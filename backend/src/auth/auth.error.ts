/**
 * Fachlicher Fehler mit HTTP-Status und stabilem Maschinencode.
 * Meldungen bleiben generisch (keine Enumeration).
 */
export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
