import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

/**
 * Feed gegen echtes PostgreSQL: Statusfluss (Freigabe nur mit Recht), Sichtbarkeit von Entwürfen,
 * Umfragen (Einzel-/Mehrfachwahl, Ende, anonymisierte Stimmen), Lesebestätigungen, Anheften, Mandantentrennung.
 * Alpha: Olga (Admin), Clara (Vorstand, alle Rechte), Anna (Mitglied mit feed:create), Paul (Mitglied mit feed:create).
 */
describe('Feed (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let ag: string;
  const u = (org: string, rest = '') => `/api/v1/orgs/${org}/feed${rest}`;
  const beitrag = (extra: object = {}) => ({ title: 'Neuigkeit', type: 'article', content: '<p>Hallo</p>', ...extra });

  async function legeAn(konto: string, extra: object = {}, org = ids.alpha): Promise<string> {
    const antwort = await f.api('post', u(org), konto, beitrag(extra));
    expect(antwort.status, JSON.stringify(antwort.body)).toBe(201);
    return antwort.body.id;
  }

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_feed_test');
    ids = f.ids;
    ag = (await f.admin.query("INSERT INTO working_groups (organization_id, name, description, lead, next_meeting, contact_type, contact_icon, category) VALUES ($1, 'Presse', 'd', 'l', 'n', 'Email', 'pi-envelope', 'AGs') RETURNING id", [ids.alpha])).rows[0].id;
  });
  afterAll(async () => {
    await f.schliessen();
  });

  it('erlaubt das Anlegen nur mit feed:create, setzt Autor und Organisation serverseitig und kennt keine fremden Felder', async () => {
    const antwort = await f.api('post', u(ids.alpha), ids.anna, beitrag({ working_group_id: ag }));

    expect(antwort.status).toBe(201);
    expect(antwort.body).toMatchObject({
      status: 'draft', author_id: ids.annaMitglied, organization_id: ids.alpha, type: 'article', is_pinned: false,
      author: { name: 'Anna' }, working_group: { name: 'Presse', category: 'AGs' }, poll_options: [], feed_item_reads: [],
    });
    await f.admin.query("UPDATE organization_roles SET permissions = '{}' WHERE id = $1", [ids.alphaMitgliedRolle]);
    expect((await f.api('post', u(ids.alpha), ids.paul, beitrag())).status).toBe(403); // ohne Recht
    await f.admin.query("UPDATE organization_roles SET permissions = ARRAY['feed:create'] WHERE id = $1", [ids.alphaMitgliedRolle]);
    expect((await f.api('post', u(ids.alpha), ids.bernd, beitrag())).status).toBe(403); // fremde Organisation
    expect((await f.api('post', u(ids.alpha), null, beitrag())).status).toBe(401);
    for (const falsch of [
      { author_id: ids.olgaMitglied }, { organization_id: ids.beta }, { is_pinned: true }, { sent_at: '2026-01-01T00:00:00Z' }, { status: 'sent' },
      { url: 'javascript:alert(1)', type: 'link' }, { type: 'link' }, { type: 'video' }, { title: '' }, { working_group_id: 'keine-uuid' },
      { options: ['a', 'b'] }, { poll_config: { multiple_choice: true } },
    ]) {
      expect((await f.api('post', u(ids.alpha), ids.anna, beitrag(falsch))).status, JSON.stringify(falsch)).toBe(400);
    }
    const fremdeAg = (await f.admin.query("INSERT INTO working_groups (organization_id, name, description, lead, next_meeting, contact_type, contact_icon) VALUES ($1, 'Fremd', 'd', 'l', 'n', 'Email', 'pi-envelope') RETURNING id", [ids.beta])).rows[0].id;
    expect((await f.api('post', u(ids.alpha), ids.anna, beitrag({ working_group_id: fremdeAg }))).status).toBe(400);
  });

  it('lässt nur Freigeber freigeben; Autoren geben sich nie selbst frei', async () => {
    expect((await f.api('post', u(ids.alpha), ids.anna, beitrag({ status: 'approved' }))).status).toBe(403);
    const id = await legeAn(ids.anna, { title: 'Zur Freigabe', status: 'review' });

    const selbst = await f.api('patch', u(ids.alpha, `/${id}`), ids.anna, { status: 'approved' });
    expect(selbst.status).toBe(403);
    const freigabe = await f.api('patch', u(ids.alpha, `/${id}`), ids.clara, { status: 'approved' });
    expect(freigabe.body).toMatchObject({ id, status: 'approved' });

    // Nach der Freigabe kann der Autor nichts mehr ändern, der Freigeber schon
    expect((await f.api('patch', u(ids.alpha, `/${id}`), ids.anna, { title: 'Umgeschrieben' })).status).toBe(403);
    expect((await f.api('patch', u(ids.alpha, `/${id}`), ids.olga, { title: 'Korrigiert' })).body.title).toBe('Korrigiert');
    // Freigeber selbst dürfen direkt als freigegeben anlegen
    expect((await f.api('post', u(ids.alpha), ids.clara, beitrag({ status: 'approved' }))).body.status).toBe('approved');
    const audit = await f.admin.query("SELECT operation FROM audit_logs WHERE table_name = 'feed_items' AND record_id = $1 ORDER BY created_at", [id]);
    expect(audit.rows.map((r) => r.operation)).toEqual(['INSERT', 'UPDATE', 'UPDATE']);
  });

  it('zeigt Entwürfe und Beiträge in Prüfung nur ihrem Autor und den Freigebern', async () => {
    const entwurf = await legeAn(ids.anna, { title: 'Geheimer Entwurf' });
    const veroeffentlicht = await legeAn(ids.clara, { title: 'Öffentlicher Beitrag', status: 'approved' });
    const titel = async (konto: string, pfad = '') => (await f.api('get', u(ids.alpha, pfad), konto)).body.map((x: { title: string }) => x.title);

    expect(await titel(ids.paul)).toContain('Öffentlicher Beitrag');
    expect(await titel(ids.paul)).not.toContain('Geheimer Entwurf');
    expect(await titel(ids.anna, '/mine')).toContain('Geheimer Entwurf');
    expect(await titel(ids.paul, '/mine')).not.toContain('Geheimer Entwurf');
    expect(await titel(ids.anna)).not.toContain('Geheimer Entwurf'); // „veröffentlicht“ zeigt nie Entwürfe
    // Prüf- und Warteschlangenlisten nur für Freigeber
    expect((await f.api('get', u(ids.alpha, '/review'), ids.anna)).status).toBe(403);
    expect((await f.api('get', u(ids.alpha, '/newsletter-queue'), ids.anna)).status).toBe(403);
    expect((await f.api('get', u(ids.alpha, '/sent'), ids.anna)).status).toBe(403);
    expect(await titel(ids.clara, '/newsletter-queue')).toContain('Öffentlicher Beitrag');
    // fremde Entwürfe sind für andere Mitglieder nicht einmal vorhanden (404 statt 403)
    expect((await f.api('patch', u(ids.alpha, `/${entwurf}`), ids.paul, { title: 'X' })).status).toBe(404);
    expect((await f.api('delete', u(ids.alpha, `/${entwurf}`), ids.paul)).status).toBe(404);
    expect((await f.api('put', u(ids.alpha, `/${entwurf}/read`), ids.paul)).status).toBe(404);
    expect((await f.api('delete', u(ids.alpha, `/${veroeffentlicht}`), ids.paul)).status).toBe(403); // sichtbar, aber fremd
    expect((await f.api('patch', u(ids.alpha, `/${entwurf}`), ids.anna, { title: 'Bearbeitet', status: 'review' })).body).toMatchObject({ title: 'Bearbeitet', status: 'review' });
    expect(await titel(ids.clara, '/review')).toContain('Bearbeitet');
  });

  it('hält Beiträge der Organisationen getrennt', async () => {
    const betaId = await legeAn(ids.bernd, { title: 'Beta-Beitrag', status: 'approved' }, ids.beta);

    expect((await f.api('get', u(ids.alpha), ids.olga)).body.map((x: { title: string }) => x.title)).not.toContain('Beta-Beitrag');
    expect((await f.api('patch', u(ids.alpha, `/${betaId}`), ids.olga, { title: 'Hack' })).status).toBe(404);
    expect((await f.api('delete', u(ids.alpha, `/${betaId}`), ids.olga)).status).toBe(404);
    expect((await f.api('patch', u(ids.alpha, `/${betaId}/pin`), ids.olga, { is_pinned: true })).status).toBe(404);
    expect((await f.api('put', u(ids.alpha, `/${betaId}/read`), ids.olga)).status).toBe(404);
    expect((await f.api('get', u(ids.beta), ids.olga)).status).toBe(403);
  });

  it('heftet nur veröffentlichte Beiträge an und zeigt sie zuerst', async () => {
    const alt = await legeAn(ids.clara, { title: 'Alt', status: 'approved' });
    const entwurf = await legeAn(ids.clara, { title: 'Nur Entwurf' });
    await legeAn(ids.clara, { title: 'Neu', status: 'approved' });

    expect((await f.api('patch', u(ids.alpha, `/${alt}/pin`), ids.anna, { is_pinned: true })).status).toBe(403);
    expect((await f.api('patch', u(ids.alpha, `/${entwurf}/pin`), ids.clara, { is_pinned: true })).status).toBe(409);
    expect((await f.api('patch', u(ids.alpha, `/${alt}/pin`), ids.clara, { is_pinned: 'ja' })).status).toBe(400);
    expect((await f.api('patch', u(ids.alpha, `/${alt}/pin`), ids.clara, { is_pinned: true })).body).toEqual({ id: alt, is_pinned: true });

    const liste = (await f.api('get', u(ids.alpha), ids.anna)).body;
    expect(liste[0]).toMatchObject({ id: alt, is_pinned: true });
  });

  it('verwaltet Lesebestätigungen: einmalig je Mitglied, Dritte sehen nur die eigene', async () => {
    const id = await legeAn(ids.anna, { title: 'Lesen', status: 'review' });
    await f.api('patch', u(ids.alpha, `/${id}`), ids.clara, { status: 'approved' });

    expect((await f.api('put', u(ids.alpha, `/${id}/read`), ids.paul)).status).toBe(204);
    expect((await f.api('put', u(ids.alpha, `/${id}/read`), ids.paul)).status).toBe(204); // idempotent
    await f.api('put', u(ids.alpha, `/${id}/read`), ids.clara);
    const zeilen = await f.admin.query('SELECT count(*)::int AS n FROM feed_item_reads WHERE feed_item_id = $1', [id]);
    expect(zeilen.rows[0].n).toBe(2);

    const sichtPaul = (await f.api('get', u(ids.alpha), ids.paul)).body.find((x: { id: string }) => x.id === id);
    const sichtAutor = (await f.api('get', u(ids.alpha), ids.anna)).body.find((x: { id: string }) => x.id === id);
    const sichtFreigeber = (await f.api('get', u(ids.alpha), ids.olga)).body.find((x: { id: string }) => x.id === id);
    expect(sichtPaul.feed_item_reads).toEqual([{ member_id: ids.paulMitglied }]);
    expect(sichtAutor.feed_item_reads).toHaveLength(2);
    expect(sichtFreigeber.feed_item_reads).toHaveLength(2);
  });

  describe('Umfragen', () => {
    let einzel: string;
    let mehrfach: string;
    let opt: (item: Record<string, any>, text: string) => string;

    beforeAll(async () => {
      opt = (item, text) => item.poll_options.find((o: { text: string }) => o.text === text).id;
      einzel = (await f.api('post', u(ids.alpha), ids.clara, beitrag({ title: 'Einzel', type: 'poll', status: 'approved', options: ['Ja', 'Nein', 'Vielleicht'], poll_config: { multiple_choice: false } }))).body.id;
      mehrfach = (await f.api('post', u(ids.alpha), ids.clara, beitrag({ title: 'Mehrfach', type: 'poll', status: 'approved', options: ['A', 'B'], poll_config: { multiple_choice: true } }))).body.id;
    });
    const hole = async (konto: string, id: string) => (await f.api('get', u(ids.alpha), konto)).body.find((x: { id: string }) => x.id === id);

    it('legt Optionen in Reihenfolge an und verlangt mindestens zwei', async () => {
      const umfrage = await hole(ids.anna, einzel);
      expect(umfrage.poll_options.map((o: { text: string; sort_order: number }) => [o.text, o.sort_order])).toEqual([['Ja', 0], ['Nein', 1], ['Vielleicht', 2]]);
      expect((await f.api('post', u(ids.alpha), ids.clara, beitrag({ type: 'poll', options: ['nur eine'] }))).status).toBe(400);
      expect((await f.api('post', u(ids.alpha), ids.clara, beitrag({ type: 'poll' }))).status).toBe(400);
    });

    it('ersetzt bei Einzelauswahl die bisherige Stimme und zählt jede Stimme einmal', async () => {
      const vorher = await hole(ids.anna, einzel);
      const [ja, nein] = [opt(vorher, 'Ja'), opt(vorher, 'Nein')];

      expect((await f.api('put', u(ids.alpha, `/options/${ja}/vote`), ids.anna)).status).toBe(204);
      expect((await f.api('put', u(ids.alpha, `/options/${ja}/vote`), ids.anna)).status).toBe(204); // doppelt: kein Fehler, keine zweite Stimme
      expect((await f.api('put', u(ids.alpha, `/options/${nein}/vote`), ids.anna)).status).toBe(204); // wechselt
      await f.api('put', u(ids.alpha, `/options/${nein}/vote`), ids.paul);

      const { rows } = await f.admin.query('SELECT o.text, count(v.id)::int AS n FROM poll_options o LEFT JOIN poll_votes v ON v.option_id = o.id WHERE o.feed_item_id = $1 GROUP BY o.text ORDER BY o.text', [einzel]);
      expect(rows).toEqual([{ text: 'Ja', n: 0 }, { text: 'Nein', n: 2 }, { text: 'Vielleicht', n: 0 }]);
      const annasSicht = await hole(ids.anna, einzel);
      const stimmen = annasSicht.poll_options.find((o: { text: string }) => o.text === 'Nein').poll_votes;
      expect(stimmen).toHaveLength(2);
      expect(stimmen.filter((s: { member_id: string | null }) => s.member_id === ids.annaMitglied)).toHaveLength(1); // eigene erkennbar
      expect(JSON.stringify(annasSicht)).not.toContain(ids.paulMitglied); // fremde Stimmen anonym
    });

    it('lässt bei Mehrfachwahl mehrere Optionen zu und erlaubt das Zurückziehen genau der eigenen Stimme', async () => {
      const umfrage = await hole(ids.anna, mehrfach);
      const [a, b] = [opt(umfrage, 'A'), opt(umfrage, 'B')];
      await f.api('put', u(ids.alpha, `/options/${a}/vote`), ids.anna);
      await f.api('put', u(ids.alpha, `/options/${b}/vote`), ids.anna);
      await f.api('put', u(ids.alpha, `/options/${a}/vote`), ids.paul);

      expect((await f.api('delete', u(ids.alpha, `/options/${a}/vote`), ids.anna)).status).toBe(204);

      const { rows } = await f.admin.query('SELECT option_id, member_id FROM poll_votes WHERE option_id = ANY($1::uuid[]) ORDER BY member_id', [[a, b]]);
      expect(rows).toEqual([{ option_id: b, member_id: ids.annaMitglied }, { option_id: a, member_id: ids.paulMitglied }]);
    });

    it('wehrt Stimmen auf fremde Umfragen, Entwürfe und beendete Abstimmungen ab', async () => {
      const betaUmfrage = (await f.api('post', u(ids.beta), ids.bernd, beitrag({ type: 'poll', status: 'approved', options: ['X', 'Y'] }))).body;
      const entwurf = (await f.api('post', u(ids.alpha), ids.clara, beitrag({ type: 'poll', options: ['X', 'Y'] }))).body;
      const abgelaufen = (await f.api('post', u(ids.alpha), ids.clara, beitrag({ type: 'poll', status: 'approved', options: ['X', 'Y'], poll_config: { multiple_choice: false, end_date: '2020-01-01T00:00:00Z' } }))).body;
      const beta = betaUmfrage.poll_options[0].id;

      expect((await f.api('put', u(ids.alpha, `/options/${beta}/vote`), ids.anna)).status).toBe(404); // andere Organisation
      expect((await f.api('put', u(ids.alpha, `/options/${entwurf.poll_options[0].id}/vote`), ids.anna)).status).toBe(404); // unveröffentlicht
      const zuSpaet = await f.api('put', u(ids.alpha, `/options/${abgelaufen.poll_options[0].id}/vote`), ids.anna);
      expect(zuSpaet.status).toBe(409);
      expect(zuSpaet.body.code).toBe('poll_closed');
      expect((await f.api('put', u(ids.alpha, `/options/${ids.unbekannt}/vote`), ids.anna)).status).toBe(404);
      expect((await f.api('put', u(ids.alpha, '/options/keine-uuid/vote'), ids.anna)).status).toBe(400);
      const nichtSelbst = await f.admin.query('SELECT count(*)::int AS n FROM poll_votes WHERE member_id = $1', [ids.annaMitglied]);
      expect(nichtSelbst.rows[0].n).toBe(2); // nur die beiden gültigen Stimmen aus den Tests davor
    });

    it('löscht Umfragen samt Optionen und Stimmen', async () => {
      expect((await f.api('delete', u(ids.alpha, `/${mehrfach}`), ids.clara)).status).toBe(204);
      const rest = await f.admin.query('SELECT (SELECT count(*) FROM poll_options WHERE feed_item_id = $1)::int AS o, (SELECT count(*) FROM poll_votes v JOIN poll_options o ON o.id = v.option_id WHERE o.feed_item_id = $1)::int AS v', [mehrfach]);
      expect(rest.rows[0]).toEqual({ o: 0, v: 0 });
    });
  });
});
