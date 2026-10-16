import { Module } from '@nestjs/common';

import { AccountModule } from './account/account.module';
import { ActivityModule } from './activity/activity.module';
import { AuthModule } from './auth/auth.module';
import { CalendarModule } from './calendar/calendar.module';
import { ChatModule } from './chat/chat.module';
import { ContactsModule } from './contacts/contacts.module';
import { EventsModule } from './events/events.module';
import { FeedModule } from './feed/feed.module';
import { JobsModule } from './jobs/jobs.module';
import { FilesModule } from './files/files.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { MembersModule } from './members/members.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { PushModule } from './push/push.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PlatformModule } from './platform/platform.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SeoModule } from './seo/seo.module';
import { SkillsModule } from './skills/skills.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { WikiModule } from './wiki/wiki.module';
import { WorkingGroupsModule } from './working-groups/working-groups.module';

/** Wurzelmodul: Querschnitt, Authentifizierung, Mandantenkontext und die Fachmodule. */
@Module({
  imports: [PlatformModule, AuthModule, AccountModule, TenancyModule, OrganizationsModule, MembersModule, SkillsModule, WorkingGroupsModule, EventsModule, FeedModule, WikiModule, ContactsModule, NewsletterModule, JobsModule, PushModule, FilesModule, KnowledgeModule, ChatModule, ActivityModule, CalendarModule, SeoModule, RealtimeModule],
})
export class AppModule {}
