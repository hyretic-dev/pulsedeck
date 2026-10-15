import { Logger } from '@nestjs/common';

import type { MailConfig } from '../config/configuration';

import type { ErrorLogger } from './templated-mail.sender';
import type { MailMessage, MailTransport } from './mail-transport';
import { ResendMailTransport } from './resend.transport';
import { SmtpMailTransport } from './smtp.transport';

export const MAIL_DISPATCHER = Symbol('MAIL_DISPATCHER');

/**
 * Versand beliebiger fertiger Nachrichten (Gast-Einladungen, Benachrichtigungen, Newsletter-Tests).
 * Wie bei den Auth-Mails kehrt `dispatch` sofort zurück; Zustellfehler werden geloggt, nie an den
 * Aufrufer gemeldet und enthalten weder Empfänger noch Inhalt.
 */
export interface MailDispatcher {
  dispatch(art: string, nachricht: MailMessage): Promise<void>;
}

export class TransportMailDispatcher implements MailDispatcher {
  private readonly laufend = new Set<Promise<void>>();

  constructor(
    private readonly transport: MailTransport,
    private readonly logger: ErrorLogger = new Logger('Mail')
  ) {}

  dispatch(art: string, nachricht: MailMessage): Promise<void> {
    const zustellung = this.senden(art, nachricht).finally(() => this.laufend.delete(zustellung));
    this.laufend.add(zustellung);
    return Promise.resolve();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.laufend]);
  }

  private async senden(art: string, nachricht: MailMessage): Promise<void> {
    try {
      await this.transport.send(nachricht);
    } catch (fehler) {
      this.logger.error(`Mailversand fehlgeschlagen (${art}): ${fehler instanceof Error ? fehler.message : 'unbekannter Fehler'}`);
    }
  }
}

/** Entwicklungs-Transport: protokolliert nur Art und Betreff, nie den Inhalt. */
class LogMailTransport implements MailTransport {
  private readonly logger = new Logger('Mail(dev)');
  async send(nachricht: MailMessage): Promise<void> {
    this.logger.log(`Mail an ${nachricht.to}: ${nachricht.subject}`);
  }
}

export function createMailTransport(config: MailConfig): MailTransport {
  switch (config.transport) {
    case 'log':
      return new LogMailTransport();
    case 'smtp':
      return new SmtpMailTransport({ ...config.smtp, from: config.from });
    case 'resend':
      return new ResendMailTransport({ apiKey: config.apiKey, from: config.from });
  }
}
