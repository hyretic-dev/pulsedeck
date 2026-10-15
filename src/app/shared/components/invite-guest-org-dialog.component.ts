import { 
    Component, 
    EventEmitter, 
    inject, 
    Input, 
    OnInit, 
    Output, 
    signal 
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ChipModule } from 'primeng/chip';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MessageModule } from 'primeng/message';

// Services
import { 
    GuestOrganizationService, 
    EventGuestOrganization 
} from '../services/guest-organization.service';

interface OrgSuggestion {
    id: string;
    name: string;
    slug: string;
    logo_url?: string;
}

/**
 * Dialog component for inviting guest organizations to an event.
 * Part of the "Viral Loop" feature - makes PulseDeck visible to other orgs.
 */
@Component({
    selector: 'app-invite-guest-org-dialog',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        DialogModule,
        ButtonModule,
        InputTextModule,
        AutoCompleteModule,
        ChipModule,
        TagModule,
        TooltipModule,
        MessageModule,
    ],
    template: `
        <p-dialog 
            [header]="'Gast-Organisation einladen'" 
            [(visible)]="visible" 
            [modal]="true"
            [style]="{width: '500px', maxWidth: '95vw'}"
            [dismissableMask]="true"
            [draggable]="false"
            (onHide)="onClose()">
            
            <div class="space-y-6">
                <!-- Info Box -->
                <p-message 
                    severity="info" 
                    text="Lade befreundete Vereine zu deinem Event ein! 
                          Sie sehen die Event-Details und können zusagen."
                    styleClass="w-full">
                </p-message>

                <!-- Existing Invitations -->
                @if (existingGuests().length > 0) {
                <div class="space-y-2">
                    <label class="text-sm font-bold text-[var(--color-text-muted)]">
                        Bereits eingeladen
                    </label>
                    <div class="flex flex-wrap gap-2">
                        @for (guest of existingGuests(); track guest.id) {
                        <p-chip 
                            [label]="guest.guest_organization?.name 
                                || guest.guest_org_name || 'Unbekannt'"
                            [removable]="true"
                            (onRemove)="removeGuest(guest)"
                            styleClass="bg-[var(--color-surface-ground)]">
                            <ng-template pTemplate="content">
                                <div class="flex items-center gap-2">
                                    @if (guest.guest_organization?.logo_url) {
                                    <img 
                                        [src]="guest.guest_organization?.logo_url" 
                                        class="w-5 h-5 rounded-full object-cover">
                                    } @else {
                                    <i class="pi pi-building text-xs"></i>
                                    }
                                    <span>{{ guest.guest_organization?.name 
                                        || guest.guest_org_name }}</span>
                                    <p-tag 
                                        [value]="getStatusLabel(guest.status)" 
                                        [severity]="getStatusSeverity(guest.status)"
                                        styleClass="text-xs ml-1">
                                    </p-tag>
                                </div>
                            </ng-template>
                        </p-chip>
                        }
                    </div>
                </div>
                }

                <!-- Search/Add Organization -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2 border-b 
                        border-[var(--color-border)] pb-4">
                        <button 
                            pButton 
                            [text]="true" 
                            [label]="'PulseDeck-Org'"
                            [severity]="mode() === 'search' ? 'primary' : 'secondary'"
                            (click)="mode.set('search')"
                            class="text-sm">
                        </button>
                        <span class="text-[var(--color-text-muted)]">|</span>
                        <button 
                            pButton 
                            [text]="true" 
                            [label]="'Externe Org'"
                            [severity]="mode() === 'external' ? 'primary' : 'secondary'"
                            (click)="mode.set('external')"
                            class="text-sm">
                        </button>
                    </div>

                    @if (mode() === 'search') {
                    <!-- Search existing PulseDeck organizations -->
                    <div class="space-y-2">
                        <label class="text-sm font-bold">
                            Organisation suchen
                        </label>
                        <p-autoComplete 
                            [(ngModel)]="selectedOrg"
                            [suggestions]="suggestions()"
                            (completeMethod)="searchOrgs($event)"
                            field="name"
                            [placeholder]="'Name eingeben...'"
                            [showEmptyMessage]="true"
                            emptyMessage="Keine Ergebnisse"
                            [dropdown]="false"
                            [forceSelection]="true"
                            styleClass="w-full">
                            <ng-template let-org pTemplate="item">
                                <div class="flex items-center gap-3 py-1">
                                    @if (org.logo_url) {
                                    <img 
                                        [src]="org.logo_url" 
                                        class="w-8 h-8 rounded-lg object-cover">
                                    } @else {
                                    <div class="w-8 h-8 rounded-lg bg-linke/10 
                                        flex items-center justify-center">
                                        <i class="pi pi-building text-linke"></i>
                                    </div>
                                    }
                                    <div>
                                        <div class="font-bold">{{ org.name }}</div>
                                        <div class="text-xs text-[var(--color-text-muted)]">
                                            pulsedeck.de/{{ org.slug }}
                                        </div>
                                    </div>
                                </div>
                            </ng-template>
                        </p-autoComplete>
                        <p class="text-xs text-[var(--color-text-muted)]">
                            Suche nach Vereinen, die bereits PulseDeck nutzen.
                        </p>
                    </div>
                    } @else {
                    <!-- External organization (not on PulseDeck) -->
                    <div class="space-y-4">
                        <div class="space-y-2">
                            <label class="text-sm font-bold">
                                Name der Organisation *
                            </label>
                            <input 
                                pInputText 
                                [(ngModel)]="externalOrgName" 
                                placeholder="z.B. RC Nachbarstadt"
                                class="w-full">
                        </div>
                        <div class="space-y-2">
                            <label class="text-sm font-bold">
                                E-Mail-Adresse *
                            </label>
                            <input 
                                pInputText 
                                type="email"
                                [(ngModel)]="externalOrgEmail" 
                                placeholder="vorstand@rc-nachbarstadt.de"
                                class="w-full">
                        </div>
                        <div class="space-y-2">
                            <label class="text-sm font-bold">
                                Ansprechpartner
                            </label>
                            <input 
                                pInputText 
                                [(ngModel)]="externalOrgContact" 
                                placeholder="Max Mustermann (optional)"
                                class="w-full">
                        </div>
                        <p-message 
                            severity="secondary"
                            styleClass="w-full text-xs">
                            <ng-template pTemplate="content">
                                <div class="flex items-start gap-2">
                                    <i class="pi pi-sparkles text-amber-500"></i>
                                    <span>
                                        Die Organisation erhält eine E-Mail mit 
                                        Event-Details und einer Einladung zu PulseDeck!
                                    </span>
                                </div>
                            </ng-template>
                        </p-message>
                    </div>
                    }
                </div>

                <!-- Error Message -->
                @if (guestService.error()) {
                <p-message 
                    severity="error" 
                    [text]="guestService.error()!"
                    styleClass="w-full">
                </p-message>
                }
            </div>

            <ng-template pTemplate="footer">
                <div class="flex justify-end gap-2">
                    <button 
                        pButton 
                        label="Abbrechen" 
                        [text]="true"
                        (click)="onClose()">
                    </button>
                    <button 
                        pButton 
                        label="Einladen" 
                        icon="pi pi-send"
                        [loading]="guestService.loading()"
                        [disabled]="!canSubmit()"
                        (click)="submit()">
                    </button>
                </div>
            </ng-template>
        </p-dialog>
    `,
})
export class InviteGuestOrgDialogComponent implements OnInit {
    @Input() visible = false;
    @Input() eventId!: string;
    @Output() visibleChange = new EventEmitter<boolean>();
    @Output() invited = new EventEmitter<void>();

    guestService = inject(GuestOrganizationService);

    mode = signal<'search' | 'external'>('search');
    suggestions = signal<OrgSuggestion[]>([]);
    existingGuests = signal<EventGuestOrganization[]>([]);

    // Search mode
    selectedOrg: OrgSuggestion | null = null;

    // External mode
    externalOrgName = '';
    externalOrgEmail = '';
    externalOrgContact = '';

    async ngOnInit(): Promise<void> {
        await this.loadExistingGuests();
    }

    async loadExistingGuests(): Promise<void> {
        if (!this.eventId) return;
        const guests = await this.guestService.getEventGuests(this.eventId);
        this.existingGuests.set(guests);
    }

    async searchOrgs(event: { query: string }): Promise<void> {
        const results = await this.guestService.searchOrganizations(event.query);
        this.suggestions.set(results);
    }

    canSubmit(): boolean {
        if (this.mode() === 'search') {
            return !!this.selectedOrg;
        }
        return !!(this.externalOrgName && this.externalOrgEmail);
    }

    async submit(): Promise<void> {
        let success = false;

        if (this.mode() === 'search' && this.selectedOrg) {
            success = await this.guestService.inviteGuest({
                event_id: this.eventId,
                guest_organization_id: this.selectedOrg.id,
            });
        } else if (this.mode() === 'external') {
            success = await this.guestService.inviteGuest({
                event_id: this.eventId,
                guest_org_name: this.externalOrgName,
                guest_org_email: this.externalOrgEmail,
                guest_org_contact_name: this.externalOrgContact || undefined,
            });
        }

        if (success) {
            this.selectedOrg = null;
            this.externalOrgName = '';
            this.externalOrgEmail = '';
            this.externalOrgContact = '';
            await this.loadExistingGuests();
            this.invited.emit();
        }
    }

    async removeGuest(guest: EventGuestOrganization): Promise<void> {
        await this.guestService.removeInvitation(guest.id, this.eventId);
        await this.loadExistingGuests();
    }

    getStatusLabel(status: string): string {
        const labels: Record<string, string> = {
            pending: 'Offen',
            accepted: 'Zugesagt',
            declined: 'Abgesagt',
        };
        return labels[status] || status;
    }

    getStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' {
        const map: Record<string, 'success' | 'warn' | 'danger' | 'info'> = {
            pending: 'warn',
            accepted: 'success',
            declined: 'danger',
        };
        return map[status] || 'info';
    }

    onClose(): void {
        this.visible = false;
        this.visibleChange.emit(false);
    }
}
