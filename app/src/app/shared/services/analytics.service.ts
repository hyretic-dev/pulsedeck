import { Injectable, inject } from '@angular/core';

import { ApiService } from '../../core/api.service';

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
    private api = inject(ApiService);

    /**
     * Track a public or private event. Die Organisation wird nur übernommen, wenn die angemeldete Person dort Mitglied ist.
     */
    async track(eventName: string, metaData: any = {}, organizationId?: string): Promise<void> {
        try {
            await this.api.post('/analytics/events', {
                event_name: eventName,
                meta_data: metaData,
                page_path: window.location.pathname.slice(0, 300),
                ...(organizationId ? { organization_id: organizationId } : {}),
            });
        } catch (e) {
            // Analytics should never break the app
            console.warn('Failed to track event:', e);
        }
    }

    /**
     * Plattformweite Zahlen (nur Plattformadministration)
     */
    async getGlobalStats(): Promise<{ name: string, count: number }[]> {
        return this.api.get('/platform/analytics/stats');
    }

    /**
     * Zahlen einer Organisation (Administratoren)
     */
    async getStats(organizationId: string): Promise<{ name: string, count: number }[]> {
        return this.api.get(`/orgs/${organizationId}/analytics/stats`);
    }

    /**
     * Get recent events
     */
    async getRecentEvents(organizationId: string, limit = 50): Promise<AnalyticsEvent[]> {
        return this.api.get(`/orgs/${organizationId}/analytics/events`, { limit });
    }
}
