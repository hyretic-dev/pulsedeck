import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { pick } from '../../core/pick';
import { OrganizationService } from './organization.service';

export type FeedItemStatus = 'draft' | 'review' | 'approved' | 'sent';
export type FeedItemType = 'article' | 'link' | 'poll';

export interface PollConfig {
    multiple_choice: boolean;
    end_date?: string;
}

export interface PollOption {
    id: string;
    text: string;
    sort_order: number;
    poll_votes?: { member_id: string }[]; // joined
}

export interface FeedItem {
    id?: string;
    created_at?: string;
    updated_at?: string;
    title: string;
    content?: string;
    url?: string;
    type: FeedItemType;
    poll_config?: PollConfig;
    poll_options?: PollOption[];
    status: FeedItemStatus;
    is_public?: boolean;
    author_id?: string;
    sent_at?: string;
    working_group_id?: string;
    is_pinned?: boolean;
    feed_item_reads?: { member_id: string }[]; // joined read receipts

    // joined
    author?: { name: string };
    working_group?: { name: string; category?: string };
}

const FEED_FELDER = ['title', 'content', 'url', 'type', 'status', 'is_public', 'working_group_id', 'poll_config', 'options'] as const;
const NEWSLETTER_FELDER = [
    'frequency', 'day_of_week', 'time_of_day', 'active', 'logo_url', 'footer_text', 'primary_color',
    'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure',
] as const;

@Injectable({ providedIn: 'root' })
export class FeedService {
    private api = inject(ApiService);
    private org = inject(OrganizationService);

    private pfad(rest = ''): string {
        const orgId = this.org.currentOrgId();
        if (!orgId) throw new Error('Keine Organisation ausgewählt');
        return `/orgs/${orgId}/feed${rest}`;
    }

    /** Get published items (freigegeben oder versendet) for all members */
    async getFeedItems() {
        return this.api.get<FeedItem[]>(this.pfad());
    }

    /** Get items created by current user */
    async getMyItems() {
        return this.api.get<FeedItem[]>(this.pfad('/mine'));
    }

    /** Get items waiting for review (Freigeber) */
    async getReviewItems() {
        return this.api.get<FeedItem[]>(this.pfad('/review'));
    }

    /** Get un-sent approved items (for newsletter generation) */
    async getNewsletterQueue() {
        return this.api.get<FeedItem[]>(this.pfad('/newsletter-queue'));
    }

    /** Get already sent items (History) */
    async getSentItems() {
        return this.api.get<FeedItem[]>(this.pfad('/sent'));
    }

    /** Autor und Organisation bestimmt der Server; Umfrageoptionen gehen als `options` mit. */
    async createItem(item: Partial<FeedItem> & { options?: string[] }) {
        return this.api.post<FeedItem>(this.pfad(), pick(item, FEED_FELDER, ['url', 'working_group_id']));
    }

    async updateItem(id: string, updates: Partial<FeedItem>) {
        return this.api.patch<FeedItem>(this.pfad(`/${id}`), pick(updates, FEED_FELDER.filter((f) => f !== 'type' && f !== 'options'), ['url', 'working_group_id']));
    }

    async deleteItem(id: string) {
        await this.api.delete(this.pfad(`/${id}`));
    }

    // Newsletter Config (Administratoren; das SMTP-Passwort wird nur geschrieben, nie geliefert)
    async getNewsletterConfig() {
        const orgId = this.org.currentOrgId();
        return this.api.get<NewsletterConfig>(`/orgs/${orgId}/newsletter/config`);
    }

    async updateNewsletterConfig(config: Partial<NewsletterConfig>) {
        const orgId = this.org.currentOrgId();
        const body = pick(config, NEWSLETTER_FELDER) as Record<string, unknown>;
        if (!body['smtp_pass']) delete body['smtp_pass']; // leer = unverändert
        return this.api.patch<NewsletterConfig>(`/orgs/${orgId}/newsletter/config`, body);
    }

    async triggerNewsletter() {
        return this.api.post<{ sent: boolean; message: string; items: number; recipients: number }>(`/orgs/${this.org.currentOrgId()}/newsletter/send`);
    }

    async sendTestEmail(email: string) {
        return this.api.post<{ message: string }>(`/orgs/${this.org.currentOrgId()}/newsletter/test`, { email });
    }

    /** Stimme abgeben; bei Einzelauswahl ersetzt sie die bisherige Stimme der Umfrage (der Server entscheidet). */
    async vote(optionId: string) {
        await this.api.put(this.pfad(`/options/${optionId}/vote`));
    }

    async unvote(optionId: string) {
        await this.api.delete(this.pfad(`/options/${optionId}/vote`));
    }

    async togglePin(id: string, isPinned: boolean) {
        await this.api.patch(this.pfad(`/${id}/pin`), { is_pinned: isPinned });
    }

    async markAsRead(id: string) {
        try {
            await this.api.put(this.pfad(`/${id}/read`));
        } catch (error) {
            console.error('Error marking as read:', error);
        }
    }
}

export interface NewsletterConfig {
    organization_id?: string;
    frequency: 'weekly' | 'monthly' | 'manual';
    day_of_week: number;
    time_of_day: string;
    last_sent_at?: string;
    active: boolean;
    // SMTP Settings
    smtp_host?: string;
    smtp_port?: number;
    smtp_user?: string;
    /** Nur schreibbar; leer lassen, um das gespeicherte Passwort zu behalten. */
    smtp_pass?: string;
    /** Ob ein SMTP-Passwort hinterlegt ist (das Passwort selbst wird nie geliefert). */
    smtp_pass_set?: boolean;
    smtp_from?: string;
    smtp_secure?: boolean;
    // Email Design
    logo_url?: string;
    footer_text?: string;
    primary_color?: string;
}
