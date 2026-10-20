import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';
import { frischesFenster } from '../../test/rate-window';

const tag = (versatz: number): string => {
  const d = new Date(Date.now() + versatz * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${1980 + (versatz % 7 + 7) % 7}`;
};

/**
 * Onboarding/Aufgaben, Startseiten-Kennzahlen, Geburtstage, Analytics, Feedback, Presence, Protokoll und Plattformadministration
 * gegen echtes PostgreSQL. Alpha: Olga (Admin), Clara (Vorstand), Anna und Paul (Mitglieder). Beta: Bernd (Admin), Clara (Mitglied).
 */
describe('Aktivität (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  const o = (org: string, rest = '') => `/api/v1/orgs/${org}${rest}`;

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_activity_test');
    ids = f.ids;
  });
  afterAll(async () => {
    await f.schliessen();
  });
  beforeEach(async () => {
    await f.admin.query('DELETE FROM rate_limits');
  });

  describe('Onboarding und Aufgaben', () => {
    it('merkt abgeschlossene Schritte idempotent, nur bekannte Schlüssel, nur für das eigene Mitglied', async () => {
      expect((await f.api('get', o(ids.alpha, '/onboarding'), ids.anna)).body).toEqual({ completed_steps: [], has_tasks: false });

      expect((await f.api('put', o(ids.alpha, '/onboarding/steps/visited_wiki'), ids.anna)).status).toBe(204);
      expect((await f.api('put', o(ids.alpha, '/onboarding/steps/visited_wiki'), ids.anna)).status).toBe(204);
      expect((await f.api('put', o(ids.alpha, '/onboarding/steps/beliebig'), ids.anna)).status).toBe(400);

      expect((await f.api('get', o(ids.alpha, '/onboarding'), ids.anna)).body.completed_steps).toEqual(['visited_wiki']);
      expect((await f.api('get', o(ids.alpha, '/onboarding'), ids.paul)).body.completed_steps).toEqual([]);
      expect((await f.api('get', o(ids.alpha, '/onboarding'), ids.bernd)).status).toBe(403);
    });

    it('verwaltet persönliche Aufgaben; fremde Aufgaben gibt es nicht', async () => {
      const neu = await f.api('post', o(ids.alpha, '/tasks'), ids.anna, { title: '  Protokoll schreiben ' });
      expect(neu.status).toBe(201);
      expect(neu.body).toMatchObject({ title: 'Protokoll schreiben', done: false });
      expect((await f.api('get', o(ids.alpha, '/onboarding'), ids.anna)).body.has_tasks).toBe(true);

      expect((await f.api('patch', o(ids.alpha, `/tasks/${neu.body.id}`), ids.paul, { done: true })).status).toBe(404);
      expect((await f.api('delete', o(ids.alpha, `/tasks/${neu.body.id}`), ids.paul)).status).toBe(404);
      expect((await f.api('patch', o(ids.alpha, `/tasks/${neu.body.id}`), ids.anna, { done: true, title: 'Erledigt' })).body).toMatchObject({ done: true, title: 'Erledigt' });
      for (const falsch of [{ title: '' }, { done: 'ja' }, { member_id: ids.paulMitglied }]) expect((await f.api('patch', o(ids.alpha, `/tasks/${neu.body.id}`), ids.anna, falsch)).status, JSON.stringify(falsch)).toBe(400);
      expect((await f.api('post', o(ids.alpha, '/tasks'), ids.anna, { title: '' })).status).toBe(400);
      expect((await f.api('get', o(ids.alpha, '/tasks'), ids.paul)).body).toEqual([]);
      expect((await f.api('get', o(ids.alpha, '/tasks'), ids.anna)).body).toEqual([{ id: neu.body.id, title: 'Erledigt', done: true }]);
      expect((await f.api('delete', o(ids.alpha, `/tasks/${neu.body.id}`), ids.anna)).status).toBe(204);
      expect((await f.api('delete', o(ids.alpha, `/tasks/${neu.body.id}`), ids.anna)).status).toBe(404);
    });
  });

  describe('Kennzahlen und Geburtstage', () => {
    it('zählt Termine und Dateien nur nach Sichtbarkeit und nur die eigene Organisation', async () => {
      const ev = (org: string, titel: string, datum: string, rollen: string) =>
        f.admin.query(`INSERT INTO events (organization_id, title, date, start_time, location, allowed_roles) VALUES ($1, $2, $3, '10:00', 'x', '${rollen}')`, [org, titel, datum]);
      const heute = new Date().toISOString().split('T')[0];
      const gestern = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
      await ev(ids.alpha, 'offen', '2099-01-01', '{public,member,committee,admin}');
      await ev(ids.alpha, 'admin', '2099-01-02', '{admin}');
      await ev(ids.alpha, 'vergangen', '2001-01-01', '{public,member,committee,admin}');
      await ev(ids.beta, 'beta', '2099-01-01', '{public,member,committee,admin}');
      await f.admin.query("INSERT INTO files (organization_id, name, original_name, storage_path, visibility, uploaded_by) VALUES ($1, 'a', 'a', 'x', 'member', $2), ($1, 'b', 'b', 'y', 'admin', $2)", [ids.alpha, ids.olgaMitglied]);
      await f.admin.query("INSERT INTO wiki_docs (organization_id, title, description, last_updated, author, status) VALUES ($1, 't', 'd', $2, 'a', 'Published'), ($1, 't2', 'd', $2, 'a', 'Draft')", [ids.alpha, gestern]);

      const mitglied = (await f.api('get', o(ids.alpha, '/statistics'), ids.anna)).body;
      const admin = (await f.api('get', o(ids.alpha, '/statistics'), ids.olga)).body;

      expect(mitglied).toMatchObject({ totalMembers: 4, totalWorkingGroups: 0, totalEvents: 2, upcomingEvents: 1, totalWikiArticles: 1, totalFiles: 1, totalFeedItems: 0, activeMembers: 4 });
      expect(admin).toMatchObject({ totalEvents: 3, upcomingEvents: 2, totalFiles: 2 });
      expect(mitglied.newMembersThisMonth).toBe(4);
      expect(mitglied.eventsThisMonth).toBe(heute.startsWith('2099') ? 1 : 0);
      expect((await f.api('get', o(ids.beta, '/statistics'), ids.bernd)).body).toMatchObject({ totalMembers: 2, totalEvents: 1 });
      expect((await f.api('get', o(ids.alpha, '/statistics'), ids.bernd)).status).toBe(403);
    });

    it('nennt Geburtstage der nächsten sieben Tage ohne Geburtsjahr; nicht aktive, spätere und fremde fehlen', async () => {
      const setze = (id: string, wert: string | null, status = 'Active') => f.admin.query('UPDATE members SET birthday = $2, status = $3 WHERE id = $1', [id, wert, status]);
      await setze(ids.olgaMitglied, tag(0));
      await setze(ids.annaMitglied, tag(3));
      await setze(ids.claraAlpha, tag(10));
      await setze(ids.paulMitglied, tag(2), 'Inactive');
      await setze(ids.berndMitglied, tag(1));

      const liste = (await f.api('get', o(ids.alpha, '/birthdays'), ids.paul)).body;

      expect(liste.map((b: { name: string; days_until: number }) => [b.name, b.days_until])).toEqual([['Olga', 0], ['Anna', 3]]);
      expect(liste[0].birthday).toMatch(/^\d{2}\.\d{2}\.$/);
      expect(JSON.stringify(liste)).not.toMatch(/19\d\d/);
      expect(Object.keys(liste[0]).sort()).toEqual(['avatar_url', 'birthday', 'days_until', 'id', 'name']);
    });
  });

  describe('Analytics', () => {
    it('nimmt Ereignisse auch anonym an, übernimmt die Organisation aber nur für Mitglieder', async () => {
      const ereignis = (konto: string | null, org?: string) => f.api('post', '/api/v1/analytics/events', konto, { event_name: 'page_view', page_path: '/dashboard', meta_data: { a: 1 }, ...(org ? { organization_id: org } : {}) });

      expect((await ereignis(null, ids.alpha)).status).toBe(204); // anonym: Organisation wird verworfen
      expect((await ereignis(ids.bernd, ids.alpha)).status).toBe(204); // Fremder: ebenfalls
      expect((await ereignis(ids.anna, ids.alpha)).status).toBe(204);
      expect((await ereignis(ids.anna)).status).toBe(204);

      const zeilen = await f.admin.query("SELECT organization_id FROM analytics_events ORDER BY created_at");
      expect(zeilen.rows.map((r) => r.organization_id)).toEqual([null, null, ids.alpha, null]);
    });

    it('prüft Eingaben, verwirft übergroße Metadaten still und begrenzt die Rate je Absender', async () => {
      await frischesFenster();
      for (const falsch of [{ event_name: 'mit Leerzeichen' }, { event_name: '' }, { event_name: 'x'.repeat(101) }, { event_name: 'ok', meta_data: 'text' }, { event_name: 'ok', organization_id: 'nein' }, { event_name: 'ok', id: 1 }]) {
        expect((await f.api('post', '/api/v1/analytics/events', null, falsch)).status, JSON.stringify(falsch)).toBe(400);
      }
      const vorher = (await f.admin.query('SELECT count(*)::int AS n FROM analytics_events')).rows[0].n;
      expect((await f.api('post', '/api/v1/analytics/events', ids.paul, { event_name: 'gross', meta_data: { x: 'y'.repeat(3000) } })).status).toBe(204);
      expect((await f.admin.query('SELECT count(*)::int AS n FROM analytics_events')).rows[0].n).toBe(vorher);

      for (let i = 0; i < 119; i += 1) await f.api('post', '/api/v1/analytics/events', ids.paul, { event_name: 'last' });
      expect((await f.api('post', '/api/v1/analytics/events', ids.paul, { event_name: 'last' })).status).toBe(429);
      expect((await f.api('post', '/api/v1/analytics/events', ids.anna, { event_name: 'last' })).status).toBe(204);
    });

    it('zeigt Organisationsadministratoren nur die Zahlen der eigenen Organisation', async () => {
      await f.admin.query('DELETE FROM analytics_events');
      await f.admin.query("INSERT INTO analytics_events (event_name, organization_id) VALUES ('a', $1), ('a', $1), ('b', $1), ('a', $2), ('global', NULL)", [ids.alpha, ids.beta]);

      expect((await f.api('get', o(ids.alpha, '/analytics/stats'), ids.olga)).body).toEqual([{ name: 'a', count: 2 }, { name: 'b', count: 1 }]);
      expect((await f.api('get', o(ids.alpha, '/analytics/events?limit=2'), ids.olga)).body).toHaveLength(2);
      for (const konto of [ids.anna, ids.clara]) expect((await f.api('get', o(ids.alpha, '/analytics/stats'), konto)).status, konto).toBe(403);
      expect((await f.api('get', o(ids.alpha, '/analytics/stats'), ids.bernd)).status).toBe(403);
    });
  });

  describe('Feedback und Issue-Tracker', () => {
    it('nimmt Feedback anonym und angemeldet an, ordnet es nur geprüften Mitgliedern einer Organisation zu und begrenzt die Anzahl', async () => {
      await frischesFenster(60 * 60 * 1000);
      await f.admin.query('DELETE FROM feedback_submissions');
      const senden = (konto: string | null, body: object) => f.api('post', '/api/v1/feedback', konto, body);

      expect((await senden(null, { type: 'bug', description: 'Anonym', organization_id: ids.alpha })).status).toBe(204);
      expect((await senden(ids.anna, { type: 'suggestion', description: 'Von Anna', organization_id: ids.alpha })).status).toBe(204);
      expect((await senden(ids.bernd, { type: 'bug', description: 'Von Bernd für Alpha', organization_id: ids.alpha })).status).toBe(204);

      const zeilen = await f.admin.query('SELECT description, user_id, organization_id, status FROM feedback_submissions ORDER BY created_at');
      expect(zeilen.rows).toEqual([
        { description: 'Anonym', user_id: null, organization_id: null, status: 'new' },
        { description: 'Von Anna', user_id: ids.anna, organization_id: ids.alpha, status: 'new' },
        { description: 'Von Bernd für Alpha', user_id: ids.bernd, organization_id: null, status: 'new' },
      ]);
      for (const falsch of [{ type: 'lob', description: 'x' }, { type: 'bug', description: '' }, { type: 'bug', description: 'x'.repeat(5001) }, { type: 'bug', description: 'x', status: 'done' }, { type: 'bug', description: 'x', user_id: ids.olga }]) {
        expect((await senden(null, falsch)).status, JSON.stringify(falsch)).toBe(400);
      }
      for (let i = 0; i < 9; i += 1) expect((await senden(null, { type: 'bug', description: `Spam ${i}` })).status).toBe(204); // zusammen mit dem ersten: zehn je Stunde und Absender
      expect((await senden(null, { type: 'bug', description: 'zu viel' })).status).toBe(429);
    });

    it('zeigt Feedback mit Recht view_issue_tracker nur der eigenen Organisation und lässt dort den Status ändern', async () => {
      await f.admin.query('DELETE FROM feedback_submissions');
      const alpha = (await f.admin.query("INSERT INTO feedback_submissions (type, description, organization_id) VALUES ('bug', 'Alpha-Bug', $1) RETURNING id", [ids.alpha])).rows[0].id;
      const beta = (await f.admin.query("INSERT INTO feedback_submissions (type, description, organization_id) VALUES ('bug', 'Beta-Bug', $1) RETURNING id", [ids.beta])).rows[0].id;
      await f.admin.query("INSERT INTO feedback_submissions (type, description) VALUES ('suggestion', 'Ohne Organisation')");

      expect((await f.api('get', o(ids.alpha, '/feedback'), ids.olga)).body.map((x: { description: string }) => x.description)).toEqual(['Alpha-Bug']);
      expect((await f.api('get', o(ids.alpha, '/feedback'), ids.clara)).status).toBe(200); // Vorstand hat alle Rechte
      expect((await f.api('get', o(ids.alpha, '/feedback'), ids.anna)).status).toBe(403);
      expect((await f.api('patch', o(ids.alpha, `/feedback/${alpha}`), ids.olga, { status: 'in_progress' })).body.status).toBe('in_progress');
      expect((await f.api('patch', o(ids.alpha, `/feedback/${beta}`), ids.olga, { status: 'done' })).status).toBe(404); // fremde Organisation
      expect((await f.api('patch', o(ids.alpha, `/feedback/${alpha}`), ids.olga, { status: 'erledigt' })).status).toBe(400);
      expect((await f.api('patch', o(ids.alpha, `/feedback/${alpha}`), ids.anna, { status: 'done' })).status).toBe(403);
      await f.admin.query("UPDATE organization_roles SET permissions = ARRAY['feed:create', 'view_issue_tracker'] WHERE id = $1", [ids.alphaMitgliedRolle]);
      expect((await f.api('get', o(ids.alpha, '/feedback'), ids.anna)).status).toBe(200); // Recht über die Rolle
      await f.admin.query("UPDATE organization_roles SET permissions = ARRAY['feed:create'] WHERE id = $1", [ids.alphaMitgliedRolle]);
    });
  });

  describe('Presence', () => {
    it('leitet Name und Rollen aus den Mitgliedschaften ab (nie vom Client) und zeigt Administratoren nur die eigene Organisation', async () => {
      await f.admin.query('DELETE FROM active_sessions');
      expect((await f.api('post', '/api/v1/presence', ids.clara, { current_path: '/alpha/dashboard/feed' })).status).toBe(204);
      expect((await f.api('post', '/api/v1/presence', ids.anna, { current_path: '/dashboard' })).status).toBe(204);
      for (const falsch of [{ current_path: 'https://evil.example' }, { current_path: 'kein-pfad' }, { current_path: '/a b' }, { current_path: '/ok', name: 'Admin', org_roles: { x: 'admin' } }, {}]) {
        expect((await f.api('post', '/api/v1/presence', ids.paul, falsch)).status, JSON.stringify(falsch)).toBe(400);
      }
      expect((await f.api('post', '/api/v1/presence', null, { current_path: '/x' })).status).toBe(401);
      expect((await f.api('post', '/api/v1/presence', ids.dora, { current_path: '/x' })).status).toBe(204); // ohne Mitgliedschaft: nichts gespeichert
      expect((await f.admin.query('SELECT count(*)::int AS n FROM active_sessions')).rows[0].n).toBe(2);

      const alpha = (await f.api('get', o(ids.alpha, '/presence'), ids.olga)).body;
      expect(alpha.map((s: { name: string }) => s.name).sort()).toEqual(['Anna', 'Clara']);
      expect(alpha.find((s: { name: string }) => s.name === 'Clara').org_roles).toEqual({ [ids.alpha]: 'committee' }); // Claras Beta-Rolle bleibt verborgen
      expect((await f.api('get', o(ids.beta, '/presence'), ids.bernd)).body.map((s: { name: string }) => s.name)).toEqual(['Clara']);
      expect((await f.api('get', o(ids.alpha, '/presence'), ids.anna)).status).toBe(403);

      await f.admin.query("UPDATE active_sessions SET last_seen_at = now() - interval '6 minutes' WHERE name = 'Anna'");
      expect((await f.api('get', o(ids.alpha, '/presence'), ids.olga)).body.map((s: { name: string }) => s.name)).toEqual(['Clara']);
    });
  });

  describe('Protokoll und Plattformadministration', () => {
    it('zeigt Organisationsadministratoren das Protokoll ihrer Organisation und sonst niemandem', async () => {
      await f.admin.query('DELETE FROM audit_logs');
      await f.admin.query("INSERT INTO audit_logs (table_name, operation, organization_id) VALUES ('events', 'INSERT', $1), ('files', 'DELETE', $1), ('events', 'UPDATE', $2)", [ids.alpha, ids.beta]);

      const alle = (await f.api('get', o(ids.alpha, '/audit-logs'), ids.olga)).body;
      expect(alle.map((l: { table_name: string }) => l.table_name).sort()).toEqual(['events', 'files']);
      expect((await f.api('get', o(ids.alpha, '/audit-logs?table=files'), ids.olga)).body).toHaveLength(1);
      for (const falsch of ['limit=0', 'limit=999', 'table=a;b', 'offset=-1']) expect((await f.api('get', o(ids.alpha, `/audit-logs?${falsch}`), ids.olga)).status, falsch).toBe(400);
      expect((await f.api('get', o(ids.alpha, '/audit-logs'), ids.clara)).status).toBe(403);
      expect((await f.api('get', o(ids.alpha, '/audit-logs'), ids.bernd)).status).toBe(403);
    });

    it('lässt nur Plattformadministratoren plattformweit lesen, das Flag zählt sofort, nicht erst beim nächsten Login', async () => {
      const pfade = ['/api/v1/platform/organizations', '/api/v1/platform/audit-logs', '/api/v1/platform/analytics/stats', '/api/v1/platform/feedback', '/api/v1/platform/online-users'];
      for (const pfad of pfade) {
        expect((await f.api('get', pfad, ids.olga)).status, pfad).toBe(403); // Organisationsadmin ist kein Plattformadmin
        expect((await f.api('get', pfad, null)).status, pfad).toBe(401);
      }
      await f.admin.query('UPDATE auth_users SET is_platform_admin = true WHERE id = $1', [ids.dora]); // Dora: Konto ohne Mitgliedschaft
      for (const pfad of pfade) expect((await f.api('get', pfad, ids.dora)).status, pfad).toBe(200);

      const orgs = (await f.api('get', '/api/v1/platform/organizations', ids.dora)).body;
      expect(orgs.map((x: { name: string }) => x.name)).toEqual(['Alpha e. V.', 'Beta e. V.']);
      expect((await f.api('get', `/api/v1/platform/audit-logs?org_id=${ids.beta}`, ids.dora)).body.every((l: { organization_id: string }) => l.organization_id === ids.beta)).toBe(true);
      const fb = (await f.admin.query("INSERT INTO feedback_submissions (type, description) VALUES ('bug', 'Plattform') RETURNING id")).rows[0].id;
      expect((await f.api('patch', `/api/v1/platform/feedback/${fb}`, ids.dora, { status: 'done' })).body.status).toBe('done');

      await f.admin.query('UPDATE auth_users SET is_platform_admin = false WHERE id = $1', [ids.dora]);
      expect((await f.api('get', pfade[0], ids.dora)).status).toBe(403); // sofort wirksam, selbes Token
    });
  });
  describe('Feedback-Board (Plattform)', () => {
    const platform = (methode: 'get' | 'post' | 'patch', pfad: string, body?: unknown) => f.api(methode, `/api/v1/platform${pfad}`, ids.dora, body);

    beforeAll(async () => {
      await f.admin.query('UPDATE auth_users SET is_platform_admin = true WHERE id = $1', [ids.dora]);
    });
    afterAll(async () => {
      await f.admin.query('UPDATE auth_users SET is_platform_admin = false WHERE id = $1', [ids.dora]);
    });
    beforeEach(async () => {
      await f.admin.query('DELETE FROM feedback_submissions');
      await f.admin.query("DELETE FROM mail_outbox WHERE kind = 'feedback_reply'");
    });

    const eintrag = async (felder: Record<string, unknown>): Promise<string> =>
      (await platform('post', '/feedback', { type: 'suggestion', description: 'Wir brauchen Aufgaben ohne Termin', ...felder })).body.id;

    it('legt Einträge aus Gesprächen an, nur für Plattformadministratoren, mit geprüfter Organisation und Quelle', async () => {
      const neu = await platform('post', '/feedback', {
        type: 'suggestion',
        description: '„Wir verteilen Aufgaben im Chat und vergessen sie.“',
        problem: 'Zuständigkeiten sind nirgends festgehalten',
        topic: 'aufgaben-ohne-termin',
        organization_id: ids.alpha,
        blocks_activation: true,
      });

      expect(neu.status).toBe(201);
      expect(neu.body).toMatchObject({ source: 'gespraech', topic: 'aufgaben-ohne-termin', organization_id: ids.alpha, blocks_activation: true, status: 'new', user_id: null, decision: null, replied_at: null });
      expect((await f.api('post', '/api/v1/platform/feedback', ids.olga, { type: 'bug', description: 'x' })).status).toBe(403);

      for (const falsch of [
        { source: 'app' },
        { topic: 'Groß Geschrieben' },
        { organization_id: ids.unbekannt },
        { type: 'frage' },
        { description: '' },
        { problem: 'x'.repeat(2001) },
      ]) {
        const antwort = await platform('post', '/feedback', { type: 'bug', description: 'Beschreibung', ...falsch });
        expect([400, 404], JSON.stringify(falsch)).toContain(antwort.status);
      }
      expect((await f.admin.query('SELECT count(*)::int AS n FROM feedback_submissions')).rows[0].n).toBe(1);
    });

    it('listet mit Organisation und meldender Person und trennt interne Felder von der Sicht der Organisation', async () => {
      await f.admin.query(
        "INSERT INTO feedback_submissions (type, description, user_id, organization_id, topic, decision, reply_text) VALUES ('bug', 'Kalender hängt', $1, $2, 'kalender', 'bauen', 'intern')",
        [ids.anna, ids.alpha]
      );

      const liste = (await platform('get', '/feedback')).body;
      expect(liste).toHaveLength(1);
      expect(liste[0]).toMatchObject({ description: 'Kalender hängt', organization_name: 'Alpha e. V.', reporter_name: 'Anna', can_reply: true, topic: 'kalender', decision: 'bauen' });

      const sichtOrg = (await f.api('get', o(ids.alpha, '/feedback'), ids.olga)).body[0];
      for (const intern of ['topic', 'decision', 'reply_text', 'problem', 'blocks_activation', 'replied_at', 'source']) expect(sichtOrg, intern).not.toHaveProperty(intern);
    });

    it('ändert Problem, Thema, Entscheidung und Status, prüft die Werte und kennt den Status live', async () => {
      const id = await eintrag({ organization_id: ids.alpha });

      const geaendert = await platform('patch', `/feedback/${id}`, { problem: 'Wer macht was?', topic: 'zustaendigkeiten', blocks_activation: true, decision: 'bauen', status: 'live' });
      expect(geaendert.body).toMatchObject({ problem: 'Wer macht was?', topic: 'zustaendigkeiten', blocks_activation: true, decision: 'bauen', status: 'live' });
      expect((await platform('patch', `/feedback/${id}`, { topic: null, decision: null })).body).toMatchObject({ topic: null, decision: null, status: 'live' });

      for (const falsch of [{ decision: 'vielleicht' }, { status: 'fertig' }, { topic: 'A B' }, { blocks_activation: 'ja' }, { reply_text: 'direkt schreiben' }]) {
        expect((await platform('patch', `/feedback/${id}`, falsch)).status, JSON.stringify(falsch)).toBe(400);
      }
      expect((await platform('patch', `/feedback/${ids.unbekannt}`, { decision: 'parken' })).status).toBe(404);
      expect((await f.api('patch', `/api/v1/platform/feedback/${id}`, ids.olga, { decision: 'parken' })).status).toBe(403);

      // Organisationsadmins können live nicht setzen (nur die Plattform entscheidet, wann etwas bei allen angekommen ist)
      const alpha = (await f.admin.query("INSERT INTO feedback_submissions (type, description, organization_id) VALUES ('bug', 'x', $1) RETURNING id", [ids.alpha])).rows[0].id;
      expect((await f.api('patch', o(ids.alpha, `/feedback/${alpha}`), ids.olga, { status: 'live' })).status).toBe(400);
    });

    it('zählt je Thema die Organisationen unabhängig voneinander, nicht die Meldungen', async () => {
      await eintrag({ topic: 'aufgaben-ohne-termin', organization_id: ids.alpha });
      await eintrag({ topic: 'aufgaben-ohne-termin', organization_id: ids.alpha, blocks_activation: true });
      await eintrag({ topic: 'aufgaben-ohne-termin', organization_id: ids.beta });
      await eintrag({ topic: 'dunkelmodus', organization_id: ids.beta });
      await eintrag({ topic: 'dunkelmodus' }); // ohne Organisation zählt nicht als eigene Organisation
      await eintrag({}); // ohne Thema erscheint nicht
      const erledigt = await eintrag({ topic: 'dunkelmodus', organization_id: ids.alpha });
      await platform('patch', `/feedback/${erledigt}`, { status: 'live' });

      const themen = (await platform('get', '/feedback/topics')).body;

      expect(themen).toEqual([
        { topic: 'aufgaben-ohne-termin', organizations: 2, entries: 3, blocking: 1, open: 3 },
        { topic: 'dunkelmodus', organizations: 2, entries: 3, blocking: 0, open: 2 },
      ]);
      expect((await f.api('get', '/api/v1/platform/feedback/topics', ids.olga)).status).toBe(403);
    });

    it('antwortet der meldenden Person per Mail-Outbox, einmal, mit maskiertem Text', async () => {
      const id = (await f.admin.query("INSERT INTO feedback_submissions (type, description, user_id, organization_id, status) VALUES ('suggestion', 'Dunkelmodus <b>bitte</b>', $1, $2, 'live') RETURNING id", [ids.anna, ids.alpha])).rows[0].id;

      const antwort = await platform('post', `/feedback/${id}/reply`, { text: 'Du hattest den Dunkelmodus gemeldet, der ist jetzt live. <script>x</script>' });

      expect(antwort.status).toBe(201);
      expect(antwort.body.replied_at).toBeTruthy();
      const mails = (await f.admin.query("SELECT recipient, subject, text_body, html_body, organization_id, use_org_smtp FROM mail_outbox WHERE kind = 'feedback_reply'")).rows;
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ recipient: 'anna@example.org', organization_id: ids.alpha, use_org_smtp: false });
      expect(mails[0].text_body).toContain('Du hattest den Dunkelmodus gemeldet');
      expect(mails[0].html_body).toContain('&lt;script&gt;x&lt;/script&gt;');
      expect(mails[0].html_body).not.toContain('<script>');
      expect(mails[0].html_body).toContain('Dunkelmodus &lt;b&gt;bitte&lt;/b&gt;'); // eigene Meldung als Zitat, ebenfalls maskiert
      expect((await f.admin.query('SELECT reply_text, replied_at FROM feedback_submissions WHERE id = $1', [id])).rows[0].reply_text).toContain('Dunkelmodus gemeldet');

      expect((await platform('post', `/feedback/${id}/reply`, { text: 'noch einmal' })).status).toBe(409); // keine Doppel-Mail
      expect((await f.admin.query("SELECT 1 FROM mail_outbox WHERE kind = 'feedback_reply'")).rowCount).toBe(1);
    });

    it('verlangt einen Text und einen Empfänger, und lässt Gespräche ohne Konto manuell als beantwortet markieren', async () => {
      const mitKonto = (await f.admin.query("INSERT INTO feedback_submissions (type, description, user_id) VALUES ('bug', 'x', $1) RETURNING id", [ids.anna])).rows[0].id;
      const ohneKonto = await eintrag({ organization_id: ids.alpha });

      expect((await platform('post', `/feedback/${mitKonto}/reply`, { text: '  ' })).status).toBe(400);
      expect((await platform('post', `/feedback/${mitKonto}/reply`, {})).status).toBe(400);
      expect((await platform('post', `/feedback/${mitKonto}/reply`, { text: 'x'.repeat(3001) })).status).toBe(400);
      expect((await platform('post', `/feedback/${ids.unbekannt}/reply`, { text: 'Hallo' })).status).toBe(404);
      expect((await f.api('post', `/api/v1/platform/feedback/${mitKonto}/reply`, ids.olga, { text: 'Hallo' })).status).toBe(403);

      const keinEmpfaenger = await platform('post', `/feedback/${ohneKonto}/reply`, { text: 'Hallo' });
      expect(keinEmpfaenger.status).toBe(409);
      expect(keinEmpfaenger.body.code).toBe('no_recipient');
      expect((await f.admin.query("SELECT 1 FROM mail_outbox WHERE kind = 'feedback_reply'")).rowCount).toBe(0);

      const manuell = await platform('post', `/feedback/${ohneKonto}/reply`, { text: 'Am Telefon zurückgemeldet', send: false });
      expect(manuell.status).toBe(201);
      expect(manuell.body.replied_at).toBeTruthy();
      expect((await f.admin.query("SELECT 1 FROM mail_outbox WHERE kind = 'feedback_reply'")).rowCount).toBe(0);
    });
  });
});
