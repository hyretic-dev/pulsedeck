import { Injectable, Injector, effect, inject } from '@angular/core';

import { ApiService } from '../../../../core/api.service';
import { RealtimeService } from '../../../../core/realtime.service';
import type { BookingEntry, BookingPlan, PlanRolle } from '../../../../shared/booking/booking.models';
import { OrganizationService } from '../../../../shared/services/organization.service';
import type {
    BookingRepository, BuchungAenderung, BuchungEingabe, PlanEingabe, PlanRolleZeile, SerieEingabe, SerienErgebnis, SerienVorschau,
} from '../domain/booking.repository';

/** Tabellen, deren Änderungen die Oberfläche neu laden lässt. */
const TABELLEN = ['bookings', 'booking_calendars', 'booking_calendar_members', 'booking_series'];

/** Backend-Anbindung des Belegungsmoduls (`/orgs/:orgId/booking-calendars`, `/bookings`, `/booking-series`). */
@Injectable()
export class ApiBookingRepository implements BookingRepository {
    private readonly api = inject(ApiService);
    private readonly org = inject(OrganizationService);
    private readonly realtime = inject(RealtimeService);
    private readonly injector = inject(Injector);

    private basis(): string {
        const id = this.org.currentOrgId();
        if (!id) throw new Error('Keine Organisation ausgewählt');
        return `/orgs/${id}`;
    }

    async plaene(): Promise<BookingPlan[]> {
        return this.api.get<BookingPlan[]>(`${this.basis()}/booking-calendars`);
    }

    async offeneAnfragen(): Promise<number> {
        return (await this.api.get<{ count: number }>(`${this.basis()}/booking-calendars/open-requests`)).count;
    }

    async planAnlegen(eingabe: PlanEingabe): Promise<BookingPlan> {
        return this.api.post<BookingPlan>(`${this.basis()}/booking-calendars`, this.planBody(eingabe));
    }

    async planAendern(planId: string, aenderung: Partial<PlanEingabe>): Promise<BookingPlan> {
        return this.api.patch<BookingPlan>(`${this.basis()}/booking-calendars/${planId}`, this.planBody(aenderung));
    }

    async planLoeschen(planId: string): Promise<void> {
        return this.api.delete(`${this.basis()}/booking-calendars/${planId}`);
    }

    /** Nur die vom Server erwarteten Felder; leere Adresse = null. */
    private planBody(e: Partial<PlanEingabe>): Partial<PlanEingabe> {
        const body: Partial<PlanEingabe> = { ...e };
        if ('address' in body) body.address = body.address?.trim() || null;
        return body;
    }

    async rollen(planId: string): Promise<PlanRolleZeile[]> {
        return this.api.get<PlanRolleZeile[]>(`${this.basis()}/booking-calendars/${planId}/members`);
    }

    async rolleSetzen(planId: string, memberId: string, rolle: PlanRolle): Promise<void> {
        await this.api.put(`${this.basis()}/booking-calendars/${planId}/members/${memberId}`, { role: rolle });
    }

    async rolleEntfernen(planId: string, memberId: string): Promise<void> {
        return this.api.delete(`${this.basis()}/booking-calendars/${planId}/members/${memberId}`);
    }

    async eintraege(planId: string, von: string, bis: string): Promise<BookingEntry[]> {
        return this.api.get<BookingEntry[]>(`${this.basis()}/booking-calendars/${planId}/bookings`, { from: von, to: bis });
    }

    async buchen(planId: string, eingabe: BuchungEingabe): Promise<BookingEntry> {
        return this.api.post<BookingEntry>(`${this.basis()}/booking-calendars/${planId}/bookings`, eingabe);
    }

    async bearbeiten(eintragId: string, aenderung: BuchungAenderung): Promise<BookingEntry> {
        return this.api.patch<BookingEntry>(`${this.basis()}/bookings/${eintragId}`, aenderung);
    }

    async annehmen(eintragId: string): Promise<BookingEntry> {
        return this.api.post<BookingEntry>(`${this.basis()}/bookings/${eintragId}/approve`);
    }

    async ablehnen(eintragId: string, grund: string | null): Promise<BookingEntry> {
        return this.api.post<BookingEntry>(`${this.basis()}/bookings/${eintragId}/decline`, grund ? { reason: grund } : {});
    }

    async stornieren(eintragId: string): Promise<BookingEntry> {
        return this.api.post<BookingEntry>(`${this.basis()}/bookings/${eintragId}/cancel`);
    }

    async loeschen(eintragId: string): Promise<void> {
        return this.api.delete(`${this.basis()}/bookings/${eintragId}`);
    }

    async serieVorschau(planId: string, serie: SerieEingabe): Promise<SerienVorschau> {
        return this.api.post<SerienVorschau>(`${this.basis()}/booking-calendars/${planId}/series/preview`, serie);
    }

    async serieAnlegen(planId: string, serie: SerieEingabe): Promise<SerienErgebnis> {
        return this.api.post<SerienErgebnis>(`${this.basis()}/booking-calendars/${planId}/series`, serie);
    }

    async serieUmbenennen(serieId: string, titel: string): Promise<void> {
        await this.api.patch(`${this.basis()}/booking-series/${serieId}`, { title: titel });
    }

    async serieBeenden(serieId: string, ab: string): Promise<number> {
        return (await this.api.post<{ removed: number }>(`${this.basis()}/booking-series/${serieId}/end`, { from: ab })).removed;
    }

    /** Folgt der aktiven Organisation: beim Wechsel wird das alte Abo beendet und für die neue Organisation neu angelegt. */
    aenderungen(beiAenderung: () => void): () => void {
        let abmelden: (() => void) | null = null;
        const ref = effect(
            () => {
                const orgId = this.org.currentOrgId();
                abmelden?.();
                abmelden = orgId ? this.realtime.abonnieren(orgId, TABELLEN, () => beiAenderung()) : null;
            },
            { injector: this.injector },
        );
        return () => {
            ref.destroy();
            abmelden?.();
        };
    }
}
