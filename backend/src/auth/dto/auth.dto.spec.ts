import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { ChangePasswordDto, LoginDto, PasswordResetConsumeDto, SignupDto } from './auth.dto';

/**
 * bcrypt verwendet nur die ersten 72 Bytes eines Passworts; längere werden still gekürzt. Neue
 * Passwörter (Signup, Reset, Änderung) sind daher auf 72 **Bytes** begrenzt (nicht Zeichen:
 * Umlaute und Emojis belegen mehrere Bytes). Das Login lehnt nichts ab, denn bcrypt kürzt dort
 * identisch, und importierte Konten sollen sich weiter anmelden können.
 */
async function fehlerFelder(klasse: new () => object, daten: Record<string, unknown>): Promise<string[]> {
  const fehler = await validate(plainToInstance(klasse, daten) as object);
  return fehler.map((f) => f.property);
}

describe('Passwort-Obergrenze (72 Bytes, E12)', () => {
  const email = 'mitglied@example.org';

  it('akzeptiert 72 Bytes, lehnt 73 ab (Signup)', async () => {
    expect(await fehlerFelder(SignupDto, { email, password: 'a'.repeat(72) })).toEqual([]);
    expect(await fehlerFelder(SignupDto, { email, password: 'a'.repeat(73) })).toEqual(['password']);
  });

  it('zählt Bytes, nicht Zeichen: 36 Umlaute sind 72 Bytes, 37 sind zu lang', async () => {
    expect(await fehlerFelder(SignupDto, { email, password: 'ä'.repeat(36) })).toEqual([]);
    expect(await fehlerFelder(SignupDto, { email, password: 'ä'.repeat(37) })).toEqual(['password']);
    expect(await fehlerFelder(SignupDto, { email, password: '😀'.repeat(19) })).toEqual(['password']); // 76 Bytes
  });

  it('gilt auch für Reset und Passwortänderung', async () => {
    expect(await fehlerFelder(PasswordResetConsumeDto, { token: 't', newPassword: 'a'.repeat(73) })).toEqual(['newPassword']);
    expect(await fehlerFelder(ChangePasswordDto, { oldPassword: 'x', newPassword: 'a'.repeat(73) })).toEqual(['newPassword']);
  });

  it('lässt beim Login auch lange Passwörter zu (importierte Konten)', async () => {
    expect(await fehlerFelder(LoginDto, { email, password: 'a'.repeat(200) })).toEqual([]);
  });
});
