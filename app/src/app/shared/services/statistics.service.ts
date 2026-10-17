import { Injectable, inject, signal } from '@angular/core';

import { ApiService } from '../../core/api.service';
import { OrganizationService } from './organization.service';

export interface DashboardStats {
    totalMembers: number;
    totalWorkingGroups: number;
    totalEvents: number;
    upcomingEvents: number;
    totalWikiArticles: number;
    totalFiles: number;
    totalFeedItems: number;
    activeMembers: number;
    newMembersThisMonth: number;
    eventsThisMonth: number;
}

@Injectable({ providedIn: 'root' })
export class StatisticsService {
    private api = inject(ApiService);
    private org = inject(OrganizationService);

    stats = signal<DashboardStats | null>(null);
    loading = signal(false);

    /**
     * Fetch all dashboard statistics for the current organization (eine Abfrage; Sichtbarkeit beachtet der Server)
     */
    async fetchStats(): Promise<void> {
        const orgId = this.org.currentOrgId();
        if (!orgId) return;
        this.loading.set(true);
        try {
            this.stats.set(await this.api.get<DashboardStats>(`/orgs/${orgId}/statistics`));
        } catch (e) {
            console.error('Error fetching stats:', e);
        }
        this.loading.set(false);
    }
}
