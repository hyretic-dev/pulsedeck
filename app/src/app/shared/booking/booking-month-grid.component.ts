import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';

import { MONATSNAMEN, STATUS_TEXT, WOCHENTAG_KUERZEL, WOCHENTAG_LANG, uhrzeit } from './booking-labels';
import type { BookingEntry, BookingPlan } from './booking.models';
import { datumsSchluessel, feiertageImJahr } from './feiertage';
import {
    TagesBalken, balkenFuerTag, berlinUhr, istWochenende, tageImMonat, verteileAufBahnen, wochentag,
} from './zeitraum';

export interface StundenAuswahl {
    jahr: number;
    monat: number;
    tag: number;
    /** Erste Stunde (inklusive) und Ende (exklusive). */
    von: number;
    bis: number;
}

interface BalkenZeile {
    balken: TagesBalken;
    bahn: number;
    spalteVon: number;
    spalteBis: number;
    beschriftung: string;
}

interface TagesZeile {
    tag: number;
    wochentag: string;
    wochenende: boolean;
    feiertag: string | null;
    heute: boolean;
    bahnen: number;
    balken: BalkenZeile[];
    /** Stunden, die durch die laufende Auswahl markiert sind (Ziehen oder vorgegebener Zeitraum). */
    markiert: ReadonlySet<number>;
    beschriftung: string;
}

interface Ziehen {
    tag: number;
    anker: number;
    aktuell: number;
}

/**
 * Monatsraster: eine Zeile je Tag, eine Spalte je Stunde im Zeitfenster des Plans. Dieselbe Komponente zeigt auch
 * einen einzelnen Tag (`nurTag`, z. B. im Termin-Dialog) und auf schmalen Bildschirmen die senkrechte Tagesliste (`kompakt`).
 */
@Component({
    selector: 'app-booking-month-grid',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './booking-month-grid.component.html',
    styleUrl: './booking-month-grid.component.css',
})
export class BookingMonthGridComponent {
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

    readonly jahr = input.required<number>();
    readonly monat = input.required<number>();
    readonly plan = input.required<BookingPlan>();
    readonly eintraege = input.required<ReadonlyArray<BookingEntry>>();
    readonly nurTag = input<number | null>(null);
    readonly kompakt = input(false);
    /** Zeitraum, der zusätzlich markiert wird (z. B. der Termin im Dialog). */
    readonly markierung = input<{ start_at: string; end_at: string } | null>(null);
    /** Ohne Auswahl per Klick (reine Anzeige, z. B. in der Vorschau). */
    readonly nurAnsicht = input(false);

    readonly stundenGewaehlt = output<StundenAuswahl>();
    readonly eintragGewaehlt = output<BookingEntry>();
    readonly tagGewaehlt = output<number>();

    protected readonly ziehen = signal<Ziehen | null>(null);
    private mausBehandelt = false;

    protected readonly stunden = computed(() => {
        const p = this.plan();
        return Array.from({ length: p.window_end - p.window_start }, (_, i) => p.window_start + i);
    });

    protected readonly titel = computed(() => `${MONATSNAMEN[this.monat() - 1]} ${this.jahr()}`);

    protected readonly zeilen = computed<TagesZeile[]>(() => {
        const jahr = this.jahr();
        const monat = this.monat();
        const plan = this.plan();
        const nur = this.nurTag();
        const feiertage = feiertageImJahr(jahr, plan.state);
        const heute = berlinUhr(new Date());
        const ziehen = this.ziehen();
        const markierung = this.markierung();
        const tage = nur ? [nur] : Array.from({ length: tageImMonat(jahr, monat) }, (_, i) => i + 1);
        return tage.map((tag): TagesZeile => {
            const balken = balkenFuerTag(this.eintraege(), jahr, monat, tag, plan.window_start, plan.window_end);
            const verteilt = verteileAufBahnen(balken).map((v): BalkenZeile => ({
                balken: v.balken,
                bahn: v.bahn,
                spalteVon: v.balken.von - plan.window_start + 2,
                spalteBis: v.balken.bis - plan.window_start + 2,
                beschriftung: this.beschrifteBalken(v.balken),
            }));
            const markiert = new Set<number>();
            if (ziehen && ziehen.tag === tag) {
                for (let h = Math.min(ziehen.anker, ziehen.aktuell); h <= Math.max(ziehen.anker, ziehen.aktuell); h++) markiert.add(h);
            }
            if (markierung) {
                const m = balkenFuerTag(
                    [{ ...this.leererEintrag(), start_at: markierung.start_at, end_at: markierung.end_at, status: 'requested' }],
                    jahr, monat, tag, plan.window_start, plan.window_end,
                )[0];
                if (m) for (let h = m.von; h < m.bis; h++) markiert.add(h);
            }
            const feiertag = feiertage.get(datumsSchluessel(jahr, monat, tag)) ?? null;
            const wt = wochentag(jahr, monat, tag);
            return {
                tag,
                wochentag: WOCHENTAG_KUERZEL[wt],
                wochenende: istWochenende(jahr, monat, tag),
                feiertag,
                heute: heute.jahr === jahr && heute.monat === monat && heute.tag === tag,
                bahnen: Math.max(1, ...verteilt.map((v) => v.bahn + 1)),
                balken: verteilt,
                markiert,
                beschriftung: `${WOCHENTAG_LANG[wt]}, ${tag}. ${MONATSNAMEN[monat - 1]}${feiertag ? `, Feiertag ${feiertag}` : ''}`,
            };
        });
    });

    private leererEintrag(): BookingEntry {
        return {
            id: '', plan_id: '', title: null, note: null, start_at: '', end_at: '', status: 'requested', is_public: false,
            requester_name: null, is_mine: false, series_id: null, event_id: null, decision_reason: null,
        };
    }

    private beschrifteBalken(b: TagesBalken): string {
        const e = b.eintrag;
        const wer = e.title ?? 'Belegt';
        return `${wer}, ${uhrzeit(b.von)} bis ${uhrzeit(b.bis)}, ${STATUS_TEXT[e.status]}${e.is_mine ? ', deine Anfrage' : ''}`;
    }

    protected kurz(b: TagesBalken): string {
        return `${String(b.von).padStart(2, '0')}–${String(b.bis).padStart(2, '0')}`;
    }

    protected stundeBeschriftung(zeile: TagesZeile, stunde: number): string {
        return `${zeile.beschriftung}, ${uhrzeit(stunde)} bis ${uhrzeit(stunde + 1)}, frei`;
    }

    protected ziehenStart(ereignis: PointerEvent, tag: number, stunde: number): void {
        if (this.nurAnsicht() || ereignis.pointerType !== 'mouse' || ereignis.button !== 0) return;
        this.ziehen.set({ tag, anker: stunde, aktuell: stunde });
    }

    protected ziehenWeiter(tag: number, stunde: number): void {
        const z = this.ziehen();
        if (z && z.tag === tag) this.ziehen.set({ ...z, aktuell: stunde });
    }

    protected ziehenEnde(): void {
        const z = this.ziehen();
        if (!z) return;
        this.ziehen.set(null);
        this.mausBehandelt = true;
        this.waehle(z.tag, Math.min(z.anker, z.aktuell), Math.max(z.anker, z.aktuell) + 1);
    }

    /** Klick per Touch oder Tastatur; Mausklicks hat `ziehenEnde` bereits abgehandelt. */
    protected stundeKlick(tag: number, stunde: number): void {
        if (this.mausBehandelt) {
            this.mausBehandelt = false;
            return;
        }
        if (!this.nurAnsicht()) this.waehle(tag, stunde, stunde + 1);
    }

    private waehle(tag: number, von: number, bis: number): void {
        this.stundenGewaehlt.emit({ jahr: this.jahr(), monat: this.monat(), tag, von, bis });
    }

    protected taste(ereignis: KeyboardEvent, tag: number, stunde: number): void {
        const schritt: Record<string, [number, number]> = {
            ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0],
        };
        const s = schritt[ereignis.key];
        if (!s) return;
        ereignis.preventDefault();
        this.host.nativeElement
            .querySelector<HTMLElement>(`[data-tag="${tag + s[0]}"][data-stunde="${stunde + s[1]}"]`)
            ?.focus();
    }
}
