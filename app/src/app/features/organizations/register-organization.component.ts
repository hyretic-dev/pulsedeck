import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { environment } from '../../../environments/environment';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';
import { DividerModule } from 'primeng/divider';
import { StepsModule } from 'primeng/steps';

// Services
import { AuthService } from '../../shared/services/auth.service';
import { OrganizationService } from '../../shared/services/organization.service';

@Component({
    selector: 'app-register-organization',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterModule,
        ButtonModule,
        InputTextModule,
        PasswordModule,
        MessageModule,
        DividerModule,
        StepsModule,
    ],
    template: `
        <div class="min-h-screen bg-[var(--color-surface)] flex items-center justify-center p-4">
            <div class="w-full max-w-md">
                <!-- Header -->
                <div class="text-center mb-8">
                    <div class="w-16 h-16 mx-auto mb-4 rounded-xl bg-linke/10 flex items-center justify-center">
                        <i class="pi pi-building text-3xl text-linke"></i>
                    </div>
                    <h1 class="text-2xl font-bold text-[var(--color-text)] mb-2">Organisation gründen</h1>
                    <p class="text-[var(--color-text-muted)] text-sm">
                        Erstelle deine Organisation und lade dein Team ein
                    </p>
                </div>

                <!-- Step Indicator -->
                <div class="flex justify-center gap-2 mb-6">
                    <div class="w-3 h-3 rounded-full transition-colors"
                        [class.bg-linke]="step() === 1"
                        [class.bg-[var(--color-border)]]="step() !== 1"></div>
                    <div class="w-3 h-3 rounded-full transition-colors"
                        [class.bg-linke]="step() === 2"
                        [class.bg-[var(--color-border)]]="step() !== 2"></div>
                </div>

                <!-- Form Card -->
                <div class="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-6">
                    
                    <!-- Step 1: Account -->
                    @if (step() === 1) {
                    <div class="space-y-4">
                        <h2 class="text-lg font-semibold text-[var(--color-text)] mb-4">
                            1. Dein Account
                        </h2>

                        <div class="space-y-2">
                            <label class="text-sm font-medium text-[var(--color-text)]">Dein Name</label>
                            <input pInputText [(ngModel)]="userName" 
                                class="w-full" placeholder="Max Mustermann" />
                        </div>

                        <div class="space-y-2">
                            <label class="text-sm font-medium text-[var(--color-text)]">E-Mail</label>
                            <input pInputText [(ngModel)]="email" type="email"
                                class="w-full" placeholder="max@example.de" />
                        </div>

                        @if (mitPasswort()) {
                        <div class="space-y-2">
                            <label for="registrieren-passwort" class="text-sm font-medium text-[var(--color-text)]">Passwort</label>
                            <p-password [(ngModel)]="password" [feedback]="true" [toggleMask]="true"
                                inputId="registrieren-passwort"
                                styleClass="w-full" inputStyleClass="w-full"
                                placeholder="Mindestens 8 Zeichen" />
                            <button type="button" (click)="mitPasswort.set(false); password = ''"
                                class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline">
                                Doch lieber ohne Passwort
                            </button>
                        </div>
                        } @else {
                        <div class="rounded-lg border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">
                            <i class="pi pi-envelope mr-1"></i>
                            Kein Passwort nötig: Du meldest dich mit einem Link per E-Mail an.
                            <button type="button" (click)="mitPasswort.set(true)"
                                class="block mt-1 text-[var(--color-text)] underline">
                                Lieber ein Passwort festlegen
                            </button>
                        </div>
                        }

                        <div class="mt-4">
                            <p-button label="Weiter" icon="pi pi-arrow-right" iconPos="right"
                                (click)="nextStep()" [disabled]="!canProceedStep1()"
                                styleClass="w-full" severity="danger" />
                        </div>
                    </div>
                    }

                    <!-- Step 2: Organization -->
                    @if (step() === 2) {
                    <div class="space-y-4">
                        <h2 class="text-lg font-semibold text-[var(--color-text)] mb-4">
                            2. Deine Organisation
                        </h2>

                        <div class="space-y-2">
                            <label class="text-sm font-medium text-[var(--color-text)]">Name der Organisation</label>
                            <input pInputText [(ngModel)]="orgName" (ngModelChange)="generateSlug()"
                                class="w-full" placeholder="z.B. Verein Musterstadt e.V." />
                        </div>

                        <div class="space-y-2">
                            <label class="text-sm font-medium text-[var(--color-text)]">URL</label>
                            <div class="flex items-center gap-2">
                                <span class="text-sm text-[var(--color-text-muted)]">{{ appHost }}/</span>
                                <input pInputText [(ngModel)]="slug" (blur)="checkSlug()"
                                    class="flex-1" placeholder="mein-verein" />
                            </div>
                            @if (slugAvailable === true) {
                            <p class="text-xs text-teal flex items-center gap-1">
                                <i class="pi pi-check"></i> Verfügbar
                            </p>
                            }
                            @if (slugAvailable === false) {
                            <p class="text-xs text-red-400 flex items-center gap-1">
                                <i class="pi pi-times"></i> Bereits vergeben
                            </p>
                            }
                        </div>

                        @if (gesendet()) {
                        <p-message severity="success" styleClass="w-full"
                            text="Fast geschafft: Wir haben dir einen Link geschickt. Bitte bestätige damit deine E-Mail-Adresse, danach wird deine Organisation automatisch erstellt." />
                        }
                        @if (error()) {
                        <p-message severity="error" [text]="error()!" styleClass="w-full" />
                        }

                        <div class="flex gap-2 mt-4">
                            <p-button label="Zurück" [text]="true" severity="secondary"
                                (click)="prevStep()" styleClass="flex-1" />
                            <p-button label="Organisation erstellen" icon="pi pi-check"
                                (click)="createAll()" [disabled]="!canSubmit()" [loading]="loading()"
                                styleClass="flex-1" severity="danger" />
                        </div>
                    </div>
                    }


                </div>

                <!-- Back Link -->
                <div class="text-center mt-4">
                    <a [href]="websiteUrl" 
                        class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                        <i class="pi pi-arrow-left mr-1"></i> Zurück zur Startseite
                    </a>
                </div>
            </div>
        </div>
    `,
})
export class RegisterOrganizationComponent {
    /** Produktseite; liegt auf der Website. */
    readonly websiteUrl = environment.websiteUrl;
    private auth = inject(AuthService);
    private orgService = inject(OrganizationService);
    private router = inject(Router);

    // Step state
    step = signal(1);
    loading = signal(false);
    error = signal<string | null>(null);
    /** Bestätigungs-Mail ist unterwegs */
    gesendet = signal(false);

    // Step 1: Account
    userName = '';
    email = '';
    password = '';
    /** Passwort ist optional; ohne Passwort erfolgt die Anmeldung per Magic Link. */
    mitPasswort = signal(false);
    /** Adresse der öffentlichen Seite der Organisation (<host>/<slug>) */
    readonly appHost = window.location.host;

    // Step 2: Organization
    orgName = '';
    slug = '';
    slugAvailable: boolean | null = null;

    canProceedStep1(): boolean {
        return (
            this.userName.trim().length >= 2 &&
            this.email.includes('@') &&
            (!this.mitPasswort() || this.password.length >= 8)
        );
    }

    nextStep(): void {
        if (this.canProceedStep1()) {
            this.step.set(2);
        }
    }

    prevStep(): void {
        this.step.set(1);
    }

    generateSlug(): void {
        if (!this.slug || this.slug === this.slugify(this.orgName.slice(0, -1))) {
            this.slug = this.slugify(this.orgName);
            this.slugAvailable = null;
        }
    }

    slugify(text: string): string {
        return text
            .toLowerCase()
            .replace(/ä/g, 'ae')
            .replace(/ö/g, 'oe')
            .replace(/ü/g, 'ue')
            .replace(/ß/g, 'ss')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 50);
    }

    async checkSlug(): Promise<void> {
        if (this.slug.length < 3) {
            this.slugAvailable = null;
            return;
        }

        try {
            this.slugAvailable = await this.orgService.isSlugAvailable(this.slug);
        } catch {
            this.slugAvailable = null;
        }
    }

    canSubmit(): boolean {
        return (
            this.canProceedStep1() &&
            this.orgName.trim().length >= 3 &&
            this.slug.length >= 3 &&
            this.slugAvailable === true &&
            !this.loading() &&
            !this.gesendet()
        );
    }

    async createAll(): Promise<void> {
        if (!this.canSubmit()) return;

        this.loading.set(true);
        this.error.set(null);

        try {
            // 1. Konto anlegen: Die E-Mail-Adresse muss per Link bestätigt werden, bevor die Anmeldung möglich ist
            const { error: authError } = await this.auth.signUp(this.email, this.mitPasswort() ? this.password : undefined);
            if (authError) throw new Error(authError.message);

            // 2. Organisation nach der Bestätigung automatisch anlegen (Auth-Callback bzw. erste Anmeldung)
            this.savePendingOrganization();
            this.gesendet.set(true);
        } catch (e) {
            this.error.set((e as Error).message);
        }

        this.loading.set(false);
    }

    /**
     * Store pending org data in localStorage for
     * creation after email confirmation.
     */
    private savePendingOrganization(): void {
        localStorage.setItem(
            'pendingOrganization',
            JSON.stringify({
                orgName: this.orgName.trim(),
                slug: this.slug,
                userName: this.userName.trim(),
                email: this.email.trim().toLowerCase(),
            })
        );
    }
}
