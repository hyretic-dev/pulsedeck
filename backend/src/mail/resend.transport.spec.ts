import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { MailDeliveryError, type MailMessage } from './mail-transport';
import { ResendMailTransport } from './resend.transport';

/**
 * Resend-Transport gegen einen lokalen HTTP-Server, der die Resend-API simuliert
 * (externe Dienste dürfen für deterministische Tests simuliert werden; ein realer
 * Versand mit echtem Key ist nicht getestet, produktiv läuft SMTP, O4).
 */
describe('ResendMailTransport (simulierte Resend-API)', () => {
  const nachricht: MailMessage = {
    to: 'mitglied@example.org',
    subject: 'Dein Anmelde-Link für PulseDeck',
    text: 'Link: https://app.example/auth/callback?type=magic&token=abc',
    html: '<p>Link</p>',
  };
  const apiKey = 're_test_key_sehr_geheim';

  interface Anfrage {
    methode?: string;
    url?: string;
    headers: IncomingMessage['headers'];
    body: string;
  }

  const offen: Server[] = [];
  afterEach(async () => {
    await Promise.all(offen.splice(0).map((s) => new Promise<void>((f) => s.close(() => f()))));
  });

  async function starteApi(antwort: (anfrage: Anfrage, res: import('node:http').ServerResponse) => void) {
    const anfragen: Anfrage[] = [];
    const http = createServer((req, res) => {
      const stuecke: Buffer[] = [];
      req.on('data', (c: Buffer) => stuecke.push(c));
      req.on('end', () => {
        const anfrage = {
          methode: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(stuecke).toString('utf8'),
        };
        anfragen.push(anfrage);
        antwort(anfrage, res);
      });
    });
    await new Promise<void>((f) => http.listen(0, '127.0.0.1', f));
    offen.push(http);
    const port = (http.address() as AddressInfo).port;
    return { endpoint: `http://127.0.0.1:${port}/emails`, anfragen };
  }

  it('sendet POST mit Bearer-Key und JSON-Körper (from, to, subject, text, html)', async () => {
    const { endpoint, anfragen } = await starteApi((_a, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'abc-123' }));
    });
    const transport = new ResendMailTransport({
      apiKey,
      from: 'PulseDeck <noreply@pulsedeck.example>',
      endpoint,
    });

    await transport.send(nachricht);

    expect(anfragen).toHaveLength(1);
    expect(anfragen[0].methode).toBe('POST');
    expect(anfragen[0].url).toBe('/emails');
    expect(anfragen[0].headers.authorization).toBe(`Bearer ${apiKey}`);
    expect(anfragen[0].headers['content-type']).toContain('application/json');
    expect(JSON.parse(anfragen[0].body)).toEqual({
      from: 'PulseDeck <noreply@pulsedeck.example>',
      to: ['mitglied@example.org'],
      subject: nachricht.subject,
      text: nachricht.text,
      html: nachricht.html,
    });
  });

  it('meldet Client-Fehler (4xx) als MailDeliveryError mit Status und Provider-Meldung, ohne den Key', async () => {
    const { endpoint } = await starteApi((_a, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'validation_error', message: 'Die from-Domain ist nicht verifiziert', statusCode: 422 }));
    });
    const transport = new ResendMailTransport({ apiKey, from: 'noreply@pulsedeck.example', endpoint });

    const fehler = await transport.send(nachricht).catch((e: unknown) => e);

    expect(fehler).toBeInstanceOf(MailDeliveryError);
    expect((fehler as Error).message).toContain('422');
    expect((fehler as Error).message).toContain('Die from-Domain ist nicht verifiziert');
    expect((fehler as Error).message).not.toContain(apiKey);
  });

  it('meldet Server-Fehler (5xx) auch dann als MailDeliveryError, wenn die Antwort kein JSON ist', async () => {
    const { endpoint } = await starteApi((_a, res) => {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<html>Bad Gateway</html>');
    });
    const transport = new ResendMailTransport({ apiKey, from: 'noreply@pulsedeck.example', endpoint });

    const fehler = await transport.send(nachricht).catch((e: unknown) => e);

    expect(fehler).toBeInstanceOf(MailDeliveryError);
    expect((fehler as Error).message).toContain('502');
  });

  it('bricht nach dem Zeitlimit ab, wenn der Provider nicht antwortet', async () => {
    const { endpoint } = await starteApi(() => {
      /* antwortet nie */
    });
    const transport = new ResendMailTransport({
      apiKey,
      from: 'noreply@pulsedeck.example',
      endpoint,
      timeoutMs: 150,
    });

    await expect(transport.send(nachricht)).rejects.toBeInstanceOf(MailDeliveryError);
  });

  it('bildet einen nicht erreichbaren Provider auf MailDeliveryError ab', async () => {
    const { endpoint } = await starteApi(() => undefined);
    await new Promise<void>((f) => offen.pop()?.close(() => f()));
    const transport = new ResendMailTransport({ apiKey, from: 'noreply@pulsedeck.example', endpoint });

    await expect(transport.send(nachricht)).rejects.toBeInstanceOf(MailDeliveryError);
  });
});
