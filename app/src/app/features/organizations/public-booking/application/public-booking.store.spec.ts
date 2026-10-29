import { TestBed } from '@angular/core/testing';

import { PUBLIC_BOOKING_REPOSITORY } from '../domain/public-booking.repository';
import { testOeffentlicherPlan, testOeffentlichesRepository } from '../testing';
import { PublicBookingStore } from './public-booking.store';

describe('PublicBookingStore', () => {
    function einrichten(zusatz: Parameters<typeof testOeffentlichesRepository>[0] = {}) {
        const repo = testOeffentlichesRepository(zusatz);
        TestBed.configureTestingModule({ providers: [PublicBookingStore, { provide: PUBLIC_BOOKING_REPOSITORY, useValue: repo }] });
        return { repo, store: TestBed.inject(PublicBookingStore) };
    }

    it('startet mit dem ersten Plan und dessen Anzeige als Startansicht', async () => {
        const { repo, store } = einrichten({ plaene: vi.fn(async () => [testOeffentlicherPlan({ id: 'a', public_view: 'month' }), testOeffentlicherPlan({ id: 'b' })]) });
        await store.start('alpha');
        expect(store.planId()).toBe('a');
        expect(store.ansicht()).toBe('monat');
        expect(repo.eintraege).toHaveBeenCalledWith('alpha', 'a', `${store.jahr() - 1}-12-15`, `${store.jahr() + 1}-01-15`);
        await store.waehle('b');
        expect(store.ansicht()).toBe('jahr'); // Startansicht des gewählten Plans
        expect(store.eintraege()).toHaveLength(1);
    });

    it('fragt höchstens so viele Tage an, wie der öffentliche Endpunkt erlaubt (400), auch im Schaltjahr', async () => {
        const { repo, store } = einrichten();
        await store.start('alpha');
        for (const jahr of [2027, 2028, 2031]) {
            store.oeffneMonat(1, jahr);
            await store.weiter(1);
            await store.weiter(-1);
            repo.eintraege.mockClear();
            await store.waehle('p1');
            const [, , von, bis] = repo.eintraege.mock.calls[0] as [string, string, string, string];
            const tage = (Date.parse(bis) - Date.parse(von)) / 86_400_000;
            expect(tage, `${jahr}: ${von} bis ${bis}`).toBeLessThanOrEqual(400);
            expect(tage).toBeGreaterThan(365); // das ganze Jahr ist abgedeckt
        }
    });

    it('bleibt ohne öffentliche Pläne leer und lädt keine Einträge', async () => {
        const { repo, store } = einrichten({ plaene: vi.fn(async () => []) });
        await store.start('alpha');
        expect(store.plaene()).toEqual([]);
        expect(store.plan()).toBeNull();
        expect(repo.eintraege).not.toHaveBeenCalled();
    });

    it('zeigt bei Serverfehlern nichts, statt die öffentliche Seite zu stören', async () => {
        const { store } = einrichten({ plaene: vi.fn(async () => { throw new Error('500'); }) });
        await expect(store.start('alpha')).resolves.toBeUndefined();
        expect(store.plaene()).toEqual([]);
        expect(store.fehler()).toBe(true);
    });

    it('leert die Einträge, wenn das Laden scheitert', async () => {
        let schlaegtFehl = false;
        const { store } = einrichten({ eintraege: vi.fn(async () => { if (schlaegtFehl) throw new Error('offline'); return [{ id: 'x' }] as never; }) });
        await store.start('alpha');
        expect(store.eintraege()).toHaveLength(1);
        schlaegtFehl = true;
        await store.weiter(1);
        expect(store.eintraege()).toEqual([]);
    });

    it('blättert wie die interne Ansicht und lädt nur beim Jahreswechsel neu', async () => {
        const { repo, store } = einrichten();
        await store.start('alpha');
        store.oeffneMonat(1, 2026);
        repo.eintraege.mockClear();
        await store.weiter(1);
        expect([store.jahr(), store.monat()]).toEqual([2026, 2]);
        expect(repo.eintraege).not.toHaveBeenCalled();
        await store.weiter(-1);
        await store.weiter(-1);
        expect([store.jahr(), store.monat()]).toEqual([2025, 12]);
        expect(repo.eintraege).toHaveBeenCalledTimes(1);
    });

    it('zeigt in der Wochenansicht die laufende KW und blättert wochenweise', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
        try {
            const { store } = einrichten();
            await store.start('alpha');
            await store.ansichtWaehlen('woche');
            expect(store.kalenderwoche()).toEqual({ woche: 44, jahr: 2026 });
            await store.weiter(1);
            expect(store.woche()).toEqual({ jahr: 2026, monat: 11, tag: 2 });
            await store.heute();
            expect(store.woche()).toEqual({ jahr: 2026, monat: 10, tag: 26 });
        } finally {
            vi.useRealTimers();
        }
    });
});
