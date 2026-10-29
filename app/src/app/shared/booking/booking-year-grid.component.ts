import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';

import { MONATSKUERZEL, MONATSNAMEN, WOCHENTAG_LANG } from './booking-labels';
import type { BookingEntry, BookingPlan } from './booking.models';
import { datumsSchluessel, feiertageImJahr } from './feiertage';
import {
    balkenFuerTag, belegungsStufe, berlinUhr, hatOffeneAnfrage, istWochenende, tageImMonat, wochentag,
} from './zeitraum';

export interface TagAuswahl {
    jahr: number;
    monat: number;
    tag: number;
}

interface Zelle {
    tag: number;
    stufe: 0 | 1 | 2 | 3 | 4;
    offen: boolean;
    wochenende: boolean;
    feiertag: string | null;
    heute: boolean;
    beschriftung: string;
}

interface Zeile {
    monat: number;
    name: string;
    kuerzel: string;
    zellen: (Zelle | null)[];
    offene: number;
}

const STUFEN_TEXT = ['frei', 'wenig belegt', 'teilweise belegt', 'überwiegend belegt', 'ausgebucht'] as const;

/** Jahresübersicht wie ein Urlaubsplaner: zwölf Monate untereinander, 31 Tage nebeneinander, Belegungsgrad als Farbstufe. */
@Component({
    selector: 'app-booking-year-grid',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './booking-year-grid.component.html',
    styleUrl: './booking-year-grid.component.css',
})
export class BookingYearGridComponent {
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

    readonly jahr = input.required<number>();
    readonly plan = input.required<BookingPlan>();
    readonly eintraege = input.required<ReadonlyArray<BookingEntry>>();

    readonly tagGewaehlt = output<TagAuswahl>();
    /** Auf schmalen Bildschirmen öffnet das Tippen auf eine Monatszeile den Monat. */
    readonly monatGewaehlt = output<number>();

    protected readonly tageKopf = Array.from({ length: 31 }, (_, i) => i + 1);

    protected readonly zeilen = computed<Zeile[]>(() => {
        const jahr = this.jahr();
        const plan = this.plan();
        const feiertage = feiertageImJahr(jahr, plan.state);
        const heute = berlinUhr(new Date());
        const alle = this.eintraege();
        return Array.from({ length: 12 }, (_, i) => {
            const monat = i + 1;
            const tage = tageImMonat(jahr, monat);
            let offene = 0;
            const zellen = this.tageKopf.map((tag): Zelle | null => {
                if (tag > tage) return null;
                const balken = balkenFuerTag(alle, jahr, monat, tag, plan.window_start, plan.window_end);
                const stufe = belegungsStufe(balken, plan.window_start, plan.window_end);
                const offen = hatOffeneAnfrage(balken);
                if (offen) offene++;
                const feiertag = feiertage.get(datumsSchluessel(jahr, monat, tag)) ?? null;
                const wochenende = istWochenende(jahr, monat, tag);
                const teile = [
                    `${WOCHENTAG_LANG[wochentag(jahr, monat, tag)]}, ${tag}. ${MONATSNAMEN[i]} ${jahr}`,
                    feiertag ? `Feiertag ${feiertag}` : wochenende ? 'Wochenende' : '',
                    STUFEN_TEXT[stufe],
                    offen ? 'offene Anfrage' : '',
                ];
                return {
                    tag, stufe, offen, wochenende, feiertag,
                    heute: heute.jahr === jahr && heute.monat === monat && heute.tag === tag,
                    beschriftung: teile.filter(Boolean).join(', '),
                };
            });
            return { monat, name: MONATSNAMEN[i], kuerzel: MONATSKUERZEL[i], zellen, offene };
        });
    });

    protected tooltip(z: Zelle): string {
        return z.feiertag ?? '';
    }

    /** Pfeiltasten springen zwischen den Tagen und Monaten. */
    protected taste(ereignis: KeyboardEvent, monat: number, tag: number): void {
        const schritt: Record<string, [number, number]> = {
            ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0],
        };
        const s = schritt[ereignis.key];
        if (!s) return;
        ereignis.preventDefault();
        const ziel = this.host.nativeElement.querySelector<HTMLElement>(
            `[data-monat="${monat + s[0]}"][data-tag="${tag + s[1]}"]`,
        );
        ziel?.focus();
    }
}
