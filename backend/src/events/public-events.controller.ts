import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { EventsService } from './events.service';

/** Öffentliche Termin-Seite (anonym lesbar, nur Termine mit der Rolle `public`). */
@ApiTags('public')
@Controller('public/events')
export class PublicEventsController {
  constructor(private readonly events: EventsService) {}

  @Get(':eventId')
  @ApiOkResponse({ description: 'Öffentlicher Termin mit Organisation' })
  einzeln(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.events.oeffentlich(eventId);
  }
}
