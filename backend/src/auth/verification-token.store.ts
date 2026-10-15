/**
 * Zweckgebundene, einmalig einlösbare Tokens
 * (E-Mail-Verifikation, Recovery, Magic Link).
 * consume ist atomar: ein Token kann genau einmal verbraucht werden.
 */
export interface VerificationTokenStore {
  save(
    userId: string,
    purpose: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void>;
  consume(purpose: string, tokenHash: string): Promise<string | null>;
  /** Entwertet alle offenen Tokens eines Zwecks (z. B. vor dem erneuten Versand einer Einladung). */
  deleteForUser(userId: string, purpose: string): Promise<void>;
}
