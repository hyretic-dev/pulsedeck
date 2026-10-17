import { TestBed } from '@angular/core/testing';

import { RealtimeService, type Aenderung } from './realtime.service';
import { SessionService } from './session.service';

/** Ein SSE-Strom, dessen Blöcke der Test von Hand nachliefert. */
function strom() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
    const enc = new TextEncoder();
    return {
        antwort: () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
        sende: (text: string) => controller.enqueue(enc.encode(text)),
        schliesse: () => controller.close(),
    };
}
const warte = (ms = 20) => new Promise((ok) => setTimeout(ok, ms));

describe('RealtimeService', () => {
    let realtime: RealtimeService;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        localStorage.clear();
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        TestBed.configureTestingModule({});
        TestBed.inject(SessionService).setze(null);
        realtime = TestBed.inject(RealtimeService);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('verbindet je Organisation einmal, filtert nach Tabellen und meldet nach „ready“ einen Neuabgleich', async () => {
        const s = strom();
        const s2 = strom();
        fetchMock.mockResolvedValueOnce(s.antwort()).mockResolvedValue(s2.antwort());
        const events: Aenderung[] = [];
        const feed: Aenderung[] = [];

        const ab1 = realtime.abonnieren('org-1', ['events'], (e) => events.push(e as Aenderung));
        const ab2 = realtime.abonnieren('org-1', ['feed_items'], (e) => feed.push(e as Aenderung));
        await warte();
        s2.sende('retry: 5000\n\nevent: ready\ndata: {}\n\n');
        s2.sende('event: change\ndata: {"table":"events","operation":"INSERT","id":"e1"}\n\n');
        s2.sende('event: change\ndata: {"table":"feed_items","operation":"UPDATE","id":"f1"}\n\n: ping\n\n');
        await warte();

        expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/v1/orgs/org-1/realtime?tables=events,feed_items'); // wuchs die Tabellenliste, wird mit der Vereinigung neu verbunden
        expect(events.map((e) => e.operation)).toEqual(['RESYNC', 'INSERT']);
        expect(feed.map((e) => e.operation)).toEqual(['RESYNC', 'UPDATE']);
        ab1();
        ab2();
    });

    it('stellt Ereignisse zu, die über Blockgrenzen hinweg ankommen, und ignoriert kaputte Nutzlast', async () => {
        const s = strom();
        fetchMock.mockResolvedValue(s.antwort());
        const empfangen: Array<Aenderung | { table: '*'; operation: 'RESYNC'; id: null }> = [];

        const ab = realtime.abonnieren('org-1', ['events'], (e) => empfangen.push(e));
        await warte();
        s.sende('event: ready\ndata: {}\n\nevent: cha');
        s.sende('nge\ndata: {"table":"events","operation":"DELETE","id":"e9"}\n\n');
        s.sende('event: change\ndata: {kaputt\n\n');
        s.sende('event: change\ndata: {"table":"wiki_docs","operation":"INSERT","id":"w1"}\n\n'); // nicht abonniert
        s.sende('event: resync\ndata: {}\n\n');
        await warte();

        expect(empfangen).toEqual([
            { table: '*', operation: 'RESYNC', id: null },
            { table: 'events', operation: 'DELETE', id: 'e9' },
            { table: '*', operation: 'RESYNC', id: null },
        ]);
        ab();
    });

    it('beendet die Verbindung, wenn der letzte Abonnent geht', async () => {
        const s = strom();
        fetchMock.mockResolvedValue(s.antwort());

        const ab = realtime.abonnieren('org-1', ['events'], () => undefined);
        await warte();
        const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
        expect(signal.aborted).toBe(false);

        ab();

        expect(signal.aborted).toBe(true);
    });
});
