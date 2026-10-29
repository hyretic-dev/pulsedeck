import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { STATUS_TEXT } from './booking-labels';
import type { BuchungsStatus } from './booking.models';

/** Chip mit Status der Belegung (optional mit Planname): angefragt = Warnfarbe, bestätigt = teal mit Haken, abgelehnt/storniert = rot. */
@Component({
    selector: 'app-booking-status-chip',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border" [class]="klassen()">
            <i class="pi text-[10px]" [class]="symbol()"></i>
            @if (planName()) {
            <span class="truncate max-w-[160px]">{{ planName() }}</span>
            <span aria-hidden="true">·</span>
            }
            {{ text() }}
        </span>
    `,
})
export class BookingStatusChipComponent {
    readonly status = input.required<BuchungsStatus>();
    readonly planName = input<string | null>(null);

    protected readonly text = computed(() => STATUS_TEXT[this.status()]);
    protected readonly symbol = computed(
        () => ({ requested: 'pi-clock', approved: 'pi-check', declined: 'pi-times', cancelled: 'pi-times' })[this.status()],
    );
    protected readonly klassen = computed(
        () =>
            ({
                requested: 'bg-[var(--color-warning)]/15 text-[var(--color-warning)] border-[var(--color-warning)]/40',
                approved: 'bg-teal/15 text-teal border-teal/40',
                declined: 'bg-[var(--color-error)]/15 text-[var(--color-error)] border-[var(--color-error)]/40',
                cancelled: 'bg-[var(--color-error)]/15 text-[var(--color-error)] border-[var(--color-error)]/40',
            })[this.status()],
    );
}
