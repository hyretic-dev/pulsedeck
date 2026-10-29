import { vi } from 'vitest';

import type { BookingEntry } from '../../../shared/booking/booking.models';
import type { PublicBookingPlan, PublicBookingRepository } from './domain/public-booking.repository';

export const testOeffentlicherPlan = (zusatz: Partial<PublicBookingPlan> = {}): PublicBookingPlan => ({
    id: 'p1', name: 'Bürgerhaus Saal', kind: 'place', address: 'Marktstraße 12', state: 'NW', window_start: 8, window_end: 22, public_view: 'year', ...zusatz,
});

export const testOeffentlicheBuchung = (zusatz: Partial<BookingEntry> = {}): BookingEntry => ({
    id: 'b1', plan_id: 'p1', title: 'Offenes Fest', note: null, start_at: '2026-11-03T17:00:00.000Z', end_at: '2026-11-03T19:00:00.000Z',
    status: 'approved', is_public: true, requester_name: null, is_mine: false, series_id: null, event_id: null, decision_reason: null, ...zusatz,
});

export function testOeffentlichesRepository(zusatz: Partial<PublicBookingRepository> = {}): { [K in keyof PublicBookingRepository]: ReturnType<typeof vi.fn> } & PublicBookingRepository {
    return {
        plaene: vi.fn(async () => [testOeffentlicherPlan()]),
        eintraege: vi.fn(async () => [testOeffentlicheBuchung()]),
        ...zusatz,
    } as never;
}
