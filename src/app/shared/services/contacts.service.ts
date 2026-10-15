import { Injectable, inject, signal, OnDestroy, effect } from '@angular/core';

import { ApiService } from '../../core/api.service';
import { pick } from '../../core/pick';
import { RealtimeService } from '../../core/realtime.service';
import { ContactPerson } from '../models/contact-person.model';
import { OrganizationService } from './organization.service';

const KONTAKT_FELDER = ['name', 'role', 'description', 'email', 'phone', 'location', 'image_url'] as const;

/**
 * Service for managing contact persons via the backend API
 * Includes live updates for the current organization
 */
@Injectable({
    providedIn: 'root',
})
export class ContactsService implements OnDestroy {
    private api = inject(ApiService);
    private realtime = inject(RealtimeService);
    private orgService = inject(OrganizationService);
    private abmelden: (() => void) | null = null;
    private abonnierteOrg: string | null = null;

    private _contacts = signal<ContactPerson[]>([]);
    private _loading = signal(false);
    private _error = signal<string | null>(null);

    /** Contacts list (readonly signal) */
    readonly contacts = this._contacts.asReadonly();

    /** Loading state (readonly signal) */
    readonly loading = this._loading.asReadonly();

    /** Error message (readonly signal) */
    readonly error = this._error.asReadonly();

    constructor() {
        // Auto-refresh when organization changes
        effect(() => {
            const orgId = this.orgService.currentOrgId();
            if (orgId) {
                this.fetchContacts();
            } else {
                this._contacts.set([]);
            }
        });
    }

    /**
     * Fetch all contacts of the current organization (sowie globale Altkontakte, nur lesbar)
     */
    async fetchContacts(): Promise<void> {
        const orgId = this.orgService.currentOrgId();
        if (!orgId) return;

        this._loading.set(true);
        this._error.set(null);
        try {
            this._contacts.set(await this.api.get<ContactPerson[]>(`/orgs/${orgId}/contacts`));
            if (this.abonnierteOrg !== orgId) {
                this.abmelden?.();
                this.abonnierteOrg = orgId;
                this.abmelden = this.realtime.abonnieren(orgId, ['contacts'], () => void this.nachladen(orgId));
            }
        } catch (error) {
            this._error.set((error as Error).message);
            console.error('Error fetching contacts:', error);
        }
        this._loading.set(false);
    }

    private async nachladen(orgId: string) {
        try {
            this._contacts.set(await this.api.get<ContactPerson[]>(`/orgs/${orgId}/contacts`));
        } catch {
            // nächste Meldung versucht es erneut
        }
    }

    ngOnDestroy() {
        this.abmelden?.();
    }

    /**
     * Add a new contact
     */
    async addContact(contact: Omit<ContactPerson, 'id' | 'created_at' | 'updated_at'>) {
        const orgId = this.orgService.currentOrgId();
        if (!orgId) throw new Error('No organization selected');
        return this.api.post<ContactPerson>(`/orgs/${orgId}/contacts`, pick(contact, KONTAKT_FELDER, ['phone', 'image_url']));
    }

    /**
     * Update an existing contact
     */
    async updateContact(id: string, updates: Partial<ContactPerson>) {
        const orgId = this.orgService.currentOrgId();
        if (!orgId) throw new Error('No organization selected');
        return this.api.patch<ContactPerson>(`/orgs/${orgId}/contacts/${id}`, pick(updates, KONTAKT_FELDER, ['phone', 'image_url']));
    }

    /**
     * Delete a contact
     */
    async deleteContact(id: string) {
        const orgId = this.orgService.currentOrgId();
        if (!orgId) throw new Error('No organization selected');
        await this.api.delete(`/orgs/${orgId}/contacts/${id}`);
    }
}
