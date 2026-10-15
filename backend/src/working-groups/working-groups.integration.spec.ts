import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

/** Arbeitsgruppen gegen echtes PostgreSQL: Mandantentrennung, Rechte von Admin/AG-Leitung/Mitglied, Rollen. */
describe('Arbeitsgruppen (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let ag: string;
  let betaAg: string;
  const w = (org: string, rest = '') => `/api/v1/orgs/${org}/working-groups${rest}`;
  const neueAg = (name: string, extra: object = {}) => ({
    name, description: 'Beschreibung', lead: 'Leitung', next_meeting: 'Montags', contact_type: 'Discord', contact_icon: 'pi-discord', ...extra,
  });

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_wg_test');
    ids = f.ids;
    betaAg = (await f.admin.query("INSERT INTO working_groups (organization_id, name, description, lead, next_meeting, contact_type, contact_icon) VALUES ($1, 'Beta-AG', 'd', 'l', 'n', 'Email', 'pi-envelope') RETURNING id", [ids.beta])).rows[0].id;
  });
  afterAll(async () => {
    await f.schliessen();
  });

  it('legt AGs nur durch Administratoren an und kennt keine privilegierten Felder', async () => {
    const neu = await f.api('post', w(ids.alpha), ids.olga, neueAg('AG Medien', { tags: ['Presse'], category: 'AGs' }));
    expect(neu.status).toBe(201);
    expect(neu.body).toMatchObject({ name: 'AG Medien', organization_id: ids.alpha, members_count: 0, tags: ['Presse'], category: 'AGs' });
    ag = neu.body.id;

    for (const konto of [ids.anna, ids.clara, ids.bernd]) expect((await f.api('post', w(ids.alpha), konto, neueAg('X'))).status, konto).toBe(403);
    expect((await f.api('post', w(ids.alpha), null, neueAg('X'))).status).toBe(401);
    for (const feld of [{ organization_id: ids.beta }, { members_count: 99 }, { id: ids.beta }, { contact_type: 'Telegram' }]) {
      expect((await f.api('post', w(ids.alpha), ids.olga, neueAg('Y', feld))).status, JSON.stringify(feld)).toBe(400);
    }
  });

  it('akzeptiert ein leeres „nächstes Treffen“ (die Oberfläche berechnet es erst aus den Terminen)', async () => {
    const antwort = await f.api('post', w(ids.alpha), ids.olga, neueAg('AG ohne Termin', { next_meeting: '' }));

    expect(antwort.status).toBe(201);
    expect(antwort.body.next_meeting).toBe('');
    await f.admin.query('DELETE FROM working_groups WHERE id = $1', [antwort.body.id]);
  });

  it('listet nur AGs der eigenen Organisation mit der Mitgliederzahl aus beiden Mitgliedschaftstabellen', async () => {
    await f.admin.query('INSERT INTO ag_memberships (working_group_id, member_id, role) VALUES ($1, $2, $3)', [ag, ids.annaMitglied, 'member']);
    await f.admin.query('INSERT INTO working_group_members (working_group_id, member_id) VALUES ($1, $2), ($1, $3)', [ag, ids.paulMitglied, ids.annaMitglied]);

    const antwort = await f.api('get', w(ids.alpha), ids.anna);

    expect(antwort.status).toBe(200);
    expect(antwort.body.map((g: { name: string }) => g.name)).toEqual(['AG Medien']);
    expect(antwort.body[0].members_count).toBe(2); // Anna doppelt eingetragen zählt einmal
    expect(JSON.stringify(antwort.body)).not.toContain('Beta-AG');
    expect((await f.api('get', w(ids.alpha), ids.bernd)).status).toBe(403);
  });

  it('meldet Kontakt-Lücken nur Administratoren, Vorstand und AG-Leitung', async () => {
    // Discord ist verlangt: weder Anna noch Paul haben einen Kanal
    const admin = await f.api('get', w(ids.alpha), ids.olga);
    const mitglied = await f.api('get', w(ids.alpha), ids.anna);

    expect(admin.body[0].missing_contact_count).toBe(2);
    expect(mitglied.body[0]).not.toHaveProperty('missing_contact_count');
    await f.admin.query("UPDATE members SET contact_channels = '{\"Discord\":\"anna#1\"}' WHERE id = $1", [ids.annaMitglied]);
    expect((await f.api('get', w(ids.alpha), ids.clara)).body[0].missing_contact_count).toBe(1);
  });

  it('lässt Mitglieder beitreten (immer als member) und austreten; eigene Rolle nicht frei wählbar', async () => {
    const beitritt = await f.api('put', w(ids.alpha, `/${ag}/members/me`), ids.clara);
    expect(beitritt.status).toBe(200);
    expect(beitritt.body).toEqual({ working_group_id: ag, role: 'member' });
    // Rolle im Body wird nicht ausgewertet: der Beitritt bleibt „member“
    const mitRolle = await f.api('put', w(ids.alpha, `/${ag}/members/me`), ids.paul, { role: 'lead' });
    expect(mitRolle.body.role).toBe('member');
    expect((await f.api('delete', w(ids.alpha, `/${ag}/members/${ids.paulMitglied}`), ids.paul)).status).toBe(204);
    expect((await f.api('get', w(ids.alpha, '/mine'), ids.clara)).body).toEqual([{ working_group_id: ag, role: 'member' }]);
    // fremde Organisation / AG
    expect((await f.api('put', w(ids.alpha, `/${betaAg}/members/me`), ids.clara)).status).toBe(404);
    expect((await f.api('put', w(ids.beta, `/${ag}/members/me`), ids.bernd)).status).toBe(404);
  });

  it('erlaubt Rollenwechsel nur Administratoren und AG-Leitung; Leitung darf bearbeiten, aber nicht löschen', async () => {
    expect((await f.api('patch', w(ids.alpha, `/${ag}/members/${ids.annaMitglied}`), ids.anna, { role: 'lead' })).status).toBe(403);
    expect((await f.api('patch', w(ids.alpha, `/${ag}/members/${ids.annaMitglied}`), ids.olga, { role: 'lead' })).status).toBe(204);

    // Anna ist jetzt Leitung dieser AG: sie darf ihre AG ändern und Mitglieder verwalten
    const aenderung = await f.api('patch', w(ids.alpha, `/${ag}`), ids.anna, { next_meeting: 'Dienstags' });
    expect(aenderung.status).toBe(200);
    expect(aenderung.body.next_meeting).toBe('Dienstags');
    expect((await f.api('put', w(ids.alpha, `/${ag}/members/${ids.paulMitglied}`), ids.anna, { role: 'member' })).status).toBe(200);
    // ... aber keine andere AG und nicht löschen
    const andere = await f.api('post', w(ids.alpha), ids.olga, neueAg('Andere AG'));
    expect((await f.api('patch', w(ids.alpha, `/${andere.body.id}`), ids.anna, { name: 'X' })).status).toBe(403);
    expect((await f.api('delete', w(ids.alpha, `/${ag}`), ids.anna)).status).toBe(403);
    // Mitglied ohne Leitung darf nichts ändern
    expect((await f.api('patch', w(ids.alpha, `/${ag}`), ids.clara, { name: 'X' })).status).toBe(403);
    expect((await f.api('patch', w(ids.alpha, `/${ag}/members/${ids.claraAlpha}`), ids.clara, { role: 'lead' })).status).toBe(403);
    expect((await f.api('patch', w(ids.alpha, `/${ag}/members/${ids.annaMitglied}`), ids.olga, { role: 'boss' })).status).toBe(400);
  });

  it('zeigt Mitglieder mit Rollen und trennt Organisationen', async () => {
    const antwort = await f.api('get', w(ids.alpha, `/${ag}/members`), ids.anna);

    expect(antwort.status).toBe(200);
    expect(antwort.body.map((m: { name: string; role: string }) => [m.name, m.role]).sort()).toEqual([
      ['Anna', 'lead'], ['Clara', 'member'], ['Paul', 'member'],
    ]);
    expect((await f.api('get', w(ids.alpha, `/${betaAg}/members`), ids.olga)).status).toBe(404);
    expect((await f.api('get', w(ids.beta, `/${ag}/members`), ids.bernd)).status).toBe(404);
    // Mitglied einer fremden Organisation lässt sich nicht hinzufügen
    expect((await f.api('put', w(ids.alpha, `/${ag}/members/${ids.berndMitglied}`), ids.olga, { role: 'member' })).status).toBe(404);
  });

  it('listet Kategorien und löscht AGs samt Mitgliedschaften nur durch Administratoren', async () => {
    expect((await f.api('get', w(ids.alpha, '/categories'), ids.anna)).body).toEqual(['AGs']);
    expect((await f.api('delete', w(ids.alpha, `/${ag}`), ids.olga)).status).toBe(204);
    expect((await f.admin.query('SELECT count(*)::int AS n FROM ag_memberships WHERE working_group_id = $1', [ag])).rows[0].n).toBe(0);
    expect((await f.api('delete', w(ids.alpha, `/${betaAg}`), ids.olga)).status).toBe(404);
    expect((await f.admin.query('SELECT count(*)::int AS n FROM working_groups WHERE id = $1', [betaAg])).rows[0].n).toBe(1);
  });
});
