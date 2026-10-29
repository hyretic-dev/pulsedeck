import { InjectionToken } from '@angular/core';

import type { BookingEntry, BookingPlan } from '../../../../shared/booking/booking.models';

export interface BuchungEingabe {
    title: string;
    note: string | null;
    start_at: string;
    end_at: string;
    is_public: boolean;
}

export interface SerieEingabe {
    title: string;
    note: string | null;
    is_public: boolean;
    /** 0 = Montag … 6 = Sonntag */
    weekdays: number[];
    every_n_weeks: 1 | 2 | 3 | 4;
    hour_from: number;
    hour_to: number;
    /** `JJJJ-MM-TT`, Berliner Datum */
    valid_from: string;
    valid_to: string;
    skip_holidays: boolean;
}

export interface SerienVorschau {
    dates: string[];
    skipped_booked: string[];
    skipped_holidays: string[];
    declined_requests: BookingEntry[];
}

/** Port der Datenschicht des Belegungsmoduls. Die Anbindung (API oder Beispieldaten) steht in `booking.providers.ts`. */
export interface BookingRepository {
    plaene(): Promise<BookingPlan[]>;
    eintraege(planId: string, von: Date, bis: Date): Promise<BookingEntry[]>;
    anfragen(planId: string, eingabe: BuchungEingabe): Promise<BookingEntry>;
    eintragen(planId: string, eingabe: BuchungEingabe): Promise<BookingEntry>;
    annehmen(eintragId: string): Promise<void>;
    ablehnen(eintragId: string, grund: string | null): Promise<void>;
    zurueckziehen(eintragId: string): Promise<void>;
    loeschen(eintragId: string): Promise<void>;
    serieVorschau(planId: string, serie: SerieEingabe): Promise<SerienVorschau>;
    serieAnlegen(planId: string, serie: SerieEingabe): Promise<number>;
}

export const BOOKING_REPOSITORY = new InjectionToken<BookingRepository>('BookingRepository');
