import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BcryptPasswordHasher } from '../auth/password-hasher';
import { buildPgTestApp, type PgTestApp } from '../../test/pg-app';
import { createTestDatabase, dropTestDatabase } from '../../test/pg-test-db';

/**
 * Mandanten-Negativtests gegen echtes PostgreSQL und die echte Nest-App (Gesamtauftrag §6, §15):
 * zwei Organisationen, Mehrfachmitgliedschaft, Rollen, fremde und unbekannte UUIDs, anonymous,
 * gesperrtes Konto, Einschleusen der Organisation über Query/Header. Kein Mock der Datenzugriffe.
 */
describe('Mandantenkontext (echtes PostgreSQL, echte HTTP-Kette)', () => {
  const DB = 'pulsedeck_tenancy_test';
  const hasher = new BcryptPasswordHasher();

  const id = {
    olga: '00000000-0000-4000-8000-0000000000a1', // Besitzerin und Admin von Alpha
    anna: '00000000-0000-4000-8000-0000000000a2', // einfaches Mitglied in Alpha
    clara: '00000000-0000-4000-8000-0000000000a3', // committee in Alpha UND Mitglied in Beta
    bernd: '00000000-0000-4000-8000-0000000000a4', // Besitzer und Admin von Beta
    dora: '00000000-0000-4000-8000-0000000000a5', // Konto ohne Mitgliedschaft
    evil: '00000000-0000-4000-8000-0000000000a6', // gesperrt, aber Mitglied in Alpha
    alpha: '10000000-0000-4000-8000-000000000001',
    beta: '10000000-0000-4000-8000-000000000002',
    alphaAdminRolle: '20000000-0000-4000-8000-000000000001',
    alphaMitgliedRolle: '20000000-0000-4000-8000-000000000002',
    betaAdminRolle: '20000000-0000-4000-8000-000000000003',
    betaMitgliedRolle: '20000000-0000-4000-8000-000000000004',
    unbekannt: '99999999-9999-4999-8999-999999999999',
  };

  let app: INestApplication;
  let pgApp: PgTestApp;
  let admin: Client;

  const server = () => app.getHttpServer();
  const tokenFuer = (userId: string) => pgApp.tokens.signAccessToken(userId);
  async function get(pfad: string, userId?: string) {
    const anfrage = request(server()).get(pfad);
    if (userId) anfrage.set('Authorization', `Bearer ${await tokenFuer(userId)}`);
    return anfrage;
  }

  beforeAll(async () => {
    const db = await createTestDatabase(DB);
    admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();

    const hash = hasher.hash('egal-egal-egal');
    for (const [name, userId, gesperrt] of [
      ['olga', id.olga, false],
      ['anna', id.anna, false],
      ['clara', id.clara, false],
      ['bernd', id.bernd, false],
      ['dora', id.dora, false],
      ['evil', id.evil, true],
    ] as const) {
      await admin.query(
        'INSERT INTO auth_users (id, email, password_hash, email_verified, is_blocked) VALUES ($1, $2, $3, true, $4)',
        [userId, `${name}@example.org`, hash, gesperrt]
      );
    }
    await admin.query(
      `INSERT INTO organizations (id, slug, name, owner_id) VALUES
         ($1, 'alpha', 'Alpha e. V.', $3), ($2, 'beta', 'Beta e. V.', $4)`,
      [id.alpha, id.beta, id.olga, id.bernd]
    );
    await admin.query(
      `INSERT INTO organization_roles (id, organization_id, name, is_system_admin, is_default, permissions) VALUES
         ($1, $5, 'Admin', true, false, ARRAY['feed:create','wiki:edit']),
         ($2, $5, 'Mitglied', false, true, ARRAY['feed:create']),
         ($3, $6, 'Admin', true, false, ARRAY['feed:create']),
         ($4, $6, 'Mitglied', false, true, ARRAY[]::text[])`,
      [id.alphaAdminRolle, id.alphaMitgliedRolle, id.betaAdminRolle, id.betaMitgliedRolle, id.alpha, id.beta]
    );
    const mitglied = (memberId: string, userId: string, org: string, rolle: string, appRole: string, name: string) =>
      admin.query(
        `INSERT INTO members (id, organization_id, user_id, role_id, app_role, name, status, email, join_date)
         VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7, '2026-01-01')`,
        [memberId, org, userId, rolle, appRole, name, `${name.toLowerCase()}-${org.slice(0, 2)}@example.org`]
      );
    await mitglied('30000000-0000-4000-8000-000000000001', id.olga, id.alpha, id.alphaAdminRolle, 'admin', 'Olga');
    await mitglied('30000000-0000-4000-8000-000000000002', id.anna, id.alpha, id.alphaMitgliedRolle, 'member', 'Anna');
    await mitglied('30000000-0000-4000-8000-000000000003', id.clara, id.alpha, id.alphaMitgliedRolle, 'committee', 'Clara');
    await mitglied('30000000-0000-4000-8000-000000000004', id.bernd, id.beta, id.betaAdminRolle, 'admin', 'Bernd');
    await mitglied('30000000-0000-4000-8000-000000000005', id.clara, id.beta, id.betaMitgliedRolle, 'member', 'Clara');
    await mitglied('30000000-0000-4000-8000-000000000006', id.evil, id.alpha, id.alphaMitgliedRolle, 'member', 'Evil');

    pgApp = await buildPgTestApp(db.runtimeUrl);
    app = pgApp.app;
  });

  afterAll(async () => {
    await app?.close();
    await admin?.end();
    await dropTestDatabase(DB);
  });

  describe('GET /api/v1/me/memberships', () => {
    it('verlangt eine Anmeldung (anonymous → 401)', async () => {
      const antwort = await get('/api/v1/me/memberships');

      expect(antwort.status).toBe(401);
      expect(antwort.body.code).toBe('unauthorized');
    });

    it('liefert einem Mitglied nur die eigene Organisation, nicht die fremde', async () => {
      const antwort = await get('/api/v1/me/memberships', id.anna);

      expect(antwort.status).toBe(200);
      expect(antwort.body).toEqual([
        {
          member_id: '30000000-0000-4000-8000-000000000002',
          member_name: 'Anna',
          organization_id: id.alpha,
          organization_name: 'Alpha e. V.',
          organization_slug: 'alpha',
          app_role: 'member',
        },
      ]);
    });

    it('liefert bei Mehrfachmitgliedschaft jede Organisation mit der Rolle genau dieser Organisation', async () => {
      const antwort = await get('/api/v1/me/memberships', id.clara);

      expect(antwort.status).toBe(200);
      expect(antwort.body.map((m: { organization_slug: string; app_role: string }) => [m.organization_slug, m.app_role])).toEqual([
        ['alpha', 'committee'],
        ['beta', 'member'],
      ]);
    });

    it('liefert einem Konto ohne Mitgliedschaft eine leere Liste (kein Fehler)', async () => {
      const antwort = await get('/api/v1/me/memberships', id.dora);

      expect(antwort.status).toBe(200);
      expect(antwort.body).toEqual([]);
    });

    it('lehnt ein gültiges Token eines gesperrten Kontos ab (401)', async () => {
      const antwort = await get('/api/v1/me/memberships', id.evil);

      expect(antwort.status).toBe(401);
    });

    it('lässt sich nicht über Query oder Header auf ein fremdes Konto umbiegen', async () => {
      const antwort = await request(server())
        .get(`/api/v1/me/memberships?userId=${id.olga}&user_id=${id.olga}`)
        .set('Authorization', `Bearer ${await tokenFuer(id.anna)}`)
        .set('X-User-Id', id.olga);

      expect(antwort.status).toBe(200);
      expect(antwort.body).toHaveLength(1);
      expect(antwort.body[0].organization_id).toBe(id.alpha);
    });
  });

  describe('GET /api/v1/orgs/:orgId/members/me', () => {
    it('verlangt eine Anmeldung (anonymous → 401)', async () => {
      expect((await get(`/api/v1/orgs/${id.alpha}/members/me`)).status).toBe(401);
    });

    it('liefert das eigene Mitglied samt serverseitig aufgelöster Berechtigung, ohne Verknüpfungs-Token', async () => {
      const antwort = await get(`/api/v1/orgs/${id.alpha}/members/me`, id.anna);

      expect(antwort.status).toBe(200);
      expect(antwort.body).toMatchObject({
        id: '30000000-0000-4000-8000-000000000002',
        organization_id: id.alpha,
        user_id: id.anna,
        name: 'Anna',
        app_role: 'member',
        role_id: id.alphaMitgliedRolle,
        org_role: { id: id.alphaMitgliedRolle, name: 'Mitglied', is_system_admin: false },
        access: { isOwner: false, isAdmin: false, permissions: ['feed:create'] },
      });
      expect(antwort.body).not.toHaveProperty('connectionToken');
      expect(antwort.body).not.toHaveProperty('connection_token');
    });

    it('löst für den Besitzer alles auf', async () => {
      const antwort = await get(`/api/v1/orgs/${id.alpha}/members/me`, id.olga);

      expect(antwort.body.access).toEqual({
        isOwner: true,
        isAdmin: true,
        permissions: ['feed:create', 'feed:approve', 'wiki:edit', 'events:create', 'contacts:edit', 'view_issue_tracker'],
      });
    });

    it('verweigert den Zugriff auf eine fremde Organisation (403 not_a_member)', async () => {
      const antwort = await get(`/api/v1/orgs/${id.beta}/members/me`, id.anna);

      expect(antwort.status).toBe(403);
      expect(antwort.body.code).toBe('not_a_member');
    });

    it('antwortet für eine nicht existierende Organisation genauso wie für eine fremde (keine Enumeration)', async () => {
      const fremd = await get(`/api/v1/orgs/${id.beta}/members/me`, id.anna);
      const unbekannt = await get(`/api/v1/orgs/${id.unbekannt}/members/me`, id.anna);

      expect(unbekannt.status).toBe(fremd.status);
      expect(unbekannt.body).toEqual(fremd.body);
    });

    it('weist eine ungültige Organisations-ID mit 400 ab', async () => {
      const antwort = await get('/api/v1/orgs/keine-uuid/members/me', id.anna);

      expect(antwort.status).toBe(400);
      expect(antwort.body.code).toBe('validation_failed');
    });

    it('trennt bei Mehrfachmitgliedschaft die Organisationen: gleiche Person, jeweils die Rolle der angefragten Org', async () => {
      const inAlpha = await get(`/api/v1/orgs/${id.alpha}/members/me`, id.clara);
      const inBeta = await get(`/api/v1/orgs/${id.beta}/members/me`, id.clara);

      expect(inAlpha.body).toMatchObject({ organization_id: id.alpha, app_role: 'committee', id: '30000000-0000-4000-8000-000000000003' });
      expect(inBeta.body).toMatchObject({ organization_id: id.beta, app_role: 'member', id: '30000000-0000-4000-8000-000000000005' });
      expect(inAlpha.body.access.isAdmin).toBe(false);
      expect(inBeta.body.access.permissions).toEqual([]);
    });

    it('ignoriert eingeschleuste Organisations-Angaben in Query und Header', async () => {
      const antwort = await request(server())
        .get(`/api/v1/orgs/${id.alpha}/members/me?organization_id=${id.beta}&organizationId=${id.beta}`)
        .set('Authorization', `Bearer ${await tokenFuer(id.anna)}`)
        .set('X-Organization-Id', id.beta);

      expect(antwort.status).toBe(200);
      expect(antwort.body.organization_id).toBe(id.alpha);
    });

    it('gibt einem gesperrten Konto nichts heraus (401)', async () => {
      expect((await get(`/api/v1/orgs/${id.alpha}/members/me`, id.evil)).status).toBe(401);
    });
  });

  describe('GET /api/v1/orgs/:orgId/roles', () => {
    it('verlangt eine Anmeldung (anonymous → 401)', async () => {
      expect((await get(`/api/v1/orgs/${id.alpha}/roles`)).status).toBe(401);
    });

    it('zeigt Mitgliedern genau die Rollen der eigenen Organisation', async () => {
      const antwort = await get(`/api/v1/orgs/${id.alpha}/roles`, id.anna);

      expect(antwort.status).toBe(200);
      expect(antwort.body.map((r: { name: string; organization_id: string }) => [r.name, r.organization_id])).toEqual([
        ['Admin', id.alpha],
        ['Mitglied', id.alpha],
      ]);
    });

    it('zeigt keine Rollen einer fremden Organisation (403)', async () => {
      const anna = await get(`/api/v1/orgs/${id.beta}/roles`, id.anna);
      const bernd = await get(`/api/v1/orgs/${id.alpha}/roles`, id.bernd);

      expect(anna.status).toBe(403);
      expect(bernd.status).toBe(403);
    });

    it('liefert Clara je Organisation die passenden Rollen (Mehrfachmitgliedschaft)', async () => {
      const alpha = await get(`/api/v1/orgs/${id.alpha}/roles`, id.clara);
      const beta = await get(`/api/v1/orgs/${id.beta}/roles`, id.clara);

      expect(alpha.body.every((r: { organization_id: string }) => r.organization_id === id.alpha)).toBe(true);
      expect(beta.body.every((r: { organization_id: string }) => r.organization_id === id.beta)).toBe(true);
      expect(alpha.body[0].permissions).toEqual(['feed:create', 'wiki:edit']);
      expect(beta.body[0].permissions).toEqual(['feed:create']);
    });
  });

  describe('Datenhaltung', () => {
    it('erzwingt per Verbund-Fremdschlüssel, dass die Rolle zur Organisation des Mitglieds gehört', async () => {
      // Im Bestand ließ sich einem Mitglied die Rolle einer fremden Organisation zuweisen.
      await expect(
        admin.query(
          `INSERT INTO members (organization_id, role_id, name, status, email, join_date)
           VALUES ($1, $2, 'Quer', 'Active', 'quer@example.org', '2026-01-01')`,
          [id.alpha, id.betaAdminRolle]
        )
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('erzwingt höchstens eine Mitgliedschaft je Konto und Organisation', async () => {
      await expect(
        admin.query(
          `INSERT INTO members (organization_id, user_id, role_id, name, status, email, join_date)
           VALUES ($1, $2, $3, 'Doppelt', 'Active', 'doppelt@example.org', '2026-01-01')`,
          [id.alpha, id.anna, id.alphaMitgliedRolle]
        )
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('läuft die Runtime-Rolle ohne DDL-Rechte auf den neuen Tabellen (kein Umbau durch das Backend)', async () => {
      const runtime = new Client({
        connectionString: `postgres://pulsedeck_runtime:runtime-test@127.0.0.1:5433/${DB}`,
      });
      await runtime.connect();
      try {
        await expect(runtime.query('ALTER TABLE members ADD COLUMN x int')).rejects.toMatchObject({ code: '42501' });
        await expect(runtime.query('SELECT count(*) FROM members')).resolves.toBeTruthy();
      } finally {
        await runtime.end();
      }
    });
  });
});
