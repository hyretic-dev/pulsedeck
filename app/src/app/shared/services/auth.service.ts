import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';

import { ApiError, ApiService } from '../../core/api.service';
import { SessionService, type StoredSession } from '../../core/session.service';
import { Member, AppRole, Permission } from '../models/member.model';
import { OrganizationService } from './organization.service';

/**
 * Represents a user's membership in an organization
 */
export interface UserMembership {
    memberId: string;
    memberName: string;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    appRole: AppRole;
}

/** Antwort der E-Mail-Prüfung der Login-Seite (nennt aus Datenschutzgründen weder Namen noch Organisationen). */
export interface LoginCheckResult {
    status: 'connected' | 'invitation_sent' | 'not_found' | 'error';
    message?: string;
    memberName?: string;
    error?: string;
}

export interface Account {
    userId: string;
    email: string;
    emailVerified: boolean;
    hasPassword: boolean;
    isPlatformAdmin?: boolean;
}

interface MembershipZeile {
    member_id: string;
    member_name: string;
    organization_id: string;
    organization_name: string;
    organization_slug: string;
    app_role: AppRole;
}

@Injectable({
    providedIn: 'root',
})
export class AuthService {
    private api = inject(ApiService);
    private session = inject(SessionService);
    private router = inject(Router);
    private orgService = inject(OrganizationService);

    /** Konto des angemeldeten Nutzers (E-Mail, Passwort gesetzt?) */
    account = signal<Account | null>(null);

    /** All memberships for the current logged-in user */
    userMemberships = signal<UserMembership[]>([]);

    /** Currently active membership (selected organization) */
    currentMember = signal<Member | null>(null);

    /** Currently active organization ID */
    currentOrgId = signal<string | null>(null);

    /** Computed Role: 'public' if not logged in or not linked */
    userRole = computed<AppRole>(() => {
        const member = this.currentMember();
        return member?.app_role ?? 'public';
    });

    /** Angemeldeter Nutzer (Konto-ID aus der Sitzung, E-Mail sobald das Konto geladen ist) */
    user = computed(() => {
        const s = this.session.session();
        return s ? { id: s.userId, email: this.account()?.email ?? '' } : null;
    });
    isLoggedIn = computed(() => !!this.user());

    /** Ist die Mitgliedschaft in der Organisation administrativ (Besitzer, System-Admin-Rolle oder Rolle admin)? Vom Server aufgelöst. */
    isAdmin = computed(() => {
        const m = this.currentMember();
        return m?.access?.isAdmin ?? (m?.org_role?.is_system_admin || this.userRole() === 'admin');
    });

    /** Is committee (Vorstand) or higher (in current org) */
    isCommittee = computed(() => this.isAdmin() || this.userRole() === 'committee');

    /** Is member or higher (in current org) */
    isMember = computed(() => this.isCommittee() || this.userRole() === 'member');

    /** Has multiple organizations */
    hasMultipleOrgs = computed(() => this.userMemberships().length > 1);

    private ladevorgang: Promise<void> = Promise.resolve();

    constructor() {
        // Auf Anmeldung/Abmeldung reagieren: Konto und Mitgliedschaften laden bzw. zurücksetzen
        effect(() => {
            const userId = this.session.userId();
            untracked(() => {
                this.ladevorgang = userId ? this.ladeAlles() : Promise.resolve(this.zuruecksetzen());
            });
        });
    }

    /** Wartet, bis Konto und Mitgliedschaften zur aktuellen Sitzung geladen sind (für Guards). */
    whenReady(): Promise<void> {
        return this.ladevorgang;
    }

    private zuruecksetzen(): void {
        this.account.set(null);
        this.userMemberships.set([]);
        this.currentMember.set(null);
        this.currentOrgId.set(null);
    }

    private async ladeAlles(): Promise<void> {
        try {
            const [konto, zeilen] = await Promise.all([
                this.api.get<Account>('/auth/me'),
                this.api.get<MembershipZeile[]>('/me/memberships'),
            ]);
            this.account.set(konto);
            const memberships: UserMembership[] = zeilen.map((m) => ({
                memberId: m.member_id,
                memberName: m.member_name,
                organizationId: m.organization_id,
                organizationName: m.organization_name,
                organizationSlug: m.organization_slug,
                appRole: m.app_role,
            }));
            this.userMemberships.set(memberships);
            if (memberships.length === 0) {
                this.currentMember.set(null);
                return;
            }

            // Priorität 1: Organisation aus dem Guard (URL), 2: zuletzt genutzte, 3: einzige Organisation
            const guardOrgId = this.orgService.currentOrgId();
            const gespeichert = localStorage.getItem('last_org_id');
            const wahl =
                memberships.find((m) => m.organizationId === guardOrgId) ??
                memberships.find((m) => m.organizationId === gespeichert) ??
                (memberships.length === 1 ? memberships[0] : undefined);
            if (wahl) await this.setActiveOrganization(wahl.organizationId);
        } catch (fehler) {
            if (!(fehler instanceof ApiError) || fehler.status !== 401) console.error('Konto konnte nicht geladen werden:', fehler);
            this.zuruecksetzen();
        }
    }

    /**
     * Set the active organization and load the full member profile
     */
    async setActiveOrganization(organizationId: string): Promise<void> {
        if (!this.session.userId()) return;
        try {
            const member = await this.api.get<Member>(`/orgs/${organizationId}/members/me`);
            localStorage.setItem('last_org_id', organizationId);
            this.currentOrgId.set(organizationId);
            this.currentMember.set(member);
        } catch (fehler) {
            console.error('Mitgliedsprofil konnte nicht geladen werden:', fehler);
        }
    }

    /**
     * Prüft, ob die E-Mail zu einem Mitglied gehört (Login-Seite). Gehört sie zu einem noch nicht verbundenen
     * Mitglied, wird dabei die Einladung verschickt.
     */
    async checkEmail(email: string, organizationId?: string): Promise<LoginCheckResult> {
        try {
            const antwort = await this.api.post<{ status: LoginCheckResult['status'] }>(
                '/auth/check-email',
                { email: email.toLowerCase().trim(), ...(organizationId ? { organization_id: organizationId } : {}) },
                { auth: false }
            );
            return { status: antwort.status };
        } catch (e) {
            return { status: 'error', error: (e as Error).message };
        }
    }

    /**
     * Refresh current member data
     */
    async refreshMember(): Promise<void> {
        if (this.session.userId()) {
            this.ladevorgang = this.ladeAlles();
            await this.ladevorgang;
        }
    }

    /**
     * Get membership for a specific organization
     */
    getMembershipForOrg(orgId: string): UserMembership | undefined {
        return this.userMemberships().find((m) => m.organizationId === orgId);
    }

    /**
     * Prüft, ob das aktuelle Mitglied eine spezifische Permission besitzt (vom Server aufgelöst; durchgesetzt wird im Backend).
     */
    hasPermission(permission: Permission): boolean {
        const member = this.currentMember();
        if (!member) return false;
        if (member.access) return member.access.permissions.includes(permission);
        return member.org_role?.is_system_admin || member.app_role === 'admin' || member.app_role === 'committee'
            ? true
            : (member.org_role?.permissions?.includes(permission) || member.permissions?.includes(permission) || false);
    }

    // ── Anmeldung ───────────────────────────────────────────────────────────────

    private uebernehme(s: StoredSession): Promise<void> {
        this.session.setze({ userId: s.userId, accessToken: s.accessToken, refreshToken: s.refreshToken });
        this.ladevorgang = this.ladeAlles();
        return this.ladevorgang;
    }

    /** Anmeldung mit E-Mail und Passwort; Fehler als `{ error }` (ApiError mit `code`, z. B. invalid_credentials, email_not_verified). */
    async signIn(email: string, password: string): Promise<{ error: Error | null }> {
        try {
            await this.uebernehme(await this.api.post<StoredSession>('/auth/login', { email: email.trim().toLowerCase(), password }, { auth: false }));
            return { error: null };
        } catch (e) {
            return { error: e as Error };
        }
    }

    /** Registrierung; das Konto muss danach per Link in der E-Mail bestätigt werden. */
    async signUp(email: string, password: string): Promise<{ error: Error | null }> {
        try {
            await this.api.post('/auth/signup', { email: email.trim().toLowerCase(), password }, { auth: false });
            return { error: null };
        } catch (e) {
            return { error: e as Error };
        }
    }

    /** Link aus der Bestätigungs-Mail einlösen (`type=verify`); meldet das Konto an. */
    async verifyEmail(token: string): Promise<void> {
        await this.uebernehme(await this.api.post<StoredSession>('/auth/verify-email', { token }, { auth: false }));
    }

    async requestMagicLink(email: string): Promise<void> {
        await this.api.post('/auth/magic-link', { email: email.trim().toLowerCase() }, { auth: false });
    }

    /** Anmelde-Link einlösen (`type=magic`). */
    async consumeMagicLink(token: string): Promise<void> {
        await this.uebernehme(await this.api.post<StoredSession>('/auth/magic-link/consume', { token }, { auth: false }));
    }

    async requestPasswordReset(email: string): Promise<void> {
        await this.api.post('/auth/password-reset', { email: email.trim().toLowerCase() }, { auth: false });
    }

    /** Reset-Link einlösen (`type=reset`) und neues Passwort setzen; meldet das Konto an. */
    async resetPassword(token: string, newPassword: string): Promise<void> {
        await this.uebernehme(await this.api.post<StoredSession>('/auth/password-reset/consume', { token, newPassword }, { auth: false }));
    }

    /** Erstes Passwort für ein eingeladenes Konto (nur wenn noch keines gesetzt ist). */
    async setPassword(newPassword: string): Promise<void> {
        await this.uebernehme(await this.api.post<StoredSession>('/auth/set-password', { newPassword }));
    }

    async changePassword(oldPassword: string, newPassword: string): Promise<void> {
        await this.uebernehme(await this.api.post<StoredSession>('/auth/change-password', { oldPassword, newPassword }));
    }

    /**
     * Legt die bei der Registrierung vorgemerkte Organisation an, sobald das (bestätigte) Konto angemeldet ist.
     * Gilt nur für die E-Mail-Adresse, mit der registriert wurde. Liefert den Kürzel der Organisation oder null.
     */
    async legeAusstehendeOrganisationAn(): Promise<string | null> {
        const roh = localStorage.getItem('pendingOrganization');
        if (!roh) return null;
        try {
            const vorgemerkt = JSON.parse(roh) as { orgName: string; slug: string; userName?: string; email: string };
            await this.ladevorgang;
            if (vorgemerkt.email?.toLowerCase() !== this.account()?.email?.toLowerCase()) return null; // gehört zu einem anderen Konto
            localStorage.removeItem('pendingOrganization');
            const org = await this.orgService.create(vorgemerkt.orgName, vorgemerkt.slug, vorgemerkt.userName);
            await this.refreshMember();
            return org.slug;
        } catch (e) {
            console.error('Vorgemerkte Organisation konnte nicht angelegt werden:', e);
            localStorage.removeItem('pendingOrganization');
            return null;
        }
    }

    async signOut(): Promise<void> {
        const sitzung = this.session.session();
        localStorage.removeItem('last_org_id');
        if (sitzung) {
            try {
                await this.api.post('/auth/logout', { refreshToken: sitzung.refreshToken });
            } catch {
                // Abmeldung lokal trotzdem durchführen
            }
        }
        this.session.setze(null);
        this.zuruecksetzen();
        this.router.navigate(['/']);
    }
}
