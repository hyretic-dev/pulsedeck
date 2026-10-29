import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

import { MONATSNAMEN, WOCHENTAG_LANG, uhrzeit } from '../../../../shared/booking/booking-labels';
import { BookingStatusChipComponent } from '../../../../shared/booking/booking-status-chip.component';
import { BookingEntry, BookingPlan, darfEntscheiden } from '../../../../shared/booking/booking.models';
import { berlinUhr, wochentag } from '../../../../shared/booking/zeitraum';

/** Details einer Belegung mit den Aktionen, die die Rolle im Plan erlaubt. */
@Component({
    selector: 'app-booking-entry-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DialogModule, ButtonModule, BookingStatusChipComponent],
    templateUrl: './booking-entry-dialog.component.html',
})
export class BookingEntryDialogComponent {
    readonly sichtbar = model(false);
    readonly eintrag = input<BookingEntry | null>(null);
    readonly plan = input.required<BookingPlan>();

    readonly annehmen = output<BookingEntry>();
    readonly ablehnen = output<BookingEntry>();
    readonly zurueckziehen = output<BookingEntry>();
    readonly loeschen = output<BookingEntry>();

    protected readonly entscheidet = computed(() => darfEntscheiden(this.plan()));
    protected readonly kannEntscheiden = computed(() => this.entscheidet() && this.eintrag()?.status === 'requested');
    protected readonly kannZurueckziehen = computed(() => {
        const e = this.eintrag();
        return !!e && e.is_mine && (e.status === 'requested' || e.status === 'approved');
    });

    protected readonly zeitraum = computed(() => {
        const e = this.eintrag();
        if (!e) return '';
        const b = berlinUhr(e.start_at);
        const en = berlinUhr(e.end_at);
        const datum = (u: typeof b) => `${WOCHENTAG_LANG[wochentag(u.jahr, u.monat, u.tag)]}, ${u.tag}. ${MONATSNAMEN[u.monat - 1]} ${u.jahr}`;
        const ende = en.stunde === 0 ? 24 : en.stunde;
        return b.tag === en.tag && b.monat === en.monat
            ? `${datum(b)}, ${uhrzeit(b.stunde)}–${uhrzeit(ende)} Uhr`
            : `${datum(b)}, ${uhrzeit(b.stunde)} Uhr bis ${datum(en)}, ${uhrzeit(ende)} Uhr`;
    });
}
