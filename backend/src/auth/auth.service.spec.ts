import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';
import type { AuthUser, AuthUserRepository } from './auth-user.repository';
import type { AccessTokenIssuer } from './access-token.issuer';
import type { RefreshTokenStore } from './refresh-token.store';

/**
 * Passwort-Login als Backend-Vertrag.
 * Fachliche Anforderungen:
 * - Login mit korrekten Zugangsdaten liefert eine Session (Access + Refresh).
 * - Falsches Passwort und unbekannte E-Mail erzeugen dieselbe Fehlermeldung
 *   (keine Kontoenumeration).
 * - Gesperrte Konten können sich nicht anmelden.
 */
describe('AuthService Passwort-Login', () => {
  const verifizierterNutzer: AuthUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'vorstand@example.org',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$HASH',
    emailVerified: true,
    isBlocked: false,
  };

  let repository: AuthUserRepository;
  const issuer: AccessTokenIssuer = {
    signAccessToken: vi.fn().mockResolvedValue('test-access-token'),
  };
  let refreshStore: RefreshTokenStore;

  beforeEach(() => {
    repository = {
      findByEmail: vi.fn().mockResolvedValue(verifizierterNutzer),
      findById: vi.fn().mockResolvedValue(verifizierterNutzer),
      create: vi.fn(),
      markEmailVerified: vi.fn(),
      createInvited: vi.fn(),
      updatePasswordHash: vi.fn(),
    } satisfies AuthUserRepository;
    refreshStore = {
      save: vi.fn().mockResolvedValue(undefined),
      findUserIdByHash: vi.fn().mockResolvedValue(null),
      deleteByHash: vi.fn().mockResolvedValue(undefined),
      deleteAllForUser: vi.fn().mockResolvedValue(undefined),
    } satisfies RefreshTokenStore;
  });

  function erstelleService(verify: (password: string, hash: string) => boolean): AuthService {
    return new AuthService(
      repository,
      { verify, hash: (password: string) => `hash(${password})` },
      issuer,
      refreshStore,
      {
        save: vi.fn(),
        deleteForUser: vi.fn().mockResolvedValue(undefined),
        consume: vi.fn().mockResolvedValue(null),
      },
      {
        sendVerificationEmail: vi.fn(),
        sendMagicLinkEmail: vi.fn(),
        sendInvitationEmail: async () => undefined,
        sendPasswordResetEmail: vi.fn(),
      },
      'https://app.example.org'
    );
  }

  it('liefert eine Session mit Access- und Refresh-Token bei korrektem Passwort', async () => {
    const service = erstelleService(() => true);
    const session = await service.loginWithPassword(
      'vorstand@example.org',
      'korrektes-passwort'
    );

    expect(session.userId).toBe(verifizierterNutzer.id);
    expect(session.accessToken).toBe('test-access-token');
    expect(session.refreshToken).toBeTruthy();
  });

  it('lehnt falsches Passwort mit generischer Authentifizierungsfehler-Meldung ab', async () => {
    const service = erstelleService(() => false);

    await expect(
      service.loginWithPassword('vorstand@example.org', 'falsches-passwort')
    ).rejects.toThrow('E-Mail oder Passwort ist falsch');
  });

  it('gibt bei unbekannter E-Mail dieselbe Meldung wie bei falschem Passwort (keine Kontoenumeration)', async () => {
    repository.findByEmail = vi.fn().mockResolvedValue(null);
    const service = erstelleService(() => false);

    await expect(
      service.loginWithPassword('unbekannt@example.org', 'irgendwas')
    ).rejects.toThrow('E-Mail oder Passwort ist falsch');
  });

  it('lehnt die Anmeldung für gesperrte Konten ab', async () => {
    repository.findByEmail = vi
      .fn()
      .mockResolvedValue({ ...verifizierterNutzer, isBlocked: true });
    const service = erstelleService(() => true);

    await expect(
      service.loginWithPassword('vorstand@example.org', 'korrektes-passwort')
    ).rejects.toThrow('Dieses Konto ist gesperrt');
  });
});
