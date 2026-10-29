import { Module } from '@nestjs/common';

import { TenancyModule } from '../tenancy/tenancy.module';

import { BookingAccessService } from './booking-access.service';
import { BookingLinkService } from './booking-link.service';
import { BookingNotifier } from './booking-notifier';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { CalendarsService } from './calendars.service';
import { PublicBookingsController } from './public-bookings.controller';
import { PublicBookingsService } from './public-bookings.service';
import { SeriesService } from './series.service';

@Module({
  imports: [TenancyModule],
  controllers: [BookingsController, PublicBookingsController],
  providers: [BookingAccessService, BookingNotifier, BookingLinkService, CalendarsService, BookingsService, SeriesService, PublicBookingsService],
  exports: [BookingLinkService],
})
export class BookingsModule {}
