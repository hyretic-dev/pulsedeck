import type { ConnectionOptions } from 'node:tls';

import { createTransport, type Transporter } from 'nodemailer';

import { MailDeliveryError, type MailMessage, type MailTransport } from './mail-transport';

export interface SmtpTransportOptions {
  host: string;
  port: number;
  /** true = implizites TLS (Port 465), false = STARTTLS, wenn der Server es anbietet. */
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  /** Eigene TLS-Optionen (z. B. interne CA); nicht über Umgebungsvariablen erreichbar. */
  tls?: ConnectionOptions;
}

/**
 * SMTP-Versand über nodemailer. Zugangsdaten werden nie unverschlüsselt gesendet:
 * Ohne implizites TLS wird bei konfigurierten Zugangsdaten STARTTLS erzwungen
 * (kein stiller Downgrade auf Klartext, falls der Server STARTTLS nicht anbietet).
 */
export class SmtpMailTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpTransportOptions) {
    const auth =
      options.user !== undefined && options.password !== undefined
        ? { user: options.user, pass: options.password }
        : undefined;
    this.transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth,
      requireTLS: !options.secure && auth !== undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      tls: options.tls,
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (fehler) {
      throw new MailDeliveryError(beschreibe(fehler));
    }
  }
}

/** Nur Codes, nie die Rohmeldung: sie kann Empfängeradressen oder Serverdetails enthalten. */
function beschreibe(fehler: unknown): string {
  const f = fehler as { code?: unknown; command?: unknown; responseCode?: unknown };
  const teile = [
    typeof f.code === 'string' ? `code=${f.code}` : undefined,
    typeof f.command === 'string' ? `command=${f.command}` : undefined,
    typeof f.responseCode === 'number' ? `responseCode=${f.responseCode}` : undefined,
  ].filter((t): t is string => t !== undefined);
  return `SMTP-Zustellung fehlgeschlagen${teile.length > 0 ? ` (${teile.join(', ')})` : ''}`;
}
