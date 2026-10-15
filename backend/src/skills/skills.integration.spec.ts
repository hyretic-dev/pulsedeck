import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

/** Fähigkeiten und Zuordnungen gegen echtes PostgreSQL: Mandantentrennung, Schreibrechte, atomares Ersetzen. */
describe('Skills (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let alphaSkill: string[];
  let betaSkill: string;
  const s = (org: string) => `/api/v1/orgs/${org}/skills`;

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_skills_test');
    ids = f.ids;
    const a = await f.admin.query(
      `INSERT INTO skills (organization_id, name, category, sort_order) VALUES
         ($1, 'Fotografie', 'ability', 1), ($1, 'Moderation', 'ability', 2), ($1, 'Abends', 'availability', 1) RETURNING id`,
      [ids.alpha]
    );
    alphaSkill = a.rows.map((r) => r.id);
    betaSkill = (await f.admin.query("INSERT INTO skills (organization_id, name, category) VALUES ($1, 'Fremd', 'ability') RETURNING id", [ids.beta])).rows[0].id;
  });
  afterAll(async () => {
    await f.schliessen();
  });

  it('listet nur Skills der eigenen Organisation, sortiert nach Kategorie und Reihenfolge', async () => {
    const antwort = await f.api('get', s(ids.alpha), ids.anna);

    expect(antwort.status).toBe(200);
    expect(antwort.body.map((x: { name: string }) => x.name)).toEqual(['Fotografie', 'Moderation', 'Abends']);
    expect(JSON.stringify(antwort.body)).not.toContain('Fremd');
    expect((await f.api('get', s(ids.alpha), ids.bernd)).status).toBe(403);
    expect((await f.api('get', s(ids.alpha), null)).status).toBe(401);
  });

  it('lässt nur Administratoren Skills anlegen, ändern und löschen', async () => {
    const neu = await f.api('post', s(ids.alpha), ids.olga, { name: 'Erste Hilfe', category: 'ability', icon: 'pi-heart', sort_order: 5 });
    expect(neu.status).toBe(201);
    expect(neu.body).toMatchObject({ name: 'Erste Hilfe', organization_id: ids.alpha });

    for (const konto of [ids.anna, ids.clara, ids.bernd]) {
      expect((await f.api('post', s(ids.alpha), konto, { name: 'Verboten' })).status, konto).toBe(403);
      expect((await f.api('patch', `${s(ids.alpha)}/${neu.body.id}`, konto, { name: 'X' })).status, konto).toBe(403);
      expect((await f.api('delete', `${s(ids.alpha)}/${neu.body.id}`, konto)).status, konto).toBe(403);
    }
    expect((await f.api('patch', `${s(ids.alpha)}/${neu.body.id}`, ids.olga, { name: 'Erste Hilfe+', sort_order: 6 })).body).toMatchObject({ name: 'Erste Hilfe+', sort_order: 6 });
    expect((await f.api('delete', `${s(ids.alpha)}/${neu.body.id}`, ids.olga)).status).toBe(204);
  });

  it('weist doppelte Namen, ungültige Kategorien, fremde Organisationen und unbekannte Felder ab', async () => {
    expect((await f.api('post', s(ids.alpha), ids.olga, { name: 'Fotografie' })).body.code).toBe('skill_name_taken');
    expect((await f.api('post', s(ids.alpha), ids.olga, { name: 'X', category: 'hobby' })).status).toBe(400);
    expect((await f.api('post', s(ids.alpha), ids.olga, { name: 'X', organization_id: ids.beta })).status).toBe(400);
    expect((await f.api('patch', `${s(ids.alpha)}/${betaSkill}`, ids.olga, { name: 'Gekapert' })).status).toBe(404);
    expect((await f.api('delete', `${s(ids.alpha)}/${betaSkill}`, ids.olga)).status).toBe(404);
    expect((await f.admin.query('SELECT name FROM skills WHERE id = $1', [betaSkill])).rows[0].name).toBe('Fremd');
  });

  it('ersetzt die eigenen Skills atomar und verweigert fremde Mitglieder und fremde Skills', async () => {
    const ersetzt = await f.api('put', `/api/v1/orgs/${ids.alpha}/members/${ids.annaMitglied}/skills`, ids.anna, { skill_ids: [alphaSkill[0], alphaSkill[1]] });
    expect(ersetzt.status).toBe(200);
    expect((await f.api('get', `/api/v1/orgs/${ids.alpha}/members/${ids.annaMitglied}/skills`, ids.paul)).body.sort()).toEqual([alphaSkill[0], alphaSkill[1]].sort());

    const fremd = await f.api('put', `/api/v1/orgs/${ids.alpha}/members/${ids.annaMitglied}/skills`, ids.anna, { skill_ids: [alphaSkill[2], betaSkill] });
    expect(fremd.status).toBe(400);
    expect((await f.admin.query('SELECT count(*)::int AS n FROM member_skills WHERE member_id = $1', [ids.annaMitglied])).rows[0].n).toBe(2);

    expect((await f.api('put', `/api/v1/orgs/${ids.alpha}/members/${ids.paulMitglied}/skills`, ids.anna, { skill_ids: [] })).status).toBe(403);
    expect((await f.api('put', `/api/v1/orgs/${ids.alpha}/members/${ids.paulMitglied}/skills`, ids.olga, { skill_ids: [alphaSkill[2]] })).status).toBe(200);
    expect((await f.api('put', `/api/v1/orgs/${ids.alpha}/members/${ids.berndMitglied}/skills`, ids.olga, { skill_ids: [] })).status).toBe(404);
  });

  it('fügt einzelne Skills hinzu und entfernt sie; fremde Skills werden nicht zugeordnet', async () => {
    const basis = `/api/v1/orgs/${ids.alpha}/members/${ids.annaMitglied}/skills`;
    expect((await f.api('put', `${basis}/${alphaSkill[2]}`, ids.anna)).status).toBe(204);
    expect((await f.api('put', `${basis}/${alphaSkill[2]}`, ids.anna)).status).toBe(204);
    expect((await f.api('put', `${basis}/${betaSkill}`, ids.anna)).status).toBe(404);
    expect((await f.api('delete', `${basis}/${alphaSkill[0]}`, ids.anna)).status).toBe(204);
    expect((await f.api('get', basis, ids.anna)).body.sort()).toEqual([alphaSkill[1], alphaSkill[2]].sort());
  });

  it('liefert die Zuordnungen der Organisation als Karte, ohne andere Organisationen', async () => {
    await f.admin.query('INSERT INTO member_skills (member_id, skill_id) VALUES ($1, $2)', [ids.berndMitglied, betaSkill]);

    const antwort = await f.api('get', `/api/v1/orgs/${ids.alpha}/member-skills`, ids.anna);

    expect(Object.keys(antwort.body)).not.toContain(ids.berndMitglied);
    expect(antwort.body[ids.annaMitglied].sort()).toEqual([alphaSkill[1], alphaSkill[2]].sort());
  });

  it('findet Mitglieder nach Skills, absteigend nach Treffern; nur Vorstand und Administratoren', async () => {
    await f.admin.query('INSERT INTO member_skills (member_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ids.paulMitglied, alphaSkill[1]]);

    const antwort = await f.api('post', `${s(ids.alpha)}/match`, ids.clara, { skill_ids: [alphaSkill[1], alphaSkill[2]] });

    expect(antwort.status).toBe(200);
    expect(antwort.body.map((x: { member_id: string; matching_skills: number }) => [x.member_id, x.matching_skills])).toEqual([
      [ids.annaMitglied, 2],
      [ids.paulMitglied, 2],
    ]);
    expect(antwort.body[0]).toHaveProperty('member_email');
    expect((await f.api('post', `${s(ids.alpha)}/match`, ids.anna, { skill_ids: [alphaSkill[1]] })).status).toBe(403);
    expect((await f.api('post', `${s(ids.alpha)}/match`, ids.olga, { skill_ids: [] })).body).toEqual([]);
    expect((await f.api('post', `${s(ids.alpha)}/match`, ids.olga, { skill_ids: ['x'] })).status).toBe(400);
  });
});
