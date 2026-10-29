import { Injectable, inject } from '@angular/core';

import { ApiService } from '../../../../core/api.service';
import type { BookingEntry, BookingPlan } from '../../../../shared/booking/booking.models';
import { OrganizationService } from '../../../../shared/services/organization.service';
import type { PlaceReservationRepository } from '../domain/place-reservation.repository';

@Injectable()
export class ApiPlaceReservationRepository implements PlaceReservationRepository {
    private readonly api = inject(ApiService);
    private readonly org = inject(OrganizationService);

    private basis(): string {
        const id = this.org.currentOrgId();
        if (!id) throw new Error('Keine Organisation ausgewählt');
        return `/orgs/${id}/booking-calendars`;
    }

    async orte(): Promise<BookingPlan[]> {
        const plaene = await this.api.get<BookingPlan[]>(this.basis());
        return plaene.filter((p) => p.kind === 'place');
    }

    async eintraegeAmTag(planId: string, tag: string): Promise<BookingEntry[]> {
        return this.api.get<BookingEntry[]>(`${this.basis()}/${planId}/bookings`, { from: tag, to: tag });
    }
}
