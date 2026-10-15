import { Injectable, inject } from '@angular/core';

import { environment } from '../../environments/environment';

import { SessionService } from './session.service';

/** Fehler der Backend-API im Vertrag `{ code, message }`. */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
    params?: Query;
    /** false → ohne Anmeldung senden (Login, öffentliche Seiten) und bei 401 nicht erneuern. */
    auth?: boolean;
    signal?: AbortSignal;
}

/**
 * Schlanker Client für die Backend-API (fetch). Fügt das Bearer-Token an, erneuert die Sitzung bei 401 genau einmal und
 * macht aus Fehlerantworten `ApiError` mit der deutschen Meldung des Servers.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
    private readonly session = inject(SessionService);

    private url(pfad: string, params?: Query): string {
        const query = new URLSearchParams();
        for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
        const text = query.toString();
        return `${environment.apiBaseUrl}${pfad}${text ? `?${text}` : ''}`;
    }

    private async senden(methode: string, pfad: string, body: unknown, optionen: RequestOptions): Promise<Response> {
        const mitAuth = optionen.auth !== false;
        const ausfuehren = async (token: string | null): Promise<Response> => {
            const kopf: Record<string, string> = {};
            if (token) kopf['Authorization'] = `Bearer ${token}`;
            let inhalt: BodyInit | undefined;
            if (body instanceof FormData) inhalt = body;
            else if (body !== undefined) {
                kopf['Content-Type'] = 'application/json';
                inhalt = JSON.stringify(body);
            }
            return fetch(this.url(pfad, optionen.params), { method: methode, headers: kopf, body: inhalt, signal: optionen.signal });
        };
        const token = mitAuth ? await this.session.zugriffstoken() : null;
        let antwort = await ausfuehren(token);
        if (antwort.status === 401 && token) {
            const erneuert = await this.session.erneuern(this.session.session()?.refreshToken);
            if (erneuert) antwort = await ausfuehren(erneuert.accessToken);
        }
        if (!antwort.ok) throw await this.fehler(antwort);
        return antwort;
    }

    private async fehler(antwort: Response): Promise<ApiError> {
        let code = 'error';
        let meldung = `Anfrage fehlgeschlagen (${antwort.status})`;
        try {
            const daten = await antwort.json();
            if (typeof daten?.code === 'string') code = daten.code;
            const m = daten?.message;
            if (typeof m === 'string') meldung = m;
            else if (Array.isArray(m)) meldung = m.join(', ');
        } catch {
            // Antwort ohne JSON (z. B. Proxy-Fehler): Standardmeldung
        }
        return new ApiError(antwort.status, code, meldung);
    }

    async request<T>(methode: string, pfad: string, body?: unknown, optionen: RequestOptions = {}): Promise<T> {
        const antwort = await this.senden(methode, pfad, body, optionen);
        if (antwort.status === 204 || antwort.headers.get('content-length') === '0') return undefined as T;
        const typ = antwort.headers.get('content-type') ?? '';
        return (typ.includes('json') ? await antwort.json() : await antwort.text()) as T;
    }

    get<T>(pfad: string, params?: Query, optionen: RequestOptions = {}): Promise<T> {
        return this.request<T>('GET', pfad, undefined, { ...optionen, params });
    }
    post<T>(pfad: string, body?: unknown, optionen?: RequestOptions): Promise<T> {
        return this.request<T>('POST', pfad, body ?? {}, optionen);
    }
    put<T>(pfad: string, body?: unknown, optionen?: RequestOptions): Promise<T> {
        return this.request<T>('PUT', pfad, body ?? {}, optionen);
    }
    patch<T>(pfad: string, body: unknown, optionen?: RequestOptions): Promise<T> {
        return this.request<T>('PATCH', pfad, body, optionen);
    }
    delete<T = void>(pfad: string, optionen?: RequestOptions): Promise<T> {
        return this.request<T>('DELETE', pfad, undefined, optionen);
    }

    /** Binärer Abruf (Dateiinhalt) mit Anmeldung. */
    async blob(pfad: string, params?: Query): Promise<Blob> {
        return (await this.senden('GET', pfad, undefined, { params })).blob();
    }

    /** Roher Abruf für Streams (Chat, Echtzeit). */
    stream(methode: string, pfad: string, body?: unknown, optionen: RequestOptions = {}): Promise<Response> {
        return this.senden(methode, pfad, body, optionen);
    }
}
