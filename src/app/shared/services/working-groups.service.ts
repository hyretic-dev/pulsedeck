import { Injectable, inject, signal, OnDestroy } from '@angular/core';

import { ApiService } from '../../core/api.service';
import { pick } from '../../core/pick';
import { RealtimeService } from '../../core/realtime.service';
import { AuthService } from './auth.service';
import { OrganizationService } from './organization.service';
import { WorkingGroup } from '../models/working-group.model';
import { CalendarEvent } from '../models/calendar-event.model';
import { AgRole } from '../models/member.model';

const AG_FELDER = ['name', 'description', 'lead', 'next_meeting', 'contact_type', 'contact_value', 'contact_link', 'contact_icon', 'tags', 'category'] as const;

/**
 * Service for managing working groups via the backend API
 * Includes live updates (Echtzeit-Änderungen werden nachgeladen)
 */
@Injectable({
    providedIn: 'root',
})
export class WorkingGroupsService implements OnDestroy {
    private api = inject(ApiService);
    private realtime = inject(RealtimeService);
    private org = inject(OrganizationService);
    private auth = inject(AuthService);
    private abmelden: (() => void) | null = null;
    private abonnierteOrg: string | null = null;

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

    private orgId(): string {
        const id = this.org.currentOrgId();
        if (!id) throw new Error('Keine Organisation ausgewählt');
        return id;
    }

    async fetchWorkingGroups(): Promise<void> {
        this._loading.set(true);
        this._error.set(null);
        try {
            const orgId = this.orgId();
            await this.ladeAlles(orgId);
            this.abonnieren(orgId);
        } catch (error) {
            this._error.set((error as Error).message);
            console.error('Error fetching working groups:', error);
        }
        this._loading.set(false);
    }

    private async ladeAlles(orgId: string): Promise<void> {
        const [gruppen, termine] = await Promise.all([
            this.api.get<WorkingGroup[]>(`/orgs/${orgId}/working-groups`),
            this.api.get<CalendarEvent[]>(`/orgs/${orgId}/events/working-group-upcoming`),
        ]);
        const karte = new Map<string, CalendarEvent[]>();
        for (const t of termine) {
            const gid = t.working_group_id as string;
            karte.set(gid, [...(karte.get(gid) ?? []), t]);
        }
        this._agEvents.set(karte);
        this._workingGroups.set(gruppen);
    }

    private abonnieren(orgId: string) {
        if (this.abonnierteOrg === orgId) return;
        this.abmelden?.();
        this.abonnierteOrg = orgId;
        this.abmelden = this.realtime.abonnieren(orgId, ['working_groups', 'ag_memberships', 'working_group_members', 'events'], () => void this.nachladen(orgId));
    }

    private async nachladen(orgId: string) {
        try {
            await this.ladeAlles(orgId);
            const memberId = this.auth.currentMember()?.id;
            if (memberId) await this.fetchMyMemberships(memberId);
        } catch {
            // nächste Meldung versucht es erneut
        }
    }

    ngOnDestroy() {
        this.abmelden?.();
    }

    async fetchMyMemberships(memberId: string) {
        if (!memberId) {
            this._myMemberships.set(new Set());
            this._myAgRoles.set(new Map());
            return;
        }
        try {
            const zeilen = await this.api.get<{ working_group_id: string; role: AgRole }[]>(`/orgs/${this.orgId()}/working-groups/mine`);
            this._myMemberships.set(new Set(zeilen.map((z) => z.working_group_id)));
            this._myAgRoles.set(new Map(zeilen.map((z) => [z.working_group_id, z.role])));
        } catch (error) {
            console.error('Error fetching memberships', error);
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

    async addWorkingGroup(wg: Omit<WorkingGroup, 'id' | 'created_at' | 'updated_at'>) {
        return this.api.post<WorkingGroup>(`/orgs/${this.orgId()}/working-groups`, pick(wg, AG_FELDER, ['contact_link', 'category']));
    }

    async updateWorkingGroup(id: string, updates: Partial<WorkingGroup>) {
        return this.api.patch<WorkingGroup>(`/orgs/${this.orgId()}/working-groups/${id}`, pick(updates, AG_FELDER, ['contact_link', 'category']));
    }

    async deleteWorkingGroup(id: string) {
        await this.api.delete(`/orgs/${this.orgId()}/working-groups/${id}`);
    }

    /** Beitritt: das eigene Mitglied immer als Mitglied, andere Mitglieder mit Rolle durch die AG-Leitung/Administratoren. */
    async joinGroup(groupId: string, memberId: string, role: AgRole = 'member') {
        const orgId = this.orgId();
        if (memberId === this.auth.currentMember()?.id) {
            await this.api.put(`/orgs/${orgId}/working-groups/${groupId}/members/me`);
            role = 'member';
        } else {
            await this.api.put(`/orgs/${orgId}/working-groups/${groupId}/members/${memberId}`, { role });
        }
        if (memberId === this.auth.currentMember()?.id) {
            this._myMemberships.update((s) => new Set(s).add(groupId));
            this._myAgRoles.update((m) => new Map(m).set(groupId, role));
        }
    }

    async leaveGroup(groupId: string, memberId: string) {
        await this.api.delete(`/orgs/${this.orgId()}/working-groups/${groupId}/members/${memberId}`);
        if (memberId === this.auth.currentMember()?.id) {
            this._myMemberships.update((s) => {
                const neu = new Set(s);
                neu.delete(groupId);
                return neu;
            });
            this._myAgRoles.update((m) => {
                const neu = new Map(m);
                neu.delete(groupId);
                return neu;
            });
        }
    }

    /**
     * Update a member's role in an AG (for AG admins)
     */
    async updateMemberRole(groupId: string, memberId: string, newRole: AgRole): Promise<void> {
        await this.api.patch(`/orgs/${this.orgId()}/working-groups/${groupId}/members/${memberId}`, { role: newRole });
    }

    /**
     * Get all members of an AG with their roles
     */
    async getAgMembers(groupId: string): Promise<{ member_id: string; name: string; role: AgRole }[]> {
        try {
            const zeilen = await this.api.get<{ member_id: string; name: string; role: AgRole }[]>(`/orgs/${this.orgId()}/working-groups/${groupId}/members`);
            return zeilen.map((m) => ({ member_id: m.member_id, name: m.name || 'Unbekannt', role: m.role }));
        } catch (error) {
            console.error('Error fetching AG members:', error);
            return [];
        }
    }

    /**
     * Fetch all distinct, non-null categories used within the current organization.
     */
    async fetchDistinctCategories(): Promise<string[]> {
        try {
            return await this.api.get<string[]>(`/orgs/${this.orgId()}/working-groups/categories`);
        } catch (error) {
            console.error('Error fetching categories:', error);
            return [];
        }
    }
}
