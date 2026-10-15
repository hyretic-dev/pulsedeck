import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from './auth.service';
import { BcryptPasswordHasher } from './password-hasher';
import { TokenService } from './token.service';
import type { AuthUser } from './auth-user.repository';
import {
  InMemoryAuthUserRepository,
  InMemoryRefreshTokenStore,
  InMemoryVerificationTokenStore,
} from '../../test/auth-memory-stores';
import type { MailSender } from './mail.sender';

/**
 * Regression aus dem Abgleich-Audit: Die E-Mail-Verifikation muss wirksam sein.
 * Ohne diese Sperre konnte sich jeder mit einer fremden, unbestätigten E-Mail-Adresse
 * registrieren und sofort anmelden (Voraussetzung für spätere Übernahme von
 * Mitgliedschaften per E-Mail, Auftrag §5).
 * - Passwort-Login verlangt eine bestätigte E-Mail (erst nach korrektem Passwort,
 *   damit unbekannte und falsche Credentials weiter nicht unterscheidbar sind).
 * - Einlösen eines Magic-Links oder Reset-Links beweist Kontrolle über das Postfach
 *   und bestätigt die E-Mail (sonst gäbe es für unbestätigte Konten keinen Ausweg).
 */
describe('AuthService: Login-Sperre für unbestätigte E-Mail', () => {
  const unbestaetigt: AuthUser = {
    id: '55555555-5555-4555-8555-555555555555',
    email: 'neu@example.org',
    passwordHash: '',
    emailVerified: false,
    isBlocked: false,
  };

  let users: InMemoryAuthUserRepository;
  let refreshStore: InMemoryRefreshTokenStore;
  let verificationStore: InMemoryVerificationTokenStore;
  let verschickteLinks: { magic: string[]; reset: string[] };
  let service: AuthService;
  const hasher = new BcryptPasswordHasher();

  beforeEach(() => {
    users = new InMemoryAuthUserRepository();
    users.anlegen({ ...unbestaetigt, passwordHash: hasher.hash('sicheres-passwort') });
    refreshStore = new InMemoryRefreshTokenStore();
    verificationStore = new InMemoryVerificationTokenStore();
    verschickteLinks = { magic: [], reset: [] };
    const mailer: MailSender = {
      sendVerificationEmail: async () => undefined,
      sendMagicLinkEmail: async (_an, link) => {
        verschickteLinks.magic.push(link);
      },
      sendInvitationEmail: async () => undefined,
      sendPasswordResetEmail: async (_an, link) => {
        verschickteLinks.reset.push(link);
      },
    };
    service = new AuthService(
      users,
      hasher,
      new TokenService({
        secret: new TextEncoder().encode('test-secret-test-secret-test-secret-1234'),
        issuer: 'pulsedeck-test',
        audience: 'pulsedeck-app',
        accessTtlSeconds: 900,
      }),
      refreshStore,
      verificationStore,
      mailer,
      'https://app.example.org'
    );
  });

  function tokenAus(link: string): string {
    return link.split('token=')[1];
  }

  it('verweigert den Passwort-Login mit email_not_verified (403) und stellt keine Session aus', async () => {
    await expect(
      service.loginWithPassword('neu@example.org', 'sicheres-passwort')
    ).rejects.toMatchObject({ code: 'email_not_verified', status: 403 });

    expect(refreshStore.gespeicherteHashes).toHaveLength(0);
  });

  it('meldet bei falschem Passwort weiterhin invalid_credentials (kein Hinweis auf den Konto-Zustand)', async () => {
    await expect(
      service.loginWithPassword('neu@example.org', 'falsches-passwort')
    ).rejects.toMatchObject({ code: 'invalid_credentials', status: 401 });
  });

  it('erlaubt den Login nach der Verifikation der E-Mail', async () => {
    await users.markEmailVerified(unbestaetigt.id);

    const session = await service.loginWithPassword('neu@example.org', 'sicheres-passwort');

    expect(session.userId).toBe(unbestaetigt.id);
  });

  it('bestätigt die E-Mail beim Einlösen eines Magic-Links (Postfach-Nachweis)', async () => {
    await service.requestMagicLink('neu@example.org');

    await service.consumeMagicLink(tokenAus(verschickteLinks.magic[0]));

    expect((await users.findById(unbestaetigt.id))?.emailVerified).toBe(true);
    await expect(
      service.loginWithPassword('neu@example.org', 'sicheres-passwort')
    ).resolves.toMatchObject({ userId: unbestaetigt.id });
  });

  it('bestätigt die E-Mail beim Einlösen eines Passwort-Reset-Links (Postfach-Nachweis)', async () => {
    await service.requestPasswordReset('neu@example.org');

    await service.resetPassword(tokenAus(verschickteLinks.reset[0]), 'neues-passwort-123');

    expect((await users.findById(unbestaetigt.id))?.emailVerified).toBe(true);
    await expect(
      service.loginWithPassword('neu@example.org', 'neues-passwort-123')
    ).resolves.toMatchObject({ userId: unbestaetigt.id });
  });
});
