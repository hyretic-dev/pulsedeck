import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
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
    private supabase = inject(SupabaseService);
    private org = inject(OrganizationService);

    stats = signal<DashboardStats | null>(null);
    loading = signal(false);

    /**
     * Fetch all dashboard statistics for current organization
     */
    async fetchStats(): Promise<void> {
        this.loading.set(true);

        const orgId = this.org.currentOrgId();

        try {
            const [
                membersResult,
                workingGroupsResult,
                eventsResult,
                upcomingEventsResult,
                wikiResult,
                filesResult,
                feedResult,
                newMembersResult,
                eventsThisMonthResult,
            ] = await Promise.all([
                // Total members
                this.countWithOrg('members', orgId),

                // Total working groups
                this.countWithOrg('working_groups', orgId),

                // Total events
                this.countWithOrg('events', orgId),

                // Upcoming events (from today)
                this.countWithOrgAndFilter('events', orgId, q =>
                    q.gte('date', new Date().toISOString().split('T')[0])
                ),

                // Wiki articles
                this.countWithOrg('wiki_docs', orgId),

                // Files
                this.countWithOrg('files', orgId),

                // Feed items (approved/sent)
                this.countWithOrgAndFilter('feed_items', orgId, q =>
                    q.in('status', ['approved', 'sent'])
                ),

                // New members this month
                this.getNewMembersThisMonth(orgId),

                // Events this month
                this.getEventsThisMonth(orgId),
            ]);

            // Calculate active members (members with user_id set = connected)
            const activeCount = await this.countWithOrgAndFilter(
                'members',
                orgId,
                q => q.not('user_id', 'is', null)
            );

            this.stats.set({
                totalMembers: membersResult,
                totalWorkingGroups: workingGroupsResult,
                totalEvents: eventsResult,
                upcomingEvents: upcomingEventsResult,
                totalWikiArticles: wikiResult,
                totalFiles: filesResult,
                totalFeedItems: feedResult,
                activeMembers: activeCount,
                newMembersThisMonth: newMembersResult,
                eventsThisMonth: eventsThisMonthResult,
            });
        } catch (e) {
            console.error('Error fetching stats:', e);
        }

        this.loading.set(false);
    }

    /**
     * Count rows in a table with optional organization filter
     */
    private async countWithOrg(
        table: string,
        orgId: string | undefined
    ): Promise<number> {
        let query = this.supabase.client
            .from(table)
            .select('*', { count: 'exact', head: true });

        if (orgId) {
            query = query.eq('organization_id', orgId);
        }

        const { count } = await query;
        return count ?? 0;
    }

    /**
     * Count with organization filter and additional filter
     */
    private async countWithOrgAndFilter(
        table: string,
        orgId: string | undefined,
        filterFn: (q: any) => any
    ): Promise<number> {
        let query = this.supabase.client
            .from(table)
            .select('*', { count: 'exact', head: true });

        if (orgId) {
            query = query.eq('organization_id', orgId);
        }

        query = filterFn(query);
        const { count } = await query;
        return count ?? 0;
    }

    /**
     * Get new members this month
     */
    private async getNewMembersThisMonth(orgId?: string): Promise<number> {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        return this.countWithOrgAndFilter('members', orgId, q =>
            q.gte('created_at', startOfMonth.toISOString())
        );
    }

    /**
     * Get events this month
     */
    private async getEventsThisMonth(orgId?: string): Promise<number> {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        const endOfMonth = new Date(startOfMonth);
        endOfMonth.setMonth(endOfMonth.getMonth() + 1);

        return this.countWithOrgAndFilter('events', orgId, q =>
            q.gte('date', startOfMonth.toISOString().split('T')[0])
                .lt('date', endOfMonth.toISOString().split('T')[0])
        );
    }
}
