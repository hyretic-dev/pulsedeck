import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { RangeQueryDto } from './dto/booking.dto';
import { PublicBookingsService } from './public-bookings.service';

/** Öffentliche Belegungsansicht (anonym, nur lesen): siehe `PublicBookingsService`. */
@ApiTags('public')
@Controller('public/organizations/:slug/booking-calendars')
export class PublicBookingsController {
  constructor(private readonly oeffentlich: PublicBookingsService) {}

  @Get()
  plaene(@Param('slug') slug: string) {
    return this.oeffentlich.plaene(slug);
  }

  @Get(':calId/bookings')
  buchungen(@Param('slug') slug: string, @Param('calId', ParseUUIDPipe) calId: string, @Query() q: RangeQueryDto) {
    return this.oeffentlich.buchungen(slug, calId, q.from, q.to);
  }
}
