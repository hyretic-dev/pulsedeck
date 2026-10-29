import { TestBed } from '@angular/core/testing';

import { ApiService } from '../../../../core/api.service';
import { ApiPublicBookingRepository } from './api-public-booking.repository';

describe('ApiPublicBookingRepository', () => {
    const api = { get: vi.fn() };
    let repo: ApiPublicBookingRepository;

    beforeEach(() => {
        api.get.mockReset();
        TestBed.configureTestingModule({ providers: [ApiPublicBookingRepository, { provide: ApiService, useValue: api }] });
        repo = TestBed.inject(ApiPublicBookingRepository);
    });

    it('ruft die anonymen Endpunkte ohne Anmeldung auf und kodiert den Slug', async () => {
        api.get.mockResolvedValue([]);
        await repo.plaene('mein verein');
        expect(api.get).toHaveBeenCalledWith('/public/organizations/mein%20verein/booking-calendars', undefined, { auth: false });
        await repo.eintraege('alpha', 'p1', '2026-01-01', '2027-01-31');
        expect(api.get).toHaveBeenLastCalledWith('/public/organizations/alpha/booking-calendars/p1/bookings', { from: '2026-01-01', to: '2027-01-31' }, { auth: false });
    });

    it('macht aus der öffentlichen Antwort bestätigte Einträge ohne Person und Notiz', async () => {
        api.get.mockResolvedValue([{ id: 'b', title: 'Fest', start_at: 'a', end_at: 'b', event_id: 'e1' }]);
        const [eintrag] = await repo.eintraege('alpha', 'p1', 'x', 'y');
        expect(eintrag).toMatchObject({ id: 'b', plan_id: 'p1', title: 'Fest', status: 'approved', is_public: true, event_id: 'e1', requester_name: null, note: null, is_mine: false });
    });
});
