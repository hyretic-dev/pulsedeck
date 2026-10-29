import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { uhrzeit } from '../../../../shared/booking/booking-labels';
import type { BookingEntry, BookingPlan } from '../../../../shared/booking/booking.models';
import { TagesBalken, balkenFuerTag } from '../../../../shared/booking/zeitraum';

interface Stunde {
    stunde: number;
    balken: TagesBalken[];
}

/** Die Stunden eines Tages untereinander (Seitenpanel auf schmalen Bildschirmen): freie Stunde antippen = anfragen. */
@Component({
    selector: 'app-booking-day-hours',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <ul class="flex flex-col" aria-label="Stunden des Tages">
            @for (z of zeilen(); track z.stunde) {
            <li class="flex items-stretch border-b border-[var(--color-border)] min-h-11">
                <span class="w-14 flex-none py-2 text-xs text-[var(--color-text-muted)]">{{ uhr(z.stunde) }}</span>
                @if (z.balken.length) {
                <div class="flex flex-1 flex-wrap gap-1 py-1.5 min-w-0">
                    @for (b of z.balken; track b.eintrag.id) {
                    <button type="button" class="stunden-chip" [attr.data-status]="b.eintrag.status"
                        [class.eigene]="b.eintrag.is_mine" (click)="eintragGewaehlt.emit(b.eintrag)">
                        @if (b.eintrag.series_id) {
                        <i class="pi pi-sync text-[10px]"></i>
                        }
                        <span class="truncate">{{ b.eintrag.title ?? 'Belegt' }}</span>
                    </button>
                    }
                </div>
                } @else if (darfAnfragen()) {
                <button type="button" class="flex-1 text-left text-xs text-[var(--color-text-muted)] hover:text-linke py-2"
                    [attr.aria-label]="uhr(z.stunde) + ' Uhr anfragen'" (click)="stundeGewaehlt.emit(z.stunde)">
                    <i class="pi pi-plus text-[10px] mr-1"></i>frei
                </button>
                } @else {
                <span class="flex-1 py-2 text-xs text-[var(--color-text-muted)]">frei</span>
                }
            </li>
            }
        </ul>
    `,
    styleUrl: './booking-day-hours.component.css',
})
export class BookingDayHoursComponent {
    readonly plan = input.required<BookingPlan>();
    readonly eintraege = input.required<ReadonlyArray<BookingEntry>>();
    readonly jahr = input.required<number>();
    readonly monat = input.required<number>();
    readonly tag = input.required<number>();
    readonly darfAnfragen = input(false);

    readonly stundeGewaehlt = output<number>();
    readonly eintragGewaehlt = output<BookingEntry>();

    protected readonly zeilen = computed<Stunde[]>(() => {
        const p = this.plan();
        const balken = balkenFuerTag(this.eintraege(), this.jahr(), this.monat(), this.tag(), p.window_start, p.window_end);
        return Array.from({ length: p.window_end - p.window_start }, (_, i) => {
            const stunde = p.window_start + i;
            return { stunde, balken: balken.filter((b) => b.von <= stunde && stunde < b.bis) };
        });
    });

    protected uhr(stunde: number): string {
        return uhrzeit(stunde);
    }
}
