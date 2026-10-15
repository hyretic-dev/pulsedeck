import { describe, expect, it } from 'vitest';

import { LogMailSender } from '../auth/log-mailer';

import { createMailSender } from './mail-sender.factory';
import { TemplatedMailSender } from './templated-mail.sender';

describe('createMailSender (O4)', () => {
  it('wählt den Adapter passend zum konfigurierten Transport', () => {
    expect(createMailSender({ transport: 'log' })).toBeInstanceOf(LogMailSender);
    expect(
      createMailSender({
        transport: 'smtp',
        from: 'noreply@example.org',
        smtp: { host: 'smtp.example.org', port: 587, secure: false },
      })
    ).toBeInstanceOf(TemplatedMailSender);
    expect(
      createMailSender({ transport: 'resend', from: 'noreply@example.org', apiKey: 're_x' })
    ).toBeInstanceOf(TemplatedMailSender);
  });
});
