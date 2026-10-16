import { describe, expect, it } from 'vitest';

import { BcryptPasswordHasher } from './password-hasher';

/**
 * Passwort-Hashing für Auth (Auftrag §5).
 * - Neue Hashes sind bcrypt (kein Klartext).
 * - Übernommene Hashes im $2a$-Format bleiben verifizierbar:
 *   übernommene Konten funktionieren ohne Passwort-Reset.
 */
describe('BcryptPasswordHasher', () => {
  const hasher = new BcryptPasswordHasher();

  it('erzeugt bcrypt-Hashes, die das Klartext-Passwort nicht enthalten', () => {
    const hash = hasher.hash('sicheres-passwort');

    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(hash).not.toContain('sicheres-passwort');
  });

  it('verifiziert das korrekte Passwort und lehnt falsche ab', () => {
    const hash = hasher.hash('sicheres-passwort');

    expect(hasher.verify('sicheres-passwort', hash)).toBe(true);
    expect(hasher.verify('falsches-passwort', hash)).toBe(false);
  });

  it('verifiziert übernommene Hashes im $2a$-Format', () => {
    // Die übernommenen Konten tragen bcrypt-Hashes mit $2a$-Präfix. bcryptjs muss diese
    // verifizieren können, damit sie ohne Passwort-Reset funktionieren.
    const hash2b = hasher.hash('import-passwort');
    const importHash = `$2a$${hash2b.slice(4)}`;

    expect(hasher.verify('import-passwort', importHash)).toBe(true);
    expect(hasher.verify('falsches-passwort', importHash)).toBe(false);
  });
});
