import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';
import { BcryptPasswordHasher } from './password-hasher';
import { TokenService } from './token.service';
import type { AuthUser, AuthUserRepository } from './auth-user.repository';
import {
  InMemoryRefreshTokenStore,
  InMemoryVerificationTokenStore,
} from '../../test/auth-memory-stores';
import type { MailSender } from './mail.sender';

/**
 * Magic-Link-Login und Passwort-Reset (Auftrag §5).
 * - Mails gehen nur an registrierte Konten; die Antwort ist bei unbekannten
 *   E-Mails identisch (keine Kontoenumeration).
 * - Reset-Token sind einmalig; ein Reset widerruft alle bestehenden Sessions.
 */
describe('AuthService Magic-Link und Passwort-Reset', () => {
  const appBaseUrl = 'https://app.example.org';
  const registrierterNutzer: AuthUser = {
    id: '44444444-4444-4444-8444-444444444444',
    email: 'mitglied@example.org',
    passwordHash: 'x',
    emailVerified: true,
    isBlocked: false,
  };

  let repository: AuthUserRepository;
  let mailer: MailSender;
  let refreshStore: InMemoryRefreshTokenStore;
  let verificationStore: InMemoryVerificationTokenStore;
  let service: AuthService;

  beforeEach(() => {
    repository = {
      findByEmail: vi.fn().mockResolvedValue(registrierterNutzer),
      findById: vi.fn().mockResolvedValue(registrierterNutzer),
      create: vi.fn(),
      markEmailVerified: vi.fn(),
      createInvited: vi.fn(),
      updatePasswordHash: vi.fn().mockResolvedValue(undefined),
    } satisfies AuthUserRepository;
    mailer = {
      sendVerificationEmail: vi.fn(),
      sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
      sendInvitationEmail: async () => undefined,
      sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
    };
    refreshStore = new InMemoryRefreshTokenStore();
    verificationStore = new InMemoryVerificationTokenStore();
    service = new AuthService(
      repository,
      new BcryptPasswordHasher(),
      new TokenService({
        secret: new TextEncoder().encode('test-secret-test-secret-test-secret-1234'),
        issuer: 'pulsedeck-test',
        audience: 'pulsedeck-app',
        accessTtlSeconds: 900,
      }),
      refreshStore,
      verificationStore,
      mailer,
      appBaseUrl
    );
  });

  describe('Magic-Link-Login', () => {
    it('sendet Login-Links nur an registrierte Konten und antwortet generisch', async () => {
      await service.requestMagicLink('mitglied@example.org');
      expect(mailer.sendMagicLinkEmail).toHaveBeenCalledTimes(1);

      repository.findByEmail = vi.fn().mockResolvedValue(null);
      await expect(
        service.requestMagicLink('unbekannt@example.org')
      ).resolves.toBeUndefined();
      expect(mailer.sendMagicLinkEmail).toHaveBeenCalledTimes(1);
    });

    it('meldet den Nutzer über den Link an; der Link ist nur einmal gültig', async () => {
      await service.requestMagicLink('mitglied@example.org');
      const link = (mailer.sendMagicLinkEmail as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // Der Zweck steht im Link, damit das Frontend den passenden Endpunkt aufrufen kann.
      expect(link).toContain(`${appBaseUrl}/auth/callback?type=magic&token=`);
      const token = link.split('token=')[1];

      const session = await service.consumeMagicLink(token);
      expect(session.userId).toBe(registrierterNutzer.id);

      await expect(service.consumeMagicLink(token)).rejects.toThrow(
        'Link ungültig oder abgelaufen'
      );
    });

    it('sendet Magic-Links nicht an gesperrte Konten', async () => {
      repository.findByEmail = vi
        .fn()
        .mockResolvedValue({ ...registrierterNutzer, isBlocked: true });

      await service.requestMagicLink('mitglied@example.org');

      expect(mailer.sendMagicLinkEmail).not.toHaveBeenCalled();
    });
  });

  describe('Passwort-Reset', () => {
    it('sendet Reset-Links nur an registrierte Konten', async () => {
      await service.requestPasswordReset('mitglied@example.org');
      expect(mailer.sendPasswordResetEmail).toHaveBeenCalledTimes(1);

      repository.findByEmail = vi.fn().mockResolvedValue(null);
      await expect(
        service.requestPasswordReset('unbekannt@example.org')
      ).resolves.toBeUndefined();
      expect(mailer.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    });

    it('setzt ein neues Passwort, widerruft alle Sessions und ist einmalig', async () => {
      await service.requestPasswordReset('mitglied@example.org');
      const link = (mailer.sendPasswordResetEmail as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(link).toContain(`${appBaseUrl}/auth/callback?type=reset&token=`);
      const token = link.split('token=')[1];

      const session = await service.resetPassword(token, 'neues-passwort');

      const [, passwordHash] = (repository.updatePasswordHash as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(new BcryptPasswordHasher().verify('neues-passwort', passwordHash)).toBe(true);
      expect(session.userId).toBe(registrierterNutzer.id);

      await expect(service.resetPassword(token, 'nochmal')).rejects.toThrow(
        'Link ungültig oder abgelaufen'
      );
    });

    it('verhindert die weitere Nutzung alter Sessions nach einem Reset', async () => {
      const hashAltesPasswort = new BcryptPasswordHasher().hash('altes-passwort');
      repository.findByEmail = vi
        .fn()
        .mockResolvedValue({ ...registrierterNutzer, passwordHash: hashAltesPasswort });
      const alteSitzung = await service.loginWithPassword(
        'mitglied@example.org',
        'altes-passwort'
      );
      await service.requestPasswordReset('mitglied@example.org');
      const link = (mailer.sendPasswordResetEmail as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const token = link.split('token=')[1];

      await service.resetPassword(token, 'neues-passwort');

      await expect(service.refreshSession(alteSitzung.refreshToken)).rejects.toThrow(
        'Sitzung ungültig oder abgelaufen'
      );
    });
  });
});
