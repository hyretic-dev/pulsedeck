import { Provider } from '@angular/core';

import { BookingStore } from './application/booking.store';
import { BOOKING_REPOSITORY } from './domain/booking.repository';
import { InMemoryBookingRepository } from './infrastructure/in-memory-booking.repository';

/** DI-Bindings des Belegungsmoduls. PROTOTYP: Beispieldaten; mit der API-Anbindung wird hier `ApiBookingRepository` gebunden. */
export const BOOKING_PROVIDERS: Provider[] = [
    { provide: BOOKING_REPOSITORY, useClass: InMemoryBookingRepository },
    BookingStore,
];
