import { createHash, randomBytes } from 'node:crypto';

import { AuthError } from './auth.error';
import { LINK_VALIDITY_HOURS } from './link-validity';
import { PLATZHALTER_HASH } from './password-hasher';

import type { AccessTokenIssuer } from './access-token.issuer';
import type { AuthUserRepository } from './auth-user.repository';
import type { MailSender } from './mail.sender';
import type { MemberLinker } from '../tenancy/membership';
import type { RefreshTokenStore } from './refresh-token.store';
import type { VerificationTokenStore } from './verification-token.store';

/** Verifiziert Klartext-Passwörter und erzeugt neue Hashes (bcrypt). */
export interface PasswordHasher {
  verify(password: string, hash: string): boolean;
  hash(password: string): string;
}

export interface AuthSession {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFICATION_TTL_MS = LINK_VALIDITY_HOURS * 60 * 60 * 1000;
const PURPOSE_EMAIL_VERIFICATION = 'email_verification';
const PURPOSE_MAGIC_LINK = 'magic_link';
const PURPOSE_PASSWORD_RESET = 'password_reset';

type LinkTyp = 'verify' | 'magic' | 'reset';

function typFuerZweck(purpose: string): LinkTyp {
  return purpose === PURPOSE_PASSWORD_RESET ? 'reset' : 'magic';
}

export class AuthService {
  constructor(
    private readonly users: AuthUserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: AccessTokenIssuer,
    private readonly refreshTokens: RefreshTokenStore,
    private readonly verificationTokens: VerificationTokenStore,
    private readonly mailer: MailSender,
    private readonly appBaseUrl: string,
    private readonly memberLinker?: MemberLinker
  ) {}

  async loginWithPassword(email: string, password: string): Promise<AuthSession> {
    const user = await this.users.findByEmail(email);
    // Immer genau ein Hash-Vergleich (bei unbekannter E-Mail gegen den Platzhalter) und dieselbe
    // Meldung: keine Kontoenumeration über Antwort oder Antwortzeit.
    const passwortStimmt = this.hasher.verify(password, user?.passwordHash ?? PLATZHALTER_HASH);
    if (!user || !passwortStimmt) {
      throw new AuthError('invalid_credentials', 'E-Mail oder Passwort ist falsch', 401);
    }
    if (user.isBlocked) {
      throw new AuthError('account_blocked', 'Dieses Konto ist gesperrt', 403);
    }
    // Erst nach korrektem Passwort prüfen: unbekannte und falsche Credentials bleiben ununterscheidbar.
    if (!user.emailVerified) {
      throw new AuthError('email_not_verified', 'E-Mail-Adresse noch nicht bestätigt', 403);
    }
    // Mitglieder, die nach der Registrierung angelegt wurden, beim nächsten Login verknüpfen.
    await this.memberLinker?.linkByVerifiedEmail(user.id, user.email);
    return this.issueSession(user.id);
  }

  async refreshSession(refreshToken: string): Promise<AuthSession> {
    const userId = await this.refreshTokens.findUserIdByHash(this.hash(refreshToken));
    if (!userId) {
      throw new AuthError('session_invalid', 'Sitzung ungültig oder abgelaufen', 401);
    }
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AuthError('session_invalid', 'Sitzung ungültig oder abgelaufen', 401);
    }
    if (user.isBlocked) {
      throw new AuthError('account_blocked', 'Dieses Konto ist gesperrt', 403);
    }
    // Rotation: alten Token zuerst verbrauchen, dann neuen ausstellen.
    await this.refreshTokens.deleteByHash(this.hash(refreshToken));
    return this.issueSession(user.id);
  }

  async revokeSession(refreshToken: string): Promise<void> {
    await this.refreshTokens.deleteByHash(this.hash(refreshToken));
  }

  async signUp(email: string, password: string): Promise<void> {
    // Hash immer zuerst berechnen (auch für bestehende E-Mails): gleicher Aufwand, keine Enumeration
    // über die Antwortzeit.
    const passwordHash = this.hasher.hash(password);
    const existing = await this.users.findByEmail(email);
    // Bestehende E-Mails nicht unterscheidbar behandeln: kein Account,
    // keine Mail, keine Fehlermeldung — keine Kontoenumeration.
    if (existing) return;

    const user = await this.users.create(email, passwordHash);

    const token = randomBytes(32).toString('base64url');
    await this.verificationTokens.save(
      user.id,
      PURPOSE_EMAIL_VERIFICATION,
      this.hash(token),
      new Date(Date.now() + VERIFICATION_TTL_MS)
    );
    await this.mailer.sendVerificationEmail(user.email, this.callbackLink('verify', token));
  }

  async requestMagicLink(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    // Unbekannte E-Mails und gesperrte Konten antworten identisch: keine Mail.
    if (!user || user.isBlocked) return;
    await this.sendLoginToken(
      user,
      PURPOSE_MAGIC_LINK,
      this.mailer.sendMagicLinkEmail.bind(this.mailer)
    );
  }

  async consumeMagicLink(token: string): Promise<AuthSession> {
    return this.consumeLoginToken(PURPOSE_MAGIC_LINK, token);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.isBlocked) return;
    await this.sendLoginToken(
      user,
      PURPOSE_PASSWORD_RESET,
      this.mailer.sendPasswordResetEmail.bind(this.mailer)
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<AuthSession> {
    const session = await this.consumeLoginToken(PURPOSE_PASSWORD_RESET, token);
    await this.users.updatePasswordHash(session.userId, this.hasher.hash(newPassword));
    // Passwort-Reset macht alle bestehenden Sessions ungültig.
    await this.refreshTokens.deleteAllForUser(session.userId);
    return this.issueSession(session.userId);
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<AuthSession> {
    const user = await this.users.findById(userId);
    // Gleiche Meldung für unbekannte Nutzer und falsches Passwort: keine Enumeration.
    if (!user || !this.hasher.verify(oldPassword, user.passwordHash)) {
      throw new AuthError('invalid_current_password', 'Aktuelles Passwort ist falsch', 403);
    }
    if (user.isBlocked) {
      throw new AuthError('account_blocked', 'Dieses Konto ist gesperrt', 403);
    }
    await this.users.updatePasswordHash(userId, this.hasher.hash(newPassword));
    // Passwort-Änderung macht alle bestehenden Sessions ungültig, nur die neue bleibt.
    await this.refreshTokens.deleteAllForUser(userId);
    return this.issueSession(userId);
  }

  /**
   * E-Mail-Prüfung der Login-Seite (Ersatz der Edge Function send-invitation): Gibt es ein Mitglied
   * mit dieser Adresse? Mit bestätigtem Konto geht es weiter zum Passwort, sonst wird eine Einladung
   * gesendet. Die Antwort enthält bewusst keine Namen oder Organisationen (der Bestand lieferte beides
   * an jeden Anonymen); der Aufrufer begrenzt die Abfragen per Rate-Limit.
   */
  async checkEmail(
    email: string,
    organizationId?: string
  ): Promise<{ status: 'connected' | 'invitation_sent' | 'not_found' }> {
    const ziele = (await this.memberLinker?.findInvitationTargets(email, organizationId)) ?? [];
    if (ziele.length === 0) return { status: 'not_found' };

    const user = await this.users.findByEmail(email);
    if (user?.emailVerified) {
      if (!user.isBlocked) await this.memberLinker?.linkByVerifiedEmail(user.id, user.email);
      return { status: 'connected' };
    }
    if (user?.isBlocked) return { status: 'connected' };
    await this.sendeEinladung(email, ziele[0].organizationName, user);
    return { status: 'invitation_sent' };
  }

  /**
   * Einladung durch einen Administrator (Ersatz von invite-member). Bestätigte Konten erhalten einen
   * Passwort-Reset-Link, alle anderen eine Einladung, die passwortlos anmeldet.
   */
  async ladeEin(email: string, organizationName: string): Promise<{ userId: string; mode: 'invited' | 'reset' }> {
    const user = await this.users.findByEmail(email);
    if (user?.isBlocked) throw new AuthError('account_blocked', 'Dieses Konto ist gesperrt', 403);
    if (user?.emailVerified) {
      await this.sendLoginToken(user, PURPOSE_PASSWORD_RESET, this.mailer.sendPasswordResetEmail.bind(this.mailer));
      return { userId: user.id, mode: 'reset' };
    }
    const eingeladen = await this.sendeEinladung(email, organizationName, user);
    return { userId: eingeladen.id, mode: 'invited' };
  }

  /**
   * Anmelde-Link, den ein Administrator kopieren und selbst weitergeben kann (Ersatz von
   * generate-magic-link, 60 Minuten gültig). Nur für Mitglieder **ohne bestätigtes Konto**: Ein
   * Link für ein bestätigtes Konto wäre die Übernahme dieses Kontos samt aller Organisationen
   * (im Bestand für beliebige E-Mail-Adressen möglich). Bestätigte Konten melden sich selbst an.
   */
  async erzeugeWeitergabeLink(email: string): Promise<{ link: string; userId: string; created: boolean; expiresInMinutes: number }> {
    const user = await this.users.findByEmail(email);
    if (user?.isBlocked) throw new AuthError('account_blocked', 'Dieses Konto ist gesperrt', 403);
    if (user?.emailVerified) {
      throw new AuthError(
        'account_exists',
        'Für dieses Mitglied existiert bereits ein Konto. Es kann sich selbst per Passwort oder „Anmelde-Link senden“ anmelden.',
        409
      );
    }
    const konto = user ?? (await this.users.createInvited(email, this.hasher.hash(randomBytes(32).toString('base64'))));
    await this.verificationTokens.deleteForUser(konto.id, PURPOSE_MAGIC_LINK);
    const token = randomBytes(32).toString('base64url');
    await this.verificationTokens.save(konto.id, PURPOSE_MAGIC_LINK, this.hash(token), new Date(Date.now() + 60 * 60 * 1000));
    return {
      link: this.callbackLink('magic', token),
      userId: konto.id,
      created: !user,
      expiresInMinutes: 60,
    };
  }

  /** Eigenes Konto: Grundlage für die Profilseite (Passwort gesetzt?). */
  async ichSelbst(userId: string): Promise<{ userId: string; email: string; emailVerified: boolean; hasPassword: boolean; isPlatformAdmin: boolean }> {
    const user = await this.users.findById(userId);
    if (!user) throw new AuthError('session_invalid', 'Sitzung ungültig oder abgelaufen', 401);
    return { userId: user.id, email: user.email, emailVerified: user.emailVerified, hasPassword: user.passwordSet !== false, isPlatformAdmin: user.isPlatformAdmin === true };
  }

  /** Erstes Passwort für ein eingeladenes Konto ohne Passwort; bestehende Passwörter ändert changePassword. */
  async setzeErstesPasswort(userId: string, newPassword: string): Promise<AuthSession> {
    const user = await this.users.findById(userId);
    if (!user || user.isBlocked) throw new AuthError('session_invalid', 'Sitzung ungültig oder abgelaufen', 401);
    if (user.passwordSet !== false) {
      throw new AuthError('password_exists', 'Es ist bereits ein Passwort gesetzt. Bitte „Passwort ändern“ mit dem aktuellen Passwort verwenden.', 409);
    }
    await this.users.updatePasswordHash(userId, this.hasher.hash(newPassword));
    await this.refreshTokens.deleteAllForUser(userId);
    return this.issueSession(userId);
  }

  private async sendeEinladung(
    email: string,
    organizationName: string,
    vorhanden: { id: string; email: string } | null | undefined
  ): Promise<{ id: string; email: string }> {
    const konto = vorhanden ?? (await this.users.createInvited(email, this.hasher.hash(randomBytes(32).toString('base64'))));
    await this.verificationTokens.deleteForUser(konto.id, PURPOSE_MAGIC_LINK);
    await this.sendLoginToken(konto, PURPOSE_MAGIC_LINK, (to, link) =>
      this.mailer.sendInvitationEmail(to, link, organizationName)
    );
    return konto;
  }

  async verifyEmail(token: string): Promise<AuthSession> {
    const userId = await this.verificationTokens.consume(
      PURPOSE_EMAIL_VERIFICATION,
      this.hash(token)
    );
    if (!userId) {
      throw new AuthError('link_invalid', 'Link ungültig oder abgelaufen', 401);
    }
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AuthError('link_invalid', 'Link ungültig oder abgelaufen', 401);
    }
    if (user.isBlocked) {
      throw new AuthError('account_blocked', 'Dieses Konto ist gesperrt', 403);
    }
    await this.users.markEmailVerified(userId);
    await this.memberLinker?.linkByVerifiedEmail(user.id, user.email);
    return this.issueSession(userId);
  }

  private async sendLoginToken(
    user: { id: string; email: string },
    purpose: string,
    send: (to: string, link: string) => Promise<void>
  ): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    await this.verificationTokens.save(
      user.id,
      purpose,
      this.hash(token),
      new Date(Date.now() + VERIFICATION_TTL_MS)
    );
    await send(user.email, this.callbackLink(typFuerZweck(purpose), token));
  }

  private async consumeLoginToken(purpose: string, token: string): Promise<AuthSession> {
    const userId = await this.verificationTokens.consume(purpose, this.hash(token));
    if (!userId) {
      throw new AuthError('link_invalid', 'Link ungültig oder abgelaufen', 401);
    }
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AuthError('link_invalid', 'Link ungültig oder abgelaufen', 401);
    }
    if (user.isBlocked) {
      throw new AuthError('account_blocked', 'Dieses Konto ist gesperrt', 403);
    }
    // Das Einlösen eines per Mail verschickten Links beweist Kontrolle über das Postfach.
    if (!user.emailVerified) {
      await this.users.markEmailVerified(user.id);
    }
    await this.memberLinker?.linkByVerifiedEmail(user.id, user.email);
    return this.issueSession(user.id);
  }

  private async issueSession(userId: string): Promise<AuthSession> {
    const accessToken = await this.tokens.signAccessToken(userId);
    const refreshToken = randomBytes(32).toString('base64url');
    await this.refreshTokens.save(
      userId,
      this.hash(refreshToken),
      new Date(Date.now() + REFRESH_TTL_MS)
    );
    return { userId, accessToken, refreshToken };
  }

  /** Der Zweck steht im Link, damit das Frontend den passenden Einlöse-Endpunkt aufruft. */
  private callbackLink(typ: LinkTyp, token: string): string {
    return `${this.appBaseUrl}/auth/callback?type=${typ}&token=${token}`;
  }

  private hash(refreshToken: string): string {
    return createHash('sha256').update(refreshToken).digest('hex');
  }
}
