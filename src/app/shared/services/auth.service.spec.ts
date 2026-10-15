import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SessionService } from '../../core/session.service';
import { AuthService } from './auth.service';

const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const jwt = () => {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 600 })}.sig`;
};

const mitgliedschaft = { member_id: 'm1', member_name: 'Anna', organization_id: 'o1', organization_name: 'Alpha', organization_slug: 'alpha', app_role: 'member' };
const mitglied = { id: 'm1', name: 'Anna', app_role: 'member', access: { isOwner: false, isAdmin: false, permissions: ['feed:create'] } };

describe('AuthService', () => {
    let auth: AuthService;
    let session: SessionService;
    let aufrufe: Array<{ pfad: string; methode: string; body?: any }>;
    let routen: Record<string, () => Response>;

    beforeEach(() => {
        localStorage.clear();
        aufrufe = [];
        routen = {
            'POST /auth/login': () => json(200, { userId: 'u1', accessToken: jwt(), refreshToken: 'r1' }),
            'GET /auth/me': () => json(200, { userId: 'u1', email: 'anna@example.org', emailVerified: true, hasPassword: true }),
            'GET /me/memberships': () => json(200, [mitgliedschaft]),
            'GET /orgs/o1/members/me': () => json(200, mitglied),
            'POST /auth/logout': () => json(204),
        };
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
            const pfad = url.replace('/api/v1', '');
            const methode = init.method ?? 'GET';
            aufrufe.push({ pfad, methode, body: init.body ? JSON.parse(init.body as string) : undefined });
            return (routen[`${methode} ${pfad}`] ?? (() => json(404, { code: 'not_found', message: 'nicht gefunden' })))();
        }));
        TestBed.configureTestingModule({ providers: [provideRouter([])] });
        auth = TestBed.inject(AuthService);
        session = TestBed.inject(SessionService);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('startet abgemeldet', () => {
        expect(auth.isLoggedIn()).toBe(false);
        expect(auth.user()).toBeNull();
        expect(auth.userMemberships()).toEqual([]);
        expect(auth.userRole()).toBe('public');
    });

    it('meldet an, lädt Konto und Mitgliedschaften und wählt die einzige Organisation mit den vom Server aufgelösten Rechten', async () => {
        const { error } = await auth.signIn(' Anna@Example.org ', 'geheim-geheim');
        await auth.whenReady();

        expect(error).toBeNull();
        expect(aufrufe[0]).toEqual({ pfad: '/auth/login', methode: 'POST', body: { email: 'anna@example.org', password: 'geheim-geheim' } });
        expect(auth.isLoggedIn()).toBe(true);
        expect(auth.user()).toEqual({ id: 'u1', email: 'anna@example.org' });
        expect(auth.userMemberships()).toEqual([{ memberId: 'm1', memberName: 'Anna', organizationId: 'o1', organizationName: 'Alpha', organizationSlug: 'alpha', appRole: 'member' }]);
        expect(auth.currentOrgId()).toBe('o1');
        expect(auth.currentMember()?.name).toBe('Anna');
        expect(auth.hasPermission('feed:create')).toBe(true);
        expect(auth.hasPermission('wiki:edit')).toBe(false);
        expect(auth.isAdmin()).toBe(false);
        expect(localStorage.getItem('last_org_id')).toBe('o1');
    });

    it('meldet Fehler beim Anmelden mit Code zurück und legt keine Sitzung an', async () => {
        routen['POST /auth/login'] = () => json(403, { code: 'email_not_verified', message: 'E-Mail nicht bestätigt' });

        const { error } = await auth.signIn('anna@example.org', 'x');

        expect(error).toMatchObject({ code: 'email_not_verified', status: 403 });
        expect(session.istAngemeldet()).toBe(false);
        expect(auth.isLoggedIn()).toBe(false);
    });

    it('kann ohne Mitgliedschaft angemeldet sein (kein aktives Mitglied)', async () => {
        routen['GET /me/memberships'] = () => json(200, []);

        await auth.signIn('anna@example.org', 'x');
        await auth.whenReady();

        expect(auth.isLoggedIn()).toBe(true);
        expect(auth.userMemberships()).toEqual([]);
        expect(auth.currentMember()).toBeNull();
    });

    it('bildet die E-Mail-Prüfung auf Status ab und meldet Fehler statt zu werfen', async () => {
        routen['POST /auth/check-email'] = () => json(200, { status: 'invitation_sent' });
        expect(await auth.checkEmail(' Neu@Example.org ')).toEqual({ status: 'invitation_sent' });
        expect(aufrufe.at(-1)?.body).toEqual({ email: 'neu@example.org' });

        routen['POST /auth/check-email'] = () => json(429, { code: 'rate_limited', message: 'Zu viele Anfragen' });
        expect(await auth.checkEmail('x@example.org')).toEqual({ status: 'error', error: 'Zu viele Anfragen' });
    });

    it('legt die bei der Registrierung vorgemerkte Organisation nur für die passende E-Mail an', async () => {
        routen['POST /orgs'] = () => json(201, { id: 'o2', slug: 'neuverein', name: 'Neuverein' });
        await auth.signIn('anna@example.org', 'x');
        await auth.whenReady();

        localStorage.setItem('pendingOrganization', JSON.stringify({ orgName: 'Fremd', slug: 'fremd', userName: 'Bernd', email: 'bernd@example.org' }));
        expect(await auth.legeAusstehendeOrganisationAn()).toBeNull(); // gehört zu einem anderen Konto
        expect(aufrufe.some((a) => a.pfad === '/orgs' && a.methode === 'POST')).toBe(false);
        expect(localStorage.getItem('pendingOrganization')).not.toBeNull();

        localStorage.setItem('pendingOrganization', JSON.stringify({ orgName: 'Neuverein', slug: 'neuverein', userName: 'Anna', email: 'ANNA@example.org' }));
        expect(await auth.legeAusstehendeOrganisationAn()).toBe('neuverein');
        expect(aufrufe.find((a) => a.pfad === '/orgs')?.body).toEqual({ name: 'Neuverein', slug: 'neuverein', owner_name: 'Anna' });
        expect(localStorage.getItem('pendingOrganization')).toBeNull();
    });

    it('meldet ab: Server-Logout mit Refresh-Token, lokale Sitzung und Organisationsmerker werden gelöscht', async () => {
        await auth.signIn('anna@example.org', 'x');
        await auth.whenReady();

        await auth.signOut();

        expect(aufrufe.find((a) => a.pfad === '/auth/logout')?.body).toEqual({ refreshToken: 'r1' });
        expect(session.istAngemeldet()).toBe(false);
        expect(localStorage.getItem('last_org_id')).toBeNull();
        expect(auth.currentMember()).toBeNull();
        expect(auth.userMemberships()).toEqual([]);
    });
});
