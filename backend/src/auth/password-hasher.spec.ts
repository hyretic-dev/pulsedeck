import { describe, expect, it } from 'vitest';

import { BcryptPasswordHasher } from './password-hasher';

/**
 * Passwort-Hashing für Auth (Auftrag §5).
 * - Neue Hashes sind bcrypt (kein Klartext).
 * - Supabase-Import-Hashes ($2a$-Format) werden verifizierbar bleiben:
 *   Bestehende Konten funktionieren nach der Migration ohne Passwort-Reset.
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

  it('verifiziert Supabase-Import-Hashes im $2a$-Format', () => {
    // Supabase speichert bcrypt-Hashes mit $2a$-Präfix. bcryptjs muss diese
    // verifizieren können, damit importierte Konten ohne Passwort-Reset funktionieren.
    const hash2b = hasher.hash('supabase-import-passwort');
    const supabaseImportHash = `$2a$${hash2b.slice(4)}`;

    expect(hasher.verify('supabase-import-passwort', supabaseImportHash)).toBe(true);
    expect(hasher.verify('falsches-passwort', supabaseImportHash)).toBe(false);
  });
});
