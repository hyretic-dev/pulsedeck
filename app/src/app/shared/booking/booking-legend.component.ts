import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Legende unter dem Raster: Zustände sind nicht nur über die Farbe zu unterscheiden. */
@Component({
    selector: 'app-booking-legend',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './booking-legend.component.html',
    styleUrl: './booking-legend.component.css',
})
export class BookingLegendComponent {
    readonly ansicht = input<'jahr' | 'monat'>('monat');
}
