import type { Bundesland } from './feiertage';

/** Felder wie im Backend (snake_case, E32). Zeitpunkte sind ISO-8601-Instants, gerechnet wird in Europe/Berlin. */

export type PlanArt = 'place' | 'item';
export type PlanRolle = 'lead' | 'manager' | 'requester';
export type OeffentlicheAnzeige = 'none' | 'week' | 'month' | 'year';
export type BuchungsStatus = 'requested' | 'approved' | 'declined' | 'cancelled';

export interface BookingPlan {
    id: string;
    name: string;
    kind: PlanArt;
    address: string | null;
    state: Bundesland | null;
    /** Zeitfenster in vollen Stunden, `window_end` exklusiv (8 bis 22 = Stunden 8 bis 21). */
    window_start: number;
    window_end: number;
    all_members_can_request: boolean;
    public_view: OeffentlicheAnzeige;
    /** Rolle der angemeldeten Person im Plan; Organisations-Admins gelten als `lead`. Null = nur lesen. */
    my_role: PlanRolle | null;
    open_requests: number;
}

/** Was die Raster vom Plan brauchen (Zeitfenster und Bundesland für die Feiertage); die öffentliche Seite kennt nicht mehr. */
export type RasterPlan = Pick<BookingPlan, 'window_start' | 'window_end' | 'state'>;

export interface BookingEntry {
    id: string;
    plan_id: string;
    /** Null = Titel nicht sichtbar, die Oberfläche zeigt „Belegt“. */
    title: string | null;
    note: string | null;
    start_at: string;
    end_at: string;
    status: BuchungsStatus;
    is_public: boolean;
    /** Name der anfragenden Person; null, wenn nicht sichtbar. */
    requester_name: string | null;
    is_mine: boolean;
    series_id: string | null;
    event_id: string | null;
    decision_reason: string | null;
}

export type Verfuegbarkeit =
    | { art: 'frei' }
    | { art: 'ueberschneidung'; mit: BookingEntry[] }
    | { art: 'belegt'; durch: BookingEntry };

/** Wer darf in diesem Plan anfragen? Rolle im Plan oder „alle Mitglieder“. */
export function darfAnfragen(plan: BookingPlan): boolean {
    return plan.my_role !== null || plan.all_members_can_request;
}

export function darfEntscheiden(plan: BookingPlan): boolean {
    return plan.my_role === 'lead' || plan.my_role === 'manager';
}
