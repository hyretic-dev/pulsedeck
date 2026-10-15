import { Module } from '@nestjs/common';

import { KnowledgeModule } from '../knowledge/knowledge.module';
import { NewsletterModule } from '../newsletter/newsletter.module';
import { PushModule } from '../push/push.module';

import { MailOutbox } from './mail-outbox';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [NewsletterModule, PushModule, KnowledgeModule],
  providers: [MailOutbox, SchedulerService],
  exports: [MailOutbox, SchedulerService],
})
export class JobsModule {}
