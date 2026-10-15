import type { RateLimiter, RateLimitConfig } from '../src/auth/rate-limiter';

/** Festfenster-Zähler nur für Tests; der Betrieb nutzt PgRateLimiter. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly eintraege = new Map<string, { windowStart: number; count: number }>();

  constructor(private readonly config: RateLimitConfig) {}

  async consume(key: string): Promise<{ allowed: boolean }> {
    const now = Date.now();
    const eintrag = this.eintraege.get(key);
    const windowStart =
      eintrag && now < eintrag.windowStart + this.config.windowMs
        ? eintrag.windowStart
        : now;

    const count = eintrag && windowStart === eintrag.windowStart ? eintrag.count + 1 : 1;
    this.eintraege.set(key, { windowStart, count });
    this.aufraeumen(now);
    return { allowed: count <= this.config.max };
  }

  private aufraeumen(now: number): void {
    for (const [key, eintrag] of this.eintraege) {
      if (now >= eintrag.windowStart + this.config.windowMs) {
        this.eintraege.delete(key);
      }
    }
  }
}
