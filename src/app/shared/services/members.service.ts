import { Injectable, inject, signal, OnDestroy } from '@angular/core';

import { ApiService } from '../../core/api.service';
import { pick } from '../../core/pick';
import { RealtimeService } from '../../core/realtime.service';
import { OrganizationService } from './organization.service';
import { Member } from '../models/member.model';

/** Felder, die ein Administrator an einem Mitglied pflegen darf (alles andere lehnt das Backend ab). */
const MITGLIED_FELDER = [
    'name', 'email', 'role', 'department', 'status', 'join_date', 'avatar_url', 'role_id', 'app_role', 'permissions',
    'street', 'zip_code', 'city', 'phone', 'birthday', 'custom_info', 'contact_channels',
] as const;
/** Optionale Felder, die die Oberfläche leer lässt. */
const MITGLIED_LEER_ALS_NULL = ['avatar_url', 'role_id', 'street', 'zip_code', 'city', 'phone', 'birthday', 'custom_info'] as const;
const IMPORT_FELDER = ['name', 'email', 'role', 'department', 'status', 'join_date', 'street', 'zip_code', 'city', 'phone', 'birthday', 'custom_info'] as const;

/**
 * Service for managing members via the backend API.
 * Mitgliederliste mit Live-Aktualisierung, Einladungen und Löschen (inklusive Konto, sofern nirgends sonst Mitglied).
 */
@Injectable({
    providedIn: 'root',
})
export class MembersService implements OnDestroy {
    private api = inject(ApiService);
    private realtime = inject(RealtimeService);
    private org = inject(OrganizationService);
    private abmelden: (() => void) | null = null;
    private abonnierteOrg: string | null = null;

    private _members = signal<Member[]>([]);
    private _loading = signal(false);
    private _error = signal<string | null>(null);

    readonly members = this._members.asReadonly();
    readonly loading = this._loading.asReadonly();
    readonly error = this._error.asReadonly();

    private orgId(): string {
        const id = this.org.currentOrgId();
        if (!id) throw new Error('Keine Organisation ausgewählt');
        return id;
    }

    async fetchMembers(): Promise<void> {
        this._loading.set(true);
        this._error.set(null);
        try {
            const orgId = this.orgId();
            const zeilen = await this.api.get<Member[]>(`/orgs/${orgId}/members`);
            this._members.set([...zeilen].sort((a, b) => a.name.localeCompare(b.name)));
            this.abonnieren(orgId);
        } catch (e) {
            this._error.set((e as Error).message);
            console.error('Error fetching members:', e);
        }
        this._loading.set(false);
    }

    private abonnieren(orgId: string) {
        if (this.abonnierteOrg === orgId) return;
        this.abmelden?.();
        this.abonnierteOrg = orgId;
        this.abmelden = this.realtime.abonnieren(orgId, ['members'], () => void this.nachladen(orgId));
    }

    private async nachladen(orgId: string) {
        try {
            const zeilen = await this.api.get<Member[]>(`/orgs/${orgId}/members`);
            this._members.set([...zeilen].sort((a, b) => a.name.localeCompare(b.name)));
        } catch {
            // nächste Meldung versucht es erneut
        }
    }

    ngOnDestroy() {
        this.abmelden?.();
    }

    async addMember(member: Omit<Member, 'id' | 'created_at' | 'updated_at'>) {
        return this.api.post<Member>(`/orgs/${this.orgId()}/members`, pick(member, MITGLIED_FELDER, MITGLIED_LEER_ALS_NULL));
    }

    /** Import: Das Backend legt neue Mitglieder an und aktualisiert vorhandene mit gleicher E-Mail (nur Stammdaten). */
    async importMembers(members: Partial<Member>[]) {
        return this.api.post<Member[]>(`/orgs/${this.orgId()}/members/import`, { members: members.map((m) => pick(m, IMPORT_FELDER)) });
    }

    /** Eigenes Profil (Telefon, Adresse, Geburtstag, Kontaktkanäle): jedes Mitglied für sich selbst, ohne Rollen oder Rechte. */
    async updateOwnProfile(updates: Partial<Member>) {
        return this.api.patch<Member>(`/orgs/${this.orgId()}/members/me`, pick(updates, ['phone', 'street', 'zip_code', 'city', 'birthday', 'avatar_url', 'contact_channels'], ['avatar_url']));
    }

    async updateMember(id: string, updates: Partial<Member>) {
        return this.api.patch<Member>(`/orgs/${this.orgId()}/members/${id}`, pick(updates, MITGLIED_FELDER, MITGLIED_LEER_ALS_NULL));
    }

    /** Löscht ein Mitglied; ein zugehöriges Konto entfällt, wenn es nirgends sonst Mitglied ist (serverseitig geprüft). */
    async deleteMember(id: string) {
        await this.api.delete(`/orgs/${this.orgId()}/members/${id}`);
    }

    async deleteMany(ids: string[]) {
        for (let i = 0; i < ids.length; i += 200) await this.api.post(`/orgs/${this.orgId()}/members/bulk-delete`, { ids: ids.slice(i, i + 200) });
    }

    /**
     * Invite a member by sending them an email invitation (Link zum Anmelden und Passwort setzen).
     */
    async inviteMember(memberId: string, _email?: string): Promise<{ userId?: string; message: string; type?: string }> {
        return this.api.post(`/orgs/${this.orgId()}/members/${memberId}/invite`);
    }

    /**
     * Check if a member has been invited (has user_id)
     */
    isInvited(member: Member): boolean {
        return !!member.user_id;
    }

    /**
     * Check if a member is connected (user_id exists)
     */
    isConnected(member: Member): boolean {
        return !!member.user_id;
    }

    /**
     * Generate a magic link that admin can copy and share via WhatsApp, etc.
     * Returns the link string for copying to clipboard
     */
    async generateMagicLink(memberId: string, _email?: string): Promise<{ link: string; message: string; expiresIn: string }> {
        return this.api.post(`/orgs/${this.orgId()}/members/${memberId}/magic-link`);
    }
}
