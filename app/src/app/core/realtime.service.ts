import { Injectable, inject } from '@angular/core';

import { ApiService } from './api.service';

export interface Aenderung {
    table: string;
    operation: 'INSERT' | 'UPDATE' | 'DELETE';
    id: string | null;
}

type Handler = (ereignis: Aenderung | { table: '*'; operation: 'RESYNC'; id: null }) => void;

interface Verbindung {
    orgId: string;
    handler: Map<symbol, { tabellen: Set<string>; fn: Handler }>;
    abbruch: AbortController | null;
    versuch: number;
    /** Tabellenliste der laufenden Verbindung (wächst sie, muss neu verbunden werden). */
    verbundeneTabellen: string;
}

/**
 * Echtzeit-Änderungen der Organisation (Server-Sent Events über fetch, damit das Bearer-Token mitgesendet wird).
 * Eine Verbindung je Organisation für alle Abonnenten. Die Meldungen enthalten nur Tabelle, Operation und ID: wer
 * etwas anzeigt, lädt über die geschützten Endpunkte neu. Nach jeder (Wieder-)Verbindung kommt `RESYNC`, weil
 * Änderungen während der Unterbrechung verloren gehen können.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
    private readonly api = inject(ApiService);
    private readonly verbindungen = new Map<string, Verbindung>();

    /** Abonniert Änderungen der angegebenen Tabellen in der Organisation; liefert die Abmeldefunktion. */
    abonnieren(orgId: string, tabellen: string[], fn: Handler): () => void {
        const id = Symbol('abo');
        let v = this.verbindungen.get(orgId);
        if (!v) {
            v = { orgId, handler: new Map(), abbruch: null, versuch: 0, verbundeneTabellen: '' };
            this.verbindungen.set(orgId, v);
        }
        v.handler.set(id, { tabellen: new Set(tabellen), fn });
        // Neue Tabellen verlangen eine neue Verbindung: der Server filtert nach der beim Aufbau gesendeten Liste
        if (v.abbruch && v.verbundeneTabellen !== this.tabellenListe(v)) {
            v.abbruch.abort();
            v.abbruch = null;
        }
        this.verbinden(v);
        return () => {
            v.handler.delete(id);
            if (v.handler.size === 0) {
                v.abbruch?.abort();
                this.verbindungen.delete(orgId);
            } else {
                // Tabellenliste hat sich verkleinert: Verbindung neu aufbauen
                if (v.verbundeneTabellen !== this.tabellenListe(v)) {
                    v.abbruch?.abort();
                    v.abbruch = null;
                    this.verbinden(v);
                }
            }
        };
    }

    private tabellenListe(v: Verbindung): string {
        return [...new Set([...v.handler.values()].flatMap((h) => [...h.tabellen]))].sort().join(',');
    }

    private verbinden(v: Verbindung): void {
        if (v.abbruch) return;
        const abbruch = new AbortController();
        v.abbruch = abbruch;
        v.verbundeneTabellen = this.tabellenListe(v);
        void this.lesen(v, abbruch).finally(() => {
            if (v.abbruch === abbruch) v.abbruch = null;
            if (v.handler.size > 0 && !abbruch.signal.aborted) {
                const wartezeit = Math.min(30_000, 1000 * 2 ** Math.min(v.versuch, 5));
                v.versuch += 1;
                setTimeout(() => this.verbinden(v), wartezeit);
            }
        });
    }

    private async lesen(v: Verbindung, abbruch: AbortController): Promise<void> {
        try {
            const antwort = await this.api.stream('GET', `/orgs/${v.orgId}/realtime${v.verbundeneTabellen ? `?tables=${v.verbundeneTabellen}` : ''}`, undefined, { signal: abbruch.signal });
            const reader = antwort.body?.getReader();
            if (!reader) return;
            const decoder = new TextDecoder();
            let puffer = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) return;
                puffer += decoder.decode(value, { stream: true });
                const bloecke = puffer.split('\n\n');
                puffer = bloecke.pop() ?? '';
                for (const block of bloecke) this.verarbeiten(v, block);
            }
        } catch {
            // Abbruch oder Verbindungsfehler: der Aufrufer baut mit Wartezeit neu auf
        }
    }

    private verarbeiten(v: Verbindung, block: string): void {
        const event = block.split('\n').find((z) => z.startsWith('event: '))?.slice(7);
        const daten = block.split('\n').find((z) => z.startsWith('data: '))?.slice(6);
        if (event === 'ready') {
            v.versuch = 0;
            this.verteilen(v, { table: '*', operation: 'RESYNC', id: null });
        } else if (event === 'resync') {
            this.verteilen(v, { table: '*', operation: 'RESYNC', id: null });
        } else if (event === 'change' && daten) {
            try {
                this.verteilen(v, JSON.parse(daten) as Aenderung);
            } catch {
                // ungültige Nutzlast ignorieren
            }
        }
    }

    private verteilen(v: Verbindung, ereignis: Aenderung | { table: '*'; operation: 'RESYNC'; id: null }): void {
        for (const h of v.handler.values()) {
            if (ereignis.table === '*' || h.tabellen.has(ereignis.table)) h.fn(ereignis);
        }
    }
}
