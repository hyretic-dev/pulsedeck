import { Component, inject, signal, effect, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { EditorModule } from 'primeng/editor';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TabsModule } from 'primeng/tabs';
import { DataViewModule } from 'primeng/dataview';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { RadioButtonModule } from 'primeng/radiobutton';
import { ProgressBarModule } from 'primeng/progressbar';
import { FieldsetModule } from 'primeng/fieldset';
import { AuthService } from '../../../shared/services/auth.service';
import { PermissionsService } from '../../../shared/services/permissions.service';
import { FeedService, FeedItem, NewsletterConfig } from '../../../shared/services/feed.service';
import { NotificationService } from '../../../shared/services/notification.service';

import { RichTextRendererComponent } from '../../../shared/components/rich-text-renderer/rich-text-renderer.component';
import { WorkingGroupsService } from '../../../shared/services/working-groups.service';

@Component({
    selector: 'app-feed',
    standalone: true,
    imports: [
        CommonModule, FormsModule, DatePipe,
        ButtonModule, DialogModule, InputTextModule, EditorModule,
        SelectButtonModule, TabsModule, DataViewModule, CardModule,
        TagModule, ToastModule, TooltipModule,
        SelectModule, CheckboxModule, FieldsetModule,
        RadioButtonModule, ProgressBarModule, RichTextRendererComponent
    ],
    providers: [MessageService],
    templateUrl: './feed.html',
    styles: [`
    :host ::ng-deep .p-editor-content { height: 320px; }
    .scrollbar-hide::-webkit-scrollbar { display: none; }
    .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
  `]
})
export class FeedComponent {
    auth = inject(AuthService);
    permissions = inject(PermissionsService);
    feedService = inject(FeedService);
    messageService = inject(MessageService);
    notificationService = inject(NotificationService);

    // Permission-based visibility
    canCreate = this.permissions.canCreateFeed;
    canApprove = this.permissions.canApproveFeed;

    wgService = inject(WorkingGroupsService);
    workingGroups = this.wgService.workingGroups;

    // Filter
    selectedWorkingGroupFilter = signal<string | null>(null);

    feedItems = signal<FeedItem[]>([]);
    myItems = signal<FeedItem[]>([]);
    reviewItems = signal<FeedItem[]>([]);
    sentItems = signal<FeedItem[]>([]);

    filteredFeedItems = computed(() => {
        const filter = this.selectedWorkingGroupFilter();
        const items = this.feedItems();
        if (!filter) return items;
        return items.filter(i => i.working_group_id === filter);
    });

    // Admin View Switch
    adminView = signal<'review' | 'sent'>('review');
    adminViewOptions = [
        { label: 'Prüfung', value: 'review', icon: 'pi pi-list-check' },
        { label: 'Archiv', value: 'sent', icon: 'pi pi-history' }
    ];

    // Newsletter Config
    newsletterConfig = signal<NewsletterConfig | null>(null);
    days = [
        { label: 'Montag', value: 1 },
        { label: 'Dienstag', value: 2 },
        { label: 'Mittwoch', value: 3 },
        { label: 'Donnerstag', value: 4 },
        { label: 'Freitag', value: 5 },
        { label: 'Samstag', value: 6 },
        { label: 'Sonntag', value: 7 }
    ];
    frequencies = [
        { label: 'Wöchentlich', value: 'weekly' },
        { label: 'Monatlich', value: 'monthly' },
        { label: 'Manuell', value: 'manual' }
    ];

    // Dialog state
    dialogVisible = signal(false);
    editMode = signal(false);
    currentItem: Partial<FeedItem> = {};

    // Poll creation state
    pollOptions = signal<string[]>(['', '']); // Start with 2 empty options

    // Test Email Dialog
    testEmailDialogVisible = signal(false);
    testEmail = '';

    typeOptions: any[] = [
        { label: 'Artikel', value: 'article' },
        { label: 'Link', value: 'link' },
        { label: 'Umfrage', value: 'poll' }
    ];

    constructor() {
        effect(() => {
            if (this.auth.user()) {
                this.loadData();
            }
        });
    }

    loadData() {
        this.wgService.fetchWorkingGroups();
        this.loadFeed();
        if (this.auth.isMember()) this.loadMyItems();
        if (this.auth.isAdmin()) {
            this.loadReviewItems();
            this.loadNewsletterConfig();
            this.loadSentItems();
        }
    }

    async loadFeed() {
        try {
            const data = await this.feedService.getFeedItems();
            this.feedItems.set(data);
        } catch (e) { console.error(e); }
    }

    async loadMyItems() {
        try {
            const data = await this.feedService.getMyItems();
            this.myItems.set(data);
        } catch (e) { console.error(e); }
    }

    async loadReviewItems() {
        try {
            const data = await this.feedService.getReviewItems();
            this.reviewItems.set(data);
        } catch (e) { console.error(e); }
    }

    async loadSentItems() {
        try {
            const data = await this.feedService.getSentItems();
            this.sentItems.set(data);
        } catch (e) { console.error(e); }
    }

    async loadNewsletterConfig() {
        try {
            const cfg = await this.feedService.getNewsletterConfig();
            this.newsletterConfig.set(cfg);
        } catch (e) { console.error(e); }
    }

    async saveConfig() {
        if (!this.newsletterConfig()) return;
        try {
            await this.feedService.updateNewsletterConfig(this.newsletterConfig()!);
            this.messageService.add({ severity: 'success', summary: 'Einstellungen gespeichert' });
        } catch (e: any) { this.messageService.add({ severity: 'error', detail: e.message }); }
    }

    async triggerNewsletter() {
        try {
            await this.feedService.triggerNewsletter();
            this.messageService.add({ severity: 'success', summary: 'Newsletter Versand ausgelöst' });
            this.loadNewsletterConfig();
            this.loadFeed();
            this.loadSentItems();
        } catch (e: any) {
            if (e.message && (e.message.includes('not found') || e.message.includes('Function '))) {
                this.messageService.add({ severity: 'info', summary: 'Simulation', detail: 'Edge Function nicht deployed.' });
            } else {
                this.messageService.add({ severity: 'error', detail: e.message });
            }
        }
    }

    openTestEmailDialog() {
        this.testEmail = this.auth.user()?.email || '';
        this.testEmailDialogVisible.set(true);
    }

    async sendTest() {
        if (!this.testEmail) {
            this.messageService.add({ severity: 'warn', summary: 'Bitte E-Mail angeben' });
            return;
        }
        try {
            await this.feedService.sendTestEmail(this.testEmail);
            this.messageService.add({ severity: 'success', summary: 'Test gesendet', detail: `Vorschau an ${this.testEmail} gesendet.` });
            this.testEmailDialogVisible.set(false);
        } catch (e: any) {
            if (e.message && (e.message.includes('not found') || e.message.includes('Function '))) {
                this.messageService.add({ severity: 'info', summary: 'Simulation', detail: `Hätte an ${this.testEmail} gesendet.` });
                this.testEmailDialogVisible.set(false);
            } else {
                this.messageService.add({ severity: 'error', detail: e.message });
            }
        }
    }

    // Publish immediately state
    publishImmediately = signal(false);

    openNew() {
        this.currentItem = { type: 'article', status: 'draft', is_public: true };
        this.pollOptions.set(['', '']);
        this.editMode.set(false);
        this.publishImmediately.set(false);
        this.dialogVisible.set(true);
    }

    openEdit(item: FeedItem) {
        this.currentItem = { ...item };
        this.editMode.set(true);
        this.dialogVisible.set(true);
    }

    async saveItem() {
        if (!this.currentItem.title) {
            this.messageService.add({ severity: 'error', summary: 'Fehler', detail: 'Titel wird benötigt' });
            return;
        }

        // Security: Reset to review if editing approved/sent item without permission
        if (!this.canApprove() &&
            (this.currentItem.status === 'approved' || this.currentItem.status === 'sent')) {
            this.currentItem.status = 'review';
            this.messageService.add({
                severity: 'info',
                summary: 'Zur Prüfung',
                detail: 'Deine Änderungen müssen erneut freigegeben werden.'
            });
        }

        try {
            const payload = { ...this.currentItem };

            // Handle direct publishing for admins
            if (this.publishImmediately() && this.canApprove()) {
                payload.status = 'approved';
            }

            // Validate Poll
            if (payload.type === 'poll') {
                const validOptions = this.pollOptions().filter(o => o.trim().length > 0);
                if (validOptions.length < 2) {
                    this.messageService.add({ severity: 'error', summary: 'Fehler', detail: 'Mindestens 2 Optionen erforderlich' });
                    return;
                }
                // Pass options to service separately
                (payload as any).options = validOptions;
            }

            if (this.editMode() && this.currentItem.id) {
                await this.feedService.updateItem(this.currentItem.id, payload);
                this.messageService.add({ severity: 'success', summary: 'Gespeichert' });
            } else {
                await this.feedService.createItem(payload);
                this.messageService.add({ severity: 'success', summary: 'Erstellt' });
            }
            this.dialogVisible.set(false);
            this.loadData();
        } catch (e: any) {
            this.messageService.add({ severity: 'error', summary: 'Fehler', detail: e.message });
        }
    }

    async deleteItem(item: FeedItem) {
        if (!confirm('Wirklich löschen?')) return;
        try {
            await this.feedService.deleteItem(item.id!);
            this.messageService.add({ severity: 'info', summary: 'Gelöscht' });
            this.loadData();
        } catch (e: any) {
            this.messageService.add({ severity: 'error', summary: 'Fehler', detail: e.message });
        }
    }

    async submitForReview(item: FeedItem) {
        try {
            await this.feedService.updateItem(item.id!, { status: 'review' });
            this.loadData();
            this.messageService.add({ severity: 'success', summary: 'Zur Prüfung eingereicht' });
        } catch (e: any) { this.messageService.add({ severity: 'error', detail: e.message }) }
    }

    async approveItem(item: FeedItem) {
        try {
            await this.feedService.updateItem(item.id!, { status: 'approved' });
            this.loadData();
            this.messageService.add({ severity: 'success', summary: 'Freigegeben und veröffentlicht' });
        } catch (e: any) { this.messageService.add({ severity: 'error', detail: e.message }) }
    }

    getStatusSeverity(status: string) {
        switch (status) {
            case 'approved': return 'success';
            case 'sent': return 'info';
            case 'review': return 'warn';
            default: return 'secondary';
        }
    }

    async enableNotifications() {
        const granted = await this.notificationService.requestPermission();
        if (granted) {
            this.messageService.add({ severity: 'success', summary: 'Aktiviert', detail: 'Benachrichtigungen sind jetzt an. Du verpasst nichts mehr.' });
        } else {
            this.messageService.add({ severity: 'info', summary: 'Info', detail: 'Benachrichtigungen wurden nicht aktiviert.' });
        }
    }

    // Poll Helpers
    addPollOption() {
        this.pollOptions.update(opts => [...opts, '']);
    }

    removePollOption(index: number) {
        this.pollOptions.update(opts => opts.filter((_, i) => i !== index));
    }

    trackByIndex(index: number, obj: any): any {
        return index;
    }

    updatePollOption(index: number, value: string) {
        this.pollOptions.update(opts => {
            const newOpts = [...opts];
            newOpts[index] = value;
            return newOpts;
        });
    }

    hasVoted(item: FeedItem): boolean {
        const memberId = this.auth.currentMember()?.id;
        if (!memberId || !item.poll_options) return false;
        return item.poll_options.some(o => o.poll_votes?.some(v => v.member_id === memberId));
    }

    async vote(item: FeedItem, optionId: string) {
        if (this.hasVoted(item)) {
            // Maybe unvote? For now simplified: assume single choice, no change
            // BUT user might want to toggle.
            // If I clicked on an option I already voted for -> Unvote?
            // If I clicked on a different option -> Switch? (requires delete + insert)
            // Simple version: Unvote if clicking same. Switch if clicking different.

            // Check what I voted for
            const memberId = this.auth.currentMember()?.id;
            const existingOption = item.poll_options?.find(o => o.poll_votes?.some(v => v.member_id === memberId));

            if (existingOption) {
                if (existingOption.id === optionId) {
                    // Unvote
                    await this.feedService.unvote(optionId);
                } else {
                    // Switch: Unvote old, Vote new
                    await this.feedService.unvote(existingOption.id);
                    await this.feedService.vote(optionId);
                }
            }
        } else {
            await this.feedService.vote(optionId);
        }
        // Refresh
        this.loadData();
        // Optimization: Optimistically update UI? simpler to reload for now
    }

    getVotePercentage(item: FeedItem, optionId: string): number {
        if (!item.poll_options) return 0;
        const totalVotes = item.poll_options.reduce((acc, o) => acc + (o.poll_votes?.length || 0), 0);
        if (totalVotes === 0) return 0;

        const option = item.poll_options.find(o => o.id === optionId);
        if (!option) return 0;

        return Math.round(((option.poll_votes?.length || 0) / totalVotes) * 100);
    }

    getVoteCount(item: FeedItem, optionId: string): number {
        const option = item.poll_options?.find(o => o.id === optionId);
        return option?.poll_votes?.length || 0;
    }

    hasVotedFor(item: FeedItem, optionId: string): boolean {
        const memberId = this.auth.currentMember()?.id;
        if (!memberId) return false;
        const option = item.poll_options?.find(o => o.id === optionId);
        return option?.poll_votes?.some(v => v.member_id === memberId) || false;
    }

    getTotalVotes(item: FeedItem): number {
        if (!item.poll_options) return 0;
        return item.poll_options.reduce((acc, o) => acc + (o.poll_votes?.length || 0), 0);
    }

    getInitials(name: string | undefined): string {
        if (!name) {
            return '?';
        }
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
            const first = parts[0][0] || '';
            const second = parts[1][0] || '';
            return (first + second).toUpperCase();
        }
        return (parts[0]?.[0] || '?').toUpperCase();
    }
}

