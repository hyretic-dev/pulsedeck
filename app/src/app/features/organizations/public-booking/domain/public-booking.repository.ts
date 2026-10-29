import { InjectionToken } from '@angular/core';

import type { BookingEntry, OeffentlicheAnzeige, PlanArt } from '../../../../shared/booking/booking.models';
import type { Bundesland } from '../../../../shared/booking/feiertage';

/** Belegungsplan, den die Leitung öffentlich zeigt; die Anzeige ist die Startansicht der Besucher. */
export interface PublicBookingPlan {
    id: string;
    name: string;
    kind: PlanArt;
    address: string | null;
    state: Bundesland | null;
    window_start: number;
    window_end: number;
    public_view: Exclude<OeffentlicheAnzeige, 'none'>;
}

/** Port der öffentlichen Belegungsansicht (anonym, nur lesen). */
export interface PublicBookingRepository {
    plaene(slug: string): Promise<PublicBookingPlan[]>;
    /** Bestätigte, öffentliche Buchungen zwischen zwei Berliner Daten (`JJJJ-MM-TT`, beide einschließlich). */
    eintraege(slug: string, planId: string, von: string, bis: string): Promise<BookingEntry[]>;
}

export const PUBLIC_BOOKING_REPOSITORY = new InjectionToken<PublicBookingRepository>('PublicBookingRepository');
