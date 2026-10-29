import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { MONATSNAMEN, STATUS_TEXT, WOCHENTAG_KUERZEL, WOCHENTAG_LANG, uhrzeit } from './booking-labels';
import type { BookingEntry, RasterPlan } from './booking.models';
import { datumsSchluessel, feiertageImJahr } from './feiertage';
import { TagRef, TagesBalken, balkenFuerTag, berlinUhr, istWochenende, tageImMonat, wochentag } from './zeitraum';

interface ListenChip {
    balken: TagesBalken;
    kurz: string;
    beschriftung: string;
}

interface ListenZeile {
    jahr: number;
    monat: number;
    tag: number;
    wochentag: string;
    wochenende: boolean;
    feiertag: string | null;
    heute: boolean;
    chips: ListenChip[];
    beschriftung: string;
}

/** Senkrechte Tagesliste für schmale Bildschirme (unter `md`, auch Android-App): eine Zeile je Tag, Buchungen als kompakte Chips. */
@Component({
    selector: 'app-booking-day-list',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './booking-day-list.component.html',
    styleUrl: './booking-day-list.component.css',
})
export class BookingDayListComponent {
    readonly jahr = input.required<number>();
    readonly monat = input.required<number>();
    readonly plan = input.required<RasterPlan>();
    readonly eintraege = input.required<ReadonlyArray<BookingEntry>>();
    /** Beliebige Tage (z. B. eine Woche); ersetzt dann die Tage des Monats. */
    readonly tage = input<ReadonlyArray<TagRef> | null>(null);

    readonly eintragGewaehlt = output<BookingEntry>();
    readonly tagGewaehlt = output<TagRef>();

    protected readonly titel = computed(() => `${MONATSNAMEN[this.monat() - 1]} ${this.jahr()}`);

    protected readonly zeilen = computed<ListenZeile[]>(() => {
        const plan = this.plan();
        const jahr0 = this.jahr();
        const monat0 = this.monat();
        const tage: TagRef[] = this.tage()
            ? [...(this.tage() as ReadonlyArray<TagRef>)]
            : Array.from({ length: tageImMonat(jahr0, monat0) }, (_, i) => ({ jahr: jahr0, monat: monat0, tag: i + 1 }));
        const feiertagsJahre = new Map<number, ReadonlyMap<string, string>>();
        const heute = berlinUhr(new Date());
        return tage.map((t): ListenZeile => {
            const { jahr, monat, tag } = t;
            const wt = wochentag(jahr, monat, tag);
            if (!feiertagsJahre.has(jahr)) feiertagsJahre.set(jahr, feiertageImJahr(jahr, plan.state));
            const feiertag = feiertagsJahre.get(jahr)?.get(datumsSchluessel(jahr, monat, tag)) ?? null;
            const chips = balkenFuerTag(this.eintraege(), jahr, monat, tag, plan.window_start, plan.window_end).map((balken) => ({
                balken,
                kurz: `${String(balken.von).padStart(2, '0')}–${String(balken.bis).padStart(2, '0')}`,
                beschriftung: `${balken.eintrag.title ?? 'Belegt'}, ${uhrzeit(balken.von)} bis ${uhrzeit(balken.bis)}, ${STATUS_TEXT[balken.eintrag.status]}${balken.eintrag.is_mine ? ', deine Anfrage' : ''}`,
            }));
            return {
                jahr, monat, tag,
                wochentag: WOCHENTAG_KUERZEL[wt],
                wochenende: istWochenende(jahr, monat, tag),
                feiertag,
                heute: heute.jahr === jahr && heute.monat === monat && heute.tag === tag,
                chips,
                beschriftung: `${WOCHENTAG_LANG[wt]}, ${tag}. ${MONATSNAMEN[monat - 1]}${feiertag ? `, Feiertag ${feiertag}` : ''}`,
            };
        });
    });
}
