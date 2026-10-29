import { Provider } from '@angular/core';

import { OPEN_BOOKING_REQUESTS } from '../../../shared/booking/open-booking-requests';
import { OpenRequestsService } from './application/open-requests.service';
import { BOOKING_REPOSITORY, MEMBER_DIRECTORY } from './domain/booking.repository';
import { ApiBookingRepository } from './infrastructure/api-booking.repository';
import { ApiMemberDirectory } from './infrastructure/api-member-directory';

/**
 * DI-Bindings des Belegungsmoduls: Ports → API-Umsetzung. Stehen in der Anwendungskonfiguration, weil das Layout den
 * Badge-Zähler über `OPEN_BOOKING_REQUESTS` liest; bei einem Backend-Wechsel ändert sich nur diese Datei.
 */
export const BOOKING_PROVIDERS: Provider[] = [
    { provide: BOOKING_REPOSITORY, useClass: ApiBookingRepository },
    { provide: MEMBER_DIRECTORY, useClass: ApiMemberDirectory },
    { provide: OPEN_BOOKING_REQUESTS, useExisting: OpenRequestsService },
];
