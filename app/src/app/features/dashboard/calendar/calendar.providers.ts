import { Provider } from '@angular/core';

import { PlaceReservationService } from './application/place-reservation.service';
import { PLACE_RESERVATION_REPOSITORY } from './domain/place-reservation.repository';
import { ApiPlaceReservationRepository } from './infrastructure/api-place-reservation.repository';

/** DI-Bindings des Termin-Features: Port → API-Umsetzung. */
export const CALENDAR_PROVIDERS: Provider[] = [
    { provide: PLACE_RESERVATION_REPOSITORY, useClass: ApiPlaceReservationRepository },
    PlaceReservationService,
];
