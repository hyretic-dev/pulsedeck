import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';

import { ApiError, ApiService } from '../../core/api.service';

export type SubscriptionTier = 'free' | 'pro' | 'pro_bono';

/** Antworten der Registrierung auf „Wie seid ihr auf PulseDeck gekommen?“ sowie der Pilot-Wunsch (bleibt intern, wird nicht angezeigt). */
export interface Herkunft {
    acquisition_source?: string;
    acquisition_ref?: string;
    pilot_requested?: boolean;
    pilot_wish?: string;
}

export interface Organization {
    id: string;
    slug: string;
    name: string;
    description?: string;
    logo_url?: string;
    primary_color: string;
    subscription_tier: SubscriptionTier;
    max_members: number;
    branding_enabled?: boolean;
    created_at?: string;
    updated_at?: string;
}

@Injectable({ providedIn: 'root' })
export class OrganizationService {
    private api = inject(ApiService);
    private router = inject(Router);

    // Current organization context
    currentOrganization = signal<Organization | null>(null);
    loading = signal(false);
    error = signal<string | null>(null);

    // Derived signals
    currentSlug = computed(() => this.currentOrganization()?.slug);
    currentOrgId = computed(() => this.currentOrganization()?.id);
    isLoaded = computed(() => this.currentOrganization() !== null);

    /**
     * Load organization by slug (öffentliche Stammdaten, auch ohne Anmeldung)
     */
    async loadBySlug(slug: string): Promise<boolean> {
        this.loading.set(true);
        this.error.set(null);
        try {
            const org = await this.api.get<Organization>(`/public/organizations/${encodeURIComponent(slug)}`, undefined, { auth: false });
            this.currentOrganization.set(org);
            return true;
        } catch {
            this.error.set('Organisation nicht gefunden');
            this.currentOrganization.set(null);
            return false;
        } finally {
            this.loading.set(false);
        }
    }

    /**
     * Create a new organization. Das Backend legt Organisation, Standardrollen und das Mitglied des Besitzers atomar an.
     */
    async create(name: string, slug: string, ownerName?: string, herkunft?: Herkunft): Promise<Organization> {
        try {
            return await this.api.post<Organization>('/orgs', {
                name,
                slug: this.slugify(slug),
                ...(ownerName ? { owner_name: ownerName } : {}),
                ...(herkunft?.acquisition_source ? { acquisition_source: herkunft.acquisition_source } : {}),
                ...(herkunft?.acquisition_ref ? { acquisition_ref: herkunft.acquisition_ref } : {}),
                ...(herkunft?.pilot_requested ? { pilot_requested: true, ...(herkunft.pilot_wish?.trim() ? { pilot_wish: herkunft.pilot_wish.trim() } : {}) } : {}),
            });
        } catch (e) {
            if (e instanceof ApiError && e.status === 409) throw new Error('Diese URL ist bereits vergeben');
            throw e;
        }
    }

    /**
     * Update organization settings (Name, Beschreibung, Farbe, Logo)
     */
    async update(id: string, updates: Partial<Organization>): Promise<void> {
        const { name, description, primary_color, logo_url } = updates;
        const geaendert = await this.api.patch<Organization>(`/orgs/${id}`, { name, description, primary_color, logo_url });
        const current = this.currentOrganization();
        if (current?.id === id) this.currentOrganization.set({ ...current, ...geaendert });
    }

    /**
     * Check if slug is available
     */
    async isSlugAvailable(slug: string): Promise<boolean> {
        const antwort = await this.api.get<{ available: boolean }>(`/public/slugs/${encodeURIComponent(this.slugify(slug))}`, undefined, { auth: false });
        return antwort.available;
    }

    /**
     * Organisationen des angemeldeten Nutzers (Mitgliedschaften)
     */
    async getMyOrganizations(): Promise<Organization[]> {
        return this.api.get<Organization[]>('/me/organizations');
    }

    /**
     * Get member count for organization
     */
    async getMemberCount(organizationId: string): Promise<number> {
        const mitglieder = await this.api.get<unknown[]>(`/orgs/${organizationId}/members`);
        return mitglieder.length;
    }

    /**
     * Check if organization can add more members
     */
    async canAddMember(organizationId: string): Promise<boolean> {
        const org = this.currentOrganization();
        if (!org) return false;
        if (org.subscription_tier !== 'free') return true;
        return (await this.getMemberCount(organizationId)) < org.max_members;
    }

    /**
     * Navigate to organization dashboard
     */
    navigateToDashboard(slug?: string): void {
        const s = slug || this.currentSlug();
        if (s) this.router.navigate(['/', s, 'dashboard']);
    }

    /**
     * Convert string to URL-friendly slug
     */
    private slugify(text: string): string {
        return text
            .toLowerCase()
            .trim()
            .replace(/[äÄ]/g, 'ae')
            .replace(/[öÖ]/g, 'oe')
            .replace(/[üÜ]/g, 'ue')
            .replace(/ß/g, 'ss')
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Get subscription tier label
     */
    getTierLabel(tier: SubscriptionTier): string {
        const labels: Record<SubscriptionTier, string> = {
            free: 'Free (bis 10 Mitglieder)',
            pro: 'Pro',
            pro_bono: 'Pro Bono (gemeinnützig)',
        };
        return labels[tier];
    }
}
