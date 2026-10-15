/**
 * Port für die serverseitige Ablage von Refresh-Tokens.
 * Es werden ausschließlich Hashes gespeichert, nie Klartext-Tokens.
 */
export interface RefreshTokenStore {
  save(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findUserIdByHash(tokenHash: string): Promise<string | null>;
  deleteByHash(tokenHash: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}
