import { Module } from '@nestjs/common';
import type { Pool } from 'pg';

import { EventsModule } from '../events/events.module';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { PgRateLimiter } from '../infrastructure/postgres/pg.rate-limiter';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MembersModule } from '../members/members.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { WorkingGroupsModule } from '../working-groups/working-groups.module';

import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { CHAT_RATE_LIMITER } from './chat.tokens';

@Module({
  imports: [TenancyModule, KnowledgeModule, EventsModule, WorkingGroupsModule, MembersModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    { provide: CHAT_RATE_LIMITER, useFactory: (pool: Pool) => new PgRateLimiter(pool, { max: 60, windowMs: 60 * 60 * 1000 }), inject: [PG_POOL] },
  ],
})
export class ChatModule {}
