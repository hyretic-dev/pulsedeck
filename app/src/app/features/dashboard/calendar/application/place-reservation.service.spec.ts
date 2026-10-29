import { TestBed } from '@angular/core/testing';

import { testEintrag, testPlan } from '../../booking/testing';
import { PLACE_RESERVATION_REPOSITORY, type PlaceReservationRepository } from '../domain/place-reservation.repository';
import { PlaceReservationService } from './place-reservation.service';

describe('PlaceReservationService', () => {
    let repo: { orte: ReturnType<typeof vi.fn>; eintraegeAmTag: ReturnType<typeof vi.fn> };
    let dienst: PlaceReservationService;

    beforeEach(() => {
        repo = {
            orte: vi.fn(async () => [
                testPlan({ id: 'lead', my_role: 'lead' }),
                testPlan({ id: 'offen', my_role: null, all_members_can_request: true }),
                testPlan({ id: 'gesperrt', my_role: null, all_members_can_request: false }),
            ]),
            eintraegeAmTag: vi.fn(async () => [testEintrag()]),
        };
        TestBed.configureTestingModule({ providers: [PlaceReservationService, { provide: PLACE_RESERVATION_REPOSITORY, useValue: repo as PlaceReservationRepository }] });
        dienst = TestBed.inject(PlaceReservationService);
    });

    it('bietet nur Orte an, in denen die Person anfragen darf, kennt aber auch die übrigen für den Hinweis bei gesperrter Zeit', async () => {
        await dienst.ladeOrte();
        expect(dienst.orte().map((p) => p.id)).toEqual(['lead', 'offen']);
        expect(dienst.planMitId('gesperrt')?.my_role).toBeNull();
        expect(dienst.planMitId('unbekannt')).toBeNull();
    });

    it('lädt die Belegung des Tages beim Wählen und leert sie beim Abwählen', async () => {
        await dienst.ladeOrte();
        await dienst.waehle('lead', '2026-11-12');
        expect(repo.eintraegeAmTag).toHaveBeenCalledWith('lead', '2026-11-12');
        expect(dienst.eintraege()).toHaveLength(1);
        await dienst.waehle(null, '2026-11-12');
        expect(dienst.eintraege()).toEqual([]);
        expect(dienst.plan()).toBeNull();
    });

    it('lädt ohne Datum nichts und behält bei Fehlern eine leere Belegung samt Meldung', async () => {
        await dienst.ladeOrte();
        await dienst.waehle('lead', null);
        expect(repo.eintraegeAmTag).not.toHaveBeenCalled();
        repo.eintraegeAmTag.mockRejectedValueOnce(new Error('offline'));
        await dienst.ladeTag('2026-11-12');
        expect(dienst.eintraege()).toEqual([]);
        expect(dienst.fehler()).toBe('offline');
    });

    it('verwirft die Antwort für einen inzwischen abgewählten Plan', async () => {
        await dienst.ladeOrte();
        let antworte: (v: ReturnType<typeof testEintrag>[]) => void = () => undefined;
        repo.eintraegeAmTag.mockReturnValueOnce(new Promise((r) => (antworte = r)));
        const laden = dienst.waehle('lead', '2026-11-12');
        dienst.planId.set('offen');
        antworte([testEintrag()]);
        await laden;
        expect(dienst.eintraege()).toEqual([]);
    });

    it('meldet einen Fehler beim Laden der Orte, ohne zu werfen', async () => {
        repo.orte.mockRejectedValueOnce(new Error('403'));
        await dienst.ladeOrte();
        expect(dienst.orte()).toEqual([]);
        expect(dienst.fehler()).toBe('403');
    });
});
