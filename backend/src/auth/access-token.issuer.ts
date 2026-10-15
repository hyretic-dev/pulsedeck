/** Stellt signierte Access-Token aus. */
export interface AccessTokenIssuer {
  signAccessToken(userId: string): Promise<string>;
}
