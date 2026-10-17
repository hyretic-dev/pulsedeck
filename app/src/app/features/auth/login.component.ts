import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';
import { AuthService, LoginCheckResult } from '../../shared/services/auth.service';
import { PulseLogoComponent } from '../../shared/components/pulse-logo.component';

type LoginStep = 'email' | 'password' | 'invitation-sent' | 'not-found';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    PulseLogoComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    ButtonModule,
    InputTextModule,
    PasswordModule,
    MessageModule,
  ],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-[var(--color-bg)] px-4">
      <!-- Subtle Background Gradient -->
      <div class="fixed inset-0 z-0 opacity-40">
         <div class="absolute top-0 left-1/4 w-96 h-96 rounded-full bg-linke/10 blur-[150px]"></div>
         <div class="absolute bottom-0 right-1/4 w-80 h-80 rounded-full bg-linke-dark/10 blur-[150px]"></div>
      </div>

      <div class="relative z-10 w-full max-w-sm">
        <!-- Card -->
        <div class="bg-[var(--color-surface-raised)] backdrop-blur-xl border border-[var(--color-border)] rounded-2xl p-8 shadow-2xl">
          
          <!-- Logo & Header -->
          <div class="flex flex-col items-center mb-8">
            <div class="mb-4 rounded-2xl shadow-lg shadow-linke/20 ring-4 ring-linke/5">
              <app-pulse-logo [groesse]="64" />
            </div>
            <h1 class="text-2xl font-bold text-[var(--color-text)] mb-1">PulseDeck</h1>
            <p class="text-[var(--color-text-muted)] text-sm">Melde dich an, um fortzufahren</p>
          </div>

          <!-- Step 1: Email -->
          @if (step() === 'email') {
            <form (submit)="checkEmail()" class="space-y-6 animate-fadein">
              <div class="space-y-2">
                <label class="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">E-Mail Adresse</label>
                <div class="relative w-full">
                  <i class="pi pi-envelope absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"></i>
                  <input pInputText type="email" [(ngModel)]="email" name="email" 
                    class="w-full !pl-10 !bg-[var(--color-surface)] !border-[var(--color-border)] focus:!border-linke !text-[var(--color-text)] !py-3 !text-sm !rounded-xl transition-all" 
                    placeholder="name@beispiel.de" required [disabled]="loading()">
                </div>
              </div>

              @if (error()) {
                <div class="text-red-500 text-sm flex items-center gap-2 bg-red-500/10 p-3 rounded-xl border border-red-500/20">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ error() }}</span>
                </div>
              }

              <p-button type="submit" label="Weiter" [loading]="loading()" icon="pi pi-arrow-right" iconPos="right"
                styleClass="w-full !py-3 !mt-4" severity="danger" [raised]="true"></p-button>
            </form>
          }

          <!-- Step 2: Password -->
          @if (step() === 'password') {
            <div class="space-y-6 animate-fadein">
              
              <!-- User Info Badge -->
              <div class="flex items-center justify-between p-4 rounded-xl bg-[var(--color-surface-ground)] border border-[var(--color-border)]">
                 <div class="flex items-center gap-4 overflow-hidden">
                    <div class="w-10 h-10 rounded-full bg-[var(--color-surface)] flex flex-shrink-0 items-center justify-center border border-[var(--color-border)] ring-2 ring-white/5">
                      <span class="font-bold text-sm">{{ email.charAt(0).toUpperCase() }}</span>
                    </div>
                    <div class="flex flex-col min-w-0">
                       <span class="text-xs font-bold truncate">{{ email }}</span>
                       <span class="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">{{ memberName() || 'Mitglied' }}</span>
                    </div>
                 </div>
                 <button (click)="resetToEmail()" class="text-xs text-linke hover:underline font-bold flex-shrink-0 ml-2">Ändern</button>
              </div>

              <form (submit)="onLogin()" class="space-y-6">
                <div class="space-y-2">
                  <div class="flex justify-between items-center mb-1">
                    <label class="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Passwort</label>
                    <button type="button" (click)="requestPasswordReset()" class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">Vergessen?</button>
                  </div>
                  <p-password [(ngModel)]="password" name="password" [feedback]="false" [toggleMask]="true" 
                    styleClass="w-full" 
                    inputStyleClass="w-full !bg-[var(--color-surface)] !border-[var(--color-border)] focus:!border-linke !text-[var(--color-text)] !py-3 !text-sm !rounded-xl transition-all" 
                    placeholder="••••••••" [disabled]="loading()" [autofocus]="true"></p-password>
                </div>

                @if (error()) {
                  <div class="text-red-500 text-sm flex items-center gap-2 bg-red-500/10 p-3 rounded-xl border border-red-500/20 animate-shake">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ error() }}</span>
                  </div>
                }

                <p-button type="submit" label="Anmelden" [loading]="loading()" 
                  styleClass="w-full !py-3 !mt-6" severity="danger" [raised]="true"></p-button>
              </form>

              <!-- Magic Link Option -->
              <div class="relative">
                <div class="absolute inset-0 flex items-center">
                  <div class="w-full border-t border-[var(--color-border)]"></div>
                </div>
                <div class="relative flex justify-center text-xs">
                  <span class="bg-[var(--color-surface-raised)] px-3 text-[var(--color-text-muted)]">oder</span>
                </div>
              </div>

              <button type="button" (click)="sendMagicLink()" 
                class="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-ground)] hover:bg-[var(--color-surface-overlay)] text-[var(--color-text)] text-sm transition-colors"
                [disabled]="loading()">
                <i class="pi pi-envelope"></i>
                <span>Login-Link per E-Mail</span>
              </button>
              <p class="text-[10px] text-center text-[var(--color-text-muted)]">
                Kein Passwort? Wir senden dir einen Login-Link.
              </p>
            </div>
          }

          <!-- Step 3: Invitation Sent -->
          @if (step() === 'invitation-sent') {
             <div class="text-center space-y-5 animate-fadein py-4">
                <div class="w-16 h-16 mx-auto rounded-full bg-green-500/10 flex items-center justify-center ring-4 ring-green-500/5">
                   <i class="pi pi-envelope text-2xl text-green-500"></i>
                </div>
                <div>
                   <h3 class="text-lg font-bold text-[var(--color-text)]">Link gesendet!</h3>
                   <p class="text-sm text-[var(--color-text-muted)] mt-2">
                      Ein Login-Link wurde an <br> <strong class="text-[var(--color-text)]">{{ email }}</strong> gesendet.
                   </p>
                </div>
                <p-button (onClick)="resetToEmail()" label="Zurück zum Login" styleClass="w-full" severity="secondary" [outlined]="true"></p-button>
             </div>
          }

          <!-- Step 4: Not Found -->
          @if (step() === 'not-found') {
             <div class="text-center space-y-5 animate-fadein py-4">
                <div class="w-16 h-16 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center ring-4 ring-amber-500/5">
                   <i class="pi pi-user-minus text-2xl text-amber-500"></i>
                </div>
                <div>
                   <h3 class="text-lg font-bold text-[var(--color-text)]">Unbekannte E-Mail</h3>
                   <p class="text-sm text-[var(--color-text-muted)] mt-2">
                      Kein Mitglied mit der E-Mail <strong class="text-[var(--color-text)]">{{ email }}</strong> gefunden.
                   </p>
                </div>
                <p-button (onClick)="resetToEmail()" label="Eingabe korrigieren" styleClass="w-full" severity="secondary" [outlined]="true"></p-button>
             </div>
          }

          <div class="mt-6 pt-4 border-t border-[var(--color-border)] text-center">
            @if(step() === 'email') {
              <p class="text-xs text-[var(--color-text-muted)] mb-3">Noch kein Zugang? Bitte wende dich an den Vorstand.</p>
            }
            <a (click)="goBack()" class="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-linke transition-colors cursor-pointer">
              <i class="pi pi-arrow-left text-[10px]"></i>
              Zurück
            </a>
          </div>

        </div>
      </div>
    </div>
  `
})
export class LoginComponent {
  auth = inject(AuthService);
  router = inject(Router);
  route = inject(ActivatedRoute);

  step = signal<LoginStep>('email');
  email = '';
  password = '';
  loading = signal(false);
  error = signal('');
  memberName = signal<string | null>(null);

  async checkEmail() {
    if (!this.email) return;

    this.loading.set(true);
    this.error.set('');

    try {
      const result = await this.auth.checkEmail(this.email.trim());

      this.loading.set(false);

      if (result.status === 'connected') {
        this.step.set('password');
        this.memberName.set(result.memberName || null);
      } else if (result.status === 'invitation_sent') {
        this.step.set('invitation-sent');
      } else if (result.status === 'not_found') {
        this.step.set('not-found');
      } else {
        this.error.set(result.error || 'Ein Fehler ist aufgetreten.');
      }
    } catch (e) {
      this.loading.set(false);
      this.error.set('Verbindungsfehler. Bitte prüfen Sie Ihre Internetverbindung.');
    }
  }

  async onLogin() {
    if (!this.password) return;

    this.loading.set(true);
    this.error.set('');

    try {
      // Use existing login method
      const { error } = await this.auth.signIn(this.email, this.password);

      if (error) {
        const code = (error as { code?: string }).code;
        if (code === 'invalid_credentials') {
          this.error.set('Falsches Passwort.');
        } else if (code === 'email_not_verified') {
          this.error.set('Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Bestätigungs-Mail.');
        } else {
          this.error.set(error.message);
        }
        this.loading.set(false);
      } else {
        // Successful login: eine bei der Registrierung vorgemerkte Organisation jetzt anlegen
        const neueOrg = await this.auth.legeAusstehendeOrganisationAn();
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        this.router.navigateByUrl(neueOrg ? `/${neueOrg}/dashboard` : returnUrl || '/organisationen');
      }
    } catch (e) {
      this.loading.set(false);
      this.error.set('Ein unerwarteter Fehler ist aufgetreten.');
    }
  }

  async requestPasswordReset() {
    if (!this.email) return;

    this.loading.set(true);
    try {
      await this.auth.requestPasswordReset(this.email);
      this.loading.set(false);
      this.step.set('invitation-sent');
    } catch (e: any) {
      this.loading.set(false);
      this.error.set(e.message || 'Fehler beim Zurücksetzen.');
    }
  }

  resetToEmail() {
    this.step.set('email');
    this.error.set('');
    this.password = '';
    this.memberName.set(null);
  }

  /**
   * Send a magic link for passwordless login
   */
  async sendMagicLink() {
    if (!this.email) return;

    this.loading.set(true);
    this.error.set('');

    try {
      await this.auth.requestMagicLink(this.email);
      this.loading.set(false);
      this.step.set('invitation-sent');
    } catch (e: any) {
      this.loading.set(false);
      this.error.set(e.message || 'Fehler beim Senden des Links.');
    }
  }

  goBack() {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    this.router.navigateByUrl(returnUrl || '/');
  }
}
