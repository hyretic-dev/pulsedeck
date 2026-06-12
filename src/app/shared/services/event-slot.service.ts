import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';

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
    private readonly supabase = inject(SupabaseService);

    /** Slots for current event */
    slots = signal<EventSlot[]>([]);

    /** Loading state */
    loading = signal(false);

    // =========================================================================
    // SLOT MANAGEMENT (Admin)
    // =========================================================================

    /**
     * Load all slots for an event with signup counts
     */
    async loadSlots(eventId: string, memberId?: string): Promise<void> {
        this.loading.set(true);

        const { data, error } = await this.supabase.client
            .from('event_slots')
            .select(`
                *,
                signups:event_slot_signups(
                    id,
                    member_id,
                    status,
                    note,
                    signed_up_at,
                    member:members(id, name, avatar_url)
                )
            `)
            .eq('event_id', eventId)
            .order('sort_order', { ascending: true });

        if (error) {
            console.error('Error loading slots:', error);
            this.slots.set([]);
        } else {
            // Calculate signup counts and check if current member is signed up
            const slotsWithCounts = (data || []).map((slot) => {
                const confirmedSignups = slot.signups?.filter(
                    (s: SlotSignup) => s.status === 'confirmed'
                ) || [];

                return {
                    ...slot,
                    signup_count: confirmedSignups.length,
                    signups: confirmedSignups,
                    is_signed_up: memberId
                        ? confirmedSignups.some((s: SlotSignup) => s.member_id === memberId)
                        : false,
                };
            });
            this.slots.set(slotsWithCounts);
        }

        this.loading.set(false);
    }

    /**
     * Create a new slot for an event
     */
    async createSlot(data: CreateSlotData): Promise<EventSlot | null> {
        const { data: slot, error } = await this.supabase.client
            .from('event_slots')
            .insert(data)
            .select()
            .single();

        if (error) {
            console.error('Error creating slot:', error);
            return null;
        }

        return slot as EventSlot;
    }

    /**
     * Update a slot
     */
    async updateSlot(
        slotId: string,
        updates: Partial<EventSlot>
    ): Promise<boolean> {
        const { error } = await this.supabase.client
            .from('event_slots')
            .update({
                ...updates,
                updated_at: new Date().toISOString(),
            })
            .eq('id', slotId);

        if (error) {
            console.error('Error updating slot:', error);
            return false;
        }

        return true;
    }

    /**
     * Delete a slot
     */
    async deleteSlot(slotId: string): Promise<boolean> {
        const { error } = await this.supabase.client
            .from('event_slots')
            .delete()
            .eq('id', slotId);

        if (error) {
            console.error('Error deleting slot:', error);
            return false;
        }

        return true;
    }

    // =========================================================================
    // SIGNUP MANAGEMENT (Members)
    // =========================================================================

    /**
     * Sign up for a slot
     */
    async signUp(slotId: string, memberId: string, organizationId: string, note?: string): Promise<boolean> {
        const { error } = await this.supabase.client
            .from('event_slot_signups')
            .insert({
                slot_id: slotId,
                member_id: memberId,
                organization_id: organizationId,
                status: 'confirmed',
                note,
            });

        if (error) {
            console.error('Error signing up for slot:', error);
            return false;
        }

        return true;
    }

    /**
     * Cancel signup for a slot
     */
    async cancelSignup(slotId: string, memberId: string): Promise<boolean> {
        const { error } = await this.supabase.client
            .from('event_slot_signups')
            .delete()
            .eq('slot_id', slotId)
            .eq('member_id', memberId);

        if (error) {
            console.error('Error cancelling signup:', error);
            return false;
        }

        return true;
    }

    /**
     * Get all signups for a member across all events
     */
    async getMemberSignups(memberId: string): Promise<SlotSignup[]> {
        const { data, error } = await this.supabase.client
            .from('event_slot_signups')
            .select(`
                *,
                slot:event_slots(
                    id,
                    title,
                    start_time,
                    end_time,
                    event:events(id, title, start)
                )
            `)
            .eq('member_id', memberId)
            .eq('status', 'confirmed')
            .order('signed_up_at', { ascending: false });

        if (error) {
            console.error('Error loading member signups:', error);
            return [];
        }

        return data || [];
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
