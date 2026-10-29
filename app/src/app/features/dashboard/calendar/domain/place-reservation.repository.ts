import { InjectionToken } from '@angular/core';

import type { BookingEntry, BookingPlan } from '../../../../shared/booking/booking.models';

/**
 * Port des Termin-Features zum Belegungsplan: Das Feature liest nur, was der Termin-Dialog zum Reservieren braucht. Reserviert wird
 * über das Termin-Formular selbst (`booking_calendar_id`), Termin und Buchung speichert der Server in einer Transaktion.
 */
export interface PlaceReservationRepository {
    /** Alle Belegungspläne der Art Ort samt Rolle der Person (null = nur lesen). */
    orte(): Promise<BookingPlan[]>;
    /** Buchungen des Plans an einem Berliner Tag (`JJJJ-MM-TT`); Titel und Person nach den Sichtbarkeitsregeln des Servers maskiert. */
    eintraegeAmTag(planId: string, tag: string): Promise<BookingEntry[]>;
}

export const PLACE_RESERVATION_REPOSITORY = new InjectionToken<PlaceReservationRepository>('PlaceReservationRepository');
