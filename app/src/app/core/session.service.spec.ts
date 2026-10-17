import { TestBed } from '@angular/core/testing';

import { SessionService } from './session.service';

function jwt(exp: number): string {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', exp })}.sig`;
}
const inSekunden = (n: number) => Math.floor(Date.now() / 1000) + n;
const antwort = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('SessionService', () => {
    let session: SessionService;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        localStorage.clear();
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        TestBed.configureTestingModule({});
        session = TestBed.inject(SessionService);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('speichert die Sitzung im localStorage und stellt sie beim Start wieder her', () => {
        session.setze({ userId: 'u1', accessToken: 'a', refreshToken: 'r' });

        expect(session.istAngemeldet()).toBe(true);
        expect(JSON.parse(localStorage.getItem('pulsedeck.session') as string)).toEqual({ userId: 'u1', accessToken: 'a', refreshToken: 'r' });
        TestBed.resetTestingModule();
        expect(TestBed.inject(SessionService).userId()).toBe('u1');

        TestBed.inject(SessionService).setze(null);
        expect(localStorage.getItem('pulsedeck.session')).toBeNull();
    });

    it('ignoriert beschädigte gespeicherte Sitzungen', () => {
        localStorage.setItem('pulsedeck.session', '{kaputt');
        TestBed.resetTestingModule();
        expect(TestBed.inject(SessionService).istAngemeldet()).toBe(false);
    });

    it('gibt ein noch gültiges Zugriffstoken ohne Netzwerkaufruf heraus und erneuert kurz vor Ablauf', async () => {
        session.setze({ userId: 'u1', accessToken: jwt(inSekunden(600)), refreshToken: 'r1' });
        expect(await session.zugriffstoken()).toBe(jwt(inSekunden(600)));
        expect(fetchMock).not.toHaveBeenCalled();

        session.setze({ userId: 'u1', accessToken: jwt(inSekunden(5)), refreshToken: 'r1' });
        fetchMock.mockResolvedValue(antwort(200, { userId: 'u1', accessToken: 'neu', refreshToken: 'r2' }));
        expect(await session.zugriffstoken()).toBe('neu');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refreshToken: 'r1' });
        expect(session.session()?.refreshToken).toBe('r2'); // rotiert
    });

    it('führt gleichzeitige Erneuerungen zu genau einem Aufruf zusammen (Refresh-Tokens rotieren)', async () => {
        session.setze({ userId: 'u1', accessToken: jwt(inSekunden(1)), refreshToken: 'r1' });
        fetchMock.mockImplementation(async () => {
            await new Promise((ok) => setTimeout(ok, 20));
            return antwort(200, { userId: 'u1', accessToken: 'neu', refreshToken: 'r2' });
        });

        const ergebnisse = await Promise.all([session.zugriffstoken(), session.zugriffstoken(), session.zugriffstoken()]);

        expect(ergebnisse).toEqual(['neu', 'neu', 'neu']);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('übernimmt das Ergebnis eines anderen Tabs, statt den bereits rotierten Token erneut zu verwenden', async () => {
        session.setze({ userId: 'u1', accessToken: jwt(inSekunden(1)), refreshToken: 'alt' });
        // Anderer Tab hat inzwischen erneuert und in den Speicher geschrieben
        localStorage.setItem('pulsedeck.session', JSON.stringify({ userId: 'u1', accessToken: 'vom-anderen-tab', refreshToken: 'neuer' }));

        const erneuert = await session.erneuern('alt');

        expect(erneuert?.accessToken).toBe('vom-anderen-tab');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('beendet die Sitzung, wenn der Refresh-Token abgelehnt wird, behält sie aber bei Serverfehlern und ohne Netz', async () => {
        session.setze({ userId: 'u1', accessToken: jwt(inSekunden(1)), refreshToken: 'r1' });

        fetchMock.mockResolvedValueOnce(antwort(503));
        expect(await session.erneuern()).toBeNull();
        expect(session.istAngemeldet()).toBe(true);

        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        expect(await session.erneuern()).toBeNull();
        expect(session.istAngemeldet()).toBe(true);

        fetchMock.mockResolvedValueOnce(antwort(401, { code: 'session_invalid' }));
        expect(await session.erneuern()).toBeNull();
        expect(session.istAngemeldet()).toBe(false);
        expect(localStorage.getItem('pulsedeck.session')).toBeNull();
    });
});
