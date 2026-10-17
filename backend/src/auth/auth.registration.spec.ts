import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';
import { BcryptPasswordHasher } from './password-hasher';
import { TokenService } from './token.service';
import type { AuthUser, AuthUserRepository } from './auth-user.repository';
import { InMemoryRefreshTokenStore, InMemoryVerificationTokenStore } from '../../test/auth-memory-stores';
import type { MailSender } from './mail.sender';

/**
 * Registrierung + E-Mail-Verifikation (Auftrag §5).
 * - Neue Konten speichern nur bcrypt-Hashes, E-Mail ist unbestätigt.
 * - Bereits registrierte E-Mails erzeugen keinen neuen Account und keine Mail
 *   (keine Kontoenumeration als Parität).
 * - Verifikations-Tokens sind zweckgebunden und genau einmal einlösbar.
 */

describe('AuthService Registrierung und E-Mail-Verifikation', () => {
  const appBaseUrl = 'https://app.example.org';
  const neuerNutzer: AuthUser = {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'neu@example.org',
    passwordHash: 'x',
    emailVerified: false,
    isBlocked: false,
  };

  let repository: AuthUserRepository;
  let mailer: MailSender;
  let service: AuthService;

  beforeEach(() => {
    repository = {
      findByEmail: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(neuerNutzer),
      create: vi.fn().mockResolvedValue(neuerNutzer),
      markEmailVerified: vi.fn().mockResolvedValue(undefined),
      createInvited: vi.fn(),
      updatePasswordHash: vi.fn(),
    } satisfies AuthUserRepository;
    mailer = {
      sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
      sendMagicLinkEmail: vi.fn(),
      sendInvitationEmail: async () => undefined,
      sendPasswordResetEmail: vi.fn(),
    };
    service = new AuthService(
      repository,
      new BcryptPasswordHasher(),
      new TokenService({
        secret: new TextEncoder().encode('test-secret-test-secret-test-secret-1234'),
        issuer: 'pulsedeck-test',
        audience: 'pulsedeck-app',
        accessTtlSeconds: 900,
      }),
      new InMemoryRefreshTokenStore(),
      new InMemoryVerificationTokenStore(),
      mailer,
      appBaseUrl
    );
  });

  it('registriert neue Konten mit bcrypt-Hash, unbestätigter E-Mail und sendet einen Verifikations-Link', async () => {
    await service.signUp('neu@example.org', 'sicheres-passwort');

    const [, passwordHash] = (repository.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(passwordHash).not.toBe('sicheres-passwort');
    expect(new BcryptPasswordHasher().verify('sicheres-passwort', passwordHash)).toBe(true);

    expect(mailer.sendVerificationEmail).toHaveBeenCalledTimes(1);
    const [empfaenger, link] = (mailer.sendVerificationEmail as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(empfaenger).toBe('neu@example.org');
    expect(link).toContain(`${appBaseUrl}/auth/callback?type=verify&token=`);
  });

  it('registriert ohne Passwort ein Konto ohne nutzbares Passwort (Anmeldung per Magic Link) und sendet den Verifikations-Link', async () => {
    repository.createInvited = vi.fn().mockResolvedValue({ ...neuerNutzer, passwordSet: false });

    await service.signUp('neu@example.org');

    expect(repository.create).not.toHaveBeenCalled();
    const [email, passwordHash] = (repository.createInvited as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(email).toBe('neu@example.org');
    expect(passwordHash).toMatch(/^\$2[aby]\$/);
    expect(mailer.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('legt für bereits registrierte E-Mails keinen Account an und sendet keine Mail (keine Enumeration)', async () => {
    repository.findByEmail = vi.fn().mockResolvedValue(neuerNutzer);

    await service.signUp('neu@example.org', 'sicheres-passwort');

    expect(repository.create).not.toHaveBeenCalled();
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('verifiziert die E-Mail über den Token aus dem Link und meldet den Nutzer an', async () => {
    await service.signUp('neu@example.org', 'sicheres-passwort');
    const link = (mailer.sendVerificationEmail as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const token = link.split('token=')[1];

    const session = await service.verifyEmail(token);

    expect(repository.markEmailVerified).toHaveBeenCalledWith(neuerNutzer.id);
    expect(session.userId).toBe(neuerNutzer.id);
    expect(session.accessToken).toBeTruthy();
  });

  it('lässt denselben Verifikations-Token nur einmal einlösen', async () => {
    await service.signUp('neu@example.org', 'sicheres-passwort');
    const link = (mailer.sendVerificationEmail as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const token = link.split('token=')[1];

    await service.verifyEmail(token);

    await expect(service.verifyEmail(token)).rejects.toThrow(
      'Link ungültig oder abgelaufen'
    );
  });

  it('lehnt unbekannte Verifikations-Tokens generisch ab', async () => {
    await expect(service.verifyEmail('ungueltig')).rejects.toThrow(
      'Link ungültig oder abgelaufen'
    );
  });
});
