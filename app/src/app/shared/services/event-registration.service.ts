import { Injectable, inject, signal } from '@angular/core';

import { ApiService } from '../../core/api.service';
import { AuthService } from './auth.service';
import { OrganizationService } from './organization.service';

export type RegistrationStatus = 'confirmed' | 'maybe' | 'cancelled';

export interface EventRegistration {
    id?: string;
    event_id: string;
    member_id: string;
    status: RegistrationStatus;
    registered_at?: string;
    note?: string;
    // Joined
    member?: { id: string; name: string; avatar_url?: string };
}

@Injectable({ providedIn: 'root' })
export class EventRegistrationService {
    private api = inject(ApiService);
    private auth = inject(AuthService);
    private org = inject(OrganizationService);

    /** Current user's registrations (event_id -> status) */
    myRegistrations = signal<Map<string, RegistrationStatus>>(new Map());

    /** Loading state */
    loading = signal(false);

    private orgId(): string {
        const id = this.org.currentOrgId();
        if (!id) throw new Error('Keine Organisation ausgewählt');
        return id;
    }

    /**
     * Fetch all registrations for the current user
     */
    async fetchMyRegistrations(): Promise<void> {
        if (!this.auth.currentMember()?.id) {
            this.myRegistrations.set(new Map());
            return;
        }
        try {
            const zeilen = await this.api.get<{ event_id: string; status: RegistrationStatus }[]>(`/orgs/${this.orgId()}/events/registrations/mine`);
            this.myRegistrations.set(new Map(zeilen.map((r) => [r.event_id, r.status])));
        } catch (error) {
            console.error('Error fetching registrations:', error);
        }
    }

    /**
     * Get registrations for a specific event (Zusagen und „vielleicht“ mit Mitglied)
     */
    async getEventRegistrations(eventId: string): Promise<EventRegistration[]> {
        const zeilen = await this.api.get<{ member: { id: string; name: string; avatar_url?: string } }[]>(`/orgs/${this.orgId()}/events/${eventId}/registrations`);
        return zeilen.map((z) => ({ event_id: eventId, member_id: z.member.id, status: 'confirmed' as RegistrationStatus, member: z.member }));
    }

    /**
     * Get count of confirmed registrations for an event
     */
    async getRegistrationCount(eventId: string): Promise<number> {
        const zusammenfassung = await this.getRegistrationsSummary([eventId]);
        return zusammenfassung.get(eventId)?.count ?? 0;
    }

    /**
     * Register current user for an event (der Server prüft Sichtbarkeit und Teilnehmerlimit atomar)
     */
    async register(eventId: string, status: RegistrationStatus = 'confirmed', note?: string): Promise<void> {
        if (!this.auth.currentMember()?.id) throw new Error('Nicht eingeloggt');
        this.loading.set(true);
        try {
            await this.api.put(`/orgs/${this.orgId()}/events/${eventId}/registration`, { status, ...(note ? { note } : {}) });
        } finally {
            this.loading.set(false);
        }
        this.myRegistrations.update((map) => new Map(map).set(eventId, status));
    }

    /**
     * Cancel registration for current user
     */
    async unregister(eventId: string): Promise<void> {
        if (!this.auth.currentMember()?.id) throw new Error('Nicht eingeloggt');
        this.loading.set(true);
        try {
            await this.api.delete(`/orgs/${this.orgId()}/events/${eventId}/registration`);
        } finally {
            this.loading.set(false);
        }
        this.myRegistrations.update((map) => {
            const neu = new Map(map);
            neu.delete(eventId);
            return neu;
        });
    }

    /**
     * Check if current user is registered for an event
     */
    isRegistered(eventId: string): RegistrationStatus | null {
        return this.myRegistrations().get(eventId) ?? null;
    }

    /**
     * Get registration status label
     */
    getStatusLabel(status: RegistrationStatus): string {
        const labels: Record<RegistrationStatus, string> = {
            confirmed: 'Zugesagt',
            maybe: 'Vielleicht',
            cancelled: 'Abgesagt',
        };
        return labels[status];
    }

    /**
     * Get confirmed registrations for multiple events (for list view bubbles)
     */
    async getRegistrationsSummary(eventIds: string[]): Promise<Map<string, { count: number; avatars: { name: string; avatar_url?: string }[] }>> {
        if (!eventIds.length) return new Map();
        const ergebnis = new Map<string, { count: number; avatars: { name: string; avatar_url?: string }[] }>();
        eventIds.forEach((id) => ergebnis.set(id, { count: 0, avatars: [] }));
        try {
            for (let i = 0; i < eventIds.length; i += 500) {
                const teil = await this.api.post<Record<string, { count: number; avatars: { name: string; avatar_url?: string }[] }>>(
                    `/orgs/${this.orgId()}/events/registrations/summary`,
                    { event_ids: eventIds.slice(i, i + 500) }
                );
                for (const [id, eintrag] of Object.entries(teil)) ergebnis.set(id, eintrag);
            }
        } catch (error) {
            console.error('Error loading summaries:', error);
        }
        return ergebnis;
    }
}
