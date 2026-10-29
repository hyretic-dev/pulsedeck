import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BOOKING_REPOSITORY } from '../domain/booking.repository';
import { testEintrag, testPlan, testRepository } from '../testing';
import { BookingStore } from './booking.store';

describe('BookingStore', () => {
    let repo: ReturnType<typeof testRepository>;
    let store: BookingStore;
    let zerstoert: (() => void)[];
    const ref = (): DestroyRef => ({ onDestroy: (fn: () => void) => { zerstoert.push(fn); return () => undefined; } }) as DestroyRef;

    function einrichten(zusatz: Parameters<typeof testRepository>[0] = {}): void {
        repo = testRepository(zusatz);
        TestBed.configureTestingModule({ providers: [BookingStore, { provide: BOOKING_REPOSITORY, useValue: repo }] });
        store = TestBed.inject(BookingStore);
    }

    beforeEach(() => {
        zerstoert = [];
        localStorage.clear();
    });

    it('wählt beim Start den ersten Plan, merkt sich die Auswahl und lädt das Jahr samt Rand', async () => {
        einrichten({ plaene: vi.fn(async () => [testPlan({ id: 'a' }), testPlan({ id: 'b' })]) });
        await store.start(ref());
        expect(store.planId()).toBe('a');
        expect(store.laedt()).toBe(false);
        const jahr = store.jahr();
        expect(repo.eintraege).toHaveBeenCalledWith('a', `${jahr - 1}-12-01`, `${jahr + 1}-01-31`);

        await store.planWaehlen('b');
        expect(store.planId()).toBe('b');
        expect(JSON.parse(localStorage.getItem('pulsedeck.belegung') ?? '{}').plan).toBe('b');
    });

    it('stellt Plan und Ansicht aus dem Speicher wieder her und ignoriert unbekannte Pläne', async () => {
        localStorage.setItem('pulsedeck.belegung', JSON.stringify({ plan: 'b', ansicht: 'monat' }));
        einrichten({ plaene: vi.fn(async () => [testPlan({ id: 'a' }), testPlan({ id: 'b' })]) });
        await store.start(ref());
        expect(store.planId()).toBe('b');
        expect(store.ansicht()).toBe('monat');

        localStorage.setItem('pulsedeck.belegung', JSON.stringify({ plan: 'weg' }));
        const zweiter = TestBed.runInInjectionContext(() => new BookingStore());
        await zweiter.start(ref());
        expect(zweiter.planId()).toBe('a');
    });

    it('bleibt bei gesperrtem oder kaputtem Speicher funktionsfähig', async () => {
        localStorage.setItem('pulsedeck.belegung', '{kaputt');
        einrichten();
        await store.start(ref());
        expect(store.planId()).toBe('p1');
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('gesperrt'); });
        await expect(store.planWaehlen('p1')).resolves.toBeUndefined();
        vi.restoreAllMocks();
    });

    it('lädt nur beim Jahreswechsel neu, nicht beim Blättern innerhalb des Jahres', async () => {
        einrichten();
        await store.start(ref());
        store.oeffneMonat(11, 2026);
        repo.eintraege.mockClear();
        await store.weiter(-1); // Oktober
        expect(store.monat()).toBe(10);
        expect(repo.eintraege).not.toHaveBeenCalled();
        store.oeffneMonat(1, 2026);
        await store.weiter(-1); // Dezember des Vorjahres
        expect([store.jahr(), store.monat()]).toEqual([2025, 12]);
        expect(repo.eintraege).toHaveBeenCalledTimes(1);
        store.oeffneMonat(12, 2025);
        await store.weiter(1);
        expect([store.jahr(), store.monat()]).toEqual([2026, 1]);
    });

    it('blättert in der Jahresansicht um ganze Jahre', async () => {
        einrichten();
        await store.start(ref());
        const start = store.jahr();
        await store.weiter(1);
        expect(store.jahr()).toBe(start + 1);
        expect(repo.eintraege).toHaveBeenLastCalledWith('p1', `${start}-12-01`, `${start + 2}-01-31`);
    });

    it('trennt offene Anfragen von den eigenen Buchungen', async () => {
        einrichten({
            eintraege: vi.fn(async () => [
                testEintrag({ id: 'o', status: 'requested' }),
                testEintrag({ id: 'm', is_mine: true, start_at: '2026-12-01T10:00:00.000Z' }),
                testEintrag({ id: 'm2', is_mine: true, start_at: '2026-11-01T10:00:00.000Z' }),
            ]),
        });
        await store.start(ref());
        expect(store.offeneAnfragen().map((e) => e.id)).toEqual(['o']);
        expect(store.meineAnfragen().map((e) => e.id)).toEqual(['m', 'm2']); // neueste zuerst
    });

    it('lädt nach jeder Aktion neu und reicht Ergebnisse durch', async () => {
        einrichten();
        await store.start(ref());
        const eintrag = await store.buchen({ title: 'X', note: null, start_at: 'a', end_at: 'b', is_public: false });
        expect(eintrag.status).toBe('requested');
        expect(repo.buchen).toHaveBeenCalledWith('p1', expect.objectContaining({ title: 'X' }));
        await store.annehmen('b1');
        await store.ablehnen('b1', 'Grund');
        expect(repo.ablehnen).toHaveBeenCalledWith('b1', 'Grund');
        await store.stornieren('b1');
        await store.loeschen('b1');
        expect(await store.serieBeenden('s1', '2027-01-01')).toBe(2);
        // Start plus sechs Aktionen, je ein Neuladen der Einträge
        expect(repo.eintraege).toHaveBeenCalledTimes(7);
    });

    it('lässt Fehler des Servers bei Aktionen an den Aufrufer, ohne den Zustand zu verändern', async () => {
        einrichten({ buchen: vi.fn(async () => { throw new Error('Der Zeitraum ist schon belegt'); }) });
        await store.start(ref());
        const vorher = store.eintraege();
        await expect(store.buchen({ title: 'X', note: null, start_at: 'a', end_at: 'b', is_public: false })).rejects.toThrow('schon belegt');
        expect(store.eintraege()).toBe(vorher);
    });

    it('legt Pläne an (und wählt sie) und fällt nach dem Löschen auf den nächsten Plan zurück', async () => {
        let plaene = [testPlan({ id: 'p1' })];
        einrichten({
            plaene: vi.fn(async () => plaene),
            planAnlegen: vi.fn(async () => { plaene = [...plaene, testPlan({ id: 'neu' })]; return testPlan({ id: 'neu' }); }),
            planLoeschen: vi.fn(async () => { plaene = plaene.filter((p) => p.id !== 'neu'); }),
        });
        await store.start(ref());
        await store.planAnlegen({ name: 'Neu', kind: 'place', address: null, state: null, window_start: 8, window_end: 22, all_members_can_request: false, public_view: 'none' });
        expect(store.planId()).toBe('neu');
        await store.planLoeschen();
        expect(store.planId()).toBe('p1');
    });

    it('lädt bei Echtzeit-Meldungen gebündelt neu und räumt das Abo beim Zerstören auf', async () => {
        vi.useFakeTimers();
        try {
            let melde: () => void = () => undefined;
            const abmelden = vi.fn();
            einrichten({ aenderungen: vi.fn((fn: () => void) => { melde = fn; return abmelden; }) });
            await store.start(ref());
            repo.eintraege.mockClear();
            melde();
            melde();
            melde();
            await vi.advanceTimersByTimeAsync(200);
            expect(repo.eintraege).toHaveBeenCalledTimes(1);
            zerstoert.forEach((fn) => fn());
            expect(abmelden).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('zeigt ohne Pläne eine leere Liste und lädt keine Einträge', async () => {
        einrichten({ plaene: vi.fn(async () => []) });
        await store.start(ref());
        expect(store.plan()).toBeNull();
        expect(store.eintraege()).toEqual([]);
        expect(repo.eintraege).not.toHaveBeenCalled();
    });
});
