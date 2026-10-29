import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TabsModule } from 'primeng/tabs';

import { BookingDayListComponent } from '../../../../shared/booking/booking-day-list.component';
import { BookingLegendComponent } from '../../../../shared/booking/booking-legend.component';
import { MONATSNAMEN } from '../../../../shared/booking/booking-labels';
import { BookingMonthGridComponent } from '../../../../shared/booking/booking-month-grid.component';
import { BookingDayPanelComponent } from '../../../../shared/booking/booking-day-panel.component';
import { BookingYearGridComponent, TagAuswahl } from '../../../../shared/booking/booking-year-grid.component';
import type { BookingEntry } from '../../../../shared/booking/booking.models';
import { TagRef } from '../../../../shared/booking/zeitraum';
import { berechneTheme } from '../../../../shared/theme/org-theme';
import { PublicBookingStore } from '../application/public-booking.store';
import { PUBLIC_BOOKING_REPOSITORY } from '../domain/public-booking.repository';
import { ApiPublicBookingRepository } from '../infrastructure/api-public-booking.repository';

/**
 * Öffentliche Belegung auf der Organisationsseite: volle Breite unter dem Kopfbereich, mehrere Pläne als Tabs, nur Ansicht
 * (keine Anfragen, keine Buchungsknöpfe). Ohne öffentliche Pläne erscheint nichts.
 */
@Component({
    selector: 'app-public-booking',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'block' },
    imports: [
        FormsModule, ButtonModule, SelectModule, SelectButtonModule, TabsModule,
        BookingDayListComponent, BookingDayPanelComponent, BookingLegendComponent, BookingMonthGridComponent, BookingYearGridComponent,
    ],
    providers: [{ provide: PUBLIC_BOOKING_REPOSITORY, useClass: ApiPublicBookingRepository }, PublicBookingStore],
    templateUrl: './public-booking.component.html',
})
export class PublicBookingComponent {
    protected readonly store = inject(PublicBookingStore);
    private readonly router = inject(Router);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly destroyRef = inject(DestroyRef);

    readonly slug = input.required<string>();
    /** Primärfarbe der Organisation; die Raster färben sich damit (auf der öffentlichen Seite gilt kein Dashboard-Theme). */
    readonly farbe = input<string | null>(null);

    protected readonly schmal = signal(false);
    protected readonly ansichtOptionen = [
        { label: 'Jahr', value: 'jahr' as const },
        { label: 'Monat', value: 'monat' as const },
        { label: 'Woche', value: 'woche' as const },
    ];
    protected readonly tagesPanel = signal<TagRef | null>(null);
    protected readonly tagesPanelSichtbar = signal(false);
    protected readonly planAlsAuswahl = computed(() => this.store.plaene().length > 4 || this.schmal());
    protected readonly titelZeile = computed(() => {
        switch (this.store.ansicht()) {
            case 'jahr':
                return String(this.store.jahr());
            case 'monat':
                return `${MONATSNAMEN[this.store.monat() - 1]} ${this.store.jahr()}`;
            case 'woche': {
                const tage = this.store.wochenTage();
                return `KW ${this.store.kalenderwoche().woche} · ${tage[0].tag}.${tage[0].monat}. – ${tage[6].tag}.${tage[6].monat}.${tage[6].jahr}`;
            }
        }
    });

    constructor() {
        const mq = window.matchMedia('(max-width: 767px)');
        this.schmal.set(mq.matches);
        const handler = (e: MediaQueryListEvent) => this.schmal.set(e.matches);
        mq.addEventListener('change', handler);
        this.destroyRef.onDestroy(() => mq.removeEventListener('change', handler));

        effect(() => void this.store.start(this.slug()));
        effect(() => {
            for (const [name, wert] of Object.entries(berechneTheme(this.farbe()))) {
                if (name === '--linke-rgb' || name === '--linke-rot') this.host.nativeElement.style.setProperty(name, wert);
            }
        });
    }

    /** Ein Tag öffnet die Tagesansicht als Seitenpanel (nur Ansicht); die Ansicht dahinter bleibt. */
    protected tagGewaehlt(tag: TagAuswahl | TagRef): void {
        this.tagesPanel.set({ jahr: tag.jahr, monat: tag.monat, tag: tag.tag });
        this.tagesPanelSichtbar.set(true);
    }

    protected planGewaehlt(id: string | number | undefined): void {
        if (typeof id === 'string') void this.store.waehle(id);
    }

    /** Eine Buchung zu einem öffentlichen Termin öffnet dessen Detailseite. */
    protected eintragGewaehlt(eintrag: BookingEntry): void {
        if (eintrag.event_id) {
            this.tagesPanelSichtbar.set(false);
            void this.router.navigate(['/event', eintrag.event_id]);
        }
    }
}
