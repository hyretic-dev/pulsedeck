import type { Pool } from 'pg';

/** Wartungsendpunkt: bereinigt abgelaufene Tokens serverseitig (Aufruf durch Betrieb/Cron). */
export class PgMaintenance {
  constructor(private readonly pool: Pool) {}

  async purgeExpiredTokens(): Promise<void> {
    await this.pool.query('DELETE FROM verification_tokens WHERE expires_at < now()');
    await this.pool.query('DELETE FROM refresh_tokens WHERE expires_at < now()');
  }
}
