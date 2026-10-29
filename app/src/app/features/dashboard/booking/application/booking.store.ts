import { Injectable, computed, inject, signal } from '@angular/core';

import type { BookingEntry, BookingPlan } from '../../../../shared/booking/booking.models';
import { berlinUhr, berlinZeitpunkt } from '../../../../shared/booking/zeitraum';
import { BOOKING_REPOSITORY, BuchungEingabe, SerieEingabe } from '../domain/booking.repository';

export type Ansicht = 'jahr' | 'monat';
export type Bereich = 'plan' | 'eingang' | 'meine';

const SCHLUESSEL = 'pulsedeck.belegung';

function gespeichert(): { plan?: string; ansicht?: Ansicht } {
    try {
        return JSON.parse(localStorage.getItem(SCHLUESSEL) ?? '{}');
    } catch {
        return {};
    }
}

/** Zustand der Belegungsseite: Pläne, gewählter Plan und Zeitraum, Einträge, Aktionen über den Repository-Port. */
@Injectable()
export class BookingStore {
    private readonly repo = inject(BOOKING_REPOSITORY);

    readonly plaene = signal<BookingPlan[]>([]);
    readonly planId = signal<string | null>(null);
    readonly eintraege = signal<BookingEntry[]>([]);
    readonly laedt = signal(true);
    readonly ansicht = signal<Ansicht>('jahr');
    readonly bereich = signal<Bereich>('plan');
    readonly jahr = signal(berlinUhr(new Date()).jahr);
    readonly monat = signal(berlinUhr(new Date()).monat);

    readonly plan = computed(() => this.plaene().find((p) => p.id === this.planId()) ?? null);
    readonly offeneAnfragen = computed(() => this.eintraege().filter((e) => e.status === 'requested'));
    readonly meineAnfragen = computed(() =>
        this.eintraege().filter((e) => e.is_mine).sort((a, b) => b.start_at.localeCompare(a.start_at)),
    );

    async start(): Promise<void> {
        const merk = gespeichert();
        if (merk.ansicht === 'jahr' || merk.ansicht === 'monat') this.ansicht.set(merk.ansicht);
        const plaene = await this.repo.plaene();
        this.plaene.set(plaene);
        this.planId.set(plaene.find((p) => p.id === merk.plan)?.id ?? plaene[0]?.id ?? null);
        await this.neuLaden();
        this.laedt.set(false);
    }

    /** Lädt das ganze Jahr samt Rand, damit Jahresansicht, Monatswechsel und Dialoge ohne Nachladen auskommen. */
    async neuLaden(): Promise<void> {
        const id = this.planId();
        if (!id) {
            this.eintraege.set([]);
            return;
        }
        const j = this.jahr();
        this.eintraege.set(await this.repo.eintraege(id, berlinZeitpunkt(j - 1, 12, 1, 0), berlinZeitpunkt(j + 1, 1, 31, 0)));
        this.plaene.set(await this.repo.plaene());
    }

    private merke(): void {
        try {
            localStorage.setItem(SCHLUESSEL, JSON.stringify({ plan: this.planId(), ansicht: this.ansicht() }));
        } catch {
            // Speicher gesperrt (privates Fenster): die Auswahl gilt dann nur für diese Sitzung
        }
    }

    async planWaehlen(id: string): Promise<void> {
        this.planId.set(id);
        this.bereich.set('plan');
        this.merke();
        await this.neuLaden();
    }

    ansichtWaehlen(ansicht: Ansicht): void {
        this.ansicht.set(ansicht);
        this.merke();
    }

    oeffneMonat(monat: number, jahr = this.jahr()): void {
        this.jahr.set(jahr);
        this.monat.set(monat);
        this.ansichtWaehlen('monat');
    }

    async weiter(schritt: 1 | -1): Promise<void> {
        const altesJahr = this.jahr();
        if (this.ansicht() === 'jahr') {
            this.jahr.update((j) => j + schritt);
        } else {
            const m = this.monat() + schritt;
            this.monat.set(m < 1 ? 12 : m > 12 ? 1 : m);
            if (m < 1 || m > 12) this.jahr.update((j) => j + schritt);
        }
        if (this.jahr() !== altesJahr) await this.neuLaden();
    }

    async heute(): Promise<void> {
        const h = berlinUhr(new Date());
        const altesJahr = this.jahr();
        this.jahr.set(h.jahr);
        this.monat.set(h.monat);
        if (altesJahr !== h.jahr) await this.neuLaden();
    }

    async anfragen(eingabe: BuchungEingabe): Promise<void> {
        await this.repo.anfragen(this.planIdPflicht(), eingabe);
        await this.neuLaden();
    }

    async eintragen(eingabe: BuchungEingabe): Promise<void> {
        await this.repo.eintragen(this.planIdPflicht(), eingabe);
        await this.neuLaden();
    }

    async annehmen(id: string): Promise<void> {
        await this.repo.annehmen(id);
        await this.neuLaden();
    }

    async ablehnen(id: string, grund: string | null): Promise<void> {
        await this.repo.ablehnen(id, grund);
        await this.neuLaden();
    }

    async zurueckziehen(id: string): Promise<void> {
        await this.repo.zurueckziehen(id);
        await this.neuLaden();
    }

    async loeschen(id: string): Promise<void> {
        await this.repo.loeschen(id);
        await this.neuLaden();
    }

    serieVorschau(serie: SerieEingabe) {
        return this.repo.serieVorschau(this.planIdPflicht(), serie);
    }

    async serieAnlegen(serie: SerieEingabe): Promise<number> {
        const anzahl = await this.repo.serieAnlegen(this.planIdPflicht(), serie);
        await this.neuLaden();
        return anzahl;
    }

    private planIdPflicht(): string {
        const id = this.planId();
        if (!id) throw new Error('Kein Belegungsplan gewählt');
        return id;
    }
}
