import { TestBed } from '@angular/core/testing';

import { ApiError, ApiService } from './api.service';
import { SessionService } from './session.service';

const jwtFrisch = () => {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 600 })}.sig`;
};
const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ApiService', () => {
    let api: ApiService;
    let session: SessionService;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        localStorage.clear();
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        TestBed.configureTestingModule({});
        api = TestBed.inject(ApiService);
        session = TestBed.inject(SessionService);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('sendet das Bearer-Token, JSON-Body und Query ohne leere Werte', async () => {
        const token = jwtFrisch();
        session.setze({ userId: 'u1', accessToken: token, refreshToken: 'r' });
        fetchMock.mockImplementation(async () => json(200, { ok: true }));

        const antwort = await api.get('/orgs/1/files', { q: 'a b', leer: '', nichts: undefined, nummer: 3 });
        await api.post('/orgs/1/tasks', { title: 'x' });

        expect(antwort).toEqual({ ok: true });
        expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orgs/1/files?q=a+b&nummer=3');
        expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe(`Bearer ${token}`);
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{"title":"x"}' });
        expect(fetchMock.mock.calls[1][1].headers['Content-Type']).toBe('application/json');
    });

    it('sendet ohne Anmeldung und mit auth:false kein Token', async () => {
        fetchMock.mockImplementation(async () => json(200, {}));
        await api.get('/public/x');
        session.setze({ userId: 'u1', accessToken: jwtFrisch(), refreshToken: 'r' });
        await api.post('/auth/login', {}, { auth: false });

        expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBeUndefined();
        expect(fetchMock.mock.calls[1][1].headers['Authorization']).toBeUndefined();
    });

    it('lässt FormData unverändert (Multipart-Grenze setzt der Browser)', async () => {
        fetchMock.mockResolvedValue(json(201, { id: '1' }));
        const form = new FormData();
        form.append('file', new Blob(['x']), 'x.txt');

        await api.post('/orgs/1/files', form);

        expect(fetchMock.mock.calls[0][1].body).toBe(form);
        expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
    });

    it('erneuert bei 401 genau einmal und wiederholt die Anfrage mit dem neuen Token', async () => {
        session.setze({ userId: 'u1', accessToken: jwtFrisch(), refreshToken: 'alt' });
        fetchMock
            .mockResolvedValueOnce(json(401, { code: 'unauthorized' }))
            .mockResolvedValueOnce(json(200, { userId: 'u1', accessToken: 'neu', refreshToken: 'neuer' }))
            .mockResolvedValueOnce(json(200, { daten: 1 }));

        const antwort = await api.get('/orgs/1/members');

        expect(antwort).toEqual({ daten: 1 });
        expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/refresh');
        expect(fetchMock.mock.calls[2][1].headers['Authorization']).toBe('Bearer neu');
    });

    it('gibt nach fehlgeschlagener Erneuerung den ursprünglichen 401 als ApiError weiter und beendet die Sitzung', async () => {
        session.setze({ userId: 'u1', accessToken: jwtFrisch(), refreshToken: 'alt' });
        fetchMock.mockResolvedValueOnce(json(401, { code: 'unauthorized', message: 'Sitzung abgelaufen' })).mockResolvedValueOnce(json(401, {}));

        await expect(api.get('/orgs/1/members')).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
        expect(session.istAngemeldet()).toBe(false);
    });

    it('macht aus Fehlerantworten ApiError mit Code und deutscher Meldung (auch Validierungslisten und Nicht-JSON)', async () => {
        fetchMock.mockResolvedValueOnce(json(409, { code: 'slot_full', message: 'Dieser Helferslot ist bereits voll' }));
        await expect(api.put('/orgs/1/slots/2/signup')).rejects.toMatchObject({ status: 409, code: 'slot_full', message: 'Dieser Helferslot ist bereits voll' });

        fetchMock.mockResolvedValueOnce(json(400, { message: ['email muss eine E-Mail sein', 'name darf nicht leer sein'] }));
        const fehler = (await api.post('/x', {}).catch((e) => e)) as ApiError;
        expect(fehler).toBeInstanceOf(ApiError);
        expect(fehler.message).toBe('email muss eine E-Mail sein, name darf nicht leer sein');

        fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));
        await expect(api.get('/x')).rejects.toMatchObject({ status: 502, code: 'error', message: 'Anfrage fehlgeschlagen (502)' });
    });

    it('liefert bei 204 undefined und lädt Binärdaten als Blob', async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        expect(await api.delete('/orgs/1/tasks/2')).toBeUndefined();

        fetchMock.mockResolvedValueOnce(new Response('Inhalt', { status: 200 }));
        expect(await (await api.blob('/orgs/1/files/2/content')).text()).toBe('Inhalt');
    });
});
