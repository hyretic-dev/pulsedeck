import { Injectable, inject, effect, OnDestroy, signal } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase';

@Injectable({
    providedIn: 'root'
})
export class PresenceTrackerService implements OnDestroy {
    private auth = inject(AuthService);
    private supabase = inject(SupabaseService);
    private router = inject(Router);

    private heartbeatInterval: any;
    private currentPath = signal<string>(window.location.pathname);

    constructor() {
        // Track route changes
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        ).subscribe((event: any) => {
            this.currentPath.set(event.urlAfterRedirects || event.url);
            this.pingPresence();
        });

        // Track auth state changes (e.g. login/logout)
        effect(() => {
            const user = this.auth.user();
            const memberships = this.auth.userMemberships();
            
            if (user && memberships.length > 0) {
                this.startHeartbeat();
            } else {
                this.stopHeartbeat();
            }
        });
    }

    private startHeartbeat() {
        if (this.heartbeatInterval) return;
        
        // Initial ping
        this.pingPresence();
        
        // Ping every 60 seconds
        this.heartbeatInterval = setInterval(() => {
            this.pingPresence();
        }, 60000);

        // Ping on window close/unload to delete presence immediately
        window.addEventListener('beforeunload', this.onUnload);
    }

    private stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        window.removeEventListener('beforeunload', this.onUnload);
    }

    private onUnload = () => {
        // Sync ping to remove presence or just let it timeout
        // But doing a sync fetch request during unload is more reliable
        const user = this.auth.user();
        if (user) {
            // Best effort removal on unload
            navigator.sendBeacon(
                `${this.supabase.getSupabaseUrl()}/rest/v1/active_sessions?user_id=eq.${user.id}`,
                ''
            );
        }
    };

    private async pingPresence() {
        const user = this.auth.user();
        const memberships = this.auth.userMemberships();
        const member = this.auth.currentMember(); // just to get name if available
        
        if (!user || memberships.length === 0) return;

        // Build org_roles jsonb: { "orgId": "appRole" }
        const orgRoles: Record<string, string> = {};
        let primaryName = user.email || 'Unknown';

        memberships.forEach(m => {
            orgRoles[m.organizationId] = m.appRole;
            // Grab a name if we haven't found a good one yet
            if (m.memberName && primaryName === (user.email || 'Unknown')) {
                primaryName = m.memberName;
            }
        });

        try {
            await this.supabase.client
                .from('active_sessions')
                .upsert({
                    user_id: user.id,
                    name: primaryName,
                    org_roles: orgRoles,
                    current_path: this.currentPath(),
                    last_seen_at: new Date().toISOString()
                }, { onConflict: 'user_id' });
        } catch (err) {
            console.warn('Failed to ping presence', err);
        }
    }

    ngOnDestroy() {
        this.stopHeartbeat();
    }
}
