import { afterEach, describe, expect, it } from 'vitest';
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import type { AddressInfo } from 'node:net';

import { MailDeliveryError, type MailMessage } from './mail-transport';
import { SmtpMailTransport } from './smtp.transport';

/**
 * SMTP-Transport gegen einen echten SMTP-Server im Testprozess (kein Mock des Protokolls):
 * Zustellung, Auth nach STARTTLS, Verweigerung von Zugangsdaten ohne TLS, Fehlerabbildung.
 */
describe('SmtpMailTransport (gegen smtp-server im Testprozess)', () => {
  const nachricht: MailMessage = {
    to: 'mitglied@example.org',
    subject: 'Bitte bestätige deine E-Mail-Adresse bei PulseDeck',
    text: 'Klicke: https://app.example/auth/callback?type=verify&token=abc123',
    html: '<p><a href="https://app.example/auth/callback?type=verify&amp;token=abc123">Link</a></p>',
  };

  const server: SMTPServer[] = [];
  afterEach(async () => {
    await Promise.all(server.splice(0).map((s) => new Promise<void>((fertig) => s.close(() => fertig()))));
  });

  async function starteServer(optionen: SMTPServerOptions = {}) {
    const empfangen: ParsedMail[] = [];
    const authVersuche: Array<{ user?: string; password?: string }> = [];
    const smtp = new SMTPServer({
      authOptional: true,
      logger: false,
      onAuth(auth, _sitzung, callback) {
        authVersuche.push({ user: auth.username, password: auth.password });
        if (auth.username === 'mailer' && auth.password === 'geheim') {
          callback(null, { user: auth.username });
        } else {
          callback(new Error('Ungültige Zugangsdaten'));
        }
      },
      onData(stream, _sitzung, callback) {
        simpleParser(stream)
          .then((mail) => {
            empfangen.push(mail);
            callback();
          })
          .catch((fehler) => callback(fehler));
      },
      ...optionen,
    });
    await new Promise<void>((fertig) => smtp.listen(0, '127.0.0.1', fertig));
    server.push(smtp);
    const port = (smtp.server.address() as AddressInfo).port;
    return { port, empfangen, authVersuche };
  }

  it('stellt Text und HTML mit Absender, Empfänger und Umlauten im Betreff zu (Relay ohne Auth)', async () => {
    const { port, empfangen } = await starteServer({ disabledCommands: ['STARTTLS', 'AUTH'] });
    const transport = new SmtpMailTransport({
      host: '127.0.0.1',
      port,
      secure: false,
      from: 'PulseDeck <noreply@pulsedeck.example>',
    });

    await transport.send(nachricht);

    expect(empfangen).toHaveLength(1);
    expect(empfangen[0].subject).toBe(nachricht.subject);
    expect(empfangen[0].from?.value[0].address).toBe('noreply@pulsedeck.example');
    expect(empfangen[0].from?.value[0].name).toBe('PulseDeck');
    expect(empfangen[0].to).toMatchObject({ value: [{ address: 'mitglied@example.org' }] });
    expect(empfangen[0].text).toContain('token=abc123');
    expect(empfangen[0].html).toContain('token=abc123');
  });

  it('authentifiziert sich erst nach STARTTLS mit den Zugangsdaten', async () => {
    const { port, empfangen, authVersuche } = await starteServer();
    const transport = new SmtpMailTransport({
      host: '127.0.0.1',
      port,
      secure: false,
      user: 'mailer',
      password: 'geheim',
      from: 'noreply@pulsedeck.example',
      tls: { rejectUnauthorized: false }, // der Test-Server nutzt ein selbstsigniertes Zertifikat
    });

    await transport.send(nachricht);

    expect(authVersuche).toEqual([{ user: 'mailer', password: 'geheim' }]);
    expect(empfangen).toHaveLength(1);
  });

  it('meldet falsche Zugangsdaten als MailDeliveryError ohne das Passwort preiszugeben', async () => {
    const { port } = await starteServer();
    const transport = new SmtpMailTransport({
      host: '127.0.0.1',
      port,
      secure: false,
      user: 'mailer',
      password: 'falsches-passwort',
      from: 'noreply@pulsedeck.example',
      tls: { rejectUnauthorized: false },
    });

    const fehler = await transport.send(nachricht).catch((e: unknown) => e);

    expect(fehler).toBeInstanceOf(MailDeliveryError);
    expect((fehler as Error).message).not.toContain('falsches-passwort');
  });

  it('sendet Zugangsdaten niemals unverschlüsselt (kein Downgrade, wenn der Server kein STARTTLS anbietet)', async () => {
    const { port, authVersuche, empfangen } = await starteServer({
      disabledCommands: ['STARTTLS'],
      allowInsecureAuth: true, // der Server würde Klartext-Auth akzeptieren
    });
    const transport = new SmtpMailTransport({
      host: '127.0.0.1',
      port,
      secure: false,
      user: 'mailer',
      password: 'geheim',
      from: 'noreply@pulsedeck.example',
    });

    await expect(transport.send(nachricht)).rejects.toBeInstanceOf(MailDeliveryError);

    expect(authVersuche).toHaveLength(0);
    expect(empfangen).toHaveLength(0);
  });

  it('bildet einen nicht erreichbaren Server auf MailDeliveryError ab', async () => {
    const { port } = await starteServer();
    await new Promise<void>((fertig) => server.pop()?.close(() => fertig()));
    const transport = new SmtpMailTransport({
      host: '127.0.0.1',
      port,
      secure: false,
      from: 'noreply@pulsedeck.example',
    });

    await expect(transport.send(nachricht)).rejects.toBeInstanceOf(MailDeliveryError);
  });
});
