import type { Pool } from 'pg';

import type { VerificationTokenStore } from '../../auth/verification-token.store';

export class PgVerificationTokenStore implements VerificationTokenStore {
  constructor(private readonly pool: Pool) {}

  async save(
    userId: string,
    purpose: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO verification_tokens (purpose, token_hash, user_id, expires_at) VALUES ($1, $2, $3, $4)',
      [purpose, tokenHash, userId, expiresAt]
    );
  }

  /**
   * Atomare Einlösung: DELETE … RETURNING garantiert, dass bei parallelen
   * consume-Aufrufen genau einer gewinnt (exactly-once).
   */
  async consume(purpose: string, tokenHash: string): Promise<string | null> {
    const result = await this.pool.query<{ user_id: string }>(
      'DELETE FROM verification_tokens WHERE purpose = $1 AND token_hash = $2 AND expires_at > now() RETURNING user_id',
      [purpose, tokenHash]
    );
    return result.rows[0]?.user_id ?? null;
  }

  async deleteForUser(userId: string, purpose: string): Promise<void> {
    await this.pool.query('DELETE FROM verification_tokens WHERE user_id = $1 AND purpose = $2', [userId, purpose]);
  }
}
