import type { Pool } from 'pg';

import type { AuthUser, AuthUserRepository } from '../../auth/auth-user.repository';

interface AuthUserRow {
  id: string;
  email: string;
  password_hash: string;
  email_verified: boolean;
  is_blocked: boolean;
  password_set: boolean;
  is_platform_admin: boolean;
}

const SPALTEN = 'id, email::text AS email, password_hash, email_verified, is_blocked, password_set, is_platform_admin';
const SELECT = `SELECT ${SPALTEN} FROM auth_users`;

function zuAuthUser(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    emailVerified: row.email_verified,
    isBlocked: row.is_blocked,
    passwordSet: row.password_set,
    isPlatformAdmin: row.is_platform_admin,
  };
}

export class PgAuthUserRepository implements AuthUserRepository {
  constructor(private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<AuthUser | null> {
    const result = await this.pool.query<AuthUserRow>(`${SELECT} WHERE email = $1`, [email]);
    return result.rows[0] ? zuAuthUser(result.rows[0]) : null;
  }

  async findById(id: string): Promise<AuthUser | null> {
    const result = await this.pool.query<AuthUserRow>(`${SELECT} WHERE id = $1`, [id]);
    return result.rows[0] ? zuAuthUser(result.rows[0]) : null;
  }

  async create(email: string, passwordHash: string): Promise<AuthUser> {
    const result = await this.pool.query<AuthUserRow>(
      `INSERT INTO auth_users (email, password_hash) VALUES ($1, $2) RETURNING ${SPALTEN}`,
      [email, passwordHash]
    );
    return zuAuthUser(result.rows[0]);
  }

  async createInvited(email: string, unusablePasswordHash: string): Promise<AuthUser> {
    const result = await this.pool.query<AuthUserRow>(
      `INSERT INTO auth_users (email, password_hash, password_set) VALUES ($1, $2, false) RETURNING ${SPALTEN}`,
      [email, unusablePasswordHash]
    );
    return zuAuthUser(result.rows[0]);
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth_users SET email_verified = true, updated_at = now() WHERE id = $1',
      [id]
    );
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth_users SET password_hash = $2, password_set = true, updated_at = now() WHERE id = $1',
      [id, passwordHash]
    );
  }
}
