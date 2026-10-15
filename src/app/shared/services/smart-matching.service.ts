import { Injectable, inject, signal } from '@angular/core';

import { ApiService } from '../../core/api.service';
import { OrganizationService } from './organization.service';
import { AuthService } from './auth.service';

/**
 * A matched opportunity for the current member
 */
export interface MatchedOpportunity {
    slot_id: string;
    slot_title: string;
    event_id: string;
    event_title: string;
    event_date: string;
    event_location?: string;
    matching_skills: string[];
    has_skill_match: boolean;
    remaining_spots: number;
}

/**
 * Service for Smart Matching - finds open helper slots for the member.
 * Die Auswahl (sichtbare Termine, freie Plätze, Fähigkeitstreffer zuerst, höchstens drei) trifft das Backend.
 */
@Injectable({
    providedIn: 'root',
})
export class SmartMatchingService {
    private readonly api = inject(ApiService);
    private readonly orgService = inject(OrganizationService);
    private readonly authService = inject(AuthService);

    /** Matched opportunities for current member */
    opportunities = signal<MatchedOpportunity[]>([]);

    /** Loading state */
    loading = signal(false);

    /** Whether the member has any skills tagged */
    hasSkills = signal(false);

    /**
     * Find open helper slots for the current member
     */
    async findMatchingOpportunities(): Promise<void> {
        const memberId = this.authService.currentMember()?.id;
        const orgId = this.orgService.currentOrgId();

        if (!memberId || !orgId) {
            this.opportunities.set([]);
            return;
        }

        this.loading.set(true);
        try {
            const antwort = await this.api.get<{ opportunities: MatchedOpportunity[]; has_skills: boolean }>(`/orgs/${orgId}/matching/opportunities`);
            this.hasSkills.set(antwort.has_skills);
            this.opportunities.set(antwort.opportunities);
        } catch (error) {
            console.error('Error in smart matching:', error);
            this.opportunities.set([]);
        }
        this.loading.set(false);
    }
}
