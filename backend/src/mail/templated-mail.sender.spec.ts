import { describe, expect, it, vi } from 'vitest';

import { MailDeliveryError, type MailMessage, type MailTransport } from './mail-transport';
import { TemplatedMailSender } from './templated-mail.sender';

/**
 * Der TemplatedMailSender setzt die Auth-Mails zusammen und gibt sie an einen Transport.
 * Der Aufrufer wartet nicht auf die Zustellung: Sonst wäre die Antwortzeit der Auth-Endpunkte
 * für bekannte Konten (SMTP-Latenz, im Ausfall ein Timeout) länger als für unbekannte, also
 * ein Timing-Kanal zur Kontoenumeration. Zustellfehler werden geloggt, nicht gemeldet; Logs
 * enthalten weder Link noch Token noch Empfänger. Beim Herunterfahren werden laufende
 * Zustellungen abgewartet.
 */
describe('TemplatedMailSender', () => {
  const link = 'https://app.pulsedeck.example/auth/callback?type=reset&token=geheim-token-123';

  function aufbau(transport: MailTransport) {
    const fehler: string[] = [];
    const sender = new TemplatedMailSender(transport, { error: (m: string) => fehler.push(m) });
    return { sender, fehler };
  }

  it('sendet Verifikations-, Magic-Link- und Reset-Mails an den Empfänger', async () => {
    const gesendet: MailMessage[] = [];
    const { sender } = aufbau({ send: async (m) => void gesendet.push(m) });

    await sender.sendVerificationEmail('a@example.org', link);
    await sender.sendMagicLinkEmail('b@example.org', link);
    await sender.sendPasswordResetEmail('c@example.org', link);
    await sender.onModuleDestroy();

    expect(gesendet.map((m) => m.to)).toEqual(['a@example.org', 'b@example.org', 'c@example.org']);
    expect(gesendet.map((m) => m.subject)).toEqual([
      'Bitte bestätige deine E-Mail-Adresse bei PulseDeck',
      'Dein Anmelde-Link für PulseDeck',
      'Passwort für PulseDeck zurücksetzen',
    ]);
    expect(gesendet.every((m) => m.text.includes(link))).toBe(true);
  });

  it('meldet Zustellfehler nicht an den Aufrufer, loggt sie aber ohne Link, Token und Empfänger', async () => {
    const send = vi.fn().mockRejectedValue(new MailDeliveryError('SMTP-Server nicht erreichbar'));
    const { sender, fehler } = aufbau({ send });

    await expect(sender.sendPasswordResetEmail('c@example.org', link)).resolves.toBeUndefined();
    await sender.onModuleDestroy();

    expect(fehler).toHaveLength(1);
    expect(fehler[0]).toContain('Mailversand fehlgeschlagen');
    expect(fehler[0]).toContain('SMTP-Server nicht erreichbar');
    expect(fehler[0]).not.toContain('geheim-token-123');
    expect(fehler[0]).not.toContain('c@example.org');
  });

  it('loggt auch unerwartete Fehler (z. B. Programmfehler im Transport) und verschluckt sie nicht lautlos', async () => {
    const { sender, fehler } = aufbau({
      send: async () => {
        throw new TypeError('kaputt');
      },
    });

    await sender.sendMagicLinkEmail('b@example.org', link);
    await sender.onModuleDestroy();

    expect(fehler).toHaveLength(1);
    expect(fehler[0]).toContain('kaputt');
  });

  it('antwortet sofort, ohne auf den Transport zu warten (kein Timing-Kanal)', async () => {
    const { sender } = aufbau({ send: () => new Promise<void>(() => undefined) }); // hängt für immer

    const ergebnis = await Promise.race([
      sender.sendMagicLinkEmail('b@example.org', link).then(() => 'zurueck'),
      new Promise<string>((fertig) => setTimeout(() => fertig('wartet'), 200)),
    ]);

    expect(ergebnis).toBe('zurueck');
  });

  it('wartet beim Herunterfahren auf laufende Zustellungen', async () => {
    let zugestellt = false;
    const { sender } = aufbau({
      send: async () => {
        await new Promise((fertig) => setTimeout(fertig, 40));
        zugestellt = true;
      },
    });

    await sender.sendVerificationEmail('a@example.org', link);
    expect(zugestellt).toBe(false);
    await sender.onModuleDestroy();

    expect(zugestellt).toBe(true);
  });
});
