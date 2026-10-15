import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

/** Kontakte gegen echtes PostgreSQL: Lesen für Mitglieder, Schreiben nur mit contacts:edit, Mandantentrennung, globale Altkontakte nur lesbar. */
describe('Kontakte (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  const c = (org: string, rest = '') => `/api/v1/orgs/${org}/contacts${rest}`;
  const kontakt = (extra: object = {}) => ({ name: 'Maria Muster', role: 'Vorsitzende', description: 'Ansprechpartnerin', email: 'maria@example.org', location: 'Berlin', ...extra });

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_contacts_test');
    ids = f.ids;
    await f.admin.query("INSERT INTO contacts (name, role, description, email, location) VALUES ('Global', 'Plattform', 'für alle', 'global@example.org', 'Online')");
  });
  afterAll(async () => {
    await f.schliessen();
  });

  it('lässt Kontakte nur mit contacts:edit anlegen (Vorstand und Admin haben es) und kennt keine fremden Felder', async () => {
    const neu = await f.api('post', c(ids.alpha), ids.clara, kontakt({ email: ' Maria@Example.org ' }));
    expect(neu.status).toBe(201);
    expect(neu.body).toMatchObject({ name: 'Maria Muster', email: 'Maria@Example.org', organization_id: ids.alpha, phone: null });

    expect((await f.api('post', c(ids.alpha), ids.anna, kontakt())).status).toBe(403);
    expect((await f.api('post', c(ids.alpha), ids.bernd, kontakt())).status).toBe(403);
    expect((await f.api('post', c(ids.alpha), null, kontakt())).status).toBe(401);
    await f.admin.query("UPDATE organization_roles SET permissions = ARRAY['contacts:edit'] WHERE id = $1", [ids.alphaMitgliedRolle]);
    expect((await f.api('post', c(ids.alpha), ids.anna, kontakt({ name: 'Von Anna' }))).status).toBe(201); // Recht über die Rolle
    await f.admin.query("UPDATE organization_roles SET permissions = ARRAY['feed:create'] WHERE id = $1", [ids.alphaMitgliedRolle]);
    for (const falsch of [{ organization_id: ids.beta }, { email: 'keine-mail' }, { name: '' }, { image_url: 'javascript:alert(1)' }, { id: ids.beta }]) {
      expect((await f.api('post', c(ids.alpha), ids.olga, kontakt(falsch))).status, JSON.stringify(falsch)).toBe(400);
    }
  });

  it('zeigt Mitgliedern die eigenen und die globalen Kontakte, nie die einer anderen Organisation', async () => {
    await f.api('post', c(ids.beta), ids.bernd, kontakt({ name: 'Beta-Kontakt' }));

    const alpha = (await f.api('get', c(ids.alpha), ids.anna)).body.map((k: { name: string }) => k.name);

    expect(alpha).toEqual(['Global', 'Maria Muster', 'Von Anna']);
    expect((await f.api('get', c(ids.beta), ids.bernd)).body.map((k: { name: string }) => k.name)).toEqual(['Beta-Kontakt', 'Global']);
    expect((await f.api('get', c(ids.alpha), ids.dora)).status).toBe(403); // Konto ohne Mitgliedschaft
    expect((await f.api('get', c(ids.alpha), null)).status).toBe(401);
  });

  it('ändert und löscht nur Kontakte der eigenen Organisation; globale bleiben unveränderlich', async () => {
    const eigener = (await f.api('get', c(ids.alpha), ids.olga)).body.find((k: { name: string }) => k.name === 'Maria Muster').id;
    const global = (await f.admin.query("SELECT id FROM contacts WHERE name = 'Global'")).rows[0].id;
    const beta = (await f.api('get', c(ids.beta), ids.bernd)).body.find((k: { name: string }) => k.name === 'Beta-Kontakt').id;

    expect((await f.api('patch', c(ids.alpha, `/${eigener}`), ids.anna, { phone: '123' })).status).toBe(403);
    const geaendert = await f.api('patch', c(ids.alpha, `/${eigener}`), ids.clara, { phone: '030 123', location: 'Hamburg' });
    expect(geaendert.body).toMatchObject({ phone: '030 123', location: 'Hamburg', name: 'Maria Muster' });
    expect((await f.api('patch', c(ids.alpha, `/${eigener}`), ids.clara, { organization_id: ids.beta })).status).toBe(400);
    expect((await f.api('patch', c(ids.alpha, `/${global}`), ids.olga, { name: 'Gekapert' })).status).toBe(404);
    expect((await f.api('delete', c(ids.alpha, `/${global}`), ids.olga)).status).toBe(404);
    expect((await f.api('patch', c(ids.alpha, `/${beta}`), ids.olga, { name: 'Gekapert' })).status).toBe(404);
    expect((await f.api('delete', c(ids.alpha, `/${beta}`), ids.olga)).status).toBe(404);

    expect((await f.api('delete', c(ids.alpha, `/${eigener}`), ids.anna)).status).toBe(403);
    expect((await f.api('delete', c(ids.alpha, `/${eigener}`), ids.clara)).status).toBe(204);
    const verbleibend = await f.admin.query("SELECT name FROM contacts WHERE name IN ('Global', 'Beta-Kontakt', 'Gekapert') ORDER BY name");
    expect(verbleibend.rows.map((r) => r.name)).toEqual(['Beta-Kontakt', 'Global']);
    const audit = await f.admin.query("SELECT operation FROM audit_logs WHERE table_name = 'contacts' AND record_id = $1 ORDER BY created_at", [eigener]);
    expect(audit.rows.map((r) => r.operation)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
  });
});
