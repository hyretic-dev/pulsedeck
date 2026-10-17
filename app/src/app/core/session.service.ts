import { Injectable, computed, signal } from '@angular/core';

import { environment } from '../../environments/environment';

export interface StoredSession {
    userId: string;
    accessToken: string;
    refreshToken: string;
}

const KEY = 'pulsedeck.session';
/** Zugriffstoken früher erneuern, damit laufende Anfragen nicht knapp vor Ablauf scheitern. */
const VORLAUF_SEKUNDEN = 30;

function ablauf(token: string): number | null {
    try {
        const nutzlast = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return typeof nutzlast.exp === 'number' ? nutzlast.exp : null;
    } catch {
        return null;
    }
}

/**
 * Sitzung des angemeldeten Kontos (Zugriffs- und Refresh-Token) im localStorage.
 *
 * Erneuerung: höchstens eine gleichzeitige Erneuerung je Tab (Single-Flight) und, wo verfügbar, je Browser (Web Lock).
 * Refresh-Tokens rotieren; ein zweiter Tab mit demselben alten Token würde die Sitzung sonst beenden. Nach dem Sperren wird
 * der Speicher erneut gelesen: Hat ein anderer Tab inzwischen erneuert, wird dessen Ergebnis übernommen.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
    private readonly _session = signal<StoredSession | null>(this.lade());
    readonly session = this._session.asReadonly();
    readonly userId = computed(() => this._session()?.userId ?? null);
    readonly istAngemeldet = computed(() => this._session() !== null);
    private laufendeErneuerung: Promise<StoredSession | null> | null = null;

    constructor() {
        // Anmeldung/Abmeldung/Erneuerung in einem anderen Tab übernehmen
        if (typeof window !== 'undefined') {
            window.addEventListener('storage', (e) => {
                if (e.key === KEY) this._session.set(this.lade());
            });
        }
    }

    private lade(): StoredSession | null {
        try {
            const roh = localStorage.getItem(KEY);
            if (!roh) return null;
            const s = JSON.parse(roh) as Partial<StoredSession>;
            return s.userId && s.accessToken && s.refreshToken ? (s as StoredSession) : null;
        } catch {
            return null;
        }
    }

    setze(sitzung: StoredSession | null): void {
        try {
            if (sitzung) localStorage.setItem(KEY, JSON.stringify(sitzung));
            else localStorage.removeItem(KEY);
        } catch {
            // Speicher gesperrt (privater Modus): Sitzung gilt dann nur für diesen Tab
        }
        this._session.set(sitzung);
    }

    /** Gültiges Zugriffstoken (erneuert bei Bedarf), oder null ohne Anmeldung. */
    async zugriffstoken(): Promise<string | null> {
        const s = this._session();
        if (!s) return null;
        const exp = ablauf(s.accessToken);
        if (exp !== null && exp - Date.now() / 1000 > VORLAUF_SEKUNDEN) return s.accessToken;
        return (await this.erneuern(s.refreshToken))?.accessToken ?? null;
    }

    /** Erneuert die Sitzung; `veraltet` = der Refresh-Token, mit dem die fehlgeschlagene Anfrage lief. */
    erneuern(veraltet?: string): Promise<StoredSession | null> {
        this.laufendeErneuerung ??= this.erneuernMitSperre(veraltet).finally(() => {
            this.laufendeErneuerung = null;
        });
        return this.laufendeErneuerung;
    }

    private async erneuernMitSperre(veraltet?: string): Promise<StoredSession | null> {
        const arbeit = async (): Promise<StoredSession | null> => {
            const aktuell = this.lade();
            this._session.set(aktuell);
            if (!aktuell) return null;
            // Ein anderer Tab war schneller: dessen Token übernehmen statt den (rotierten) alten erneut zu verwenden
            if (veraltet && aktuell.refreshToken !== veraltet) return aktuell;
            try {
                const antwort = await fetch(`${environment.apiBaseUrl}/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: aktuell.refreshToken }),
                });
                if (antwort.status === 401 || antwort.status === 400 || antwort.status === 403) {
                    this.setze(null); // Refresh-Token ungültig: Sitzung ist beendet
                    return null;
                }
                if (!antwort.ok) return null; // Serverproblem: Sitzung behalten, später erneut versuchen
                const neu = (await antwort.json()) as StoredSession;
                this.setze({ userId: neu.userId, accessToken: neu.accessToken, refreshToken: neu.refreshToken });
                return this._session();
            } catch {
                return null; // Netzwerkfehler: Sitzung behalten
            }
        };
        const sperren = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        return sperren ? sperren.request('pulsedeck-session-refresh', arbeit) : arbeit();
    }
}
