import { Injectable, inject, signal, OnDestroy } from '@angular/core';

import { ApiService } from '../../core/api.service';
import { pick } from '../../core/pick';
import { RealtimeService } from '../../core/realtime.service';
import { environment } from '../../../environments/environment';
import { OrganizationService } from './organization.service';
import { AuthService } from './auth.service';
import { CalendarEvent } from '../models/calendar-event.model';

/** Felder, die beim Anlegen/Ändern eines Termins gesendet werden (Organisation und AG-Name bestimmt der Server). */
const TERMIN_FELDER = [
    'title', 'date', 'start_time', 'end_time', 'location', 'description', 'working_group_id', 'allowed_roles',
    'max_participants', 'registration_required', 'meeting_reason', 'location_type', 'is_recurring', 'recurrence_interval',
    'booking_calendar_id',
] as const;
/** Optionale Felder, die die Oberfläche leer lässt (der Server erwartet dann `null`). */
const TERMIN_LEER_ALS_NULL = ['end_time', 'description', 'working_group_id', 'meeting_reason', 'location_type', 'recurrence_interval'] as const;

/**
 * Service for managing calendar events via the backend API
 * Sichtbarkeit (Rolle, Arbeitsgruppe) setzt der Server durch; Änderungen kommen per Echtzeit-Meldung.
 */
@Injectable({
    providedIn: 'root',
})
export class EventsService implements OnDestroy {
    private api = inject(ApiService);
    private realtime = inject(RealtimeService);
    private org = inject(OrganizationService);
    private auth = inject(AuthService);
    private abmelden: (() => void) | null = null;
    private abonnierteOrg: string | null = null;

    private _events = signal<CalendarEvent[]>([]);
    private _loading = signal(false);
    private _error = signal<string | null>(null);

    readonly events = this._events.asReadonly();
    readonly loading = this._loading.asReadonly();
    readonly error = this._error.asReadonly();

    private orgId(): string {
        const id = this.org.currentOrgId();
        if (!id) throw new Error('Keine Organisation ausgewählt');
        return id;
    }

    async fetchEvents(): Promise<void> {
        this._loading.set(true);
        this._error.set(null);
        try {
            const orgId = this.orgId();
            this._events.set(await this.api.get<CalendarEvent[]>(`/orgs/${orgId}/events`));
            this.abonnieren(orgId);
        } catch (error) {
            this._error.set((error as Error).message);
            console.error('Error fetching events:', error);
        }
        this._loading.set(false);
    }

    private abonnieren(orgId: string) {
        if (this.abonnierteOrg === orgId) return;
        this.abmelden?.();
        this.abonnierteOrg = orgId;
        this.abmelden = this.realtime.abonnieren(orgId, ['events'], () => void this.nachladen(orgId));
    }

    private async nachladen(orgId: string) {
        try {
            this._events.set(await this.api.get<CalendarEvent[]>(`/orgs/${orgId}/events`));
        } catch {
            // nächste Meldung versucht es erneut
        }
    }

    ngOnDestroy() {
        this.abmelden?.();
    }

    /** Legt einen Termin an; bei Serien erzeugt der Server alle Folgetermine in derselben Transaktion. */
    async addEvent(event: Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>) {
        const bereinigt: Record<string, unknown> = pick(event, TERMIN_FELDER, TERMIN_LEER_ALS_NULL);
        for (const feld of TERMIN_LEER_ALS_NULL) if (bereinigt[feld] === null) delete bereinigt[feld]; // beim Anlegen: nicht gesetzt = weglassen
        if (!bereinigt['is_recurring']) delete bereinigt['is_recurring'];
        return this.api.post<CalendarEvent>(`/orgs/${this.orgId()}/events`, bereinigt);
    }

    async updateEvent(id: string, updates: Partial<CalendarEvent>) {
        return this.api.patch<CalendarEvent>(`/orgs/${this.orgId()}/events/${id}`, pick(updates, TERMIN_FELDER, TERMIN_LEER_ALS_NULL));
    }

    async deleteEvent(id: string) {
        await this.api.delete(`/orgs/${this.orgId()}/events/${id}`);
    }

    /**
     * Get iCal subscription URL
     * @param agId Optional: Filter by working group
     */
    getICalUrl(agId?: string): string {
        return this.icalAdresse(agId, false);
    }

    private icalAdresse(agId: string | undefined, download: boolean): string {
        const params = new URLSearchParams();
        const member = this.auth.currentMember();
        if (member?.calendar_token) {
            params.set('token', member.calendar_token);
        } else {
            const orgId = this.org.currentOrgId();
            if (orgId) params.set('org', orgId);
        }
        if (agId) params.set('ag', agId);
        params.set('download', String(download));
        return `${window.location.origin}${environment.apiBaseUrl}/public/ical?${params.toString()}`;
    }

    /**
     * Download iCal file
     * @param agId Optional: Filter by working group
     */
    async downloadICalFile(agId?: string): Promise<void> {
        window.open(this.icalAdresse(agId, true), '_blank');
    }

    /** Neuer Kalender-Token: der bisherige Abo-Link wird ungültig. */
    async regenerateCalendarToken(): Promise<string> {
        const antwort = await this.api.post<{ calendar_token: string }>(`/orgs/${this.orgId()}/calendar/token`);
        await this.auth.refreshMember();
        return antwort.calendar_token;
    }

    /**
     * Get a single public event by ID (öffentliche Termin-Seite, ohne Anmeldung)
     */
    async getEventById(id: string): Promise<CalendarEvent & {
        organization?: { name: string; slug: string; logo_url: string }
    }> {
        return this.api.get(`/public/events/${id}`, undefined, { auth: false });
    }
}
