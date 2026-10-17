import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';
import { OrganizationsService } from './organizations.service';

/**
 * Organisationen gegen echtes PostgreSQL und die echte HTTP-Kette: Anlegen als atomarer Ablauf,
 * Slug-Regeln, öffentliche Seite ohne Fremddaten, Ändern nur durch Administratoren mit
 * Feld-Whitelist (Tarif, Besitzer und Slug sind nicht änderbar).
 */
describe('Organisationen (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_orgs_test');
    ids = f.ids;
  });
  afterAll(async () => {
    await f.schliessen();
  });

  describe('Anlegen (POST /api/v1/orgs)', () => {
    it('verlangt eine Anmeldung', async () => {
      const antwort = await f.api('post', '/api/v1/orgs', null, { name: 'X Verein', slug: 'x-verein' });

      expect(antwort.status).toBe(401);
    });

    it('legt Organisation, Standardrollen, Standard-Skills und das Besitzer-Mitglied atomar an', async () => {
      const meineVorher = await f.api('get', '/api/v1/me/organizations', ids.dora);
      expect(meineVorher.body).toEqual([]);

      const antwort = await f.api('post', '/api/v1/orgs', ids.dora, {
        name: 'Müller & Söhne Verein',
        slug: 'Müller & Söhne',
        owner_name: 'Dora Vorsitz',
      });

      expect(antwort.status).toBe(201);
      expect(antwort.body).toMatchObject({ name: 'Müller & Söhne Verein', slug: 'mueller-soehne', subscription_tier: 'free', max_members: 9999 });
      expect(antwort.body).not.toHaveProperty('owner_id');

      const orgId = antwort.body.id as string;
      const rollen = await f.admin.query('SELECT name, is_system_admin, is_default, permissions FROM organization_roles WHERE organization_id = $1 ORDER BY name', [orgId]);
      expect(rollen.rows.map((r) => [r.name, r.is_system_admin, r.is_default])).toEqual([
        ['Admin', true, false],
        ['Mitglied', false, true],
      ]);
      expect(rollen.rows[0].permissions).toHaveLength(6);
      expect(rollen.rows[1].permissions).toEqual(['feed:create']);

      const skills = await f.admin.query('SELECT category, count(*)::int AS n FROM skills WHERE organization_id = $1 GROUP BY category ORDER BY category', [orgId]);
      expect(skills.rows).toEqual([
        { category: 'ability', n: 10 },
        { category: 'availability', n: 4 },
        { category: 'interest', n: 7 },
      ]);

      const mitglieder = await f.admin.query(
        `SELECT m.user_id, m.app_role, m.role, m.name, m.email::text AS email, m.status, m.join_date, r.is_system_admin
           FROM members m JOIN organization_roles r ON r.id = m.role_id WHERE m.organization_id = $1`,
        [orgId]
      );
      expect(mitglieder.rows).toHaveLength(1);
      expect(mitglieder.rows[0]).toMatchObject({
        user_id: ids.dora,
        app_role: 'admin',
        role: 'Admin',
        name: 'Dora Vorsitz',
        email: 'dora@example.org',
        status: 'Active',
        is_system_admin: true,
      });
      expect(mitglieder.rows[0].join_date).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4}$/);

      const audit = await f.admin.query('SELECT table_name, operation, performed_by FROM audit_logs WHERE organization_id = $1 ORDER BY table_name', [orgId]);
      expect(audit.rows).toEqual([
        { table_name: 'members', operation: 'INSERT', performed_by: ids.dora },
        { table_name: 'organizations', operation: 'INSERT', performed_by: ids.dora },
      ]);

      // Der Besitzer ist danach sofort Admin der Organisation.
      const ich = await f.api('get', `/api/v1/orgs/${orgId}/members/me`, ids.dora);
      expect(ich.status).toBe(200);
      expect(ich.body.access).toMatchObject({ isOwner: true, isAdmin: true });
      const meine = await f.api('get', '/api/v1/me/organizations', ids.dora);
      expect(meine.body.map((o: { slug: string }) => o.slug)).toEqual(['mueller-soehne']);
    });

    it('antwortet bei bereits vergebener URL mit 409 und legt keine Dublette an', async () => {
      const antwort = await f.api('post', '/api/v1/orgs', ids.anna, { name: 'Anderer Verein', slug: 'ALPHA' });

      expect(antwort.status).toBe(409);
      expect(antwort.body.code).toBe('slug_taken');
      const { rows } = await f.admin.query('SELECT count(*)::int AS n FROM organizations WHERE slug = $1', ['alpha']);
      expect(rows[0].n).toBe(1);
    });

    it('lehnt reservierte, zu kurze und ungültige URLs sowie unbekannte Felder ab', async () => {
      for (const slug of ['login', 'dashboard', 'ab', '--', '']) {
        const antwort = await f.api('post', '/api/v1/orgs', ids.anna, { name: 'Test Verein', slug });
        expect(antwort.status, `Slug "${slug}"`).toBe(400);
      }
      const fremderBesitzer = await f.api('post', '/api/v1/orgs', ids.anna, { name: 'Test Verein', slug: 'testverein', owner_id: ids.olga });
      expect(fremderBesitzer.status).toBe(400);
      const tarif = await f.api('post', '/api/v1/orgs', ids.anna, { name: 'Test Verein', slug: 'testverein', subscription_tier: 'pro_bono' });
      expect(tarif.status).toBe(400);
      const { rows } = await f.admin.query("SELECT count(*)::int AS n FROM organizations WHERE slug = 'testverein'");
      expect(rows[0].n).toBe(0);
    });

    it('bricht bei einem Fehler mitten im Ablauf vollständig ab (keine halbe Organisation)', async () => {
      // Pool, der beim Anlegen des Besitzer-Mitglieds ausfällt: Organisation, Rollen und Skills
      // wurden zu diesem Zeitpunkt schon geschrieben und müssen zurückgerollt werden.
      const echt = new Pool({ connectionString: f.pgApp.config.databaseUrl, max: 2 });
      const ausfallPool = {
        connect: async (): Promise<PoolClient> => {
          const client = await echt.connect();
          const query = client.query.bind(client) as (...a: unknown[]) => unknown;
          (client as unknown as { query: unknown }).query = (text: unknown, ...rest: unknown[]) => {
            if (typeof text === 'string' && text.includes('INSERT INTO members')) {
              return Promise.reject(new Error('Simulierter Ausfall'));
            }
            return query(text, ...rest);
          };
          return client;
        },
        query: echt.query.bind(echt),
      } as unknown as Pool;
      const dienst = new OrganizationsService(ausfallPool);

      await expect(dienst.anlegen(ids.paul, { name: 'Halber Verein', slug: 'halber-verein' })).rejects.toThrow('Simulierter Ausfall');

      const orgs = await f.admin.query("SELECT count(*)::int AS n FROM organizations WHERE slug = 'halber-verein'");
      const skills = await f.admin.query("SELECT count(*)::int AS n FROM skills s WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = s.organization_id)");
      const audit = await f.admin.query("SELECT count(*)::int AS n FROM audit_logs WHERE new_data->>'slug' = 'halber-verein'");
      expect([orgs.rows[0].n, skills.rows[0].n, audit.rows[0].n]).toEqual([0, 0, 0]);
      const rollen = await f.admin.query("SELECT count(*)::int AS n FROM organization_roles WHERE organization_id NOT IN (SELECT id FROM organizations)");
      expect(rollen.rows[0].n).toBe(0);
      await echt.end();
    });
  });

  describe('Öffentliche Endpunkte', () => {
    it('meldet die Verfügbarkeit einer URL (inkl. Normalisierung und reservierter Namen)', async () => {
      expect((await f.api('get', '/api/v1/public/slugs/frei-123')).body).toEqual({ available: true });
      expect((await f.api('get', '/api/v1/public/slugs/Alpha')).body).toEqual({ available: false });
      expect((await f.api('get', '/api/v1/public/slugs/login')).body).toEqual({ available: false });
      expect((await f.api('get', '/api/v1/public/slugs/ab')).body).toEqual({ available: false });
    });

    it('liefert die Organisation anonym ohne Besitzer-ID, unbekannte mit 404', async () => {
      const antwort = await f.api('get', '/api/v1/public/organizations/ALPHA');

      expect(antwort.status).toBe(200);
      expect(antwort.body).toMatchObject({ id: ids.alpha, slug: 'alpha', name: 'Alpha e. V.' });
      expect(antwort.body).not.toHaveProperty('owner_id');
      expect((await f.api('get', '/api/v1/public/organizations/gibt-es-nicht')).status).toBe(404);
    });

    it('liefert die Seiteninhalte nur öffentlich sichtbar und nur der eigenen Organisation', async () => {
      const zukunft = '2999-01-01';
      await f.admin.query(
        `INSERT INTO events (title, date, start_time, location, organization_id, allowed_roles) VALUES
           ('Öffentlich', $1, '10:00', 'Saal', $2, '{public,member}'),
           ('Nur intern', $1, '11:00', 'Saal', $2, '{member,committee,admin}'),
           ('Vergangen', '2000-01-01', '10:00', 'Saal', $2, '{public}'),
           ('Fremd', $1, '10:00', 'Saal', $3, '{public}')`,
        [zukunft, ids.alpha, ids.beta]
      );
      const kategorie = await f.admin.query("INSERT INTO wiki_categories (organization_id, name) VALUES ($1, 'Allgemein') RETURNING id", [ids.alpha]);
      await f.admin.query(
        `INSERT INTO wiki_docs (title, description, last_updated, author, status, organization_id, allowed_roles, category) VALUES
           ('Öffentliches Wiki', 'd', 'heute', 'Olga', 'Published', $1, '{public}', $2),
           ('Internes Wiki', 'd', 'heute', 'Olga', 'Published', $1, '{member,committee,admin}', $2),
           ('Entwurf', 'd', 'heute', 'Olga', 'Draft', $1, '{public}', $2)`,
        [ids.alpha, kategorie.rows[0].id]
      );
      await f.admin.query(
        `INSERT INTO feed_items (title, author_id, status, organization_id, is_public) VALUES
           ('Öffentlicher Beitrag', $1, 'approved', $2, true),
           ('Interner Beitrag', $1, 'approved', $2, false),
           ('Unfreigegeben', $1, 'draft', $2, true)`,
        [ids.olgaMitglied, ids.alpha]
      );
      await f.admin.query(
        `INSERT INTO working_groups (name, description, lead, next_meeting, contact_type, contact_icon, organization_id) VALUES
           ('AG Alpha', 'd', 'Olga', 'n', 'Email', 'pi-envelope', $1), ('AG Beta', 'd', 'Bernd', 'n', 'Email', 'pi-envelope', $2)`,
        [ids.alpha, ids.beta]
      );
      for (let i = 1; i <= 7; i += 1) {
        await f.admin.query(
          `INSERT INTO contacts (name, role, description, email, location, organization_id) VALUES ($1, 'Rolle', 'd', $2, 'Ort', $3)`,
          [`Kontakt ${i}`, `k${i}@example.org`, ids.alpha]
        );
      }

      const antwort = await f.api('get', '/api/v1/public/organizations/alpha/overview');

      expect(antwort.status).toBe(200);
      expect(antwort.body.member_count).toBe(4);
      expect(antwort.body.events.map((e: { title: string }) => e.title)).toEqual(['Öffentlich']);
      expect(antwort.body.wiki_docs.map((d: { title: string; wiki_categories: { name: string } }) => [d.title, d.wiki_categories.name])).toEqual([['Öffentliches Wiki', 'Allgemein']]);
      expect(antwort.body.feed_items.map((i: { title: string }) => i.title)).toEqual(['Öffentlicher Beitrag']);
      expect(antwort.body.working_groups.map((g: { name: string }) => g.name)).toEqual(['AG Alpha']);
      expect(antwort.body.contacts).toHaveLength(5);
      expect(Object.keys(antwort.body.contacts[0]).sort()).toEqual(['email', 'id', 'image_url', 'name', 'phone', 'role']);
    });
  });

  describe('Lesen und Ändern (/api/v1/orgs/:orgId)', () => {
    it('lässt Mitglieder lesen, fremde Konten nicht', async () => {
      expect((await f.api('get', `/api/v1/orgs/${ids.alpha}`, ids.anna)).status).toBe(200);
      expect((await f.api('get', `/api/v1/orgs/${ids.alpha}`, ids.bernd)).status).toBe(403);
      expect((await f.api('get', `/api/v1/orgs/${ids.alpha}`, null)).status).toBe(401);
    });

    it('lässt nur Administratoren ändern und schreibt einen Audit-Eintrag mit alt/neu', async () => {
      const antwort = await f.api('patch', `/api/v1/orgs/${ids.alpha}`, ids.olga, {
        name: 'Alpha neu',
        primary_color: '#112233',
        description: 'Beschreibung',
        logo_url: 'https://example.org/logo.png',
      });

      expect(antwort.status).toBe(200);
      expect(antwort.body).toMatchObject({ name: 'Alpha neu', primary_color: '#112233', description: 'Beschreibung' });
      const audit = await f.admin.query(
        "SELECT old_data->>'name' AS alt, new_data->>'name' AS neu, performed_by FROM audit_logs WHERE table_name = 'organizations' AND operation = 'UPDATE' AND record_id = $1",
        [ids.alpha]
      );
      expect(audit.rows).toEqual([{ alt: 'Alpha e. V.', neu: 'Alpha neu', performed_by: ids.olga }]);
    });

    it('verweigert Mitgliedern, committee und Administratoren fremder Organisationen das Ändern', async () => {
      for (const konto of [ids.anna, ids.clara, ids.bernd]) {
        const antwort = await f.api('patch', `/api/v1/orgs/${ids.alpha}`, konto, { name: 'Gehackt' });
        expect(antwort.status, `Konto ${konto}`).toBe(403);
      }
      expect((await f.api('patch', `/api/v1/orgs/${ids.alpha}`, null, { name: 'Gehackt' })).status).toBe(401);
      const { rows } = await f.admin.query('SELECT name FROM organizations WHERE id = $1', [ids.alpha]);
      expect(rows[0].name).toBe('Alpha neu');
    });

    it('erlaubt nur die Felder der Einstellungsseite (Tarif, Besitzer, Slug, Mitgliederlimit nicht)', async () => {
      for (const feld of [
        { subscription_tier: 'pro_bono' },
        { max_members: 99999 },
        { owner_id: ids.anna },
        { slug: 'uebernommen' },
        { branding_enabled: false },
        { id: ids.beta },
      ]) {
        const antwort = await f.api('patch', `/api/v1/orgs/${ids.alpha}`, ids.olga, feld);
        expect(antwort.status, JSON.stringify(feld)).toBe(400);
      }
      expect((await f.api('patch', `/api/v1/orgs/${ids.alpha}`, ids.olga, { primary_color: 'rot' })).status).toBe(400);
      const { rows } = await f.admin.query('SELECT subscription_tier, max_members, owner_id, slug FROM organizations WHERE id = $1', [ids.alpha]);
      expect(rows[0]).toEqual({ subscription_tier: 'free', max_members: 9999, owner_id: ids.olga, slug: 'alpha' });
    });

    it('listet die eigenen Organisationen je Konto', async () => {
      const clara = await f.api('get', '/api/v1/me/organizations', ids.clara);

      expect(clara.body.map((o: { slug: string }) => o.slug)).toEqual(['alpha', 'beta']);
      expect(clara.body[0]).not.toHaveProperty('owner_id');
      expect((await f.api('get', '/api/v1/me/organizations', ids.bernd)).body.map((o: { slug: string }) => o.slug)).toEqual(['beta']);
      expect((await f.api('get', '/api/v1/me/organizations', null)).status).toBe(401);
    });
  });
});
