import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from '../../shared/services/auth.service';
import { AuthCallbackComponent } from './auth-callback.component';

function aufbauen(queryParams: Record<string, string>, konto: { hasPassword: boolean } = { hasPassword: true }) {
    const auth = {
        verifyEmail: vi.fn().mockResolvedValue(undefined),
        consumeMagicLink: vi.fn().mockResolvedValue(undefined),
        resetPassword: vi.fn().mockResolvedValue(undefined),
        setPassword: vi.fn().mockResolvedValue(undefined),
        whenReady: vi.fn().mockResolvedValue(undefined),
        legeAusstehendeOrganisationAn: vi.fn().mockResolvedValue(null),
        refreshMember: vi.fn().mockResolvedValue(undefined),
        setActiveOrganization: vi.fn().mockResolvedValue(undefined),
        account: signal(konto),
        userMemberships: signal([{ memberId: 'm1', memberName: 'Anna', organizationId: 'o1', organizationName: 'Alpha', organizationSlug: 'alpha', appRole: 'member' }]),
    };
    const router = { navigate: vi.fn() };
    TestBed.configureTestingModule({
        providers: [
            { provide: AuthService, useValue: auth },
            { provide: Router, useValue: router },
            { provide: ActivatedRoute, useValue: { snapshot: { queryParams } } },
        ],
    });
    const fixture = TestBed.createComponent(AuthCallbackComponent);
    return { auth, router, fixture, komponente: fixture.componentInstance };
}

describe('AuthCallbackComponent', () => {
    let replaceState: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        replaceState = vi.spyOn(window.history, 'replaceState');
    });
    afterEach(() => {
        vi.useRealTimers();
        replaceState.mockRestore();
    });

    it('entfernt den Token sofort aus der Adresszeile und löst Bestätigungslinks ein', async () => {
        const { auth, komponente } = aufbauen({ type: 'verify', token: 'geheim-token' });

        await komponente.ngOnInit();

        expect(replaceState.mock.calls[0][2]).toBe(window.location.pathname); // Adresse ohne Query
        expect(replaceState.mock.invocationCallOrder[0]).toBeLessThan(auth.verifyEmail.mock.invocationCallOrder[0]);
        expect(auth.verifyEmail).toHaveBeenCalledWith('geheim-token');
        expect(auth.consumeMagicLink).not.toHaveBeenCalled();
    });

    it('löst Magic-Links ein und leitet bei einer einzigen Organisation zum Dashboard weiter', async () => {
        const { auth, router, komponente } = aufbauen({ type: 'magic', token: 't' });

        await komponente.ngOnInit();
        vi.advanceTimersByTime(2000);

        expect(auth.consumeMagicLink).toHaveBeenCalledWith('t');
        expect(auth.setActiveOrganization).toHaveBeenCalledWith('o1');
        expect(router.navigate).toHaveBeenCalledWith(['/', 'alpha', 'dashboard']);
    });

    it('bietet eingeladenen Konten ohne Passwort ein freiwilliges Passwort an', async () => {
        const { auth, komponente } = aufbauen({ type: 'magic', token: 't' }, { hasPassword: false });

        await komponente.ngOnInit();

        expect(komponente.showPasswordForm()).toBe(true);
        expect(komponente.passwordMode()).toBe('invite');
        komponente.password = 'sehr-sicher-123';
        komponente.confirmPassword = 'sehr-sicher-123';
        await komponente.setPassword();
        expect(auth.setPassword).toHaveBeenCalledWith('sehr-sicher-123');
        expect(auth.resetPassword).not.toHaveBeenCalled();
    });

    it('löst Reset-Links erst mit dem neuen Passwort ein und prüft Länge und Übereinstimmung vorher', async () => {
        const { auth, komponente } = aufbauen({ type: 'reset', token: 'reset-token' });

        await komponente.ngOnInit();
        expect(komponente.showPasswordForm()).toBe(true);
        expect(auth.resetPassword).not.toHaveBeenCalled(); // Token wird nicht ohne Passwort verbraucht

        komponente.password = 'kurz';
        komponente.confirmPassword = 'kurz';
        await komponente.setPassword();
        expect(komponente.passwordError()).toContain('mindestens 8');

        komponente.password = 'sehr-sicher-123';
        komponente.confirmPassword = 'anderes-passwort';
        await komponente.setPassword();
        expect(komponente.passwordError()).toContain('stimmen nicht überein');
        expect(auth.resetPassword).not.toHaveBeenCalled();

        komponente.confirmPassword = 'sehr-sicher-123';
        await komponente.setPassword();
        expect(auth.resetPassword).toHaveBeenCalledWith('reset-token', 'sehr-sicher-123');
    });

    it('zeigt bei fehlendem/unbekanntem Link-Typ und bei abgelaufenen Links verständliche Fehler', async () => {
        const ohne = aufbauen({});
        await ohne.komponente.ngOnInit();
        expect(ohne.komponente.error()).toContain('Kein gültiger Link');
        TestBed.resetTestingModule();

        const fremd = aufbauen({ type: 'invite', token: 'x' });
        await fremd.komponente.ngOnInit();
        expect(fremd.komponente.error()).toContain('Kein gültiger Link');
        TestBed.resetTestingModule();

        const abgelaufen = aufbauen({ type: 'verify', token: 'alt' });
        abgelaufen.auth.verifyEmail.mockRejectedValue(Object.assign(new Error('Token abgelaufen'), { status: 401 }));
        await abgelaufen.komponente.ngOnInit();
        expect(abgelaufen.komponente.error()).toContain('ungültig oder abgelaufen');
        expect(abgelaufen.komponente.processing()).toBe(false);
    });

    it('legt eine vorgemerkte Organisation nach der Bestätigung an und leitet dorthin', async () => {
        const { auth, router, komponente } = aufbauen({ type: 'verify', token: 't' });
        auth.legeAusstehendeOrganisationAn.mockResolvedValue('neuverein');

        await komponente.ngOnInit();
        vi.advanceTimersByTime(2000);

        expect(router.navigate).toHaveBeenCalledWith(['/', 'neuverein', 'dashboard']);
        expect(auth.refreshMember).not.toHaveBeenCalled();
    });
});
