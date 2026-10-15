/**
 * Injection-Tokens für die Auth-Ports (Implementierungen sind austauschbar:
 * In-Memory für Tests, PostgreSQL für den Betrieb).
 */
export const AUTH_USER_REPOSITORY = Symbol('AUTH_USER_REPOSITORY');
export const REFRESH_TOKEN_STORE = Symbol('REFRESH_TOKEN_STORE');
export const VERIFICATION_TOKEN_STORE = Symbol('VERIFICATION_TOKEN_STORE');
export const MAIL_SENDER = Symbol('MAIL_SENDER');
export const MIN_RESPONSE_MS = Symbol('MIN_RESPONSE_MS');
export const LOGIN_RATE_LIMITER = Symbol('LOGIN_RATE_LIMITER');
export const MAIL_RATE_LIMITER = Symbol('MAIL_RATE_LIMITER');
/** Readiness-Prüfung (Betrieb: DB-Ping); Liveness braucht keine Abhängigkeit. */
export const READINESS_CHECK = Symbol('READINESS_CHECK');
/** Wartungsendpunkt: bereinigt abgelaufene Tokens. */
export const MAINTENANCE_PURGER = Symbol('MAINTENANCE_PURGER');
