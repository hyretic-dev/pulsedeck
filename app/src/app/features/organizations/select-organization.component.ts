import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

// Services
import { OrganizationService, Organization } from '../../shared/services/organization.service';
import { AuthService } from '../../shared/services/auth.service';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-select-organization',
    standalone: true,
    imports: [
        CommonModule,
        ButtonModule,
        ProgressSpinnerModule,
    ],
    template: `
        <div class="min-h-screen bg-[var(--color-surface)] flex items-center justify-center p-4">
            <div class="w-full max-w-lg">
                <!-- Header -->
                <div class="text-center mb-8">
                    <div class="w-16 h-16 mx-auto mb-4 rounded-xl bg-linke/10 flex items-center justify-center">
                        <i class="pi pi-sitemap text-3xl text-linke"></i>
                    </div>
                    <h1 class="text-2xl font-bold text-[var(--color-text)] mb-2">Organisation auswählen</h1>
                    <p class="text-[var(--color-text-muted)]">
                        Wähle eine Organisation oder erstelle eine neue
                    </p>
                </div>

                <!-- Loading -->
                @if (loading()) {
                <div class="flex justify-center py-8">
                    <p-progressSpinner strokeWidth="4" />
                </div>
                }

                <!-- Organizations List -->
                @if (!loading()) {
                <div class="space-y-3 mb-6">
                    @for (org of organizations(); track org.id) {
                    <button (click)="selectOrganization(org)"
                        class="w-full p-4 bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] hover:border-linke/50 transition-colors text-left group">
                        <div class="flex items-center gap-4">
                            <!-- Logo/Icon -->
                            <div class="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                                [style.background]="org.primary_color + '20'">
                                @if (org.logo_url) {
                                <img [src]="org.logo_url" alt="" class="w-8 h-8 object-contain" />
                                } @else {
                                <i class="pi pi-building text-xl" [style.color]="org.primary_color"></i>
                                }
                            </div>
                            
                            <!-- Info -->
                            <div class="flex-1 min-w-0">
                                <h3 class="font-semibold text-[var(--color-text)] group-hover:text-linke truncate">
                                    {{ org.name }}
                                </h3>
                                <p class="text-xs text-[var(--color-text-muted)]">
                                    pulsedeck.de/{{ org.slug }}
                                </p>
                            </div>

                            <!-- Arrow -->
                            <i class="pi pi-chevron-right text-[var(--color-text-muted)] group-hover:text-linke"></i>
                        </div>
                    </button>
                    } @empty {
                    <div class="text-center py-8 text-[var(--color-text-muted)]">
                        <i class="pi pi-inbox text-4xl mb-3"></i>
                        <p>Du bist noch keiner Organisation beigetreten.</p>
                    </div>
                    }
                </div>

                <!-- Create New Button -->
                <p-button label="Neue Organisation erstellen" icon="pi pi-plus"
                    (click)="createNew()" severity="danger" styleClass="w-full" />

                <!-- Logout -->
                <div class="text-center mt-6">
                    <button (click)="logout()" 
                        class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                        <i class="pi pi-sign-out mr-1"></i> Ausloggen
                    </button>
                </div>
                }
            </div>
        </div>
    `,
})
export class SelectOrganizationComponent {
    private orgService = inject(OrganizationService);
    private session = inject(SessionService);
    private auth = inject(AuthService);
    private router = inject(Router);

    organizations = signal<Organization[]>([]);
    loading = signal(true);
    private loaded = false;

    constructor() {
        // React to session changes
        effect(() => {
            if (this.session.istAngemeldet()) {
                if (!this.loaded) {
                    this.loaded = true;
                    this.loadOrganizations();
                }
            } else {
                this.router.navigate(['/login']);
            }
        });
    }

    async loadOrganizations(): Promise<void> {
        this.loading.set(true);

        const orgs = await this.orgService.getMyOrganizations();
        this.organizations.set(orgs);

        // Auto-redirect to last organization if available
        const lastOrgId = localStorage.getItem('last_org_id');
        const lastOrg = orgs.find((o) => o.id === lastOrgId);

        if (lastOrg) {
            this.router.navigate(['/', lastOrg.slug, 'dashboard']);
            return;
        }

        // Otherwise show the selection page
        this.loading.set(false);
    }

    selectOrganization(org: Organization): void {
        this.router.navigate(['/', org.slug, 'dashboard']);
    }

    createNew(): void {
        this.router.navigate(['/erstellen']);
    }

    async logout(): Promise<void> {
        await this.auth.signOut();
    }
}
