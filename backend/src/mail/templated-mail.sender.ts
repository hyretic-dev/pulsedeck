import { Logger } from '@nestjs/common';

import type { MailSender } from '../auth/mail.sender';

import { invitationMail, magicLinkMail, passwordResetMail, verificationMail, type MailContent } from './mail-templates';
import type { MailTransport } from './mail-transport';

export interface ErrorLogger {
  error(message: string): void;
}

/**
 * Setzt die Auth-Mails zusammen und übergibt sie an einen Transport.
 *
 * Die Zustellung läuft asynchron (der Aufrufer wartet nicht, siehe `zustellen`).
 * Zustellfehler werden geloggt (ohne Link, Token und Empfänger), aber nicht an den Aufrufer
 * gemeldet: Die Auth-Endpunkte antworten für bekannte und unbekannte Konten identisch, ein
 * Provider-Ausfall darf diese Gleichheit nicht aufheben (keine Kontoenumeration). Der
 * Nutzer kann den Versand erneut anstoßen (Rate-Limit: 3 Mails pro Stunde).
 */
export class TemplatedMailSender implements MailSender {
  private readonly laufend = new Set<Promise<void>>();

  constructor(
    private readonly transport: MailTransport,
    private readonly logger: ErrorLogger = new Logger('Mail')
  ) {}

  sendVerificationEmail(to: string, verificationLink: string): Promise<void> {
    return this.zustellen('Verifikation', to, verificationMail(verificationLink));
  }

  sendMagicLinkEmail(to: string, loginLink: string): Promise<void> {
    return this.zustellen('Magic-Link', to, magicLinkMail(loginLink));
  }

  sendInvitationEmail(to: string, loginLink: string, organizationName: string): Promise<void> {
    return this.zustellen('Einladung', to, invitationMail(loginLink, organizationName));
  }

  sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    return this.zustellen('Passwort-Reset', to, passwordResetMail(resetLink));
  }

  /** Wartet beim Herunterfahren (Nest-Lifecycle) auf noch laufende Zustellungen. */
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.laufend]);
  }

  /**
   * Startet die Zustellung und kehrt sofort zurück. Würde der Aufrufer warten, hinge die
   * Antwortzeit vom SMTP-/API-Provider ab, und nur bei bekannten Konten wird überhaupt
   * gesendet: ein Timing-Kanal zur Kontoenumeration.
   */
  private zustellen(art: string, to: string, inhalt: MailContent): Promise<void> {
    const zustellung = this.senden(art, to, inhalt).finally(() => this.laufend.delete(zustellung));
    this.laufend.add(zustellung);
    return Promise.resolve();
  }

  private async senden(art: string, to: string, inhalt: MailContent): Promise<void> {
    try {
      await this.transport.send({ to, ...inhalt });
    } catch (fehler) {
      const grund = fehler instanceof Error ? fehler.message : 'unbekannter Fehler';
      this.logger.error(`Mailversand fehlgeschlagen (${art}): ${grund}`);
    }
  }
}
