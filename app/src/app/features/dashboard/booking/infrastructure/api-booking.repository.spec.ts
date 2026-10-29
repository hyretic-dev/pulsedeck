import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ApiService } from '../../../../core/api.service';
import { RealtimeService } from '../../../../core/realtime.service';
import { OrganizationService } from '../../../../shared/services/organization.service';
import { ApiBookingRepository } from './api-booking.repository';

describe('ApiBookingRepository', () => {
    let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    let realtime: { abonnieren: ReturnType<typeof vi.fn> };
    let orgId: ReturnType<typeof signal<string | undefined>>;
    let repo: ApiBookingRepository;

    beforeEach(() => {
        api = { get: vi.fn(async () => []), post: vi.fn(async () => ({})), put: vi.fn(async () => ({})), patch: vi.fn(async () => ({})), delete: vi.fn(async () => undefined) };
        realtime = { abonnieren: vi.fn(() => vi.fn()) };
        orgId = signal<string | undefined>('o1');
        TestBed.configureTestingModule({
            providers: [
                ApiBookingRepository,
                { provide: ApiService, useValue: api },
                { provide: RealtimeService, useValue: realtime },
                { provide: OrganizationService, useValue: { currentOrgId: orgId } },
            ],
        });
        repo = TestBed.inject(ApiBookingRepository);
    });

    it('spricht die Endpunkte der Organisation an und reicht Datum und Felder unverändert durch', async () => {
        await repo.plaene();
        expect(api.get).toHaveBeenCalledWith('/orgs/o1/booking-calendars');
        await repo.eintraege('p1', '2026-01-01', '2027-01-31');
        expect(api.get).toHaveBeenCalledWith('/orgs/o1/booking-calendars/p1/bookings', { from: '2026-01-01', to: '2027-01-31' });
        const eingabe = { title: 'T', note: null, start_at: 'a', end_at: 'b', is_public: false };
        await repo.buchen('p1', eingabe);
        expect(api.post).toHaveBeenCalledWith('/orgs/o1/booking-calendars/p1/bookings', eingabe);
        await repo.annehmen('b1');
        expect(api.post).toHaveBeenCalledWith('/orgs/o1/bookings/b1/approve');
        await repo.stornieren('b1');
        expect(api.post).toHaveBeenCalledWith('/orgs/o1/bookings/b1/cancel');
        await repo.loeschen('b1');
        expect(api.delete).toHaveBeenCalledWith('/orgs/o1/bookings/b1');
        await repo.bearbeiten('b1', { title: 'Neu' });
        expect(api.patch).toHaveBeenCalledWith('/orgs/o1/bookings/b1', { title: 'Neu' });
    });

    it('sendet die Begründung nur, wenn es eine gibt', async () => {
        await repo.ablehnen('b1', 'Renovierung');
        expect(api.post).toHaveBeenLastCalledWith('/orgs/o1/bookings/b1/decline', { reason: 'Renovierung' });
        await repo.ablehnen('b1', null);
        expect(api.post).toHaveBeenLastCalledWith('/orgs/o1/bookings/b1/decline', {});
    });

    it('liest die Zahl offener Anfragen, Rollen und Serien über die vorgesehenen Pfade', async () => {
        api.get.mockResolvedValueOnce({ count: 4 });
        expect(await repo.offeneAnfragen()).toBe(4);
        expect(api.get).toHaveBeenCalledWith('/orgs/o1/booking-calendars/open-requests');
        await repo.rolleSetzen('p1', 'm1', 'manager');
        expect(api.put).toHaveBeenCalledWith('/orgs/o1/booking-calendars/p1/members/m1', { role: 'manager' });
        await repo.rolleEntfernen('p1', 'm1');
        expect(api.delete).toHaveBeenCalledWith('/orgs/o1/booking-calendars/p1/members/m1');
        api.post.mockResolvedValueOnce({ removed: 3 });
        expect(await repo.serieBeenden('s1', '2027-01-01')).toBe(3);
        expect(api.post).toHaveBeenLastCalledWith('/orgs/o1/booking-series/s1/end', { from: '2027-01-01' });
        await repo.serieUmbenennen('s1', 'Neu');
        expect(api.patch).toHaveBeenLastCalledWith('/orgs/o1/booking-series/s1', { title: 'Neu' });
    });

    it('macht aus einer leeren Adresse null und lässt nicht gesetzte Felder weg', async () => {
        await repo.planAendern('p1', { name: 'X', address: '  ' });
        expect(api.patch).toHaveBeenLastCalledWith('/orgs/o1/booking-calendars/p1', { name: 'X', address: null });
        await repo.planAendern('p1', { name: 'Y' });
        expect(api.patch).toHaveBeenLastCalledWith('/orgs/o1/booking-calendars/p1', { name: 'Y' });
    });

    it('meldet ohne Organisation einen verständlichen Fehler statt eine Adresse mit „undefined“ zu rufen', async () => {
        orgId.set(undefined);
        await expect(repo.plaene()).rejects.toThrow('Keine Organisation');
        expect(api.get).not.toHaveBeenCalled();
    });

    it('abonniert Echtzeit-Änderungen der aktiven Organisation und wechselt beim Organisationswechsel', () => {
        const abmelden1 = vi.fn();
        const abmelden2 = vi.fn();
        realtime.abonnieren.mockReturnValueOnce(abmelden1).mockReturnValueOnce(abmelden2);
        const fn = vi.fn();
        const stop = TestBed.runInInjectionContext(() => repo.aenderungen(fn));
        TestBed.tick();
        expect(realtime.abonnieren).toHaveBeenCalledWith('o1', expect.arrayContaining(['bookings', 'booking_calendars']), expect.any(Function));
        realtime.abonnieren.mock.calls[0][2]();
        expect(fn).toHaveBeenCalledTimes(1);

        orgId.set('o2');
        TestBed.tick();
        expect(abmelden1).toHaveBeenCalled();
        expect(realtime.abonnieren).toHaveBeenLastCalledWith('o2', expect.any(Array), expect.any(Function));

        stop();
        expect(abmelden2).toHaveBeenCalled();
    });
});
