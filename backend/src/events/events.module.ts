import { Module } from '@nestjs/common';

import { TenancyModule } from '../tenancy/tenancy.module';

import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';
import { PublicEventsController } from './public-events.controller';
import { SlotsController } from './slots.controller';
import { SlotsService } from './slots.service';

@Module({
  imports: [TenancyModule],
  controllers: [EventsController, SlotsController, GuestsController, PublicEventsController],
  providers: [EventsService, SlotsService, GuestsService],
  exports: [EventsService],
})
export class EventsModule {}
