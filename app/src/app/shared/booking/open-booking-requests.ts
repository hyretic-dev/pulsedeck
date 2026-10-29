import { InjectionToken, Signal, signal } from '@angular/core';

/**
 * Zahl offener Belegungsanfragen, über die die Person entscheiden darf (Badge am Menüpunkt „Belegung“). Das Layout kennt nur
 * diesen Vertrag; das Belegungs-Feature bindet die Umsetzung (`provideBooking`). Ohne Bindung bleibt der Zähler bei 0.
 */
export interface OpenBookingRequests {
    readonly count: Signal<number>;
}

export const OPEN_BOOKING_REQUESTS = new InjectionToken<OpenBookingRequests>('OpenBookingRequests', {
    providedIn: 'root',
    factory: () => ({ count: signal(0).asReadonly() }),
});
