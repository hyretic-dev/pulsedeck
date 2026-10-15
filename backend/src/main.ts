import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { configureApp, createHttpAdapter, setupOpenApi } from './app.bootstrap';
import { AppModule } from './app.module';
import { loadAppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  // Start-Validierung: fehlende Pflichtwerte → verständlicher Abbruch, kein Serverstart.
  const config = loadAppConfig(process.env);

  const app = await NestFactory.create(AppModule, createHttpAdapter());
  configureApp(app, { corsOrigins: config.corsOrigins });
  setupOpenApi(app);
  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger('Bootstrap').log(`HTTP auf Port ${config.port}`);
}

bootstrap().catch((fehler: unknown) => {
  console.error(fehler instanceof Error ? fehler.message : String(fehler));
  process.exit(1);
});
