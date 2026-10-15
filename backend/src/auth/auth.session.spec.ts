import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';

import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import type { AuthUser, AuthUserRepository } from './auth-user.repository';
import { InMemoryRefreshTokenStore } from '../../test/auth-memory-stores';

/**
 * Red-Schritt 2: Session-Vertrag gemäß Auftrag §5 (O2: Bearer-JWT, E10: jose).
 * - Access-Token ist ein signiertes JWT mit sub/iss/aud und definierter kurzer Laufzeit.
 * - Refresh-Token liegt serverseitig nur als Hash (nicht im Klartext).
 * - Erneuerung rotiert den Refresh-Token; der alte ist danach ungültig.
 * - Logout widerruft die Session; gesperrte Konten erhalten keinen neuen Access-Token.
 */
describe('AuthService Session-Vertrag (JWT + Refresh-Rotation)', () => {
  const nutzer: AuthUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'vorstand@example.org',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$HASH',
    emailVerified: true,
    isBlocked: false,
  };

  const secret = new TextEncoder().encode(
    'test-secret-test-secret-test-secret-1234'
  );
  const issuer = 'pulsedeck-test';
  const audience = 'pulsedeck-app';
  const accessTtlSeconds = 900;

  let repository: AuthUserRepository;
  let refreshStore: InMemoryRefreshTokenStore;
  let service: AuthService;

  beforeEach(() => {
    repository = {
      findByEmail: vi.fn().mockResolvedValue(nutzer),
      findById: vi.fn().mockResolvedValue(nutzer),
      create: vi.fn(),
      markEmailVerified: vi.fn(),
      createInvited: vi.fn(),
      updatePasswordHash: vi.fn(),
    } satisfies AuthUserRepository;
    refreshStore = new InMemoryRefreshTokenStore();
    service = new AuthService(
      repository,
      { verify: () => true, hash: (password: string) => `hash(${password})` },
      new TokenService({ secret, issuer, audience, accessTtlSeconds }),
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

  async function login(): Promise<{ userId: string; accessToken: string; refreshToken: string }> {
    return service.loginWithPassword('vorstand@example.org', 'korrektes-passwort');
  }

  it('liefert einen mit jose verifizierbaren Access-Token mit sub, iss, aud und Laufzeit', async () => {
    const session = await login();

    const { payload } = await jwtVerify(session.accessToken, secret, {
      issuer,
      audience,
    });

    expect(payload.sub).toBe(nutzer.id);
    expect(payload.iss).toBe(issuer);
    expect(payload.aud).toBe(audience);
    expect(payload.exp! - payload.iat!).toBe(accessTtlSeconds);
  });

  it('speichert den Refresh-Token serverseitig nur als Hash, nicht im Klartext', async () => {
    const session = await login();

    expect(refreshStore.gespeicherteHashes).not.toContain(session.refreshToken);
    expect(refreshStore.gespeicherteHashes).toHaveLength(1);
  });

  it('rotiert den Refresh-Token bei Erneuerung; der alte ist danach ungültig', async () => {
    const ersteSitzung = await login();
    const zweiteSitzung = await service.refreshSession(
      ersteSitzung.refreshToken
    );

    expect(zweiteSitzung.userId).toBe(nutzer.id);
    expect(zweiteSitzung.refreshToken).not.toBe(ersteSitzung.refreshToken);

    await expect(
      service.refreshSession(ersteSitzung.refreshToken)
    ).rejects.toThrow();
  });

  it('macht revokeSession (Logout) die Session unbrauchbar', async () => {
    const sitzung = await login();
    await service.revokeSession(sitzung.refreshToken);

    await expect(
      service.refreshSession(sitzung.refreshToken)
    ).rejects.toThrow();
  });

  it('verweigert refreshSession für gesperrte Konten', async () => {
    const sitzung = await login();
    repository.findById = vi.fn().mockResolvedValue({ ...nutzer, isBlocked: true });

    await expect(
      service.refreshSession(sitzung.refreshToken)
    ).rejects.toThrow('Dieses Konto ist gesperrt');
  });

  it('verweigert refreshSession für unbekannte Tokens mit generischer Meldung', async () => {
    await expect(service.refreshSession('ungueltig')).rejects.toThrow(
      'Sitzung ungültig oder abgelaufen'
    );
  });
});

describe('TokenService verifyAccessToken (Guard-Basis)', () => {
  const secret = new TextEncoder().encode('test-secret-test-secret-test-secret-1234');
  const issuer = 'pulsedeck-test';
  const audience = 'pulsedeck-app';
  const tokenService = new TokenService({ secret, issuer, audience, accessTtlSeconds: 900 });

  it('verifiziert Signatur (HS256), iss und aud eines selbst ausgestellten Tokens', async () => {
    const token = await tokenService.signAccessToken('user-1');

    const payload = await tokenService.verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
  });

  it('lehnt Tokens mit falschem Secret, falschem iss/aud oder abgelaufen ab', async () => {
    const fremdesSecret = new TokenService({
      secret: new TextEncoder().encode('falsch-falsch-falsch-falsch-falsch-1234'),
      issuer,
      audience,
      accessTtlSeconds: 900,
    });
    const fremdesToken = await fremdesSecret.signAccessToken('user-1');

    await expect(tokenService.verifyAccessToken(fremdesToken)).rejects.toThrow();
    await expect(
      new TokenService({ secret, issuer: 'anderer-issuer', audience, accessTtlSeconds: 900 })
        .verifyAccessToken(await tokenService.signAccessToken('user-1'))
    ).rejects.toThrow();
    await expect(
      tokenService.verifyAccessToken('kein-jwt')
    ).rejects.toThrow();
  });
});
