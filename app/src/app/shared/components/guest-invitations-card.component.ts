import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

// Services
import { 
    GuestOrganizationService, 
    EventGuestOrganization 
} from '../services/guest-organization.service';

/**
 * Card component showing pending event invitations from other organizations.
 * Displays on the dashboard when another org has invited this org to an event.
 */
@Component({
    selector: 'app-guest-invitations-card',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        ButtonModule,
        CardModule,
        TagModule,
        TooltipModule,
    ],
    template: `
        @if (invitations().length > 0) {
        <div class="bg-[var(--color-surface-card)] rounded-2xl border 
            border-[var(--color-border)] shadow-sm overflow-hidden">
            
            <!-- Header -->
            <div class="px-5 py-4 border-b border-[var(--color-border)] 
                bg-gradient-to-r from-amber-500/10 to-transparent">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-amber-500/20 
                        flex items-center justify-center">
                        <i class="pi pi-envelope text-amber-500 text-lg"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-[var(--color-text)]">
                            Event-Einladungen
                        </h3>
                        <p class="text-xs text-[var(--color-text-muted)]">
                            {{ invitations().length }} offene Einladung(en)
                        </p>
                    </div>
                </div>
            </div>

            <!-- Invitations List -->
            <div class="divide-y divide-[var(--color-border)]">
                @for (inv of invitations(); track inv.id) {
                <div class="p-4 hover:bg-[var(--color-surface-hover)] 
                    transition-colors">
                    <div class="flex items-start gap-4">
                        <!-- Host Org Logo -->
                        <div class="shrink-0">
                            @if (inv.host_organization?.logo_url) {
                            <img 
                                [src]="inv.host_organization?.logo_url" 
                                class="w-12 h-12 rounded-xl object-cover border 
                                    border-[var(--color-border)]">
                            } @else {
                            <div class="w-12 h-12 rounded-xl bg-linke/10 
                                flex items-center justify-center">
                                <i class="pi pi-building text-linke text-xl"></i>
                            </div>
                            }
                        </div>

                        <!-- Content -->
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="font-bold text-[var(--color-text)]">
                                    {{ inv.host_organization?.name || 'Organisation' }}
                                </span>
                                <span class="text-xs text-[var(--color-text-muted)]">
                                    lädt euch ein zu:
                                </span>
                            </div>
                            <h4 class="font-bold text-lg text-linke mb-1">
                                {{ inv.event?.title || 'Event' }}
                            </h4>
                            <div class="flex items-center gap-4 text-sm 
                                text-[var(--color-text-muted)]">
                                <span class="flex items-center gap-1">
                                    <i class="pi pi-calendar text-xs"></i>
                                    {{ formatDate(inv.event?.date) }}
                                </span>
                                <span class="flex items-center gap-1">
                                    <i class="pi pi-clock text-xs"></i>
                                    Eingeladen {{ formatRelative(inv.invited_at) }}
                                </span>
                            </div>
                        </div>

                        <!-- Actions -->
                        <div class="flex gap-2 shrink-0">
                            <button 
                                pButton 
                                icon="pi pi-times" 
                                [rounded]="true"
                                [text]="true"
                                severity="secondary"
                                pTooltip="Ablehnen"
                                [loading]="respondingTo() === inv.id + 'decline'"
                                (click)="respond(inv, 'declined')">
                            </button>
                            <button 
                                pButton 
                                icon="pi pi-check" 
                                label="Zusagen"
                                severity="success"
                                [loading]="respondingTo() === inv.id + 'accept'"
                                (click)="respond(inv, 'accepted')">
                            </button>
                        </div>
                    </div>
                </div>
                }
            </div>

            <!-- Powered by Footer -->
            <div class="px-4 py-2 bg-[var(--color-surface-ground)] 
                text-center border-t border-[var(--color-border)]">
                <a href="https://pulsedeck.de" target="_blank" 
                    class="text-xs text-[var(--color-text-muted)] 
                    hover:text-linke transition-colors">
                    <i class="pi pi-sparkles text-amber-500 mr-1"></i>
                    Powered by <span class="font-bold">PulseDeck</span>
                </a>
            </div>
        </div>
        }
    `,
})
export class GuestInvitationsCardComponent implements OnInit {
    private guestService = inject(GuestOrganizationService);

    invitations = signal<EventGuestOrganization[]>([]);
    respondingTo = signal<string | null>(null);

    async ngOnInit(): Promise<void> {
        await this.loadInvitations();
    }

    async loadInvitations(): Promise<void> {
        const data = await this.guestService.getPendingInvitations();
        this.invitations.set(data);
    }

    async respond(
        inv: EventGuestOrganization, 
        response: 'accepted' | 'declined'
    ): Promise<void> {
        this.respondingTo.set(inv.id + (response === 'accepted' ? 'accept' : 'decline'));
        
        await this.guestService.respondToInvitation(inv.id, response);
        await this.loadInvitations();
        
        this.respondingTo.set(null);
    }

    formatDate(dateStr?: string): string {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('de-DE', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    }

    formatRelative(dateStr?: string): string {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        const now = new Date();
        const diffDays = Math.floor(
            (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        if (diffDays === 0) return 'heute';
        if (diffDays === 1) return 'gestern';
        if (diffDays < 7) return `vor ${diffDays} Tagen`;
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
    }
}
