import { compareSync, hashSync } from 'bcryptjs';

import type { PasswordHasher } from './auth.service';

/**
 * Platzhalter-Hash (bcrypt, Kostenfaktor 10) zu einem zufälligen, nicht gespeicherten Passwort.
 * Wird bei unbekannter E-Mail verglichen, damit Login unbekannter und bekannter Konten gleich
 * lange dauert (keine Kontoenumeration über die Antwortzeit). Muss denselben Kostenfaktor
 * wie echte Hashes haben (COST unten).
 */
export const PLATZHALTER_HASH =
  '$2b$10$Y5X2Py8WUJlWHHo8psI06u8HkHOlKzAJkvHwy6E8L6zfxbcKk.gtq';

/**
 * bcrypt mit Kostenfaktor 10; verifiziert auch die übernommenen $2a$-Hashes,
 * damit diese Konten ohne Passwort-Reset weiter funktionieren.
 */
export class BcryptPasswordHasher implements PasswordHasher {
  private static readonly COST = 10;

  verify(password: string, hash: string): boolean {
    return compareSync(password, hash);
  }

  hash(password: string): string {
    return hashSync(password, BcryptPasswordHasher.COST);
  }
}
