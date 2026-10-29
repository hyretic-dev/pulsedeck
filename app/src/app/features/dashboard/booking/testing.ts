import { vi } from 'vitest';

import type { BookingEntry, BookingPlan } from '../../../shared/booking/booking.models';
import type { BookingRepository } from './domain/booking.repository';

export const testPlan = (zusatz: Partial<BookingPlan> = {}): BookingPlan => ({
    id: 'p1', name: 'Saal', kind: 'place', address: null, state: null, window_start: 8, window_end: 22,
    all_members_can_request: false, public_view: 'none', my_role: 'lead', open_requests: 0, ...zusatz,
});

export const testEintrag = (zusatz: Partial<BookingEntry> = {}): BookingEntry => ({
    id: 'b1', plan_id: 'p1', title: 'Treffen', note: null, start_at: '2026-11-03T17:00:00.000Z', end_at: '2026-11-03T19:00:00.000Z',
    status: 'approved', is_public: false, requester_name: 'Anna', is_mine: false, series_id: null, event_id: null, decision_reason: null, ...zusatz,
});

/** Repository-Attrappe: jede Methode ist ein Vitest-Mock mit sinnvoller Standardantwort. */
export function testRepository(zusatz: Partial<BookingRepository> = {}): { [K in keyof BookingRepository]: ReturnType<typeof vi.fn> } & BookingRepository {
    const basis = {
        plaene: vi.fn(async () => [testPlan()]),
        offeneAnfragen: vi.fn(async () => 0),
        planAnlegen: vi.fn(async () => testPlan({ id: 'neu', name: 'Neu' })),
        planAendern: vi.fn(async () => testPlan()),
        planLoeschen: vi.fn(async () => undefined),
        rollen: vi.fn(async () => []),
        rolleSetzen: vi.fn(async () => undefined),
        rolleEntfernen: vi.fn(async () => undefined),
        eintraege: vi.fn(async () => [testEintrag()]),
        buchen: vi.fn(async () => testEintrag({ status: 'requested' })),
        bearbeiten: vi.fn(async () => testEintrag()),
        annehmen: vi.fn(async () => testEintrag()),
        ablehnen: vi.fn(async () => testEintrag({ status: 'declined' })),
        stornieren: vi.fn(async () => testEintrag({ status: 'cancelled' })),
        loeschen: vi.fn(async () => undefined),
        serieVorschau: vi.fn(async () => ({ dates: [], skipped_booked: [], skipped_holidays: [], declined_requests: [] })),
        serieAnlegen: vi.fn(async () => ({ series_id: 's1', created: 1, skipped_booked: [], skipped_holidays: [], declined_requests: 0 })),
        serieUmbenennen: vi.fn(async () => undefined),
        serieBeenden: vi.fn(async () => 2),
        aenderungen: vi.fn(() => () => undefined),
    };
    return { ...basis, ...zusatz } as never;
}
