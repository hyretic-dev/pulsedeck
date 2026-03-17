import { Injectable, signal, inject } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { SupabaseService } from './supabase';
import { AuthService } from './auth.service';

@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    private swPush = inject(SwPush);
    private supabase = inject(SupabaseService);
    private auth = inject(AuthService);

    // Signals for UI state
    public permissionStatus = signal<NotificationPermission>('default');
    public isSupported = signal<boolean>(false);
    public isSubscribed = signal<boolean>(false);

    private readonly VAPID_PUBLIC_KEY = 'BO19JVr7-jl1y39KHtprGelr3EtWnZAJRHexWD4N_TBBZkw9GAPIBmuIgjhq3trSl1H8qS2NOAWLCjNZNv8L4xs'; 

    constructor() {
        this.checkSupport();
        this.checkPermission();

        // Listen to subscription changes
        this.swPush.subscription.subscribe((sub: PushSubscription | null) => {
            this.isSubscribed.set(!!sub);
            if (sub) {
                this.saveSubscriptionToServer(sub);
            }
        });
    }

    private checkSupport() {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            this.isSupported.set(true);
        }
    }

    private checkPermission() {
        if (!this.isSupported()) return;
        this.permissionStatus.set(Notification.permission);
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
        
        try {
            const sub = await this.swPush.requestSubscription({
                serverPublicKey: this.VAPID_PUBLIC_KEY
            });
            await this.saveSubscriptionToServer(sub);
            console.log('Push Subscription successful');
        } catch (err) {
            console.error('Could not subscribe to push', err);
        }
    }

    /**
     * Save subscription to Supabase
     */
    private async saveSubscriptionToServer(sub: PushSubscription) {
        const memberId = this.auth.currentMember()?.id;
        if (!memberId) return;

        const subJson = sub.toJSON();
        if (!subJson.endpoint || !subJson.keys) return;

        const { error } = await this.supabase.client
            .from('push_subscriptions')
            .upsert({
                member_id: memberId,
                endpoint: subJson.endpoint,
                p256dh: subJson.keys?.['p256dh'],
                auth: subJson.keys?.['auth']
            }, { onConflict: 'endpoint' });

        if (error) {
            console.error('Error saving push subscription to Supabase:', error);
        }
    }
}

