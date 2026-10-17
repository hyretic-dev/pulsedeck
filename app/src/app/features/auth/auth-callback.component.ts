import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService, UserMembership } from '../../shared/services/auth.service';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

@Component({
    selector: 'app-auth-callback',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        InputTextModule,
        PasswordModule,
        MessageModule,
        ProgressSpinnerModule
    ],
    template: `
        <div class="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4">
            <div class="max-w-md w-full">
                <!-- Processing State -->
                @if (processing()) {
                    <div class="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl p-8 text-center">
                        <p-progressSpinner strokeWidth="4" ariaLabel="Verarbeite..." />
                        <p class="text-[var(--color-text-muted)] mt-4">{{ statusMessage() }}</p>
                    </div>
                }

                <!-- Error State -->
                @if (error()) {
                    <div class="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl p-8">
                        <div class="text-center mb-6">
                            <div class="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                                <i class="pi pi-times text-red-500 text-3xl"></i>
                            </div>
                            <h1 class="text-2xl font-bold text-[var(--color-text)] mb-2">Fehler</h1>
                            <p class="text-[var(--color-text-muted)]">{{ error() }}</p>
                        </div>
                        <p-button 
                            label="Zur Startseite" 
                            icon="pi pi-arrow-left" 
                            styleClass="w-full"
                            (click)="goHome()">
                        </p-button>
                    </div>
                }

                <!-- Set Password State -->
                @if (showPasswordForm()) {
                    <div class="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl p-8">
                        <div class="text-center mb-6">
                            <div class="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                                <i class="pi pi-lock text-green-500 text-3xl"></i>
                            </div>
                            <h1 class="text-2xl font-bold text-[var(--color-text)] mb-2">Willkommen!</h1>
                            <p class="text-[var(--color-text-muted)]">Bitte lege ein Passwort für deinen Account fest.</p>
                        </div>

                        <div class="space-y-4">
                            <div>
                                <label class="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Neues Passwort</label>
                                <p-password 
                                    [(ngModel)]="password" 
                                    [toggleMask]="true"
                                    [feedback]="true"
                                    styleClass="w-full"
                                    inputStyleClass="w-full"
                                    placeholder="Mindestens 8 Zeichen">
                                </p-password>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Passwort bestätigen</label>
                                <p-password 
                                    [(ngModel)]="confirmPassword" 
                                    [toggleMask]="true"
                                    [feedback]="false"
                                    styleClass="w-full"
                                    inputStyleClass="w-full"
                                    placeholder="Passwort wiederholen">
                                </p-password>
                            </div>

                            @if (passwordError()) {
                                <p-message severity="error" [text]="passwordError()!" styleClass="w-full"></p-message>
                            }

                            <p-button 
                                label="Passwort setzen" 
                                icon="pi pi-check" 
                                styleClass="w-full mt-4"
                                [loading]="saving()"
                                (click)="setPassword()">
                            </p-button>
                            @if (passwordMode() === 'invite') {
                                <p-button
                                    label="Später festlegen"
                                    severity="secondary"
                                    [text]="true"
                                    styleClass="w-full"
                                    (click)="skipPassword()">
                                </p-button>
                            }
                        </div>
                    </div>
                }

                <!-- Organization Selector (Multi-Org) -->
                @if (showOrgSelector()) {
                    <div class="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl p-8">
                        <div class="text-center mb-6">
                            <div class="w-16 h-16 rounded-full bg-teal-500/20 flex items-center justify-center mx-auto mb-4">
                                <i class="pi pi-building text-teal-500 text-3xl"></i>
                            </div>
                            <h1 class="text-2xl font-bold text-[var(--color-text)] mb-2">Willkommen zurück!</h1>
                            <p class="text-[var(--color-text-muted)]">Wähle die Organisation, zu der du möchtest:</p>
                        </div>

                        <div class="space-y-3">
                            @for (membership of memberships(); track membership.organizationId) {
                                <button 
                                    (click)="selectOrganization(membership)"
                                    class="w-full p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-ground)] hover:bg-[var(--color-surface-overlay)] hover:border-teal-500 transition-all flex items-center gap-4 text-left group">
                                    <div class="w-12 h-12 rounded-xl bg-teal-500/10 flex items-center justify-center group-hover:bg-teal-500/20 transition-colors">
                                        <i class="pi pi-building text-teal-500 text-xl"></i>
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <div class="font-bold text-[var(--color-text)] truncate">{{ membership.organizationName }}</div>
                                        <div class="text-xs text-[var(--color-text-muted)]">{{ membership.memberName }} • {{ getRoleLabel(membership.appRole) }}</div>
                                    </div>
                                    <i class="pi pi-arrow-right text-[var(--color-text-muted)] group-hover:text-teal-500 transition-colors"></i>
                                </button>
                            }
                        </div>
                    </div>
                }

                <!-- Success State -->
                @if (success()) {
                    <div class="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl p-8 text-center">
                        <div class="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                            <i class="pi pi-check text-green-500 text-3xl"></i>
                        </div>
                        <h1 class="text-2xl font-bold text-[var(--color-text)] mb-2">Erfolgreich!</h1>
                        <p class="text-[var(--color-text-muted)] mb-6">Du wirst jetzt weitergeleitet...</p>
                        <p-progressSpinner strokeWidth="4" ariaLabel="Weiterleitung..." />
                    </div>
                }
            </div>
        </div>
    `,
})
export class AuthCallbackComponent implements OnInit {
    private auth = inject(AuthService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    processing = signal(true);
    showPasswordForm = signal(false);
    showOrgSelector = signal(false);
    success = signal(false);
    error = signal<string | null>(null);
    statusMessage = signal('Überprüfe Einladung...');

    memberships = signal<UserMembership[]>([]);

    password = '';
    confirmPassword = '';
    passwordError = signal<string | null>(null);
    saving = signal(false);

    /** reset = Passwort-Reset (Pflicht), invite = Einladung/Magic-Link ohne bisheriges Passwort (freiwillig) */
    passwordMode = signal<'reset' | 'invite'>('invite');
    private resetToken: string | null = null;

    async ngOnInit() {
        // Der Token ist ein Zugangsdatum: sofort aus Adresszeile und Verlauf entfernen, bevor etwas anderes passiert
        const params = this.route.snapshot.queryParams;
        const type = params['type'] as string | undefined;
        const token = params['token'] as string | undefined;
        if (token) window.history.replaceState(window.history.state, '', window.location.pathname);

        if (!type || !token || !['verify', 'magic', 'reset'].includes(type)) {
            this.processing.set(false);
            this.error.set('Kein gültiger Link. Bitte fordere einen neuen Link an.');
            return;
        }

        try {
            if (type === 'reset') {
                // Das neue Passwort wird beim Einlösen mitgesendet: erst abfragen
                this.resetToken = token;
                this.passwordMode.set('reset');
                this.processing.set(false);
                this.showPasswordForm.set(true);
                return;
            }

            this.statusMessage.set('Verifiziere Link...');
            if (type === 'verify') await this.auth.verifyEmail(token);
            else await this.auth.consumeMagicLink(token);
            await this.auth.whenReady();

            // Eingeladene Konten haben noch kein Passwort: freiwillig anbieten
            if (this.auth.account()?.hasPassword === false) {
                this.processing.set(false);
                this.passwordMode.set('invite');
                this.showPasswordForm.set(true);
            } else {
                await this.handleRedirect();
            }
        } catch (e) {
            this.processing.set(false);
            this.error.set(
                (e as { status?: number }).status === 401
                    ? 'Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.'
                    : (e as Error).message
            );
        }
    }

    async setPassword() {
        this.passwordError.set(null);

        if (this.password.length < 8) {
            this.passwordError.set('Das Passwort muss mindestens 8 Zeichen lang sein.');
            return;
        }

        if (this.password !== this.confirmPassword) {
            this.passwordError.set('Die Passwörter stimmen nicht überein.');
            return;
        }

        this.saving.set(true);

        try {
            if (this.passwordMode() === 'reset' && this.resetToken) {
                await this.auth.resetPassword(this.resetToken, this.password);
                this.resetToken = null;
            } else {
                await this.auth.setPassword(this.password);
            }
            await this.auth.whenReady();

            this.showPasswordForm.set(false);
            await this.handleRedirect();
        } catch (e) {
            this.passwordError.set(
                (e as { status?: number }).status === 401 && this.passwordMode() === 'reset'
                    ? 'Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.'
                    : (e as Error).message
            );
            this.saving.set(false);
        }
    }

    async skipPassword() {
        this.showPasswordForm.set(false);
        await this.handleRedirect();
    }

    /**
     * Handle redirect after successful auth.
     * Checks for pending organization from registration
     * flow, then falls back to membership-based routing.
     */
    private async handleRedirect() {
        this.processing.set(true);

        // Bei der Registrierung vorgemerkte Organisation jetzt anlegen
        this.statusMessage.set('Prüfe Organisation...');
        const neueOrg = await this.auth.legeAusstehendeOrganisationAn();
        if (neueOrg) {
            this.processing.set(false);
            this.success.set(true);
            setTimeout(() => this.router.navigate(['/', neueOrg, 'dashboard']), 1500);
            return;
        }

        this.statusMessage.set('Lade Mitgliedschaften...');
        await this.auth.refreshMember();

        const userMemberships = this.auth.userMemberships();

        if (userMemberships.length === 0) {
            this.processing.set(false);
            this.error.set(
                'Kein Mitgliedsprofil gefunden. '
                + 'Bitte registriere dich erneut oder '
                + 'wende dich an den Vorstand.'
            );
            return;
        }

        if (userMemberships.length === 1) {
            // Single org - redirect directly
            const org = userMemberships[0];
            await this.auth.setActiveOrganization(org.organizationId);
            this.processing.set(false);
            this.success.set(true);
            setTimeout(() => {
                this.router.navigate(['/', org.organizationSlug, 'dashboard']);
            }, 1500);
        } else {
            // Multiple orgs - show selector
            this.memberships.set(userMemberships);
            this.processing.set(false);
            this.showOrgSelector.set(true);
        }
    }

    /**
     * User selected an organization from the
     * multi-org selector.
     */
    async selectOrganization(
        membership: UserMembership
    ) {
        this.showOrgSelector.set(false);
        this.processing.set(true);
        this.statusMessage.set(
            `Wechsle zu ${membership.organizationName}...`
        );

        await this.auth.setActiveOrganization(
            membership.organizationId
        );

        this.processing.set(false);
        this.success.set(true);

        setTimeout(() => {
            this.router.navigate([
                '/',
                membership.organizationSlug,
                'dashboard'
            ]);
        }, 1500);
    }

    getRoleLabel(role: string): string {
        const labels: Record<string, string> = {
            'admin': 'Administrator',
            'committee': 'Vorstand',
            'member': 'Mitglied',
            'public': 'Öffentlich'
        };
        return labels[role] || role;
    }

    goHome() {
        this.router.navigate(['/']);
    }
}
