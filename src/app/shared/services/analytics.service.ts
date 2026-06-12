import { Injectable } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from './supabase';

export interface AnalyticsEvent {
    id: string;
    event_name: string;
    organization_id?: string;
    page_path?: string;
    meta_data?: any;
    created_at: string;
}

@Injectable({
    providedIn: 'root'
})
export class AnalyticsService {
    private supabase: SupabaseClient;

    constructor(private supabaseService: SupabaseService) {
        this.supabase = this.supabaseService.client;
    }

    /**
     * Track a public or private event
     */
    async track(eventName: string, metaData: any = {}, organizationId?: string): Promise<void> {
        try {
            // Auto-detect organization ID from URL if not provided
            if (!organizationId) {
                // pattern: /:slug/dashboard...
                const path = window.location.pathname;
                const matches = path.match(/^\/([^\/]+)\//);
                if (matches && matches[1] && matches[1] !== 'auth' && matches[1] !== 'public') {
                    // We would need to resolve slug to ID, which is hard here.
                    // Better to rely on caller passing orgId or leaving it null for global events.
                }
            }

            await this.supabase.from('analytics_events').insert({
                event_name: eventName,
                meta_data: metaData,
                page_path: window.location.pathname,
                organization_id: organizationId || null
            });
        } catch (e) {
            // Analytics should never break the app
            console.warn('Failed to track event:', e);
        }
    }

    /**
     * Get global aggregated stats (Super Admin only)
     */
    async getGlobalStats(): Promise<{ name: string, count: number }[]> {
        const { data, error } = await this.supabase
            .from('analytics_events')
            .select('event_name');

        if (error) throw error;

        const counts: Record<string, number> = {};
        data.forEach((row: any) => {
            counts[row.event_name] = (counts[row.event_name] || 0) + 1;
        });

        return Object.entries(counts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Get aggregated stats for an organization (Admin only)
     */
    async getStats(organizationId: string): Promise<{ name: string, count: number }[]> {
        const { data, error } = await this.supabase
            .from('analytics_events')
            .select('event_name')
            .eq('organization_id', organizationId); // We will count in JS for now or use rpc if data is large

        if (error) throw error;

        // Client-side aggregation (okay for small scale Alpha)
        const counts: Record<string, number> = {};
        data.forEach((row: any) => {
            counts[row.event_name] = (counts[row.event_name] || 0) + 1;
        });

        return Object.entries(counts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Get recent events
     */
    async getRecentEvents(organizationId: string, limit = 50): Promise<AnalyticsEvent[]> {
        const { data, error } = await this.supabase
            .from('analytics_events')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data as AnalyticsEvent[];
    }
}
