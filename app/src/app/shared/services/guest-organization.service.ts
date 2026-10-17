import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { OrganizationService } from './organization.service';

/**
 * Status of a guest organization invitation
 */
export type GuestInvitationStatus = 'pending' | 'accepted' | 'declined';

/**
 * Guest organization invitation for an event
 */
export interface EventGuestOrganization {
    id: string;
    event_id: string;
    host_organization_id: string;
    guest_organization_id?: string;
    guest_org_name?: string;
    guest_org_email?: string;
    guest_org_contact_name?: string;
    status: GuestInvitationStatus;
    invited_by?: string;
    invited_at: string;
    responded_at?: string;
    // Joined data
    guest_organization?: {
        id: string;
        name: string;
        slug: string;
        logo_url?: string;
    };
    host_organization?: {
        id: string;
        name: string;
        slug: string;
        logo_url?: string;
    };
    event?: {
        id: string;
        title: string;
        date: string;
    };
}

/**
 * DTO for creating a guest invitation
 */
export interface CreateGuestInvitationDto {
    event_id: string;
    guest_organization_id?: string;
    guest_org_name?: string;
    guest_org_email?: string;
    guest_org_contact_name?: string;
}

/**
 * Service for managing guest organization invitations to events.
 * Enables the "Viral Loop" - when orgs see how cleanly events are planned,
 * they want PulseDeck too!
 */
@Injectable({ providedIn: 'root' })
export class GuestOrganizationService {
    private api = inject(ApiService);
    private orgService = inject(OrganizationService);

    loading = signal(false);
    error = signal<string | null>(null);

    private orgId(): string {
        const id = this.orgService.currentOrgId();
        if (!id) throw new Error('Keine Organisation ausgewählt');
        return id;
    }

    /** Antwort des Servers (Organisationsname flach) in die verschachtelte Form der Oberfläche bringen. */
    private abbilden(z: Record<string, any>): EventGuestOrganization {
        const { organization_name, organization_slug, organization_logo_url, ...rest } = z;
        return {
            ...rest,
            guest_organization: rest['guest_organization_id'] ? { id: rest['guest_organization_id'], name: organization_name, slug: organization_slug, logo_url: organization_logo_url } : undefined,
        } as EventGuestOrganization;
    }

    /**
     * Get all guest invitations for an event (Verwaltende sehen alle, andere nur angenommene)
     */
    async getEventGuests(eventId: string): Promise<EventGuestOrganization[]> {
        try {
            return (await this.api.get<Record<string, any>[]>(`/orgs/${this.orgId()}/events/${eventId}/guests`)).map((z) => this.abbilden(z));
        } catch (error) {
            console.error('Error loading event guests:', error);
            return [];
        }
    }

    /**
     * Get accepted guest organizations for an event (for public display)
     */
    async getAcceptedGuests(eventId: string): Promise<EventGuestOrganization[]> {
        return (await this.getEventGuests(eventId)).filter((g) => g.status === 'accepted');
    }

    /**
     * Get pending invitations for the current organization
     * (Events where this org has been invited as a guest)
     */
    async getPendingInvitations(): Promise<EventGuestOrganization[]> {
        const orgId = this.orgService.currentOrgId();
        if (!orgId) return [];
        try {
            return await this.api.get<EventGuestOrganization[]>(`/orgs/${orgId}/guest-invitations`);
        } catch (error) {
            // Nur Vorstand und Administratoren dürfen Einladungen sehen
            console.error('Error loading pending invitations:', error);
            return [];
        }
    }

    /**
     * Invite a guest organization to an event (der Server sendet die Einladungsmail)
     */
    async inviteGuest(dto: CreateGuestInvitationDto): Promise<boolean> {
        this.loading.set(true);
        this.error.set(null);
        try {
            await this.api.post(`/orgs/${this.orgId()}/events/${dto.event_id}/guests`, {
                guest_organization_id: dto.guest_organization_id,
                guest_org_name: dto.guest_org_name,
                guest_org_email: dto.guest_org_email,
                guest_org_contact_name: dto.guest_org_contact_name,
            });
            return true;
        } catch (e) {
            const code = (e as { code?: string }).code;
            this.error.set(code === 'guest_already_invited' ? 'Diese Organisation wurde bereits eingeladen' : 'Einladung konnte nicht gesendet werden');
            console.error('Error inviting guest:', e);
            return false;
        } finally {
            this.loading.set(false);
        }
    }

    /**
     * Respond to an invitation (accept or decline)
     */
    async respondToInvitation(invitationId: string, response: 'accepted' | 'declined'): Promise<boolean> {
        this.loading.set(true);
        this.error.set(null);
        try {
            await this.api.patch(`/orgs/${this.orgId()}/guest-invitations/${invitationId}`, { status: response });
            return true;
        } catch (e) {
            this.error.set('Antwort konnte nicht gespeichert werden');
            console.error('Error responding to invitation:', e);
            return false;
        } finally {
            this.loading.set(false);
        }
    }

    /**
     * Remove a guest invitation
     */
    async removeInvitation(invitationId: string, eventId: string): Promise<boolean> {
        this.loading.set(true);
        try {
            await this.api.delete(`/orgs/${this.orgId()}/events/${eventId}/guests/${invitationId}`);
            return true;
        } catch (error) {
            console.error('Error removing invitation:', error);
            return false;
        } finally {
            this.loading.set(false);
        }
    }

    /**
     * Search for organizations to invite (autocomplete; mindestens zwei Zeichen)
     */
    async searchOrganizations(query: string): Promise<Array<{ id: string; name: string; slug: string; logo_url?: string }>> {
        if (!query || query.length < 2) return [];
        try {
            return await this.api.get(`/orgs/${this.orgId()}/guest-organizations/search`, { q: query });
        } catch (error) {
            console.error('Error searching organizations:', error);
            return [];
        }
    }
}
