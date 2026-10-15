import { beforeEach, describe, expect, it, vi } from 'vitest';

const optionen: Array<Record<string, unknown>> = [];
vi.mock('../mail/smtp.transport', () => ({
  SmtpMailTransport: class {
    constructor(o: Record<string, unknown>) {
      optionen.push(o);
    }
  },
}));

import { SecretBox } from '../common/secret-box';

import { baueOrgTransport, newsletterKontext } from './org-smtp';

describe('baueOrgTransport', () => {
  const box = new SecretBox(Buffer.alloc(32, 3));
  const org = '10000000-0000-4000-8000-000000000001';
  const db = (zeile: Record<string, unknown> | undefined) => ({ query: vi.fn().mockResolvedValue({ rows: zeile ? [zeile] : [] }) });
  beforeEach(() => {
    optionen.length = 0;
  });

  it('entschlüsselt das Passwort im Kontext der Organisation, verbindet per aufgelöster Adresse und prüft TLS gegen den Hostnamen', async () => {
    const zeile = { smtp_host: '8.8.8.8', smtp_port: 587, smtp_user: 'mailer', smtp_pass_encrypted: box.seal('geheim', newsletterKontext(org)), smtp_from: 'Verein <v@example.org>', smtp_secure: false };

    await baueOrgTransport(db(zeile), org, box, false);

    expect(optionen[0]).toMatchObject({ host: '8.8.8.8', port: 587, secure: false, user: 'mailer', password: 'geheim', from: 'Verein <v@example.org>', tls: { servername: '8.8.8.8' } });
  });

  it('liefert null ohne SMTP-Server, verweigert interne Ziele und fremde Chiffretexte', async () => {
    expect(await baueOrgTransport(db({ smtp_host: null }), org, box, false)).toBeNull();
    expect(await baueOrgTransport(db(undefined), org, box, false)).toBeNull();
    await expect(baueOrgTransport(db({ smtp_host: '10.0.0.5', smtp_port: 25, smtp_from: 'a@b.example' }), org, box, false)).rejects.toMatchObject({ response: { code: 'smtp_host_not_allowed' } });
    const fremd = box.seal('geheim', newsletterKontext('20000000-0000-4000-8000-000000000002'));
    await expect(baueOrgTransport(db({ smtp_host: '8.8.8.8', smtp_port: 587, smtp_user: 'u', smtp_pass_encrypted: fremd, smtp_from: 'a@b.example' }), org, box, false)).rejects.toThrow('Geheimnis nicht lesbar');
    expect(optionen).toHaveLength(0);
  });
});
