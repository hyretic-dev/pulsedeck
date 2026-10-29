import { DestroyRef, Injectable, inject, signal } from '@angular/core';

import type { OpenBookingRequests } from '../../../../shared/booking/open-booking-requests';
import { BOOKING_REPOSITORY } from '../domain/booking.repository';

/** Zähler für das Badge am Menüpunkt; lädt neu, wenn sich Buchungen ändern oder die Organisation wechselt. */
@Injectable({ providedIn: 'root' })
export class OpenRequestsService implements OpenBookingRequests {
    private readonly repo = inject(BOOKING_REPOSITORY);
    private readonly zaehler = signal(0);
    readonly count = this.zaehler.asReadonly();

    constructor() {
        const abmelden = this.repo.aenderungen(() => void this.laden());
        inject(DestroyRef).onDestroy(abmelden);
        void this.laden();
    }

    private async laden(): Promise<void> {
        try {
            this.zaehler.set(await this.repo.offeneAnfragen());
        } catch {
            // ohne Organisation oder bei Netzfehlern bleibt der letzte Stand; die nächste Meldung lädt neu
        }
    }
}
