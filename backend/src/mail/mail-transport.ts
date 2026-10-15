/** Eine fertig zusammengesetzte Nachricht an genau einen Empfänger. */
/** Plattform-Transport (Konfiguration MAIL_TRANSPORT) für Versand außerhalb der Auth-Mails. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Niedrigste Ebene des Mailversands (SMTP, Resend). Wirft MailDeliveryError bei Zustellfehlern. */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

/**
 * Zustellfehler eines Transports. Die Meldung enthält nie Zugangsdaten, Links, Token
 * oder Empfängeradressen, damit sie unbedenklich geloggt werden kann.
 */
export class MailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}
