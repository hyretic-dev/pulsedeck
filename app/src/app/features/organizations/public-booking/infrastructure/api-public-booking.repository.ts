import { Injectable, inject } from '@angular/core';

import { ApiService } from '../../../../core/api.service';
import type { BookingEntry } from '../../../../shared/booking/booking.models';
import type { PublicBookingPlan, PublicBookingRepository } from '../domain/public-booking.repository';

interface OeffentlicheBuchung {
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    event_id: string | null;
}

/** Anonyme Endpunkte `/public/organizations/:slug/booking-calendars`; die Antworten enthalten nur Titel und Zeitraum. */
@Injectable()
export class ApiPublicBookingRepository implements PublicBookingRepository {
    private readonly api = inject(ApiService);

    private basis(slug: string): string {
        return `/public/organizations/${encodeURIComponent(slug)}/booking-calendars`;
    }

    plaene(slug: string): Promise<PublicBookingPlan[]> {
        return this.api.get<PublicBookingPlan[]>(this.basis(slug), undefined, { auth: false });
    }

    async eintraege(slug: string, planId: string, von: string, bis: string): Promise<BookingEntry[]> {
        const zeilen = await this.api.get<OeffentlicheBuchung[]>(`${this.basis(slug)}/${planId}/bookings`, { from: von, to: bis }, { auth: false });
        return zeilen.map((z) => ({
            id: z.id, plan_id: planId, title: z.title, note: null, start_at: z.start_at, end_at: z.end_at, status: 'approved', is_public: true,
            requester_name: null, is_mine: false, series_id: null, event_id: z.event_id, decision_reason: null,
        }));
    }
}
