import { Injectable, inject, effect, OnDestroy, signal } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { ApiService } from '../../core/api.service';

@Injectable({
    providedIn: 'root'
})
export class PresenceTrackerService implements OnDestroy {
    private auth = inject(AuthService);
    private api = inject(ApiService);
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
        // Kein Abmelde-Aufruf nötig: Anwesenheit gilt nur fünf Minuten nach dem letzten Ping
        this.stopHeartbeat();
    };

    private async pingPresence() {
        const user = this.auth.user();
        const memberships = this.auth.userMemberships();
        if (!user || memberships.length === 0) return;

        try {
            // Name und Rollen leitet der Server aus den Mitgliedschaften ab; vom Client kommt nur der Pfad
            await this.api.post('/presence', { current_path: this.currentPath().split(/[?#]/)[0].slice(0, 299) || '/' });
        } catch (err) {
            console.warn('Failed to ping presence', err);
        }
    }

    ngOnDestroy() {
        this.stopHeartbeat();
    }
}
