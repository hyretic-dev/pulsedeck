import type { AuthUser, AuthUserRepository } from '../src/auth/auth-user.repository';
import type { RefreshTokenStore } from '../src/auth/refresh-token.store';
import type { VerificationTokenStore } from '../src/auth/verification-token.store';

/** In-Memory-Implementierungen der Auth-Ports für Unit-/Integrationstests. */
export class InMemoryAuthUserRepository implements AuthUserRepository {
  private readonly nutzer = new Map<string, AuthUser>();

  async findByEmail(email: string): Promise<AuthUser | null> {
    return this.suche((user) => user.email === email);
  }

  async findById(id: string): Promise<AuthUser | null> {
    return this.nutzer.get(id) ?? null;
  }

  async create(email: string, passwordHash: string): Promise<AuthUser> {
    const user: AuthUser = {
      id: `user-${this.nutzer.size + 1}`,
      email,
      passwordHash,
      emailVerified: false,
      isBlocked: false,
    };
    this.nutzer.set(user.id, user);
    return user;
  }

  async createInvited(email: string, unusablePasswordHash: string): Promise<AuthUser> {
    const user: AuthUser = {
      id: `user-${this.nutzer.size + 1}`,
      email,
      passwordHash: unusablePasswordHash,
      emailVerified: false,
      isBlocked: false,
      passwordSet: false,
    };
    this.nutzer.set(user.id, user);
    return user;
  }

  async markEmailVerified(id: string): Promise<void> {
    const user = this.nutzer.get(id);
    if (user) this.nutzer.set(id, { ...user, emailVerified: true });
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    const user = this.nutzer.get(id);
    if (user) this.nutzer.set(id, { ...user, passwordHash, passwordSet: true });
  }

  /** Testhilfe: Nutzer direkt anlegen (z. B. für Guard-Tests mit gültigem JWT). */
  anlegen(user: AuthUser): void {
    this.nutzer.set(user.id, user);
  }

  private suche(praedikat: (user: AuthUser) => boolean): AuthUser | null {
    for (const user of this.nutzer.values()) {
      if (praedikat(user)) return user;
    }
    return null;
  }
}
export class InMemoryRefreshTokenStore implements RefreshTokenStore {
  readonly gespeicherteHashes: string[] = [];

  private readonly eintraege = new Map<string, string>();

  async save(userId: string, tokenHash: string, _expiresAt: Date): Promise<void> {
    this.gespeicherteHashes.push(tokenHash);
    this.eintraege.set(tokenHash, userId);
  }

  async findUserIdByHash(tokenHash: string): Promise<string | null> {
    return this.eintraege.get(tokenHash) ?? null;
  }

  async deleteByHash(tokenHash: string): Promise<void> {
    this.eintraege.delete(tokenHash);
  }

  async deleteAllForUser(userId: string): Promise<void> {
    for (const [hash, owner] of this.eintraege) {
      if (owner === userId) {
        this.eintraege.delete(hash);
      }
    }
  }
}

export class InMemoryVerificationTokenStore implements VerificationTokenStore {
  private readonly eintraege = new Map<string, string>();

  async save(
    userId: string,
    purpose: string,
    tokenHash: string,
    _expiresAt: Date
  ): Promise<void> {
    this.eintraege.set(`${purpose}:${tokenHash}`, userId);
  }

  async deleteForUser(userId: string, purpose: string): Promise<void> {
    for (const [key, owner] of this.eintraege) {
      if (owner === userId && key.startsWith(`${purpose}:`)) this.eintraege.delete(key);
    }
  }

  async consume(purpose: string, tokenHash: string): Promise<string | null> {
    const key = `${purpose}:${tokenHash}`;
    const userId = this.eintraege.get(key) ?? null;
    if (userId !== null) {
      this.eintraege.delete(key);
    }
    return userId;
  }
}
