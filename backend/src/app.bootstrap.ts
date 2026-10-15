import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { ErrorContractFilter } from './http/error-contract.filter';
import { requestLogger } from './http/request-logger';

export interface ConfigureAppOptions {
  /** Senke für das JSON-Zugriffslog. Standard: stdout, in Tests (NODE_ENV=test) aus. */
  writeAccessLog?: (zeile: string) => void;
  /** Ursprünge nativer Apps, die die API aufrufen dürfen (CORS_ORIGINS). Leer: keine CORS-Header. */
  corsOrigins?: string[];
}

/** Zentrale App-Konfiguration; von main und den Integrationstests gemeinsam genutzt. */
export function configureApp(app: INestApplication, options: ConfigureAppOptions = {}): void {
  const write =
    options.writeAccessLog ??
    (process.env.NODE_ENV === 'test' ? undefined : (zeile: string) => process.stdout.write(`${zeile}\n`));
  if (write) app.use(requestLogger(write));
  if (options.corsOrigins?.length) {
    // Nur ausdrücklich genannte Ursprünge, Bearer statt Cookies (keine Credentials). Preflight beantwortet der Cors-Handler
    // vor dem Routing, auch für Pfade ohne eigene OPTIONS-Route.
    app.enableCors({
      origin: options.corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'x-chat-session-id'],
      maxAge: 600,
    });
  }
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/liveness', 'health/readiness'],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  );
  app.useGlobalFilters(new ErrorContractFilter());
  // Hinter dem Reverse Proxy (nginx) die Client-IP aus X-Forwarded-For entnehmen (Rate-Limit-Schlüssel).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
}

/**
 * HTTP-Adapter mit exakter Pfad-Schreibweise, sonst ließe sich der Proxy-Block für /api/docs*
 * per `/api/DOCS-json` umgehen. Die App-Einstellung `case sensitive routing` käme zu spät: der
 * ExpressAdapter legt den Router schon im Konstruktor an. Der Router liest `caseSensitive` erst
 * beim Registrieren jeder Route, daher wirkt das Setzen vor allen Routen (Regressionstest:
 * openapi.spec.ts). Von main und den Integrationstests gemeinsam genutzt.
 */
export function createHttpAdapter(): ExpressAdapter {
  const adapter = new ExpressAdapter();
  adapter.getInstance().router.caseSensitive = true;
  return adapter;
}

/** OpenAPI unter /api/docs (UI) und /api/docs-json (Maschinenvertrag). */
export function setupOpenApi(app: INestApplication): void {
  const options = new DocumentBuilder()
    .setTitle('PulseDeck API')
    .setDescription('Authentifizierung (v1); Bearer-Transport, keine Cookies (O2).')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('api/docs', app, document);
}
