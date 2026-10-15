import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';

import { BcryptPasswordHasher } from '../src/auth/password-hasher';
import type { AppConfig } from '../src/config/configuration';

import { buildPgTestApp, type PgTestApp } from './pg-app';
import { createTestDatabase, dropTestDatabase } from './pg-test-db';

/**
 * Gemeinsamer Fixture für Modul-Integrationstests: echte Datenbank, echte Nest-App, echte HTTP-Kette.
 *
 *   Alpha: Olga (Besitzerin, Admin), Clara (committee), Anna (member), Paul (member, zweites Mitglied)
 *   Beta : Bernd (Besitzer, Admin), Clara (member)
 *   Dora : Konto ohne Mitgliedschaft
 */
export const ids = {
  olga: '00000000-0000-4000-8000-0000000000a1',
  anna: '00000000-0000-4000-8000-0000000000a2',
  clara: '00000000-0000-4000-8000-0000000000a3',
  bernd: '00000000-0000-4000-8000-0000000000a4',
  dora: '00000000-0000-4000-8000-0000000000a5',
  paul: '00000000-0000-4000-8000-0000000000a6',
  alpha: '10000000-0000-4000-8000-000000000001',
  beta: '10000000-0000-4000-8000-000000000002',
  alphaAdminRolle: '20000000-0000-4000-8000-000000000001',
  alphaMitgliedRolle: '20000000-0000-4000-8000-000000000002',
  betaAdminRolle: '20000000-0000-4000-8000-000000000003',
  betaMitgliedRolle: '20000000-0000-4000-8000-000000000004',
  olgaMitglied: '30000000-0000-4000-8000-000000000001',
  annaMitglied: '30000000-0000-4000-8000-000000000002',
  claraAlpha: '30000000-0000-4000-8000-000000000003',
  berndMitglied: '30000000-0000-4000-8000-000000000004',
  claraBeta: '30000000-0000-4000-8000-000000000005',
  paulMitglied: '30000000-0000-4000-8000-000000000006',
  unbekannt: '99999999-9999-4999-8999-999999999999',
};

export interface Fixture {
  app: INestApp;
  pgApp: PgTestApp;
  admin: Client;
  ids: typeof ids;
  /** Bearer-Token für ein Konto (für Konten, die erst im Test entstehen). */
  tokenFuer(userId: string): Promise<string>;
  /** Anfrage mit Bearer-Token des Kontos (oder anonym). Fixture-Konten haben vorab erzeugte Tokens. */
  api(methode: 'get' | 'post' | 'put' | 'patch' | 'delete', pfad: string, userId?: string | null, body?: unknown): request.Test;
  schliessen(): Promise<void>;
}
type INestApp = INestApplication;

export async function erstelleFixture(dbName: string, konfiguration: Partial<AppConfig> = {}): Promise<Fixture> {
  const db = await createTestDatabase(dbName);
  const admin = new Client({ connectionString: db.adminUrl });
  await admin.connect();

  const hash = new BcryptPasswordHasher().hash('egal-egal-egal');
  const konten: Array<[string, string]> = [
    ['olga', ids.olga], ['anna', ids.anna], ['clara', ids.clara],
    ['bernd', ids.bernd], ['dora', ids.dora], ['paul', ids.paul],
  ];
  for (const [name, id] of konten) {
    await admin.query(
      'INSERT INTO auth_users (id, email, password_hash, email_verified) VALUES ($1, $2, $3, true)',
      [id, `${name}@example.org`, hash]
    );
  }
  await admin.query(
    `INSERT INTO organizations (id, slug, name, owner_id) VALUES ($1, 'alpha', 'Alpha e. V.', $3), ($2, 'beta', 'Beta e. V.', $4)`,
    [ids.alpha, ids.beta, ids.olga, ids.bernd]
  );
  const alleRechte = ['feed:create', 'feed:approve', 'wiki:edit', 'events:create', 'contacts:edit', 'view_issue_tracker'];
  await admin.query(
    `INSERT INTO organization_roles (id, organization_id, name, is_system_admin, is_default, permissions) VALUES
       ($1, $5, 'Admin', true, false, $7), ($2, $5, 'Mitglied', false, true, ARRAY['feed:create']),
       ($3, $6, 'Admin', true, false, $7), ($4, $6, 'Mitglied', false, true, ARRAY['feed:create'])`,
    [ids.alphaAdminRolle, ids.alphaMitgliedRolle, ids.betaAdminRolle, ids.betaMitgliedRolle, ids.alpha, ids.beta, alleRechte]
  );
  const mitglied = (id: string, userId: string, org: string, rolle: string, appRole: string, name: string) =>
    admin.query(
      `INSERT INTO members (id, organization_id, user_id, role_id, app_role, name, status, email, join_date)
       VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7, '01.01.2026')`,
      [id, org, userId, rolle, appRole, name, `${name.toLowerCase()}-${org.slice(0, 2)}@example.org`]
    );
  await mitglied(ids.olgaMitglied, ids.olga, ids.alpha, ids.alphaAdminRolle, 'admin', 'Olga');
  await mitglied(ids.annaMitglied, ids.anna, ids.alpha, ids.alphaMitgliedRolle, 'member', 'Anna');
  await mitglied(ids.claraAlpha, ids.clara, ids.alpha, ids.alphaMitgliedRolle, 'committee', 'Clara');
  await mitglied(ids.berndMitglied, ids.bernd, ids.beta, ids.betaAdminRolle, 'admin', 'Bernd');
  await mitglied(ids.claraBeta, ids.clara, ids.beta, ids.betaMitgliedRolle, 'member', 'Clara');
  await mitglied(ids.paulMitglied, ids.paul, ids.alpha, ids.alphaMitgliedRolle, 'member', 'Paul');

  const pgApp = await buildPgTestApp(db.runtimeUrl, konfiguration);
  const app = pgApp.app;

  const tokens = new Map<string, string>();
  for (const [, id] of konten) tokens.set(id, await pgApp.tokens.signAccessToken(id));

  return {
    app,
    pgApp,
    admin,
    ids,
    tokenFuer: async (userId) => {
      if (!tokens.has(userId)) tokens.set(userId, await pgApp.tokens.signAccessToken(userId));
      return tokens.get(userId) as string;
    },
    api(methode, pfad, userId, body) {
      let anfrage = request(app.getHttpServer())[methode](pfad);
      if (userId) anfrage = anfrage.set('Authorization', `Bearer ${tokens.get(userId)}`);
      if (body !== undefined) anfrage = anfrage.send(body as object);
      return anfrage;
    },
    async schliessen() {
      await app.close();
      await admin.end();
      await dropTestDatabase(dbName);
    },
  };
}
