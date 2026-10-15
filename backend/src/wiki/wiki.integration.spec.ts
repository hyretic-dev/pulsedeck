import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

/**
 * Wiki gegen echtes PostgreSQL: Sichtbarkeit nach Rolle und Status, Schreibrechte (wiki:edit, AG-Leitung),
 * Löschen nur Vorstand/AG-Leitung, Kategorien global und je Arbeitsgruppe, Mandantentrennung.
 * Alpha: Olga (Admin), Clara (Vorstand), Anna (Mitglied, AG Technik), Paul (Mitglied, AG-Leiter Leitung).
 */
describe('Wiki (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let technik: string;
  let leitung: string;
  const w = (org: string, rest = '') => `/api/v1/orgs/${org}/wiki${rest}`;
  const doc = (extra: object = {}) => ({ title: 'Anleitung', description: 'Kurz', content: '# Inhalt', ...extra });

  async function legeAn(konto: string, extra: object = {}, org = ids.alpha): Promise<string> {
    const antwort = await f.api('post', w(org, '/docs'), konto, doc(extra));
    expect(antwort.status, JSON.stringify(antwort.body)).toBe(201);
    return antwort.body.id;
  }

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_wiki_test');
    ids = f.ids;
    const ag = async (name: string) =>
      (await f.admin.query("INSERT INTO working_groups (organization_id, name, description, lead, next_meeting, contact_type, contact_icon) VALUES ($1, $2, 'd', 'l', 'n', 'Email', 'pi-envelope') RETURNING id", [ids.alpha, name])).rows[0].id;
    technik = await ag('Technik');
    leitung = await ag('Leitung');
    await f.admin.query("INSERT INTO ag_memberships (working_group_id, member_id, role) VALUES ($1, $2, 'member'), ($3, $4, 'lead')", [technik, ids.annaMitglied, leitung, ids.paulMitglied]);
  });
  afterAll(async () => {
    await f.schliessen();
  });

  it('legt Dokumente nur mit wiki:edit oder als AG-Leitung an; Autor und Datum setzt der Server', async () => {
    const neu = await f.api('post', w(ids.alpha, '/docs'), ids.clara, doc({ author: 'Fälscher', last_updated: '1999-01-01' }));
    expect(neu.status).toBe(400); // Autor und Datum sind keine Eingabefelder
    const ok = await f.api('post', w(ids.alpha, '/docs'), ids.clara, doc());
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ author: 'Clara', status: 'Draft', organization_id: ids.alpha, allowed_roles: ['public', 'member', 'committee', 'admin'] });
    expect(ok.body.last_updated).toBe(new Date().toISOString().split('T')[0]);

    expect((await f.api('post', w(ids.alpha, '/docs'), ids.anna, doc())).status).toBe(403);
    expect((await f.api('post', w(ids.alpha, '/docs'), ids.paul, doc())).status).toBe(403); // AG-Leiter, aber ohne AG
    expect((await f.api('post', w(ids.alpha, '/docs'), ids.paul, doc({ working_group_id: leitung }))).status).toBe(201);
    expect((await f.api('post', w(ids.alpha, '/docs'), ids.paul, doc({ working_group_id: technik }))).status).toBe(403);
    expect((await f.api('post', w(ids.alpha, '/docs'), ids.bernd, doc())).status).toBe(403);
    expect((await f.api('post', w(ids.alpha, '/docs'), null, doc())).status).toBe(401);
    for (const falsch of [{ status: 'Archiviert' }, { allowed_roles: ['alle'] }, { organization_id: ids.beta }, { title: '' }, { category: 'keine-uuid' }]) {
      expect((await f.api('post', w(ids.alpha, '/docs'), ids.olga, doc(falsch))).status, JSON.stringify(falsch)).toBe(400);
    }
    // Kategorie und AG müssen zur eigenen Organisation gehören
    const fremdeKategorie = (await f.admin.query("INSERT INTO wiki_categories (organization_id, name) VALUES ($1, 'Beta-Kat') RETURNING id", [ids.beta])).rows[0].id;
    expect((await f.api('post', w(ids.alpha, '/docs'), ids.olga, doc({ category: fremdeKategorie }))).status).toBe(400);
  });

  it('zeigt Mitgliedern nur veröffentlichte Dokumente ihrer Rolle, Bearbeitern und AG-Leitung mehr', async () => {
    await legeAn(ids.olga, { title: 'W-oeffentlich', status: 'Published', allowed_roles: ['public', 'member', 'committee', 'admin'] });
    await legeAn(ids.olga, { title: 'W-mitglieder', status: 'Published', allowed_roles: ['member', 'committee', 'admin'] });
    await legeAn(ids.olga, { title: 'W-vorstand', status: 'Published', allowed_roles: ['committee', 'admin'] });
    await legeAn(ids.olga, { title: 'W-admin', status: 'Published', allowed_roles: ['admin'] });
    await legeAn(ids.olga, { title: 'W-entwurf', status: 'Draft' });
    await legeAn(ids.olga, { title: 'W-ag-entwurf', status: 'Draft', working_group_id: leitung });
    const titel = async (konto: string) => (await f.api('get', w(ids.alpha, '/docs'), konto)).body.map((d: { title: string }) => d.title).filter((t: string) => t.startsWith('W-')).sort();

    expect(await titel(ids.anna)).toEqual(['W-mitglieder', 'W-oeffentlich']);
    expect(await titel(ids.paul)).toEqual(['W-ag-entwurf', 'W-mitglieder', 'W-oeffentlich']); // eigene Leitungsgruppe
    expect(await titel(ids.clara)).toEqual(['W-admin', 'W-ag-entwurf', 'W-entwurf', 'W-mitglieder', 'W-oeffentlich', 'W-vorstand']);
    expect(await titel(ids.olga)).toEqual(await titel(ids.clara));
    expect((await f.api('get', w(ids.alpha, '/docs'), ids.bernd)).status).toBe(403);
    expect((await f.api('get', w(ids.alpha, '/docs'), null)).status).toBe(401);
  });

  it('antwortet auf unsichtbare Dokumente mit 404 und auf sichtbare, aber nicht änderbare mit 403', async () => {
    const entwurf = await legeAn(ids.olga, { title: 'X-entwurf', status: 'Draft' });
    const sichtbar = await legeAn(ids.olga, { title: 'X-sichtbar', status: 'Published', allowed_roles: ['member'] });

    for (const methode of ['get', 'delete'] as const) expect((await f.api(methode, w(ids.alpha, `/docs/${entwurf}`), ids.anna)).status, methode).toBe(404);
    expect((await f.api('patch', w(ids.alpha, `/docs/${entwurf}`), ids.anna, { title: 'x' })).status).toBe(404);
    expect((await f.api('get', w(ids.alpha, `/docs/${sichtbar}`), ids.anna)).status).toBe(200);
    expect((await f.api('patch', w(ids.alpha, `/docs/${sichtbar}`), ids.anna, { title: 'Hack' })).status).toBe(403);
    expect((await f.api('delete', w(ids.alpha, `/docs/${sichtbar}`), ids.anna)).status).toBe(403);
    expect((await f.api('get', w(ids.beta, `/docs/${sichtbar}`), ids.bernd)).status).toBe(404); // fremde Organisation
    expect((await f.api('get', w(ids.alpha, '/docs/nicht-uuid'), ids.anna)).status).toBe(400);
  });

  it('ändert Dokumente mit Prüfung beider Arbeitsgruppen und aktualisiert Datum und Audit', async () => {
    const id = await legeAn(ids.paul, { title: 'Y-leitung', working_group_id: leitung });

    const geaendert = await f.api('patch', w(ids.alpha, `/docs/${id}`), ids.paul, { content: 'Neu', status: 'Published' });
    expect(geaendert.body).toMatchObject({ content: 'Neu', status: 'Published', author: 'Paul' }); // Autor bleibt
    expect((await f.api('patch', w(ids.alpha, `/docs/${id}`), ids.paul, { working_group_id: technik })).status).toBe(403); // nicht in fremde AG verschieben
    expect((await f.api('patch', w(ids.alpha, `/docs/${id}`), ids.paul, { working_group_id: null })).status).toBe(403); // nicht zum globalen Dokument machen
    expect((await f.api('patch', w(ids.alpha, `/docs/${id}`), ids.paul, { author: 'Fälscher' })).status).toBe(400);
    expect((await f.api('patch', w(ids.alpha, `/docs/${id}`), ids.olga, { working_group_id: technik })).body.working_group_id).toBe(technik);
    const audit = await f.admin.query("SELECT operation FROM audit_logs WHERE table_name = 'wiki_docs' AND record_id = $1 ORDER BY created_at", [id]);
    expect(audit.rows.map((r) => r.operation)).toEqual(['INSERT', 'UPDATE', 'UPDATE']);
  });

  it('erlaubt das Löschen nur Vorstand, Admin und der Leitung der eigenen Arbeitsgruppe', async () => {
    const global = await legeAn(ids.olga, { title: 'Z-global', status: 'Published' });
    const ag = await legeAn(ids.olga, { title: 'Z-ag', status: 'Published', working_group_id: leitung });
    await f.admin.query("UPDATE organization_roles SET permissions = ARRAY['feed:create', 'wiki:edit'] WHERE id = $1", [ids.alphaMitgliedRolle]);

    expect((await f.api('delete', w(ids.alpha, `/docs/${global}`), ids.anna)).status).toBe(403); // Bearbeiter, aber nicht Vorstand
    expect((await f.api('delete', w(ids.alpha, `/docs/${global}`), ids.paul)).status).toBe(403);
    expect((await f.api('delete', w(ids.alpha, `/docs/${ag}`), ids.paul)).status).toBe(204); // Leiter seiner AG
    expect((await f.api('delete', w(ids.alpha, `/docs/${global}`), ids.clara)).status).toBe(204);
    expect((await f.api('delete', w(ids.alpha, `/docs/${global}`), ids.clara)).status).toBe(404);
    await f.admin.query("UPDATE organization_roles SET permissions = ARRAY['feed:create'] WHERE id = $1", [ids.alphaMitgliedRolle]);
  });

  describe('Kategorien', () => {
    it('legt globale Kategorien nur durch den Vorstand und AG-Kategorien durch die AG-Leitung an; Namen sind eindeutig', async () => {
      const global = await f.api('post', w(ids.alpha, '/categories'), ids.clara, { name: 'Allgemein', icon: 'pi-book', sort_order: 1 });
      expect(global.status).toBe(201);
      expect(global.body).toMatchObject({ name: 'Allgemein', working_group_id: null, organization_id: ids.alpha });

      expect((await f.api('post', w(ids.alpha, '/categories'), ids.anna, { name: 'Hack' })).status).toBe(403);
      expect((await f.api('post', w(ids.alpha, '/categories'), ids.paul, { name: 'Hack' })).status).toBe(403); // AG-Leiter darf nicht global
      expect((await f.api('post', w(ids.alpha, '/categories'), ids.paul, { name: 'Intern', working_group_id: leitung })).status).toBe(201);
      expect((await f.api('post', w(ids.alpha, '/categories'), ids.paul, { name: 'Intern', working_group_id: technik })).status).toBe(403);
      const doppelt = await f.api('post', w(ids.alpha, '/categories'), ids.clara, { name: 'Allgemein' });
      expect(doppelt.status).toBe(409);
      expect(doppelt.body.code).toBe('category_exists');
      expect((await f.api('post', w(ids.alpha, '/categories'), ids.paul, { name: 'Intern', working_group_id: leitung })).status).toBe(409);
      expect((await f.api('post', w(ids.alpha, '/categories'), ids.olga, { name: 'X', working_group_id: ids.unbekannt })).status).toBe(400);
      expect((await f.api('post', w(ids.alpha, '/categories'), ids.clara, { name: 'X', organization_id: ids.beta })).status).toBe(400);
    });

    it('zeigt AG-Kategorien nur deren Mitgliedern und dem Vorstand', async () => {
      await f.api('post', w(ids.alpha, '/categories'), ids.olga, { name: 'Technik-Intern', working_group_id: technik });
      const namen = async (konto: string) => (await f.api('get', w(ids.alpha, '/categories'), konto)).body.map((c: { name: string }) => c.name).sort();

      expect(await namen(ids.anna)).toEqual(['Allgemein', 'Technik-Intern']); // Anna ist in Technik, nicht in Leitung
      expect(await namen(ids.paul)).toEqual(['Allgemein', 'Intern']);
      expect(await namen(ids.clara)).toEqual(['Allgemein', 'Intern', 'Technik-Intern']);
      expect((await f.api('get', w(ids.beta, '/categories'), ids.olga)).status).toBe(403);
    });

    it('ändert und löscht Kategorien mit denselben Rechten; Dokumente behalten ihren Inhalt', async () => {
      const kat = (await f.api('post', w(ids.alpha, '/categories'), ids.clara, { name: 'Zum Löschen' })).body.id;
      const docId = await legeAn(ids.clara, { title: 'In Kategorie', category: kat });

      expect((await f.api('patch', w(ids.alpha, `/categories/${kat}`), ids.anna, { name: 'Hack' })).status).toBe(403);
      expect((await f.api('patch', w(ids.alpha, `/categories/${kat}`), ids.clara, { working_group_id: technik })).status).toBe(400); // Zuordnung unveränderlich
      expect((await f.api('patch', w(ids.alpha, `/categories/${kat}`), ids.clara, { name: 'Allgemein' })).status).toBe(409);
      expect((await f.api('patch', w(ids.alpha, `/categories/${kat}`), ids.clara, { name: 'Umbenannt', sort_order: 5 })).body).toMatchObject({ name: 'Umbenannt', sort_order: 5 });
      expect((await f.api('delete', w(ids.alpha, `/categories/${kat}`), ids.anna)).status).toBe(403);
      expect((await f.api('delete', w(ids.alpha, `/categories/${kat}`), ids.clara)).status).toBe(204);

      const nachher = await f.api('get', w(ids.alpha, `/docs/${docId}`), ids.clara);
      expect(nachher.body).toMatchObject({ title: 'In Kategorie', category: null });
      expect((await f.api('delete', w(ids.beta, `/categories/${kat}`), ids.bernd)).status).toBe(404);
    });
  });
});
