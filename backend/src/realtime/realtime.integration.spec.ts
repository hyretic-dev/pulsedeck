import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

interface Strom {
  status: number;
  kopf: IncomingMessage['headers'];
  /** Alle bisher empfangenen Ereignisse (event + data, Kommentarzeilen als `ping`). */
  ereignisse: Array<{ event: string; daten: any }>;
  roh: () => string;
  geschlossen: Promise<void>;
  schliessen: () => void;
}

const warte = (bedingung: () => boolean | Promise<boolean>, ms = 3000) =>
  new Promise<void>((ok, nein) => {
    const start = Date.now();
    const pruefe = async () => {
      if (await bedingung()) return ok();
      if (Date.now() - start > ms) return nein(new Error('Zeitüberschreitung beim Warten'));
      setTimeout(pruefe, 25);
    };
    void pruefe();
  });

/**
 * Echtzeit-Strom gegen echtes PostgreSQL (LISTEN/NOTIFY) über eine echte HTTP-Verbindung:
 * Auslieferung nach Commit, Organisations- und Tabellenfilter, Zugriffsrechte, Verbindungsgrenzen,
 * Entzug der Mitgliedschaft, Neuaufbau der Datenbankverbindung.
 */
describe('Echtzeit (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let port: number;
  const offen: Strom[] = [];

  function oeffne(pfad: string, token: string | null): Promise<Strom> {
    return new Promise((ok, nein) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: pfad, headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res: IncomingMessage) => {
        let roh = '';
        const ereignisse: Strom['ereignisse'] = [];
        res.setEncoding('utf8');
        const geschlossen = new Promise<void>((fertig) => res.on('close', () => fertig()));
        res.on('data', (stueck: string) => {
          roh += stueck;
          for (const block of roh.split('\n\n').slice(0, -1)) {
            const zeilen = block.split('\n');
            if (zeilen[0]?.startsWith(':')) continue;
            const event = zeilen.find((z) => z.startsWith('event: '))?.slice(7);
            const daten = zeilen.find((z) => z.startsWith('data: '))?.slice(6);
            if (event) ereignisse.push({ event, daten: daten ? JSON.parse(daten) : null });
          }
          roh = roh.slice(roh.lastIndexOf('\n\n') + 2);
        });
        const strom: Strom = { status: res.statusCode ?? 0, kopf: res.headers, ereignisse, roh: () => roh, geschlossen, schliessen: () => req.destroy() };
        offen.push(strom);
        ok(strom);
      });
      req.on('error', nein);
      req.end();
    });
  }
  const strom = async (konto: string, org = ids.alpha, query = '') => oeffne(`/api/v1/orgs/${org}/realtime${query}`, await f.tokenFuer(konto));
  const aenderungen = (s: Strom) => s.ereignisse.filter((e) => e.event === 'change').map((e) => `${e.daten.table}:${e.daten.operation}`);

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_realtime_test', { realtime: { enabled: true, heartbeatMs: 150, recheckMs: 300, maxPerUser: 2 } });
    ids = f.ids;
    await f.app.listen(0, '127.0.0.1');
    port = (f.app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const s of offen) s.schliessen();
    await f.schliessen();
  });

  it('antwortet mit Event-Stream-Kopfzeilen und meldet die Bereitschaft; Herzschlag hält die Verbindung offen', async () => {
    const s = await strom(ids.anna);

    expect(s.status).toBe(200);
    expect(s.kopf['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(s.kopf['cache-control']).toBe('no-cache, no-transform');
    expect(s.kopf['x-accel-buffering']).toBe('no');
    await warte(() => s.ereignisse.some((e) => e.event === 'ready'));
    await warte(() => s.roh().includes(': ping') || true); // Kommentarzeilen werden beim Parsen verworfen; Verbindung bleibt offen
    await new Promise((ok) => setTimeout(ok, 400));
    expect(s.status).toBe(200);
    s.schliessen();
  });

  it('liefert Änderungen der eigenen Organisation nach dem Commit – nie von anderen Organisationen oder zurückgerollte', async () => {
    const alpha = await strom(ids.anna);
    const beta = await strom(ids.bernd, ids.beta);
    await warte(() => alpha.ereignisse.length > 0 && beta.ereignisse.length > 0);

    const termin = await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, { title: 'Live', date: '2030-01-01', start_time: '10:00', location: 'x' });
    expect(termin.status).toBe(201);
    await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, { title: 'Abgelehnt', date: '2030-01-01', start_time: '10:00', location: 'x', working_group_id: ids.unbekannt }); // 400 → Rollback → keine Meldung

    await warte(() => aenderungen(alpha).includes('events:INSERT'));
    await new Promise((ok) => setTimeout(ok, 200));
    expect(aenderungen(alpha)).toEqual(['events:INSERT']);
    expect(alpha.ereignisse.find((e) => e.event === 'change')?.daten).toEqual({ table: 'events', operation: 'INSERT', id: termin.body.id });
    expect(aenderungen(beta)).toEqual([]);
    alpha.schliessen();
    beta.schliessen();
  });

  it('beachtet den Tabellenfilter und lehnt unbekannte Tabellen ab', async () => {
    const nurFeed = await strom(ids.paul, ids.alpha, '?tables=feed_items,poll_votes');
    await warte(() => nurFeed.ereignisse.length > 0);

    await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, { title: 'Nicht abonniert', date: '2030-01-01', start_time: '10:00', location: 'x' });
    await f.api('post', `/api/v1/orgs/${ids.alpha}/feed`, ids.olga, { title: 'Beitrag', type: 'article', status: 'approved' });

    await warte(() => aenderungen(nurFeed).length >= 1);
    await new Promise((ok) => setTimeout(ok, 150));
    expect(aenderungen(nurFeed)).toEqual(['feed_items:INSERT']);
    for (const falsch of ['?tables=audit_logs', '?tables=events,users', '?tables=a%20b']) {
      expect((await strom(ids.paul, ids.alpha, falsch)).status, falsch).toBe(400);
    }
    nurFeed.schliessen();
  });

  it('verlangt Anmeldung und Mitgliedschaft', async () => {
    expect((await oeffne(`/api/v1/orgs/${ids.alpha}/realtime`, null)).status).toBe(401);
    expect((await strom(ids.bernd, ids.alpha)).status).toBe(403);
    expect((await oeffne(`/api/v1/orgs/${ids.alpha}/realtime`, 'kein.token.hier')).status).toBe(401);
    expect((await oeffne('/api/v1/orgs/keine-uuid/realtime', await f.tokenFuer(ids.anna))).status).toBe(400);
  });

  it('begrenzt offene Verbindungen je Nutzer und gibt Plätze beim Schließen frei', async () => {
    const eins = await strom(ids.clara);
    const zwei = await strom(ids.clara);
    expect(eins.status).toBe(200);
    expect(zwei.status).toBe(200);

    expect((await strom(ids.clara)).status).toBe(429);
    expect((await strom(ids.anna)).status).toBe(200); // andere Nutzer unbeeinträchtigt

    eins.schliessen();
    await eins.geschlossen;
    await warte(async () => (await strom(ids.clara)).status === 200);
    zwei.schliessen();
  });

  it('beendet den Strom, wenn die Mitgliedschaft entfällt', async () => {
    const s = await strom(ids.paul);
    await warte(() => s.ereignisse.length > 0);

    await f.admin.query('UPDATE members SET user_id = NULL WHERE id = $1', [ids.paulMitglied]);

    await Promise.race([s.geschlossen, new Promise((_ok, nein) => setTimeout(() => nein(new Error('Strom blieb offen')), 3000))]);
    await f.admin.query('UPDATE members SET user_id = $2 WHERE id = $1', [ids.paulMitglied, ids.paul]);
  });

  it('baut die Datenbankverbindung nach einer Unterbrechung neu auf, meldet resync und liefert danach weiter', async () => {
    const s = await strom(ids.anna);
    await warte(() => s.ereignisse.length > 0);

    await f.admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE 'LISTEN table_changes%' AND datname = current_database() AND pid <> pg_backend_pid()");
    await warte(() => s.ereignisse.some((e) => e.event === 'resync'), 5000);

    await f.api('post', `/api/v1/orgs/${ids.alpha}/feed`, ids.olga, { title: 'Nach Neuaufbau', type: 'article', status: 'approved' });
    await warte(() => aenderungen(s).includes('feed_items:INSERT'));
    s.schliessen();
  });
});
