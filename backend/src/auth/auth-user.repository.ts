/**
 * Port für den Benutzerzugriff des Auth-Moduls.
 * Implementierung (PostgreSQL) entsteht in der Infrastrukturschicht.
 */
export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  isBlocked: boolean;
  /** false = eingeladenes Konto ohne selbst gesetztes Passwort (Standard: true). */
  passwordSet?: boolean;
  /** Plattformadministrator (Standard: false). */
  isPlatformAdmin?: boolean;
}

export interface AuthUserRepository {
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  create(email: string, passwordHash: string): Promise<AuthUser>;
  /** Konto für eine Einladung: unbestätigt, mit unbenutzbarem Hash, `passwordSet = false`. */
  createInvited(email: string, unusablePasswordHash: string): Promise<AuthUser>;
  markEmailVerified(id: string): Promise<void>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
}
