import { Logger } from '@nestjs/common';

import type { MailSender } from './mail.sender';

/**
 * Entwicklungs-Transport bis O4 geklärt ist: schreibt Links statt sie zu senden.
 * Nur für dev/local; loadAppConfig lehnt MAIL_TRANSPORT='log' in der Produktion ab.
 */
export class LogMailSender implements MailSender {
  private readonly logger = new Logger('Mail(dev)');

  async sendVerificationEmail(to: string, verificationLink: string): Promise<void> {
    this.logger.log(`Verifikation an ${to}: ${verificationLink}`);
  }

  async sendMagicLinkEmail(to: string, loginLink: string): Promise<void> {
    this.logger.log(`Magic-Link an ${to}: ${loginLink}`);
  }

  async sendInvitationEmail(to: string, loginLink: string, organizationName: string): Promise<void> {
    this.logger.log(`Einladung (${organizationName}) an ${to}: ${loginLink}`);
  }

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    this.logger.log(`Passwort-Reset an ${to}: ${resetLink}`);
  }
}
