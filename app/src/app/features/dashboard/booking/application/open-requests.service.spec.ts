import { TestBed } from '@angular/core/testing';

import { BOOKING_REPOSITORY } from '../domain/booking.repository';
import { testRepository } from '../testing';
import { OpenRequestsService } from './open-requests.service';

describe('OpenRequestsService', () => {
    it('zeigt die Zahl offener Anfragen und lädt bei Änderungen neu', async () => {
        let melde: () => void = () => undefined;
        let stand = 3;
        const repo = testRepository({
            offeneAnfragen: vi.fn(async () => stand),
            aenderungen: vi.fn((fn: () => void) => { melde = fn; return () => undefined; }),
        });
        TestBed.configureTestingModule({ providers: [{ provide: BOOKING_REPOSITORY, useValue: repo }] });
        const dienst = TestBed.inject(OpenRequestsService);
        await vi.waitFor(() => expect(dienst.count()).toBe(3));
        stand = 1;
        melde();
        await vi.waitFor(() => expect(dienst.count()).toBe(1));
    });

    it('behält den letzten Stand, wenn das Laden scheitert', async () => {
        let ok = true;
        let melde: () => void = () => undefined;
        const repo = testRepository({
            offeneAnfragen: vi.fn(async () => { if (!ok) throw new Error('offline'); return 2; }),
            aenderungen: vi.fn((fn: () => void) => { melde = fn; return () => undefined; }),
        });
        TestBed.configureTestingModule({ providers: [{ provide: BOOKING_REPOSITORY, useValue: repo }] });
        const dienst = TestBed.inject(OpenRequestsService);
        await vi.waitFor(() => expect(dienst.count()).toBe(2));
        ok = false;
        melde();
        await new Promise((r) => setTimeout(r, 20));
        expect(dienst.count()).toBe(2);
    });
});
