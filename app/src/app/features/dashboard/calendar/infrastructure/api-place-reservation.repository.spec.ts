import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ApiService } from '../../../../core/api.service';
import { OrganizationService } from '../../../../shared/services/organization.service';
import { testPlan } from '../../booking/testing';
import { ApiPlaceReservationRepository } from './api-place-reservation.repository';

describe('ApiPlaceReservationRepository', () => {
    const api = { get: vi.fn() };
    const orgId = signal<string | undefined>('o1');

    beforeEach(() => {
        api.get.mockReset();
        orgId.set('o1');
        TestBed.configureTestingModule({
            providers: [ApiPlaceReservationRepository, { provide: ApiService, useValue: api }, { provide: OrganizationService, useValue: { currentOrgId: orgId } }],
        });
    });

    it('liefert nur Pläne der Art Ort', async () => {
        api.get.mockResolvedValue([testPlan({ id: 'a', kind: 'place' }), testPlan({ id: 'b', kind: 'item' })]);
        const orte = await TestBed.inject(ApiPlaceReservationRepository).orte();
        expect(api.get).toHaveBeenCalledWith('/orgs/o1/booking-calendars');
        expect(orte.map((p) => p.id)).toEqual(['a']);
    });

    it('fragt die Belegung genau eines Tages ab', async () => {
        api.get.mockResolvedValue([]);
        await TestBed.inject(ApiPlaceReservationRepository).eintraegeAmTag('p1', '2026-11-12');
        expect(api.get).toHaveBeenCalledWith('/orgs/o1/booking-calendars/p1/bookings', { from: '2026-11-12', to: '2026-11-12' });
    });

    it('meldet ohne Organisation einen Fehler', async () => {
        orgId.set(undefined);
        await expect(TestBed.inject(ApiPlaceReservationRepository).orte()).rejects.toThrow('Keine Organisation');
    });
});
