import type { Pool } from 'pg';

import type { RefreshTokenStore } from '../../auth/refresh-token.store';

export class PgRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly pool: Pool) {}

  async save(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      'INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, userId, expiresAt]
    );
  }

  async findUserIdByHash(tokenHash: string): Promise<string | null> {
    const result = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now()',
      [tokenHash]
    );
    return result.rows[0]?.user_id ?? null;
  }

  async deleteByHash(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
  }
}
