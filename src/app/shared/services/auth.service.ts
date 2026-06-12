import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase';
import { OrganizationService } from './organization.service';
import { Member, AppRole, Permission } from '../models/member.model';
import { environment } from '../../../environments/environment';

/**
 * Represents a user's membership in an organization
 */
export interface UserMembership {
    memberId: string;
    memberName: string;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    appRole: AppRole;
}

/**
 * Response from send-invitation Edge Function
 */
export interface LoginCheckResult {
    status: 'connected' | 'invitation_sent' | 'not_found' | 'error';
    message?: string;
    memberName?: string;
    organizations?: Array<{
        id: string;
        name: string;
        slug: string;
    }>;
    error?: string;
    details?: string;
}

@Injectable({
    providedIn: 'root',
})
export class AuthService {
    private supabase = inject(SupabaseService);
    private router = inject(Router);
    private orgService = inject(OrganizationService);
    private readonly FUNCTIONS_URL = `${environment.supabase.url}/functions/v1`;

    /** All memberships for the current logged-in user */
    userMemberships = signal<UserMembership[]>([]);

    /** Currently active membership (selected organization) */
    currentMember = signal<Member | null>(null);

    /** Currently active organization ID */
    currentOrgId = signal<string | null>(null);

    /** Computed Role: 'public' if not logged in or not linked */
    userRole = computed<AppRole>(() => {
        const member = this.currentMember();
        return member?.app_role ?? 'public';
    });

    user = this.supabase.user;
    isLoggedIn = computed(() => !!this.user());

    /** Is system administrator (in current org) */
    isAdmin = computed(() => {
        const m = this.currentMember();
        return m?.org_role?.is_system_admin || this.userRole() === 'admin';
    });

    /** Is committee (Vorstand) or higher (in current org) */
    isCommittee = computed(() =>
        ['committee', 'admin'].includes(this.userRole())
    );

    /** Is member or higher (in current org) */
    isMember = computed(() =>
        ['member', 'committee', 'admin'].includes(this.userRole())
    );

    /** Has multiple organizations */
    hasMultipleOrgs = computed(() => this.userMemberships().length > 1);

    constructor() {
        // React to Supabase User changes
        effect(
            () => {
                const user = this.supabase.user();
                if (user) {
                    this.fetchAllMemberships(user.id);
                } else {
                    this.userMemberships.set([]);
                    this.currentMember.set(null);
                    this.currentOrgId.set(null);
                }
            }
        );
    }

    /**
     * Fetch all memberships for a user across all organizations
     */
    private async fetchAllMemberships(userId: string): Promise<void> {
        const { data, error } = await this.supabase.client
            .rpc('get_user_memberships', { user_uuid: userId });

        if (error) {
            console.error('Error fetching user memberships:', error);
            // Fallback to direct query
            await this.fetchMembershipsDirectly(userId);
            return;
        }

        if (data && data.length > 0) {
            const memberships: UserMembership[] = data.map((m: any) => ({
                memberId: m.member_id,
                memberName: m.member_name,
                organizationId: m.organization_id,
                organizationName: m.organization_name,
                organizationSlug: m.organization_slug,
                appRole: m.app_role as AppRole,
            }));

            this.userMemberships.set(memberships);
            console.log('User memberships loaded:', memberships);

            // Priority 1: Check if OrganizationService already has an org loaded
            // (e.g., from organizationGuard)
            const guardOrgId = this.orgService.currentOrgId();
            const guardMembership = guardOrgId
                ? memberships.find(m => m.organizationId === guardOrgId)
                : null;

            if (guardMembership) {
                console.log('Using organization from guard:', guardOrgId);
                await this.setActiveOrganization(guardMembership.organizationId);
                return;
            }

            // Priority 2: Check localStorage for stored preference
            const storedOrgId = localStorage.getItem('last_org_id');
            const storedMembership = storedOrgId
                ? memberships.find(m => m.organizationId === storedOrgId)
                : null;

            if (storedMembership) {
                await this.setActiveOrganization(storedMembership.organizationId);
            } else if (memberships.length === 1) {
                // Only one org - auto-select
                await this.setActiveOrganization(memberships[0].organizationId);
            }
            // If multiple orgs and no stored preference, leave currentMember null
            // The UI should show org selector
        } else {
            console.warn('User logged in, but no linked Member profiles found.');
            this.userMemberships.set([]);
            this.currentMember.set(null);
        }
    }

    /**
     * Fallback: Direct query if RPC function not available
     */
    private async fetchMembershipsDirectly(userId: string): Promise<void> {
        const { data, error } = await this.supabase.client
            .from('members')
            .select(`
                id,
                name,
                app_role,
                organization_id,
                organization:organizations!inner(id, name, slug),
                org_role:organization_roles(*)
            `)
            .eq('user_id', userId);

        if (error) {
            console.error('Error fetching memberships directly:', error);
            return;
        }

        if (data && data.length > 0) {
            const memberships: UserMembership[] = data.map((m: any) => ({
                memberId: m.id,
                memberName: m.name,
                organizationId: m.organization_id,
                organizationName: m.organization?.name,
                organizationSlug: m.organization?.slug,
                appRole: m.app_role as AppRole,
            }));

            this.userMemberships.set(memberships);

            // Priority 1: Check if OrganizationService already has org loaded
            const guardOrgId = this.orgService.currentOrgId();
            const guardMembership = guardOrgId
                ? memberships.find(m => m.organizationId === guardOrgId)
                : null;

            if (guardMembership) {
                await this.setActiveOrganization(guardMembership.organizationId);
                return;
            }

            // Priority 2: Check localStorage
            const storedOrgId = localStorage.getItem('last_org_id');
            const storedMembership = storedOrgId
                ? memberships.find(m => m.organizationId === storedOrgId)
                : null;

            if (storedMembership) {
                await this.setActiveOrganization(storedMembership.organizationId);
            } else if (memberships.length === 1) {
                await this.setActiveOrganization(memberships[0].organizationId);
            }
        }
    }

    /**
     * Set the active organization and load the full member profile
     */
    async setActiveOrganization(organizationId: string): Promise<void> {
        const userId = this.user()?.id;
        if (!userId) return;

        // Store preference
        localStorage.setItem('last_org_id', organizationId);
        this.currentOrgId.set(organizationId);

        // Load full member profile for this org
        const { data, error } = await this.supabase.client
            .from('members')
            .select('*, org_role:organization_roles(*)')
            .eq('user_id', userId)
            .eq('organization_id', organizationId)
            .single();

        if (error) {
            console.error('Error fetching member profile:', error);
            return;
        }

        if (data) {
            this.currentMember.set(data as Member);
            console.log('Active organization set:', data.name, 'Role:', data.app_role);
        }
    }

    /**
     * Check if an email exists and determine login status
     * Called from login flow before authentication
     */
    async checkEmail(email: string, organizationId?: string): Promise<LoginCheckResult> {
        try {
            const response = await fetch(`${this.FUNCTIONS_URL}/send-invitation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': environment.supabase.anonKey,
                },
                body: JSON.stringify({
                    email: email.toLowerCase().trim(),
                    organizationId,
                    // Explicitly set redirectTo to ensure we land on the callback page
                    // This handles both localhost and production environments correctly
                    redirectTo: `${window.location.origin}/auth/callback`,
                }),
            });

            const result = await response.json();

            if (!response.ok) {
                console.error('Edge Function Error:', result);
                return {
                    status: 'error',
                    error: result.error || result.message || `Anfrage fehlgeschlagen (${response.status})`
                };
            }

            return result as LoginCheckResult;
        } catch (e) {
            console.error('Error checking email:', e);
            return { status: 'not_found', error: (e as Error).message };
        }
    }

    /**
     * Refresh current member data
     */
    async refreshMember(): Promise<void> {
        const user = this.user();
        if (user) {
            await this.fetchAllMemberships(user.id);
        }
    }

    /**
     * Get membership for a specific organization
     */
    getMembershipForOrg(orgId: string): UserMembership | undefined {
        return this.userMemberships().find(m => m.organizationId === orgId);
    }

    /**
     * Prüft, ob das aktuelle Mitglied eine spezifische Permission besitzt.
     */
    hasPermission(permission: Permission): boolean {
        const member = this.currentMember();
        if (!member) return false;

        // Echte System-Admins (Owner oder Admin-Rolle) haben alle Rechte
        if (member.org_role?.is_system_admin || member.app_role === 'admin' || member.app_role === 'committee') {
            return true;
        }

        return member.org_role?.permissions?.includes(permission) || member.permissions?.includes(permission) || false;
    }

    // Auth Proxies
    async signIn(
        email: string,
        password: string
    ): Promise<{ error: Error | null }> {
        return this.supabase.signInWithPassword(email, password);
    }

    async signOut(): Promise<void> {
        localStorage.removeItem('last_org_id');
        await this.supabase.signOut();
        this.userMemberships.set([]);
        this.currentMember.set(null);
        this.currentOrgId.set(null);
        this.router.navigate(['/']);
    }
}
