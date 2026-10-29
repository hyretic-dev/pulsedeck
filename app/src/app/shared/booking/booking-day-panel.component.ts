import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';

import { MONATSNAMEN, WOCHENTAG_LANG, uhrzeit } from './booking-labels';
import type { BookingEntry, RasterPlan } from './booking.models';
import { datumsSchluessel, feiertageImJahr } from './feiertage';
import { TagRef, TagesBalken, balkenFuerTag, plusTage, wochentag } from './zeitraum';

interface StundenZeile {
    stunde: number;
    /** Einträge, die in dieser Stunde beginnen. */
    beginnen: TagesBalken[];
    /** Einträge, die schon laufen (mehrstündig oder über Nacht). */
    laufen: TagesBalken[];
}

export interface TagesStunde extends TagRef {
    von: number;
    bis: number;
}

/**
 * Tagesansicht als Seitenpanel: Die Ansicht dahinter (Jahr, Monat, Woche) bleibt, der Tag lässt sich hier ansehen und
 * bearbeiten (freie Stunde antippen = anfragen, Eintrag antippen = Details). Vor und zurück springt von Tag zu Tag.
 * Rechts auf großen, unten auf schmalen Bildschirmen.
 */
@Component({
    selector: 'app-booking-day-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DrawerModule, ButtonModule],
    templateUrl: './booking-day-panel.component.html',
    styleUrl: './booking-day-panel.component.css',
})
export class BookingDayPanelComponent {
    readonly sichtbar = model(false);
    readonly tag = model<TagRef | null>(null);
    readonly plan = input.required<RasterPlan>();
    readonly eintraege = input.required<ReadonlyArray<BookingEntry>>();
    /** Freie Stunden lassen sich anfragen (Rolle im Plan); ohne bleibt es eine reine Ansicht. */
    readonly darfAnfragen = input(false);
    readonly unten = input(false);

    readonly stundeGewaehlt = output<TagesStunde>();
    readonly eintragGewaehlt = output<BookingEntry>();

    protected readonly titel = computed(() => {
        const t = this.tag();
        return t ? `${WOCHENTAG_LANG[wochentag(t.jahr, t.monat, t.tag)]}, ${t.tag}. ${MONATSNAMEN[t.monat - 1]} ${t.jahr}` : '';
    });

    protected readonly feiertag = computed(() => {
        const t = this.tag();
        return t ? (feiertageImJahr(t.jahr, this.plan().state).get(datumsSchluessel(t.jahr, t.monat, t.tag)) ?? null) : null;
    });

    protected readonly zeilen = computed<StundenZeile[]>(() => {
        const t = this.tag();
        const p = this.plan();
        if (!t) return [];
        const balken = balkenFuerTag(this.eintraege(), t.jahr, t.monat, t.tag, p.window_start, p.window_end);
        return Array.from({ length: p.window_end - p.window_start }, (_, i) => {
            const stunde = p.window_start + i;
            return {
                stunde,
                beginnen: balken.filter((b) => b.von === stunde),
                laufen: balken.filter((b) => b.von < stunde && stunde < b.bis),
            };
        });
    });

    protected springe(schritt: 1 | -1): void {
        const t = this.tag();
        if (t) this.tag.set(plusTage(t, schritt));
    }

    protected uhr(stunde: number): string {
        return uhrzeit(stunde);
    }

    protected zeit(b: TagesBalken): string {
        return `${String(b.von).padStart(2, '0')}–${String(b.bis).padStart(2, '0')}`;
    }

    protected waehleStunde(stunde: number): void {
        const t = this.tag();
        if (t) this.stundeGewaehlt.emit({ ...t, von: stunde, bis: stunde + 1 });
    }
}
