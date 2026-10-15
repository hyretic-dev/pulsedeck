import { Injectable, signal, inject, effect } from '@angular/core';
import { SwPush } from '@angular/service-worker';

import { ApiService } from '../../core/api.service';
import { AuthService } from './auth.service';

/** base64url eines Schlüssels (zum Vergleich mit dem öffentlichen VAPID-Schlüssel des Servers) */
function alsBase64Url(puffer: ArrayBuffer | null | undefined): string {
    if (!puffer) return '';
    let text = '';
    new Uint8Array(puffer).forEach((b) => (text += String.fromCharCode(b)));
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Web-Push: Der öffentliche VAPID-Schlüssel kommt vom Server (`GET /push/config`), das Abonnement wird je Organisation
 * (Mitglied) beim Server gespeichert. Wechselt der Server-Schlüssel, wird das alte Browser-Abonnement ersetzt.
 */
@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    private swPush = inject(SwPush);
    private api = inject(ApiService);
    private auth = inject(AuthService);

    // Signals for UI state
    public permissionStatus = signal<NotificationPermission>('default');
    public isSupported = signal<boolean>(false);
    public isSubscribed = signal<boolean>(false);

    private serverSchluessel: string | null | undefined;
    private letztesAbo: PushSubscription | null = null;

    constructor() {
        this.checkSupport();
        this.checkPermission();

        // Listen to subscription changes
        this.swPush.subscription.subscribe((sub: PushSubscription | null) => {
            this.isSubscribed.set(!!sub);
            this.letztesAbo = sub;
            if (sub) void this.saveSubscriptionToServer(sub);
        });

        // Beim Wechsel der Organisation/Anmeldung das vorhandene Abonnement für das aktuelle Mitglied registrieren
        effect(() => {
            const memberId = this.auth.currentMember()?.id;
            if (memberId && this.letztesAbo) void this.saveSubscriptionToServer(this.letztesAbo);
        });
    }

    private checkSupport() {
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window) {
            this.isSupported.set(true);
        }
    }

    private checkPermission() {
        if (!this.isSupported()) return;
        this.permissionStatus.set(Notification.permission);
    }

    private async holeServerSchluessel(): Promise<string | null> {
        if (this.serverSchluessel === undefined) {
            try {
                const config = await this.api.get<{ enabled: boolean; publicKey: string | null }>('/push/config', undefined, { auth: false });
                this.serverSchluessel = config.enabled ? config.publicKey : null;
            } catch {
                return null;
            }
        }
        return this.serverSchluessel;
    }

    /**
     * Request permission from the user
     * Designed to be called from a user gesture (button click)
     */
    async requestPermission(): Promise<boolean> {
        if (!this.isSupported()) return false;

        try {
            const permission = await Notification.requestPermission();
            this.permissionStatus.set(permission);

            if (permission === 'granted') {
                await this.subscribeToPush();
                return true;
            }
        } catch (err) {
            console.error('Could not ask for notification permission', err);
        }
        return false;
    }

    /**
     * Subscribe to push notifications
     */
    async subscribeToPush() {
        if (!this.isSupported()) return;
        const schluessel = await this.holeServerSchluessel();
        if (!schluessel) return; // Push ist auf dem Server nicht eingerichtet

        try {
            let sub: PushSubscription;
            try {
                sub = await this.swPush.requestSubscription({ serverPublicKey: schluessel });
            } catch {
                // Ein Abonnement mit anderem Schlüssel (nach Schlüsselwechsel) blockiert das neue: ersetzen
                await this.swPush.unsubscribe();
                sub = await this.swPush.requestSubscription({ serverPublicKey: schluessel });
            }
            if (alsBase64Url(sub.options?.applicationServerKey) && alsBase64Url(sub.options.applicationServerKey) !== schluessel) {
                await this.swPush.unsubscribe();
                sub = await this.swPush.requestSubscription({ serverPublicKey: schluessel });
            }
            await this.saveSubscriptionToServer(sub);
        } catch (err) {
            console.error('Could not subscribe to push', err);
        }
    }

    /**
     * Abonnement beim Server für das aktuelle Mitglied speichern
     */
    private async saveSubscriptionToServer(sub: PushSubscription) {
        const orgId = this.auth.currentOrgId();
        if (!orgId || !this.auth.currentMember()?.id) return;

        const subJson = sub.toJSON();
        if (!subJson.endpoint || !subJson.keys) return;

        try {
            await this.api.put(`/orgs/${orgId}/push/subscription`, {
                endpoint: subJson.endpoint,
                keys: { p256dh: subJson.keys['p256dh'], auth: subJson.keys['auth'] },
            });
        } catch (error) {
            console.error('Error saving push subscription:', error);
        }
    }
}
