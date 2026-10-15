import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

import { PushFehler } from './push-sender';
import { PushService } from './push.service';

/**
 * Web-Push gegen echtes PostgreSQL: Abonnements (Adressprüfung gegen SSRF), Einreihung in der Transaktion der Änderung,
 * Empfänger nach Terminsichtbarkeit, Mandantentrennung, Bereinigung abgelaufener Abos, Wiederholung.
 * Alpha: Olga (Admin), Clara (Vorstand), Anna (Mitglied, AG Technik), Paul (Mitglied). Beta: Bernd (Admin).
 */
describe('Push (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let push: PushService;
  let technik: string;
  const abo = (name: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } });
  const p = (org: string, rest = '') => `/api/v1/orgs/${org}/push${rest}`;
  const ziele = () => f.pgApp.pushSender.send.mock.calls.map((aufruf) => (aufruf[0] as { endpoint: string }).endpoint.split('/').pop()).sort();

  async function abonniere(konto: string, org: string, name: string) {
    const antwort = await f.api('put', p(org, '/subscription'), konto, abo(name));
    expect(antwort.status, JSON.stringify(antwort.body)).toBe(204);
  }

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_push_test');
    ids = f.ids;
    push = f.app.get(PushService);
    technik = (await f.admin.query("INSERT INTO working_groups (organization_id, name, description, lead, next_meeting, contact_type, contact_icon) VALUES ($1, 'Technik', 'd', 'l', 'n', 'Email', 'pi-envelope') RETURNING id", [ids.alpha])).rows[0].id;
    await f.admin.query("INSERT INTO ag_memberships (working_group_id, member_id, role) VALUES ($1, $2, 'member')", [technik, ids.annaMitglied]);
  });
  afterAll(async () => {
    await f.schliessen();
  });
  beforeEach(async () => {
    f.pgApp.pushSender.send.mockReset().mockResolvedValue(undefined);
    await f.admin.query('DELETE FROM push_notification_queue');
  });

  it('liefert den öffentlichen Schlüssel anonym und nur diesen', async () => {
    const antwort = await f.api('get', '/api/v1/push/config', null);

    expect(antwort.status).toBe(200);
    expect(antwort.body).toEqual({ enabled: true, publicKey: f.pgApp.config.push?.publicKey });
    expect(JSON.stringify(antwort.body)).not.toContain(f.pgApp.config.push?.privateKey);
  });

  it('nimmt Abonnements nur von Mitgliedern an, prüft die Adresse gegen den Push-Dienst und ist idempotent', async () => {
    await abonniere(ids.anna, ids.alpha, 'anna-1');
    await abonniere(ids.anna, ids.alpha, 'anna-1');

    expect((await f.admin.query('SELECT count(*)::int AS n FROM push_subscriptions WHERE member_id = $1', [ids.annaMitglied])).rows[0].n).toBe(1);
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest/meta-data', 'https://intern.example.org/hook', 'https://fcm.googleapis.com.evil.example/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'kein-url']) {
      expect((await f.api('put', p(ids.alpha, '/subscription'), ids.anna, { ...abo('x'), endpoint })).status, endpoint).toBe(400);
    }
    expect((await f.api('put', p(ids.alpha, '/subscription'), ids.anna, { endpoint: abo('x').endpoint, keys: { p256dh: 'ungültig!', auth: 'a' } })).status).toBe(400);
    expect((await f.api('put', p(ids.alpha, '/subscription'), ids.anna, { ...abo('x'), member_id: ids.olgaMitglied })).status).toBe(400);
    expect((await f.api('put', p(ids.alpha, '/subscription'), ids.bernd, abo('b'))).status).toBe(403); // keine Mitgliedschaft in Alpha
    expect((await f.api('put', p(ids.alpha, '/subscription'), null, abo('b'))).status).toBe(401);
  });

  it('bindet das Abo an das Mitglied der Organisation (ein Gerät, zwei Organisationen = zwei Abos) und entfernt nur eigene', async () => {
    await abonniere(ids.clara, ids.alpha, 'clara-gerät');
    await abonniere(ids.clara, ids.beta, 'clara-gerät');
    const zeilen = await f.admin.query("SELECT member_id FROM push_subscriptions WHERE endpoint LIKE '%clara-ger%' ORDER BY member_id");
    expect(zeilen.rows.map((r) => r.member_id)).toEqual([ids.claraAlpha, ids.claraBeta]);

    expect((await f.api('post', p(ids.alpha, '/unsubscribe'), ids.anna, { endpoint: abo('clara-gerät').endpoint })).status).toBe(204); // fremdes Abo: wirkungslos
    expect((await f.admin.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint LIKE '%clara-ger%'")).rows[0].n).toBe(2);
    expect((await f.api('post', p(ids.alpha, '/unsubscribe'), ids.clara, { endpoint: abo('clara-gerät').endpoint })).status).toBe(204);
    expect((await f.admin.query("SELECT member_id FROM push_subscriptions WHERE endpoint LIKE '%clara-ger%'")).rows.map((r) => r.member_id)).toEqual([ids.claraBeta]);
  });

  it('begrenzt die Zahl der Geräte je Mitglied', async () => {
    for (let i = 0; i < 20; i += 1) await abonniere(ids.paul, ids.alpha, `paul-${i}`);

    const zuViele = await f.api('put', p(ids.alpha, '/subscription'), ids.paul, abo('paul-21'));

    expect(zuViele.status).toBe(409);
    expect(zuViele.body.code).toBe('too_many_subscriptions');
    expect((await f.api('put', p(ids.alpha, '/subscription'), ids.paul, abo('paul-3'))).status).toBe(204); // bestehendes aktualisieren geht weiter
    await f.admin.query('DELETE FROM push_subscriptions WHERE member_id = $1', [ids.paulMitglied]);
  });

  describe('Benachrichtigungen', () => {
    beforeAll(async () => {
      await f.admin.query('DELETE FROM push_subscriptions');
      await abonniere(ids.olga, ids.alpha, 'olga');
      await abonniere(ids.clara, ids.alpha, 'clara');
      await abonniere(ids.anna, ids.alpha, 'anna');
      await abonniere(ids.paul, ids.alpha, 'paul');
      await abonniere(ids.bernd, ids.beta, 'bernd');
    });

    const termin = (extra: object = {}) => ({ title: 'Sommerfest', date: '2030-06-01', start_time: '15:00', location: 'Park', ...extra });

    it('reiht beim Anlegen eines Termins genau eine Benachrichtigung ein (nicht je Folgetermin) und sendet an alle sichtbaren Empfänger der Organisation', async () => {
      const ev = await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, termin({ is_recurring: true, recurrence_interval: 'monthly' }));
      expect(ev.status).toBe(201);
      const queue = await f.admin.query('SELECT kind, ref_id, title, message, url FROM push_notification_queue');
      expect(queue.rows).toEqual([{ kind: 'event', ref_id: ev.body.id, title: 'Sommerfest', message: 'Neuer Termin: Sommerfest', url: '/dashboard/calendar' }]);

      expect(await push.verarbeiten()).toEqual({ verarbeitet: 1, zugestellt: 4 });
      expect(ziele()).toEqual(['anna', 'clara', 'olga', 'paul']); // nie Bernd (Beta)
      const nutzlast = JSON.parse((f.pgApp.pushSender.send.mock.calls[0] as [unknown, string])[1]);
      expect(nutzlast).toMatchObject({ title: 'Sommerfest', body: 'Neuer Termin: Sommerfest', data: { url: '/dashboard/calendar' } });
      expect((await f.admin.query('SELECT status FROM push_notification_queue')).rows[0].status).toBe('sent');
    });

    it('benachrichtigt nur, wer den Termin sehen darf (Rolle, Arbeitsgruppe)', async () => {
      await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, termin({ title: 'Vorstand', allowed_roles: ['committee', 'admin'] }));
      await push.verarbeiten();
      expect(ziele()).toEqual(['clara', 'olga']);

      f.pgApp.pushSender.send.mockClear();
      await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, termin({ title: 'Nur Admin', allowed_roles: ['admin'] }));
      await push.verarbeiten();
      expect(ziele()).toEqual(['olga']);

      f.pgApp.pushSender.send.mockClear();
      await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, termin({ title: 'Technik', allowed_roles: [], working_group_id: technik }));
      await push.verarbeiten();
      expect(ziele()).toEqual(['anna', 'olga']); // Mitglied der AG und Admin
    });

    it('benachrichtigt bei Beiträgen einmal beim Übergang nach „freigegeben“ – nicht bei Entwürfen und nicht bei späteren Änderungen', async () => {
      const feed = (rest = '') => `/api/v1/orgs/${ids.alpha}/feed${rest}`;
      const entwurf = await f.api('post', feed(), ids.anna, { title: 'Entwurf', type: 'article' });
      expect((await f.admin.query('SELECT count(*)::int AS n FROM push_notification_queue')).rows[0].n).toBe(0);

      await f.api('patch', feed(`/${entwurf.body.id}`), ids.clara, { status: 'approved' });
      await f.api('patch', feed(`/${entwurf.body.id}`), ids.clara, { title: 'Entwurf (korrigiert)' });
      await f.api('post', feed(), ids.clara, { title: 'Direkt freigegeben', type: 'article', status: 'approved', content: '<p>Hallo <b>Welt</b></p>' });

      const queue = await f.admin.query('SELECT title, message, url FROM push_notification_queue ORDER BY created_at');
      expect(queue.rows).toEqual([
        { title: 'Entwurf', message: '', url: '/dashboard/feed' },
        { title: 'Direkt freigegeben', message: 'Hallo Welt', url: '/dashboard/feed' },
      ]);
      await push.verarbeiten();
      expect(ziele()).toEqual(['anna', 'anna', 'clara', 'clara', 'olga', 'olga', 'paul', 'paul']);
    });

    it('legt keine Benachrichtigung an, wenn die Änderung zurückgerollt wird', async () => {
      const vorher = (await f.admin.query('SELECT count(*)::int AS n FROM push_notification_queue')).rows[0].n;

      const abgelehnt = await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, termin({ working_group_id: ids.unbekannt }));

      expect(abgelehnt.status).toBe(400);
      expect((await f.admin.query('SELECT count(*)::int AS n FROM push_notification_queue')).rows[0].n).toBe(vorher);
    });

    it('löscht abgelaufene Abos (410), wiederholt bei Totalausfall und gibt nach fünf Versuchen auf', async () => {
      await f.api('post', `/api/v1/orgs/${ids.alpha}/feed`, ids.clara, { title: 'Abo-Test', type: 'article', status: 'approved' });
      f.pgApp.pushSender.send.mockImplementation(async (empfaenger: { endpoint: string }) => {
        if (empfaenger.endpoint.endsWith('/paul')) throw new PushFehler(410);
      });

      expect(await push.verarbeiten()).toEqual({ verarbeitet: 1, zugestellt: 3 });
      expect((await f.admin.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint LIKE '%/paul'")).rows[0].n).toBe(0);
      expect((await f.admin.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint LIKE '%/anna'")).rows[0].n).toBe(1);

      await f.api('post', `/api/v1/orgs/${ids.alpha}/feed`, ids.clara, { title: 'Ausfall', type: 'article', status: 'approved' });
      f.pgApp.pushSender.send.mockRejectedValue(new PushFehler(503));
      await push.verarbeiten();
      const wartend = (await f.admin.query("SELECT status, attempts, next_attempt_at > now() AS spaeter FROM push_notification_queue WHERE title = 'Ausfall'")).rows[0];
      expect(wartend).toMatchObject({ status: 'pending', attempts: 1, spaeter: true });
      for (let i = 2; i <= 5; i += 1) {
        await f.admin.query("UPDATE push_notification_queue SET next_attempt_at = now() WHERE status = 'pending'");
        await push.verarbeiten();
      }
      expect((await f.admin.query("SELECT status, attempts FROM push_notification_queue WHERE title = 'Ausfall'")).rows[0]).toEqual({ status: 'failed', attempts: 5 });
      expect((await f.admin.query("SELECT count(*)::int AS n FROM push_subscriptions")).rows[0].n).toBe(4); // 503 löscht keine Abos (Olga, Clara, Anna, Bernd)
    });
  });
});
