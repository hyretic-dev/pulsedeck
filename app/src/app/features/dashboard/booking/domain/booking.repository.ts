import { InjectionToken } from '@angular/core';

import type { BookingEntry, BookingPlan, OeffentlicheAnzeige, PlanArt, PlanRolle } from '../../../../shared/booking/booking.models';
import type { Bundesland } from '../../../../shared/booking/feiertage';

export interface BuchungEingabe {
    title: string;
    note: string | null;
    start_at: string;
    end_at: string;
    is_public: boolean;
}

/** Änderung einer Buchung durch Verwaltung oder Leitung; nicht gesetzte Felder bleiben unverändert. */
export type BuchungAenderung = Partial<BuchungEingabe>;

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

export interface AbgelehnteAnfrage {
    id: string;
    title: string | null;
    requester_name: string | null;
}

export interface SerienVorschau {
    dates: string[];
    skipped_booked: string[];
    skipped_holidays: string[];
    declined_requests: AbgelehnteAnfrage[];
}

export interface SerienErgebnis {
    series_id: string;
    created: number;
    skipped_booked: string[];
    skipped_holidays: string[];
    declined_requests: number;
}

export interface PlanEingabe {
    name: string;
    kind: PlanArt;
    address: string | null;
    state: Bundesland | null;
    window_start: number;
    window_end: number;
    all_members_can_request: boolean;
    public_view: OeffentlicheAnzeige;
}

export interface PlanRolleZeile {
    member_id: string;
    name: string;
    role: PlanRolle;
}

/** Port der Datenschicht des Belegungsmoduls. Die Anbindung steht in `booking.providers.ts`. */
export interface BookingRepository {
    plaene(): Promise<BookingPlan[]>;
    /** Offene Anfragen über alle Pläne, in denen die Person entscheiden darf. */
    offeneAnfragen(): Promise<number>;
    planAnlegen(eingabe: PlanEingabe): Promise<BookingPlan>;
    planAendern(planId: string, aenderung: Partial<PlanEingabe>): Promise<BookingPlan>;
    planLoeschen(planId: string): Promise<void>;

    rollen(planId: string): Promise<PlanRolleZeile[]>;
    rolleSetzen(planId: string, memberId: string, rolle: PlanRolle): Promise<void>;
    rolleEntfernen(planId: string, memberId: string): Promise<void>;

    /** Buchungen eines Plans zwischen zwei Berliner Daten (`JJJJ-MM-TT`, beide einschließlich). */
    eintraege(planId: string, von: string, bis: string): Promise<BookingEntry[]>;
    /** Verwaltung und Leitung tragen direkt ein (angenommen), alle anderen stellen eine Anfrage; der Server entscheidet. */
    buchen(planId: string, eingabe: BuchungEingabe): Promise<BookingEntry>;
    bearbeiten(eintragId: string, aenderung: BuchungAenderung): Promise<BookingEntry>;
    annehmen(eintragId: string): Promise<BookingEntry>;
    ablehnen(eintragId: string, grund: string | null): Promise<BookingEntry>;
    stornieren(eintragId: string): Promise<BookingEntry>;
    loeschen(eintragId: string): Promise<void>;

    serieVorschau(planId: string, serie: SerieEingabe): Promise<SerienVorschau>;
    serieAnlegen(planId: string, serie: SerieEingabe): Promise<SerienErgebnis>;
    serieUmbenennen(serieId: string, titel: string): Promise<void>;
    /** Beendet die Serie ab einem Berliner Datum (einschließlich); liefert die Zahl entfernter Termine. */
    serieBeenden(serieId: string, ab: string): Promise<number>;

    /** Meldet Änderungen anderer Personen und Wiederverbindungen (Echtzeit); liefert die Abmeldefunktion. */
    aenderungen(beiAenderung: () => void): () => void;
}

export const BOOKING_REPOSITORY = new InjectionToken<BookingRepository>('BookingRepository');

export interface PersonAuswahl {
    id: string;
    name: string;
}

/** Mitglieder der Organisation, aus denen die Leitung Rollen im Plan vergibt. */
export interface MemberDirectory {
    mitglieder(): Promise<PersonAuswahl[]>;
}

export const MEMBER_DIRECTORY = new InjectionToken<MemberDirectory>('BookingMemberDirectory');
