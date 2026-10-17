import { Injectable, inject, computed, signal, effect } from '@angular/core';
import { AuthService } from './auth.service';
import { ApiService } from '../../core/api.service';
import { Permission, AgRole } from '../models/member.model';

/**
 * Permission labels for UI display
 */
export const PERMISSION_LABELS: Record<Permission, string> = {
    'feed:create': 'Beiträge erstellen',
    'feed:approve': 'Beiträge freigeben',
    'wiki:edit': 'Wiki bearbeiten',
    'events:create': 'Termine erstellen',
    'contacts:edit': 'Kontakte bearbeiten',
    'view_issue_tracker': 'Issue-Tracker anzeigen',
};

/**
 * AG Role labels for UI display
 */
export const AG_ROLE_LABELS: Record<AgRole, string> = {
    member: 'Mitglied',
    admin: 'Admin',
    lead: 'Leitung',
};

/**
 * All available permissions
 */
export const ALL_PERMISSIONS: Permission[] = [
    'feed:create',
    'feed:approve',
    'wiki:edit',
    'events:create',
    'contacts:edit',
    'view_issue_tracker',
];

@Injectable({
    providedIn: 'root',
})
export class PermissionsService {
    private auth = inject(AuthService);
    private api = inject(ApiService);

    /**
     * AG memberships with roles for the current user
     * Map: working_group_id -> role
     */
    agRoles = signal<Map<string, AgRole>>(new Map());

    /**
     * Is the current user a system admin?
     */
    isSystemAdmin = computed(() => this.auth.userRole() === 'admin');

    /**
     * Is the current user committee (Vorstand)?
     */
    isCommittee = computed(
        () => this.auth.userRole() === 'committee' || this.isSystemAdmin()
    );

    /**
     * Get the current member's permissions array
     */
    permissions = computed<Permission[]>(() => {
        const member = this.auth.currentMember();
        return member?.access?.permissions ?? ((member?.permissions as Permission[]) || []);
    });

    constructor() {
        // Fetch AG roles when member changes
        effect(() => {
            const member = this.auth.currentMember();
            const orgId = this.auth.currentOrgId();
            if (member?.id && orgId) {
                this.fetchAgRoles(orgId);
            } else {
                this.agRoles.set(new Map());
            }
        });
    }

    /**
     * Check if user has a specific permission
     */
    hasPermission(permission: Permission): boolean {
        // Admins and committee have all permissions
        if (this.isCommittee()) {
            return true;
        }

        return this.permissions().includes(permission);
    }

    /**
     * Check if user can create feed posts
     */
    canCreateFeed = computed(() => this.hasPermission('feed:create'));

    /**
     * Check if user can approve feed posts
     */
    canApproveFeed = computed(() => this.hasPermission('feed:approve'));

    /**
     * Check if user can edit wiki
     */
    canEditWiki = computed(() => this.hasPermission('wiki:edit'));

    /**
     * Check if user can create general events
     */
    canCreateEvents = computed(() => this.hasPermission('events:create'));

    /**
     * Check if user can edit contacts
     */
    canEditContacts = computed(() => this.hasPermission('contacts:edit'));

    /**
     * Check if user is admin/lead of a specific AG
     */
    isAgAdmin(agId: string): boolean {
        if (this.isSystemAdmin()) return true;
        const role = this.agRoles().get(agId);
        return role === 'admin' || role === 'lead';
    }

    /**
     * Check if user is lead of a specific AG
     */
    isAgLead(agId: string): boolean {
        if (this.isSystemAdmin()) return true;
        return this.agRoles().get(agId) === 'lead';
    }

    /**
     * Get the user's role in a specific AG
     */
    getAgRole(agId: string): AgRole | null {
        return this.agRoles().get(agId) || null;
    }

    /**
     * Check if user can edit a specific AG
     */
    canEditAg(agId: string): boolean {
        return this.isAgAdmin(agId);
    }

    /**
     * Check if user can create events for a specific AG
     */
    canCreateAgEvent(agId: string): boolean {
        return this.isAgAdmin(agId);
    }

    /**
     * Check if user can manage members of a specific AG
     */
    canManageAgMembers(agId: string): boolean {
        return this.isAgAdmin(agId);
    }

    /**
     * Fetch AG roles for the current member
     */
    private async fetchAgRoles(orgId: string): Promise<void> {
        try {
            const zeilen = await this.api.get<{ working_group_id: string; role: AgRole }[]>(`/orgs/${orgId}/working-groups/mine`);
            this.agRoles.set(new Map(zeilen.map((m) => [m.working_group_id, m.role])));
        } catch (error) {
            console.error('Error fetching AG roles:', error);
            this.agRoles.set(new Map());
        }
    }

    /**
     * Update a member's permissions (admin only)
     */
    async updateMemberPermissions(memberId: string, permissions: Permission[]): Promise<void> {
        const orgId = this.auth.currentOrgId();
        try {
            await this.api.patch(`/orgs/${orgId}/members/${memberId}`, { permissions });
        } catch (e) {
            throw new Error(`Fehler beim Aktualisieren: ${(e as Error).message}`);
        }
    }

    /**
     * Update a member's AG role (AG admin or system admin only)
     */
    async updateAgMemberRole(agId: string, memberId: string, role: AgRole): Promise<void> {
        const orgId = this.auth.currentOrgId();
        try {
            await this.api.patch(`/orgs/${orgId}/working-groups/${agId}/members/${memberId}`, { role });
        } catch (e) {
            throw new Error(`Fehler beim Aktualisieren der Rolle: ${(e as Error).message}`);
        }
    }

    /**
     * Get all AG memberships with details for a specific AG
     */
    async getAgMembers(agId: string): Promise<{ id: string; member_id: string; member_name: string; role: AgRole }[]> {
        const orgId = this.auth.currentOrgId();
        try {
            const zeilen = await this.api.get<{ id: string; member_id: string; name: string; role: AgRole }[]>(`/orgs/${orgId}/working-groups/${agId}/members`);
            return zeilen.map((m) => ({ id: m.id, member_id: m.member_id, member_name: m.name || 'Unbekannt', role: m.role }));
        } catch (error) {
            console.error('Error fetching AG members:', error);
            return [];
        }
    }
}
