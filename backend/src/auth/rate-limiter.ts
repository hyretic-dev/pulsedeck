/**
 * Port für Missbrauchsschutz (Auftrag §5): Festfenster-Rate-Limit.
 * Der Schlüssel kombiniert Fachkontext, E-Mail und IP, z. B.
 * `login:mail@example.org:203.0.113.4`.
 */
export interface RateLimitResult {
  allowed: boolean;
}

export interface RateLimiter {
  consume(key: string): Promise<RateLimitResult>;
}

/** Konfigurierbare Werte pro Endpunkt-Gruppe (Login bzw. Mail-Versand). */
export interface RateLimitConfig {
  max: number;
  windowMs: number;
}
