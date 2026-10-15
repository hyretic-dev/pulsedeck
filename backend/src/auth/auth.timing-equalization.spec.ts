import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService, type PasswordHasher } from './auth.service';
import { TokenService } from './token.service';
import {
  InMemoryAuthUserRepository,
  InMemoryRefreshTokenStore,
  InMemoryVerificationTokenStore,
} from '../../test/auth-memory-stores';

/**
 * Regression aus dem Folge-Audit: Keine Kontoenumeration über die Antwortzeit
 * (Folgeauftrag Schritt A). Gemessen wurde: Login mit unbekannter E-Mail ~0 ms,
 * mit bekannter E-Mail und falschem Passwort ~54 ms (bcrypt nur im zweiten Fall);
 * Signup umgekehrt (neu ~55 ms, bestehend ~0 ms).
 *
 * Deterministischer Nachweis statt Zeitmessung (die wäre flackernd): In beiden Fällen
 * muss derselbe teure Hash-Schritt mit demselben Kostenfaktor ausgeführt werden.
 */
class ZaehlenderHasher implements PasswordHasher {
  readonly geprueftGegen: string[] = [];
  hashAufrufe = 0;

  verify(password: string, hash: string): boolean {
    this.geprueftGegen.push(hash);
    return hash === `hash(${password})`;
  }

  hash(password: string): string {
    this.hashAufrufe += 1;
    return `hash(${password})`;
  }
}

describe('AuthService: gleicher Hash-Aufwand für bekannte und unbekannte E-Mails', () => {
  let users: InMemoryAuthUserRepository;
  let hasher: ZaehlenderHasher;
  let service: AuthService;

  beforeEach(() => {
    users = new InMemoryAuthUserRepository();
    users.anlegen({
      id: 'u1',
      email: 'bekannt@example.org',
      passwordHash: 'hash(richtiges-passwort)',
      emailVerified: true,
      isBlocked: false,
    });
    hasher = new ZaehlenderHasher();
    service = new AuthService(
      users,
      hasher,
      new TokenService({
        secret: new TextEncoder().encode('test-secret-test-secret-test-secret-1234'),
        issuer: 'pulsedeck-test',
        audience: 'pulsedeck-app',
        accessTtlSeconds: 900,
      }),
      new InMemoryRefreshTokenStore(),
      new InMemoryVerificationTokenStore(),
      { sendVerificationEmail: async () => undefined, sendMagicLinkEmail: async () => undefined, sendInvitationEmail: async () => undefined, sendPasswordResetEmail: async () => undefined },
      'https://app.example.org'
    );
  });

  it('Login: prüft bei unbekannter E-Mail das Passwort gegen einen Platzhalter-Hash mit bcrypt-Kostenfaktor 10', async () => {
    await expect(
      service.loginWithPassword('unbekannt@example.org', 'irgendwas')
    ).rejects.toMatchObject({ code: 'invalid_credentials', status: 401 });

    expect(hasher.geprueftGegen).toHaveLength(1);
    expect(hasher.geprueftGegen[0]).toMatch(/^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/);
  });

  it('Login: bekannte E-Mail führt genau einen Hash-Vergleich aus (wie die unbekannte)', async () => {
    await expect(
      service.loginWithPassword('bekannt@example.org', 'falsches-passwort')
    ).rejects.toMatchObject({ code: 'invalid_credentials' });

    expect(hasher.geprueftGegen).toEqual(['hash(richtiges-passwort)']);
  });

  it('Login: der Platzhalter-Hash lässt sich mit keinem Passwort erfüllen', async () => {
    // Der Hasher meldet für den Platzhalter immer „falsch“; ein echtes Passwort würde ihn nicht erfüllen.
    for (const passwort of ['', 'passwort', 'hash(passwort)']) {
      await expect(
        service.loginWithPassword('unbekannt@example.org', passwort)
      ).rejects.toMatchObject({ code: 'invalid_credentials' });
    }
  });

  it('Signup: berechnet den Passwort-Hash auch für eine bestehende E-Mail, legt aber nichts an', async () => {
    await service.signUp('bekannt@example.org', 'sicheres-passwort');

    expect(hasher.hashAufrufe).toBe(1);
    expect(await users.findByEmail('bekannt@example.org')).toMatchObject({ id: 'u1' });
  });

  it('Signup: neue E-Mail berechnet den Hash genau einmal', async () => {
    await service.signUp('neu@example.org', 'sicheres-passwort');

    expect(hasher.hashAufrufe).toBe(1);
    expect(await users.findByEmail('neu@example.org')).not.toBeNull();
  });
});
