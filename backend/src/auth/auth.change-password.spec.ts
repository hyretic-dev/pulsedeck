import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import type { AuthUser, AuthUserRepository } from './auth-user.repository';
import { InMemoryRefreshTokenStore } from '../../test/auth-memory-stores';

/**
 * Schritt A: Passwort-Änderung für eingeloggte Nutzer.
 * - Altes Passwort wird verifiziert; bei falschem altem Passwort generischer Fehler.
 * - Neuer bcrypt-Hash wird gesetzt; alle Sessions des Nutzers werden widerrufen.
 * - Der Nutzer erhält eine neue Session.
 */
describe('AuthService changePassword', () => {
  const nutzer: AuthUser = {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'mitglied@example.org',
    passwordHash: 'hash(altes-passwort)',
    emailVerified: true,
    isBlocked: false,
  };

  let repository: AuthUserRepository;
  let refreshStore: InMemoryRefreshTokenStore;
  let hasher: { verify: (password: string, hash: string) => boolean; hash: (password: string) => string };
  let service: AuthService;

  beforeEach(() => {
    repository = {
      findByEmail: vi.fn(),
      findById: vi.fn().mockResolvedValue(nutzer),
      create: vi.fn(),
      markEmailVerified: vi.fn(),
      createInvited: vi.fn(),
      updatePasswordHash: vi.fn(),
    } satisfies AuthUserRepository;
    refreshStore = new InMemoryRefreshTokenStore();
    hasher = {
      verify: vi.fn((password: string, hash: string) => hash === `hash(${password})`),
      hash: (password: string) => `hash(${password})`,
    };
    service = new AuthService(
      repository,
      hasher,
      new TokenService({
        secret: new TextEncoder().encode('test-secret-test-secret-test-secret-1234'),
        issuer: 'pulsedeck-test',
        audience: 'pulsedeck-app',
        accessTtlSeconds: 900,
      }),
      refreshStore,
      { save: vi.fn(), consume: vi.fn().mockResolvedValue(null), deleteForUser: vi.fn() },
      {
        sendVerificationEmail: vi.fn(),
        sendMagicLinkEmail: vi.fn(),
        sendInvitationEmail: async () => undefined,
        sendPasswordResetEmail: vi.fn(),
      },
      'https://app.example.org'
    );
  });

  function refreshTokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  it('ändert das Passwort, widerruft alle Sessions und stellt eine neue Session aus', async () => {
    await refreshStore.save(nutzer.id, refreshTokenHash('alter-token-1'), new Date());
    await refreshStore.save(nutzer.id, refreshTokenHash('alter-token-2'), new Date());

    const neueSitzung = await service.changePassword(
      nutzer.id,
      'altes-passwort',
      'neues-passwort'
    );

    expect(repository.updatePasswordHash).toHaveBeenCalledWith(
      nutzer.id,
      'hash(neues-passwort)'
    );
    expect(neueSitzung.userId).toBe(nutzer.id);
    expect(neueSitzung.accessToken).toBeTruthy();
    expect(neueSitzung.refreshToken).toBeTruthy();
    // Alle alten Sessions sind widerrufen, nur die neue bleibt.
    await expect(
      service.refreshSession('alter-token-1')
    ).rejects.toThrow('Sitzung ungültig oder abgelaufen');
    await expect(
      service.refreshSession('alter-token-2')
    ).rejects.toThrow('Sitzung ungültig oder abgelaufen');
    expect(
      await service.refreshSession(neueSitzung.refreshToken)
    ).toBeTruthy();
  });

  it('lehnt bei falschem altem Passwort mit generischer Meldung ab', async () => {
    await expect(
      service.changePassword(nutzer.id, 'falsches-passwort', 'neues-passwort')
    ).rejects.toThrow('Aktuelles Passwort ist falsch');
    expect(repository.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('lehnt für unbekannte Nutzer mit derselben generischen Meldung ab', async () => {
    repository.findById = vi.fn().mockResolvedValue(null);

    await expect(
      service.changePassword('00000000-0000-4000-8000-000000000000', 'x', 'y')
    ).rejects.toThrow('Aktuelles Passwort ist falsch');
    expect(repository.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('widerruft auch bei gesperrten Konten keine Sessions (Abweisung vorher)', async () => {
    repository.findById = vi.fn().mockResolvedValue({ ...nutzer, isBlocked: true });

    await expect(
      service.changePassword(nutzer.id, 'altes-passwort', 'neues-passwort')
    ).rejects.toThrow('Dieses Konto ist gesperrt');
    expect(repository.updatePasswordHash).not.toHaveBeenCalled();
  });
});
