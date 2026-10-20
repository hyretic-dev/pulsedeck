import { createHash, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

import { PgAuthUserRepository } from './pg.auth-user-repository';
import { PgMaintenance } from './pg.maintenance';
import { PgRateLimiter } from './pg.rate-limiter';
import { PgRefreshTokenStore } from './pg.refresh-token-store';
import { PgVerificationTokenStore } from './pg.verification-token-store';
import { ADMIN_URL, createTestDatabase } from '../../../test/pg-test-db';

/**
 * Schritt C: Integrationstests gegen echtes PostgreSQL (pg-Container).
 * Pflichtnachweise: Migration auf leerer DB, Port-Verträge, Atomarität,
 * Ablaufprüfung, begrenzter Pool ohne offene Handles, Rollen-Trennung.
 * Unit-Tests mit Mocks gelten für diese Nachweise nicht.
 */
const RUNTIME_URL = `postgres://pulsedeck_runtime:runtime-test@${new URL(ADMIN_URL).host}/pulsedeck_test`;

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('PostgreSQL-Schicht (Integrationstests gegen echte Datenbank)', () => {
  let admin: Client;
  let pool: Pool;
  let users: PgAuthUserRepository;
  let refreshStore: PgRefreshTokenStore;
  let verificationStore: PgVerificationTokenStore;
  let rateLimiter: PgRateLimiter;
  let maintenance: PgMaintenance;

  beforeAll(async () => {
    // Frische Test-DB + Rollen + Migrationen mit der Migrations-Rolle (Migration-before-serve analog).
    await createTestDatabase('pulsedeck_test');
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();

    // Runtime-Zugang: eingeschränkte Rolle, begrenzter Pool.
    pool = new Pool({ connectionString: RUNTIME_URL, max: 5 });
    pool.on('error', () => undefined); // Teardown: DROP ... WITH (FORCE) trennt Leerlauf-Clients
    users = new PgAuthUserRepository(pool);
    refreshStore = new PgRefreshTokenStore(pool);
    verificationStore = new PgVerificationTokenStore(pool);
    rateLimiter = new PgRateLimiter(pool, { max: 3, windowMs: 60 * 60 * 1000 });
    maintenance = new PgMaintenance(pool);
  });

  afterAll(async () => {
    await pool.end();
    expect(pool.ended).toBe(true);
    await admin.query('DROP DATABASE IF EXISTS pulsedeck_test WITH (FORCE)');
    await admin.end();
  });

  it('hat die Migrationen auf der leeren DB ausgeführt (Tabellen vorhanden)', async () => {
    const result = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    const tabellen = result.rows.map((r) => r.tablename);
    // Auth-Tabellen aus den ersten Migrationen müssen vorhanden sein; weitere Module kommen dazu.
    expect(tabellen).toEqual(
      expect.arrayContaining([
        'auth_users',
        'pgmigrations',
        'rate_limits',
        'refresh_tokens',
        'verification_tokens',
      ])
    );
  });

  it('erfüllt den AuthUserRepository-Vertrag (citext: E-Mail case-insensitive)', async () => {
    const erstellt = await users.create('vorstand@example.org', 'hash(passwort123)');
    expect(erstellt.email).toBe('vorstand@example.org');
    expect(erstellt.emailVerified).toBe(false);

    const perEmail = await users.findByEmail('Vorstand@Example.ORG');
    expect(perEmail?.id).toBe(erstellt.id);

    await users.markEmailVerified(erstellt.id);
    expect((await users.findById(erstellt.id))?.emailVerified).toBe(true);

    await users.updatePasswordHash(erstellt.id, 'hash(neu)');
    expect((await users.findById(erstellt.id))?.passwordHash).toBe('hash(neu)');
  });

  it('erzwingt den Unique-Constraint auf der E-Mail', async () => {
    await users.create('duplikat@example.org', 'x');
    await expect(users.create('Duplikat@Example.org', 'y')).rejects.toThrow();
  });

  it('erfüllt den RefreshTokenStore-Vertrag inkl. deleteAllForUser', async () => {
    const user = await users.create('sessions@example.org', 'x');
    await refreshStore.save(user.id, hash('token-1'), new Date(Date.now() + 1000));
    await refreshStore.save(user.id, hash('token-2'), new Date(Date.now() + 1000));

    expect(await refreshStore.findUserIdByHash(hash('token-1'))).toBe(user.id);

    await refreshStore.deleteByHash(hash('token-1'));
    expect(await refreshStore.findUserIdByHash(hash('token-1'))).toBeNull();

    await refreshStore.deleteAllForUser(user.id);
    expect(await refreshStore.findUserIdByHash(hash('token-2'))).toBeNull();
  });

  it('lehnt abgelaufene Refresh-Tokens ab (expires_at geprüft)', async () => {
    const user = await users.create('abgelaufen-refresh@example.org', 'x');
    await refreshStore.save(user.id, hash('expired'), new Date(Date.now() - 1000));
    expect(await refreshStore.findUserIdByHash(hash('expired'))).toBeNull();
  });

  it('löscht Refresh-Tokens kaskadierend mit dem Nutzer (FK ON DELETE CASCADE)', async () => {
    const user = await users.create('kaskade@example.org', 'x');
    await refreshStore.save(user.id, hash('kaskade'), new Date(Date.now() + 1000));
    await verificationStore.save(
      user.id,
      'email_verification',
      hash('kaskade-v'),
      new Date(Date.now() + 1000)
    );
    await pool.query('DELETE FROM auth_users WHERE id = $1', [user.id]);
    const refresh = await pool.query('SELECT * FROM refresh_tokens WHERE user_id = $1', [user.id]);
    const verification = await pool.query(
      'SELECT * FROM verification_tokens WHERE user_id = $1',
      [user.id]
    );
    expect(refresh.rows).toHaveLength(0);
    expect(verification.rows).toHaveLength(0);
  });

  it('erfüllt den VerificationTokenStore-Vertrag und lehnt abgelaufene Tokens ab', async () => {
    const user = await users.create('verifizieren@example.org', 'x');
    await verificationStore.save(
      user.id,
      'email_verification',
      hash('gueltig'),
      new Date(Date.now() + 1000)
    );
    expect(await verificationStore.consume('email_verification', hash('gueltig'))).toBe(user.id);
    // Wiederverwendung schlägt fehl.
    expect(await verificationStore.consume('email_verification', hash('gueltig'))).toBeNull();

    await verificationStore.save(
      user.id,
      'magic_link',
      hash('abgelaufen'),
      new Date(Date.now() - 1000)
    );
    expect(await verificationStore.consume('magic_link', hash('abgelaufen'))).toBeNull();
  });

  it('garantiert bei parallelem consume genau einen Gewinner (Atomarität)', async () => {
    const user = await users.create('parallel@example.org', 'x');
    const tokenHash = hash(randomBytes(16).toString('hex'));
    await verificationStore.save(
      user.id,
      'magic_link',
      tokenHash,
      new Date(Date.now() + 60_000)
    );

    const ergebnisse = await Promise.allSettled([
      verificationStore.consume('magic_link', tokenHash),
      verificationStore.consume('magic_link', tokenHash),
    ]);

    const userIds = ergebnisse
      .filter((e) => e.status === 'fulfilled')
      .map((e) => (e as PromiseFulfilledResult<string | null>).value);
    expect(userIds.filter((id) => id === user.id)).toHaveLength(1);
    expect(userIds.filter((id) => id === null)).toHaveLength(1);
  });

  it('erfüllt den RateLimiter-Vertrag (Festfenster, Schlüssel getrennt)', async () => {
    expect((await rateLimiter.consume('login:a@example.org:1.2.3.4')).allowed).toBe(true);
    expect((await rateLimiter.consume('login:a@example.org:1.2.3.4')).allowed).toBe(true);
    expect((await rateLimiter.consume('login:a@example.org:1.2.3.4')).allowed).toBe(true);
    expect((await rateLimiter.consume('login:a@example.org:1.2.3.4')).allowed).toBe(false);
    expect((await rateLimiter.consume('login:b@example.org:1.2.3.4')).allowed).toBe(true);
    expect((await rateLimiter.consume('login:a@example.org:5.6.7.8')).allowed).toBe(true);
  });

  it('bereinigt der Wartungsendpunkt abgelaufene Tokens', async () => {
    const user = await users.create('wartung@example.org', 'x');
    await refreshStore.save(user.id, hash('weg'), new Date(Date.now() - 1000));
    await verificationStore.save(
      user.id,
      'email_verification',
      hash('weg'),
      new Date(Date.now() - 1000)
    );

    await maintenance.purgeExpiredTokens();

    // Nur die eigenen Zeilen prüfen: Tokens anderer Tests mit kurzer Restlaufzeit sind sonst noch gültig (Flackern).
    const refresh = await pool.query('SELECT * FROM refresh_tokens WHERE user_id = $1', [user.id]);
    const verification = await pool.query('SELECT * FROM verification_tokens WHERE user_id = $1', [user.id]);
    expect(refresh.rows).toHaveLength(0);
    expect(verification.rows).toHaveLength(0);
  });

  it('trennt Rollen: Runtime darf DML, kein DDL, keine Migrationstabelle, kein Owner', async () => {
    // DML erlaubt
    await pool.query('SELECT * FROM auth_users');

    // Kein DDL
    await expect(pool.query('CREATE TABLE hacker (id int)')).rejects.toThrow();
    await expect(pool.query('DROP TABLE auth_users')).rejects.toThrow();

    // Keine Migrationstabelle (kein Grant), keine Ownership
    await expect(pool.query('SELECT * FROM pgmigrations')).rejects.toThrow();
    const ownership = await pool.query<{ ist_owner: boolean }>(
      `SELECT (tableowner = current_user) AS ist_owner
       FROM pg_tables WHERE tablename = 'auth_users'`
    );
    expect(ownership.rows[0].ist_owner).toBe(false);
  });

  it('hält die Poolgröße begrenzt und schließt sauber', async () => {
    expect(pool.options.max).toBe(5);
    // afterAll prüft pool.ended === true nach end().
  });
});
