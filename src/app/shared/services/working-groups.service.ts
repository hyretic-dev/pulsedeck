import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { SupabaseService } from './supabase';
import { OrganizationService } from './organization.service';
import { WorkingGroup } from '../models/working-group.model';
import { CalendarEvent } from '../models/calendar-event.model';
import { AgRole } from '../models/member.model';
import { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Service for managing working groups via Supabase
 * Includes realtime subscriptions for live updates
 */
@Injectable({
    providedIn: 'root',
})
export class WorkingGroupsService implements OnDestroy {
    private supabase = inject(SupabaseService);
    private org = inject(OrganizationService);
    private readonly TABLE_NAME = 'working_groups';
    private realtimeChannel: RealtimeChannel | null = null;
    private memberRealtimeChannel: RealtimeChannel | null = null;

    private _workingGroups = signal<WorkingGroup[]>([]);
    private _loading = signal(false);
    private _error = signal<string | null>(null);
    private _myMemberships = signal<Set<string>>(new Set());
    private _myAgRoles = signal<Map<string, AgRole>>(new Map());
    private _agEvents = signal<Map<string, CalendarEvent[]>>(new Map());

    readonly workingGroups = this._workingGroups.asReadonly();
    readonly loading = this._loading.asReadonly();
    readonly error = this._error.asReadonly();
    readonly myMemberships = this._myMemberships.asReadonly();
    readonly myAgRoles = this._myAgRoles.asReadonly();
    readonly agEvents = this._agEvents.asReadonly();

    async fetchWorkingGroups(): Promise<void> {
        this._loading.set(true);
        this._error.set(null);

        const orgId = this.org.currentOrgId();

        // Fetch working groups with organization filter
        let query = this.supabase
            .from(this.TABLE_NAME)
            .select('*')
            .order('name', { ascending: true });

        if (orgId) {
            query = query.eq('organization_id', orgId);
        }

        const { data: groups, error } = await query;

        if (error) {
            this._error.set(error.message);
            console.error('Error fetching working groups:', error);
            this._loading.set(false);
            return;
        }

        // Fetch actual member counts for each group
        const { data: memberCounts } = await this.supabase
            .from('ag_memberships')
            .select('working_group_id');

        // Build count map
        const countMap = new Map<string, number>();
        if (memberCounts) {
            for (const m of memberCounts) {
                const gid = m.working_group_id;
                countMap.set(gid, (countMap.get(gid) || 0) + 1);
            }
        }

        // Fetch upcoming events for all AGs (filtered by org)
        const today = new Date().toISOString().split('T')[0];
        let eventQuery = this.supabase
            .from('events')
            .select('*')
            .not('working_group_id', 'is', null)
            .gte('date', today)
            .order('date', { ascending: true })
            .order('start_time', { ascending: true });

        if (orgId) {
            eventQuery = eventQuery.eq('organization_id', orgId);
        }

        const { data: events } = await eventQuery;

        // Build events map
        const eventsMap = new Map<string, CalendarEvent[]>();
        if (events) {
            for (const evt of events) {
                const gid = evt.working_group_id;
                if (!eventsMap.has(gid)) {
                    eventsMap.set(gid, []);
                }
                eventsMap.get(gid)!.push(evt);
            }
        }
        this._agEvents.set(eventsMap);

        // Update groups with actual counts
        const enrichedGroups = (groups ?? []).map(g => ({
            ...g,
            members_count: countMap.get(g.id) || 0
        }));

        this._workingGroups.set(enrichedGroups);
        this._loading.set(false);
        this.subscribeToRealtime();
    }

    private subscribeToRealtime() {
        if (!this.realtimeChannel) {
            this.realtimeChannel = this.supabase.subscribeToTable(
                this.TABLE_NAME,
                (payload: any) => {
                    this.handleRealtimeUpdate(payload);
                }
            );
        }

        if (!this.memberRealtimeChannel) {
            this.memberRealtimeChannel = this.supabase.subscribeToTable(
                'ag_memberships',
                (payload: any) => {
                    this.handleMemberRealtimeUpdate(payload);
                }
            );
        }
    }

    private handleRealtimeUpdate(payload: any) {
        const eventType = payload.eventType;
        const newRecord = payload.new as WorkingGroup;
        const oldRecord = payload.old as WorkingGroup;

        switch (eventType) {
            case 'INSERT':
                this._workingGroups.update(groups => {
                    const sorted = [...groups, { ...newRecord, members_count: 0 }]
                        .sort((a, b) => a.name.localeCompare(b.name));
                    return sorted;
                });
                break;
            case 'UPDATE':
                this._workingGroups.update(groups =>
                    groups.map(g => (g.id === newRecord.id ? { ...newRecord, members_count: g.members_count } : g))
                );
                break;
            case 'DELETE':
                this._workingGroups.update(groups =>
                    groups.filter(g => g.id !== oldRecord.id)
                );
                break;
        }
    }

    private handleMemberRealtimeUpdate(payload: any) {
        const eventType = payload.eventType;
        const record = payload.new || payload.old;
        const groupId = record?.working_group_id;

        if (!groupId) return;

        switch (eventType) {
            case 'INSERT':
                this._workingGroups.update(groups =>
                    groups.map(g => g.id === groupId
                        ? { ...g, members_count: (g.members_count || 0) + 1 }
                        : g)
                );
                break;
            case 'DELETE':
                this._workingGroups.update(groups =>
                    groups.map(g => g.id === groupId
                        ? { ...g, members_count: Math.max(0, (g.members_count || 0) - 1) }
                        : g)
                );
                break;
        }
    }

    ngOnDestroy() {
        if (this.realtimeChannel) {
            this.supabase.unsubscribe(this.realtimeChannel);
        }
        if (this.memberRealtimeChannel) {
            this.supabase.unsubscribe(this.memberRealtimeChannel);
        }
    }

    async fetchMyMemberships(memberId: string) {
        if (!memberId) {
            this._myMemberships.set(new Set());
            this._myAgRoles.set(new Map());
            return;
        }

        // Try new ag_memberships table first (with roles)
        const { data: agData, error: agError } = await this.supabase
            .from('ag_memberships')
            .select('working_group_id, role')
            .eq('member_id', memberId);

        if (!agError && agData && agData.length > 0) {
            // Use new table with roles
            const membershipSet = new Set(agData.map(d => d.working_group_id));
            const rolesMap = new Map<string, AgRole>();
            agData.forEach(d => rolesMap.set(d.working_group_id, d.role as AgRole));

            this._myMemberships.set(membershipSet);
            this._myAgRoles.set(rolesMap);
            return;
        }

        // Fallback to old working_group_members table
        const { data, error } = await this.supabase
            .from('working_group_members')
            .select('working_group_id')
            .eq('member_id', memberId);

        if (error) {
            console.error('Error fetching memberships', error);
            return;
        }

        if (data) {
            this._myMemberships.set(new Set(data.map((d: any) => d.working_group_id)));
            // All members from old table are regular members
            const rolesMap = new Map<string, AgRole>();
            data.forEach((d: any) => rolesMap.set(d.working_group_id, 'member'));
            this._myAgRoles.set(rolesMap);
        }
    }

    /**
     * Get current user's role in a specific AG
     */
    getMyRole(groupId: string): AgRole | null {
        return this._myAgRoles().get(groupId) || null;
    }

    /**
     * Check if current user is admin/lead of a specific AG
     */
    isMyAgAdmin(groupId: string): boolean {
        const role = this.getMyRole(groupId);
        return role === 'admin' || role === 'lead';
    }

    async addWorkingGroup(
        wg: Omit<WorkingGroup, 'id' | 'created_at' | 'updated_at'>
    ) {
        const orgId = this.org.currentOrgId();
        const wgWithOrg = orgId ? { ...wg, organization_id: orgId } : wg;

        const { data, error } = await this.supabase
            .from(this.TABLE_NAME)
            .insert(wgWithOrg)
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    async updateWorkingGroup(id: string, updates: Partial<WorkingGroup>) {
        const { data, error } = await this.supabase
            .from(this.TABLE_NAME)
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    async deleteWorkingGroup(id: string) {
        const { error } = await this.supabase
            .from(this.TABLE_NAME)
            .delete()
            .eq('id', id);

        if (error) throw new Error(error.message);
    }

    async joinGroup(groupId: string, memberId: string, role: AgRole = 'member') {
        // Try new ag_memberships table first
        const { error: agError } = await this.supabase
            .from('ag_memberships')
            .insert({
                working_group_id: groupId,
                member_id: memberId,
                role: role
            });

        if (agError) {
            // Fallback to old table if new one doesn't exist
            const { error } = await this.supabase
                .from('working_group_members')
                .insert({ working_group_id: groupId, member_id: memberId });

            if (error) throw error;
        }

        this._myMemberships.update(s => {
            const newSet = new Set(s);
            newSet.add(groupId);
            return newSet;
        });

        this._myAgRoles.update(m => {
            const newMap = new Map(m);
            newMap.set(groupId, role);
            return newMap;
        });
    }

    async leaveGroup(groupId: string, memberId: string) {
        // Try new ag_memberships table first
        const { error: agError } = await this.supabase
            .from('ag_memberships')
            .delete()
            .eq('working_group_id', groupId)
            .eq('member_id', memberId);

        if (agError) {
            // Fallback to old table
            const { error } = await this.supabase
                .from('working_group_members')
                .delete()
                .eq('working_group_id', groupId)
                .eq('member_id', memberId);

            if (error) throw error;
        }

        this._myMemberships.update(s => {
            const newSet = new Set(s);
            newSet.delete(groupId);
            return newSet;
        });

        this._myAgRoles.update(m => {
            const newMap = new Map(m);
            newMap.delete(groupId);
            return newMap;
        });
    }

    /**
     * Update a member's role in an AG (for AG admins)
     */
    async updateMemberRole(
        groupId: string,
        memberId: string,
        newRole: AgRole
    ): Promise<void> {
        const { error } = await this.supabase
            .from('ag_memberships')
            .update({ role: newRole })
            .eq('working_group_id', groupId)
            .eq('member_id', memberId);

        if (error) throw new Error(error.message);
    }

    /**
     * Get all members of an AG with their roles
     */
    async getAgMembers(
        groupId: string
    ): Promise<{ member_id: string; name: string; role: AgRole }[]> {
        const { data, error } = await this.supabase
            .from('ag_memberships')
            .select(`
                member_id,
                role,
                members(name)
            `)
            .eq('working_group_id', groupId);

        if (error) {
            console.error('Error fetching AG members:', error);
            return [];
        }

        return data?.map((m: any) => ({
            member_id: m.member_id,
            name: m.members?.name || 'Unbekannt',
            role: m.role as AgRole
        })) || [];
    }

    /**
     * Fetch all distinct, non-null categories used within the current organization.
     * Results are alphabetically sorted for use in AutoComplete suggestions.
     */
    async fetchDistinctCategories(): Promise<string[]> {
        const orgId = this.org.currentOrgId();

        let query = this.supabase
            .from(this.TABLE_NAME)
            .select('category')
            .not('category', 'is', null);

        if (orgId) {
            query = query.eq('organization_id', orgId);
        }

        const { data, error } = await query;

        if (error || !data) {
            console.error('Error fetching categories:', error);
            return [];
        }

        const unique = new Set<string>(
            data
                .map((d: { category: string }) => d.category)
                .filter(Boolean)
        );

        return [...unique].sort((a, b) => a.localeCompare(b));
    }
}
