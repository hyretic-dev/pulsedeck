import { LogMailSender } from '../auth/log-mailer';
import type { MailSender } from '../auth/mail.sender';
import type { MailConfig } from '../config/configuration';

import { ResendMailTransport } from './resend.transport';
import { SmtpMailTransport } from './smtp.transport';
import { TemplatedMailSender } from './templated-mail.sender';

/** Wählt den Mail-Adapter laut validierter Konfiguration (O4). */
export function createMailSender(config: MailConfig): MailSender {
  switch (config.transport) {
    case 'log':
      return new LogMailSender();
    case 'smtp':
      return new TemplatedMailSender(new SmtpMailTransport({ ...config.smtp, from: config.from }));
    case 'resend':
      return new TemplatedMailSender(
        new ResendMailTransport({ apiKey: config.apiKey, from: config.from })
      );
  }
}
