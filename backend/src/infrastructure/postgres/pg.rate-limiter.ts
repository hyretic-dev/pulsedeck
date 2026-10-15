import type { Pool } from 'pg';

import type { RateLimiter, RateLimitConfig, RateLimitResult } from '../../auth/rate-limiter';

/** Festfenster-Rate-Limit auf PostgreSQL-Basis; atomar per Upsert. */
export class PgRateLimiter implements RateLimiter {
  constructor(
    private readonly pool: Pool,
    private readonly config: RateLimitConfig
  ) {}

  async consume(key: string): Promise<RateLimitResult> {
    const fensterStart = new Date(
      Math.floor(Date.now() / this.config.windowMs) * this.config.windowMs
    );
    const result = await this.pool.query<{ count: number }>(
      `INSERT INTO rate_limits (key, window_start, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`,
      [key, fensterStart]
    );
    return { allowed: result.rows[0].count <= this.config.max };
  }
}
