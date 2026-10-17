import type { RateLimitConfig } from '../auth/rate-limiter';

/** Injektionstoken der validierten Konfiguration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

const MAIL_TRANSPORTS = ['log', 'smtp', 'resend'] as const;

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = implizites TLS (Port 465); sonst STARTTLS. */
  secure: boolean;
  user?: string;
  password?: string;
}

/** 'log' ist nur dev/local nutzbar (Links samt Token landen im Log) und in der Produktion gesperrt. */
export type MailConfig =
  | { transport: 'log' }
  | { transport: 'smtp'; from: string; smtp: SmtpConfig }
  | { transport: 'resend'; from: string; apiKey: string };

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** VAPID-Kontakt: `mailto:` oder `https:`-Adresse. */
  subject: string;
}

export interface AppConfig {
  port: number;
  appBaseUrl: string;
  jwt: {
    secret: Uint8Array;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
  };
  databaseUrl: string;
  mail: MailConfig;
  /** Optionaler Token für den internen Wartungsendpunkt (leer → Endpunkt deaktiviert). */
  maintenanceToken: string | null;
  poolMax: number;
  /** Mindest-Antwortdauer der Mail-Endpunkte in ms (Schutz vor Enumeration über die Antwortzeit). */
  minResponseMs: number;
  rateLimits: {
    login: RateLimitConfig;
    mail: RateLimitConfig;
  };
  /** AES-256-Schlüssel für gespeicherte Geheimnisse (Newsletter-SMTP-Passwort); null → Funktion deaktiviert. */
  secretsKey: Buffer | null;
  /** Hintergrundarbeit (Outbox, Push, Newsletter-Zeitplan, Wartung) in diesem Prozess. */
  jobs: { enabled: boolean; tickMs: number };
  /** Erlaubt Organisations-SMTP-Server in privaten Netzen (nur für Betrieb mit internem Mail-Relay). */
  smtpAllowPrivateHosts: boolean;
  /** Web-Push; null → Push deaktiviert. */
  push: PushConfig | null;
  /** Zeitzone für Zeitpläne (Newsletter). */
  timeZone: string;
  /** Dateispeicher: Verzeichnis (Volume) und Obergrenze je Upload. */
  storage: { dir: string; maxUploadBytes: number };
  /** KI (Chatbot, Wissensbasis); null → Funktionen antworten mit 503 `ai_disabled`. */
  ai: { mistralApiKey: string; baseUrl: string } | null;
  /** Pfad zur Produktdokumentation (DOCS.md) für die Wissensbasis; null → keine globale Dokumentation. */
  docsFile: string | null;
  /** Echtzeit-Änderungsstrom (SSE über PostgreSQL LISTEN/NOTIFY). */
  realtime: { enabled: boolean; heartbeatMs: number; recheckMs: number; maxPerUser: number };
  /** Ursprünge nativer Apps (z. B. capacitor://localhost), die die API aufrufen dürfen; leer = nur gleicher Ursprung. */
  corsOrigins: string[];
}

export class ConfigValidationError extends Error {
  constructor(fehler: string[]) {
    super(`Ungültige Konfiguration:\n- ${fehler.join('\n- ')}`);
    this.name = 'ConfigValidationError';
  }
}

function dekodiereSecret(wert: string): Uint8Array | null {
  if (/^[0-9a-fA-F]+$/.test(wert)) {
    const bytes = Buffer.from(wert, 'hex');
    return bytes.byteLength >= 32 ? new Uint8Array(bytes) : null;
  }
  try {
    const bytes = Buffer.from(wert, 'base64');
    // Buffer.from toleriert ungültige Base64 still, daher Längenprüfung gegen die Decoderwartung.
    if (bytes.byteLength >= 32 && (bytes.toString('base64').replace(/=+$/, '') === wert.replace(/=+$/, ''))) {
      return new Uint8Array(bytes);
    }
    return null;
  } catch {
    return null;
  }
}

function istHttpUrl(wert: string): boolean {
  try {
    const url = new URL(wert);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function ganzeZahl(env: Record<string, string | undefined>, schluessel: string, standard: number): number {
  const wert = env[schluessel];
  if (wert === undefined || wert === '') return standard;
  const zahl = Number(wert);
  if (!Number.isInteger(zahl) || zahl <= 0) {
    throw new ConfigValidationError([`${schluessel} muss eine positive ganze Zahl sein`]);
  }
  return zahl;
}

/** MAIL_FROM: „name@host“ oder „Name <name@host>“, ohne Zeilenumbruch (Header-Injection). */
export function istAbsender(wert: string): boolean {
  return /^[^\r\n<>@]*<?[^\s<>@]+@[^\s<>@]+>?$/.test(wert.trim());
}

/**
 * Mail-Transport laut O4: 'smtp' und 'resend' sind produktiv nutzbar, 'log' nur außerhalb der
 * Produktion. Fehlermeldungen nennen nur Variablennamen, nie Werte.
 */
function leseMailKonfiguration(
  env: Record<string, string | undefined>,
  fehler: string[]
): MailConfig | undefined {
  const transport = env.MAIL_TRANSPORT;
  if (!transport || !(MAIL_TRANSPORTS as readonly string[]).includes(transport)) {
    fehler.push(`MAIL_TRANSPORT fehlt oder ist ungültig (erlaubt: ${MAIL_TRANSPORTS.join(', ')})`);
    return undefined;
  }

  if (transport === 'log') {
    if (env.NODE_ENV === 'production') {
      fehler.push(
        "MAIL_TRANSPORT='log' ist in der Produktion nicht zulässig (Tokens würden geloggt); smtp oder resend konfigurieren"
      );
      return undefined;
    }
    return { transport: 'log' };
  }

  const from = env.MAIL_FROM ?? '';
  const fromGueltig = istAbsender(from);
  if (!fromGueltig) {
    fehler.push('MAIL_FROM fehlt oder ist keine Absenderadresse (z. B. PulseDeck <noreply@example.org>)');
  }

  if (transport === 'resend') {
    const apiKey = env.RESEND_API_KEY ?? '';
    if (!apiKey) fehler.push('RESEND_API_KEY fehlt (MAIL_TRANSPORT=resend)');
    return fromGueltig && apiKey ? { transport: 'resend', from: from.trim(), apiKey } : undefined;
  }

  const host = env.SMTP_HOST ?? '';
  if (!host) fehler.push('SMTP_HOST fehlt (MAIL_TRANSPORT=smtp)');
  let port = 587;
  try {
    port = ganzeZahl(env, 'SMTP_PORT', 587);
  } catch {
    fehler.push('SMTP_PORT muss eine positive ganze Zahl sein');
  }
  const secureWert = env.SMTP_SECURE;
  if (secureWert && secureWert !== 'true' && secureWert !== 'false') {
    fehler.push("SMTP_SECURE muss 'true' oder 'false' sein");
  }
  const user = env.SMTP_USER || undefined;
  const password = env.SMTP_PASSWORD || undefined;
  if (user && !password) fehler.push('SMTP_PASSWORD fehlt (SMTP_USER ist gesetzt)');
  if (password && !user) fehler.push('SMTP_USER fehlt (SMTP_PASSWORD ist gesetzt)');

  if (!fromGueltig || !host || (user && !password) || (password && !user)) return undefined;
  return {
    transport: 'smtp',
    from: from.trim(),
    smtp: {
      host,
      port,
      secure: secureWert ? secureWert === 'true' : port === 465,
      ...(user && password ? { user, password } : {}),
    },
  };
}

export function leseSchluessel(env: Record<string, string | undefined>, fehler: string[]): Buffer | null {
  const wert = env.SECRETS_ENCRYPTION_KEY ?? '';
  if (!wert) {
    if (env.NODE_ENV === 'production') fehler.push('SECRETS_ENCRYPTION_KEY fehlt (32 Bytes, Base64 oder Hex; z. B. `openssl rand -base64 32`)');
    return null;
  }
  const bytes = /^[0-9a-fA-F]{64}$/.test(wert) ? Buffer.from(wert, 'hex') : Buffer.from(wert, 'base64');
  if (bytes.byteLength !== 32 || (!/^[0-9a-fA-F]{64}$/.test(wert) && bytes.toString('base64').replace(/=+$/, '') !== wert.replace(/=+$/, ''))) {
    fehler.push('SECRETS_ENCRYPTION_KEY muss genau 32 Bytes (Base64 oder Hex) enthalten');
    return null;
  }
  return bytes;
}

function lesePush(env: Record<string, string | undefined>, fehler: string[]): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = env.VAPID_PRIVATE_KEY ?? '';
  const subject = env.VAPID_SUBJECT ?? '';
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey) fehler.push('VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY müssen zusammen gesetzt sein (npx web-push generate-vapid-keys)');
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) fehler.push('VAPID_SUBJECT fehlt oder ist weder mailto: noch https:');
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

function leseCorsUrsprung(wert: string | undefined, fehler: string[]): string[] {
  const liste = (wert ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  // exakter Ursprung: Schema://Host[:Port]. `new URL(...).origin` taugt nicht, es liefert für capacitor://… „null“.
  const gueltig = liste.filter((o) => /^[a-z][a-z0-9+.-]*:\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d{1,5})?$/i.test(o));
  if (gueltig.length !== liste.length) fehler.push('CORS_ORIGINS erwartet exakte Ursprünge ohne Pfad und Platzhalter, kommagetrennt (z. B. capacitor://localhost,https://localhost)');
  return gueltig;
}

function leseZeitzone(wert: string | undefined, fehler: string[]): string {
  const zone = wert || 'Europe/Berlin';
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: zone });
    return zone;
  } catch {
    fehler.push('APP_TIMEZONE ist keine gültige IANA-Zeitzone (z. B. Europe/Berlin)');
    return 'Europe/Berlin';
  }
}

/**
 * Liest und validiert die Pflichtkonfiguration beim Start.
 * Fehlende/ungültige Werte führen zu einem verständlichen Abbruch.
 */
export function loadAppConfig(env: Record<string, string | undefined>): AppConfig {
  const fehler: string[] = [];

  const jwtSecretWert = env.JWT_SECRET ?? '';
  const jwtSecret = jwtSecretWert ? dekodiereSecret(jwtSecretWert) : null;
  if (!jwtSecret) {
    fehler.push('JWT_SECRET fehlt oder ist ungültig (mindestens 32 Bytes, Base64 oder Hex)');
  }

  for (const schluessel of ['JWT_ISSUER', 'JWT_AUDIENCE']) {
    if (!env[schluessel]) fehler.push(`${schluessel} fehlt`);
  }

  if (!env.APP_BASE_URL || !istHttpUrl(env.APP_BASE_URL)) {
    fehler.push('APP_BASE_URL fehlt oder ist keine http(s)-URL (Redirect-Basis für Links)');
  }

  if (!env.DATABASE_URL) fehler.push('DATABASE_URL fehlt (Runtime-Zugang)');
  if (!env.DATABASE_URL?.startsWith('postgres')) {
    if (env.DATABASE_URL) fehler.push('DATABASE_URL muss eine PostgreSQL-Verbindung sein');
  }

  const mail = leseMailKonfiguration(env, fehler);
  const secretsKey = leseSchluessel(env, fehler);
  const push = lesePush(env, fehler);
  const timeZone = leseZeitzone(env.APP_TIMEZONE, fehler);
  const corsOrigins = leseCorsUrsprung(env.CORS_ORIGINS, fehler);
  if (env.JOBS_ENABLED && env.JOBS_ENABLED !== 'true' && env.JOBS_ENABLED !== 'false') fehler.push("JOBS_ENABLED muss 'true' oder 'false' sein");
  if (env.REALTIME_ENABLED && env.REALTIME_ENABLED !== 'true' && env.REALTIME_ENABLED !== 'false') fehler.push("REALTIME_ENABLED muss 'true' oder 'false' sein");
  if (env.SMTP_ALLOW_PRIVATE_HOSTS && env.SMTP_ALLOW_PRIVATE_HOSTS !== 'true' && env.SMTP_ALLOW_PRIVATE_HOSTS !== 'false') {
    fehler.push("SMTP_ALLOW_PRIVATE_HOSTS muss 'true' oder 'false' sein");
  }

  if (fehler.length > 0) {
    throw new ConfigValidationError(fehler);
  }

  return {
    port: ganzeZahl(env, 'PORT', 3000),
    appBaseUrl: env.APP_BASE_URL as string,
    jwt: {
      secret: jwtSecret as Uint8Array,
      issuer: env.JWT_ISSUER as string,
      audience: env.JWT_AUDIENCE as string,
      accessTtlSeconds: ganzeZahl(env, 'ACCESS_TTL_SECONDS', 900),
    },
    databaseUrl: env.DATABASE_URL as string,
    mail: mail as MailConfig,
    maintenanceToken: env.MAINTENANCE_TOKEN || null,
    poolMax: ganzeZahl(env, 'PG_POOL_MAX', 10),
    minResponseMs: env.AUTH_MIN_RESPONSE_MS === '0' ? 0 : ganzeZahl(env, 'AUTH_MIN_RESPONSE_MS', 200),
    rateLimits: {
      login: {
        max: ganzeZahl(env, 'RATE_LIMIT_LOGIN_MAX', 5),
        windowMs: ganzeZahl(env, 'RATE_LIMIT_LOGIN_WINDOW_MINUTES', 15) * 60 * 1000,
      },
      mail: {
        max: ganzeZahl(env, 'RATE_LIMIT_MAIL_MAX', 3),
        windowMs: ganzeZahl(env, 'RATE_LIMIT_MAIL_WINDOW_MINUTES', 60) * 60 * 1000,
      },
    },
    secretsKey,
    jobs: { enabled: env.JOBS_ENABLED !== 'false', tickMs: ganzeZahl(env, 'JOBS_TICK_SECONDS', 15) * 1000 },
    smtpAllowPrivateHosts: env.SMTP_ALLOW_PRIVATE_HOSTS === 'true',
    push,
    timeZone,
    storage: { dir: env.FILES_DIR || '/data/files', maxUploadBytes: ganzeZahl(env, 'MAX_UPLOAD_MB', 25) * 1024 * 1024 },
    ai: env.MISTRAL_API_KEY ? { mistralApiKey: env.MISTRAL_API_KEY, baseUrl: env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1' } : null,
    docsFile: env.DOCS_FILE || null,
    realtime: { enabled: env.REALTIME_ENABLED !== 'false', heartbeatMs: 25_000, recheckMs: 60_000, maxPerUser: 5 },
    corsOrigins,
  };
}
