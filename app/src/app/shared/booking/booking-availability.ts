import { InjectionToken, inject } from '@angular/core';

import { BeispielBelegungStore } from './booking-beispieldaten';
import type { BookingEntry, BookingPlan } from './booking.models';

/**
 * Lesezugriff auf Belegungspläne für andere Features (Termin-Dialog: „Ort reservieren“). Features importieren sich
 * nicht gegenseitig, deshalb liegt der Port in `shared/`; die Anbindung steht in der Factory.
 */
export interface BookingAvailability {
    /** Pläne der Art Ort, in denen die Person anfragen darf. */
    orte(): Promise<BookingPlan[]>;
    eintraege(planId: string): Promise<BookingEntry[]>;
}

export const BOOKING_AVAILABILITY = new InjectionToken<BookingAvailability>('BookingAvailability', {
    providedIn: 'root',
    // PROTOTYP: Beispieldaten; mit der API-Anbindung ersetzt durch eine Implementierung auf dem Lese-Endpunkt.
    factory: () => {
        const store = inject(BeispielBelegungStore);
        return {
            orte: async () => store.plaene().filter((p) => p.kind === 'place' && (p.my_role !== null || p.all_members_can_request)),
            eintraege: async (planId: string) => store.eintraegeVon(planId),
        };
    },
});
