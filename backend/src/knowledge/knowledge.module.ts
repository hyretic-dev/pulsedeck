import { Module } from '@nestjs/common';

import { LLM_CLIENT } from '../ai/llm';
import { MistralClient } from '../ai/mistral.client';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { FilesModule } from '../files/files.module';
import { TenancyModule } from '../tenancy/tenancy.module';

import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [TenancyModule, FilesModule],
  controllers: [KnowledgeController],
  providers: [
    { provide: LLM_CLIENT, useFactory: (config: AppConfig) => (config.ai ? new MistralClient(config.ai.mistralApiKey, config.ai.baseUrl) : null), inject: [APP_CONFIG] },
    KnowledgeService,
  ],
  exports: [KnowledgeService, LLM_CLIENT],
})
export class KnowledgeModule {}
