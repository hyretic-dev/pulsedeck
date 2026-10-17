import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { OrganizationService } from './organization.service';

export interface EventSlot {
    id: string;
    event_id: string;
    organization_id: string;
    title: string;
    description?: string;
    start_time?: string;
    end_time?: string;
    max_helpers: number;
    required_skills: string[];
    sort_order: number;
    created_at: string;
    // Computed fields (from joins)
    signup_count?: number;
    signups?: SlotSignup[];
    is_signed_up?: boolean;
}

export interface SlotSignup {
    id: string;
    slot_id: string;
    member_id: string;
    status: 'confirmed' | 'cancelled' | 'pending';
    note?: string;
    signed_up_at: string;
    // Joined data
    member?: {
        id: string;
        name: string;
        avatar_url?: string;
    };
    /** Nur bei „meine Anmeldungen“: Slot mit Termin */
    slot?: { id: string; title: string; start_time?: string; end_time?: string; event: { id: string; title: string; date: string; start_time: string } };
}

export interface CreateSlotData {
    event_id: string;
    organization_id: string;
    title: string;
    description?: string;
    start_time?: string;
    end_time?: string;
    max_helpers?: number;
    required_skills?: string[];
    sort_order?: number;
}

@Injectable({
    providedIn: 'root',
})
export class EventSlotService {
    private readonly api = inject(ApiService);
    private readonly org = inject(OrganizationService);

    /** Slots for current event */
    slots = signal<EventSlot[]>([]);

    /** Loading state */
    loading = signal(false);

    private orgId(organizationId?: string): string {
        const id = organizationId ?? this.org.currentOrgId();
        if (!id) throw new Error('Keine Organisation ausgewählt');
        return id;
    }

    // =========================================================================
    // SLOT MANAGEMENT (Admin)
    // =========================================================================

    /**
     * Load all slots for an event with confirmed signups and counts (der Server zählt und markiert die eigene Anmeldung)
     */
    async loadSlots(eventId: string, _memberId?: string): Promise<void> {
        this.loading.set(true);
        try {
            this.slots.set(await this.api.get<EventSlot[]>(`/orgs/${this.orgId()}/events/${eventId}/slots`));
        } catch (error) {
            console.error('Error loading slots:', error);
            this.slots.set([]);
        }
        this.loading.set(false);
    }

    /**
     * Create a new slot for an event
     */
    async createSlot(data: CreateSlotData): Promise<EventSlot | null> {
        try {
            return await this.api.post<EventSlot>(`/orgs/${this.orgId(data.organization_id)}/events/${data.event_id}/slots`, {
                title: data.title,
                start_time: data.start_time || undefined,
                end_time: data.end_time || undefined,
                max_helpers: data.max_helpers,
                required_skills: data.required_skills,
                sort_order: data.sort_order,
            });
        } catch (error) {
            console.error('Error creating slot:', error);
            return null;
        }
    }

    /**
     * Update a slot
     */
    async updateSlot(slotId: string, updates: Partial<EventSlot>): Promise<boolean> {
        try {
            await this.api.patch(`/orgs/${this.orgId()}/slots/${slotId}`, {
                title: updates.title,
                start_time: updates.start_time || undefined,
                end_time: updates.end_time || undefined,
                max_helpers: updates.max_helpers,
                required_skills: updates.required_skills,
                sort_order: updates.sort_order,
            });
            return true;
        } catch (error) {
            console.error('Error updating slot:', error);
            return false;
        }
    }

    /**
     * Delete a slot
     */
    async deleteSlot(slotId: string): Promise<boolean> {
        try {
            await this.api.delete(`/orgs/${this.orgId()}/slots/${slotId}`);
            return true;
        } catch (error) {
            console.error('Error deleting slot:', error);
            return false;
        }
    }

    // =========================================================================
    // SIGNUP MANAGEMENT (Members)
    // =========================================================================

    /**
     * Sign up the current member for a slot (409 slot_full, wenn der Platz inzwischen vergeben ist)
     */
    async signUp(slotId: string, _memberId: string, organizationId: string, note?: string): Promise<boolean> {
        try {
            await this.api.put(`/orgs/${this.orgId(organizationId)}/slots/${slotId}/signup`, note ? { note } : {});
            return true;
        } catch (error) {
            console.error('Error signing up for slot:', error);
            return false;
        }
    }

    /**
     * Cancel signup for a slot
     */
    async cancelSignup(slotId: string, _memberId: string): Promise<boolean> {
        try {
            await this.api.delete(`/orgs/${this.orgId()}/slots/${slotId}/signup`);
            return true;
        } catch (error) {
            console.error('Error cancelling signup:', error);
            return false;
        }
    }

    /**
     * Get all confirmed slot signups of the current member (with slot and event)
     */
    async getMemberSignups(_memberId?: string): Promise<SlotSignup[]> {
        try {
            const zeilen = await this.api.get<{ slot: SlotSignup['slot'] }[]>(`/orgs/${this.orgId()}/slots/signups/mine`);
            return zeilen.map((z) => ({ id: z.slot?.id ?? '', slot_id: z.slot?.id ?? '', member_id: _memberId ?? '', status: 'confirmed' as const, signed_up_at: '', slot: z.slot }));
        } catch (error) {
            console.error('Error loading member signups:', error);
            return [];
        }
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    /**
     * Check if a slot has capacity for more signups
     */
    hasCapacity(slot: EventSlot): boolean {
        return (slot.signup_count || 0) < slot.max_helpers;
    }

    /**
     * Get remaining capacity for a slot
     */
    getRemainingCapacity(slot: EventSlot): number {
        return Math.max(0, slot.max_helpers - (slot.signup_count || 0));
    }

    /**
     * Format time range for display
     */
    formatTimeRange(slot: EventSlot): string {
        if (!slot.start_time && !slot.end_time) return '';
        if (slot.start_time && slot.end_time) {
            return `${slot.start_time} - ${slot.end_time}`;
        }
        return slot.start_time || slot.end_time || '';
    }
}
