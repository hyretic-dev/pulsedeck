import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

import { MITGLIEDS_TABELLEN } from './account.service';

/**
 * Datenexport des eigenen Kontos (Art. 15/20 DSGVO) gegen echtes PostgreSQL: vollständig für die eigene Person, nichts von anderen
 * Personen, keine Geheimnisse (Hashes, Tokens, Push-Schlüssel). Clara ist Mitglied in Alpha und Beta, Paul nur in Alpha.
 */
describe('Datenexport (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_account_test');
    ids = f.ids;
    const q = (sql: string, werte: unknown[]) => f.admin.query(sql, werte);
    await q("UPDATE members SET phone = '0151 1111', city = 'Soest', connection_token = 'verknuepfung-geheim' WHERE id = $1", [ids.claraAlpha]);
    await q("INSERT INTO user_tasks (member_id, title, done) VALUES ($1, 'Claras Aufgabe', false), ($2, 'Pauls Aufgabe', false)", [ids.claraAlpha, ids.paulMitglied]);
    await q("INSERT INTO onboarding_progress (member_id, step_key) VALUES ($1, 'visited_wiki')", [ids.claraBeta]);
    await q("INSERT INTO push_subscriptions (member_id, endpoint, p256dh, auth) VALUES ($1, 'https://push.example.org/clara', 'p256dh-geheim', 'auth-geheim')", [ids.claraAlpha]);
    const sitzung = await q('INSERT INTO chat_sessions (user_id, organization_id) VALUES ($1, $2) RETURNING id', [ids.clara, ids.alpha]);
    await q("INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', 'Claras Frage')", [sitzung.rows[0].id]);
    const fremd = await q('INSERT INTO chat_sessions (user_id, organization_id) VALUES ($1, $2) RETURNING id', [ids.paul, ids.alpha]);
    await q("INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', 'Pauls Frage')", [fremd.rows[0].id]);
    await q(
      `INSERT INTO files (name, original_name, storage_path, organization_id, uploaded_by) VALUES
         ('clara.pdf', 'clara.pdf', 'pfad/clara-geheim', $1, $2), ('paul.pdf', 'paul.pdf', 'pfad/paul', $1, $3)`,
      [ids.alpha, ids.claraAlpha, ids.paulMitglied]
    );
    await q("INSERT INTO feedback_submissions (type, description, user_id) VALUES ('bug', 'Claras Hinweis', $1), ('bug', 'Pauls Hinweis', $2)", [ids.clara, ids.paul]);
  });
  afterAll(async () => {
    await f.schliessen();
  });

  it('kennt jede Tabelle des Schemas, die an einem Mitglied hängt', async () => {
    const { rows } = await f.admin.query(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'member_id' ORDER BY table_name"
    );
    expect(MITGLIEDS_TABELLEN.map((t) => t.tabelle).sort()).toEqual(rows.map((r) => r.table_name));
  });

  it('verlangt eine Anmeldung', async () => {
    expect((await f.api('get', '/api/v1/me/export')).status).toBe(401);
  });

  it('liefert alle eigenen Daten als Download, aber nichts von anderen und keine Geheimnisse', async () => {
    const antwort = await f.api('get', '/api/v1/me/export', ids.clara);
    expect(antwort.status).toBe(200);
    expect(antwort.headers['content-disposition']).toMatch(/^attachment; filename="pulsedeck-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(antwort.headers['cache-control']).toBe('no-store');
    const daten = antwort.body;

    expect(daten.account).toMatchObject({ id: ids.clara, email: 'clara@example.org', email_verified: true });
    expect(daten.memberships.map((m: { organization: { slug: string } }) => m.organization.slug).sort()).toEqual(['alpha', 'beta']);
    const alpha = daten.memberships.find((m: { organization: { slug: string } }) => m.organization.slug === 'alpha');
    expect(alpha.member).toMatchObject({ id: ids.claraAlpha, name: 'Clara', phone: '0151 1111', city: 'Soest' });
    expect(alpha.user_tasks.map((t: { title: string }) => t.title)).toEqual(['Claras Aufgabe']);
    expect(alpha.push_subscriptions).toEqual([expect.objectContaining({ endpoint: 'https://push.example.org/clara' })]);
    const beta = daten.memberships.find((m: { organization: { slug: string } }) => m.organization.slug === 'beta');
    expect(beta.onboarding_progress.map((o: { step_key: string }) => o.step_key)).toEqual(['visited_wiki']);
    expect(alpha.uploaded_files.map((d: { name: string }) => d.name)).toEqual(['clara.pdf']);
    expect(daten.chat_sessions).toHaveLength(1);
    expect(daten.chat_sessions[0].messages.map((m: { content: string }) => m.content)).toEqual(['Claras Frage']);
    expect(daten.feedback.map((x: { description: string }) => x.description)).toEqual(['Claras Hinweis']);

    const text = JSON.stringify(daten);
    for (const fremd of ['Pauls Aufgabe', 'Pauls Frage', 'Pauls Hinweis', 'paul.pdf', ids.paulMitglied]) expect(text, fremd).not.toContain(fremd);
    for (const geheim of ['password_hash', 'storage_path', 'clara-geheim', 'verknuepfung-geheim', 'connection_token', 'calendar_token', 'p256dh', 'auth-geheim', '$2']) {
      expect(text, geheim).not.toContain(geheim);
    }
  });

  it('liefert für ein Konto ohne Mitgliedschaft nur das Konto', async () => {
    const daten = (await f.api('get', '/api/v1/me/export', ids.dora)).body;
    expect(daten.account.email).toBe('dora@example.org');
    expect(daten).toMatchObject({ memberships: [], chat_sessions: [], feedback: [] });
  });
});
