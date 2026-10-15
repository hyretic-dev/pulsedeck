import { describe, expect, it } from 'vitest';

import { istNichtOeffentlich, pruefeSmtpZiel } from './smtp-host-guard';

describe('SMTP-Zielprüfung', () => {
  it('erkennt private, lokale und reservierte Adressen (IPv4 und IPv6)', () => {
    for (const adresse of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', 'kein-ip']) {
      expect(istNichtOeffentlich(adresse), adresse).toBe(true);
    }
    for (const adresse of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '172.15.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(istNichtOeffentlich(adresse), adresse).toBe(false);
    }
  });

  it('lehnt interne Ziele, falsche Ports und ungültige Hostnamen ab', async () => {
    await expect(pruefeSmtpZiel('127.0.0.1', 587, false)).rejects.toMatchObject({ response: { code: 'smtp_host_not_allowed' } });
    await expect(pruefeSmtpZiel('169.254.169.254', 25, false)).rejects.toMatchObject({ response: { code: 'smtp_host_not_allowed' } });
    await expect(pruefeSmtpZiel('localhost', 587, false)).rejects.toMatchObject({ response: { code: 'smtp_host_not_allowed' } });
    await expect(pruefeSmtpZiel('8.8.8.8', 5432, false)).rejects.toMatchObject({ response: { code: 'smtp_port_not_allowed' } });
    await expect(pruefeSmtpZiel('mail.example.org; rm -rf /', 587, false)).rejects.toMatchObject({ response: { code: 'smtp_host_invalid' } });
    await expect(pruefeSmtpZiel('-oProxy', 587, false)).rejects.toMatchObject({ response: { code: 'smtp_host_invalid' } });
  });

  it('erlaubt öffentliche Ziele und – nur auf Betreiberwunsch – private', async () => {
    await expect(pruefeSmtpZiel('8.8.8.8', 587, false)).resolves.toEqual({ adresse: '8.8.8.8' });
    await expect(pruefeSmtpZiel('127.0.0.1', 2525, true)).resolves.toEqual({ adresse: '127.0.0.1' });
  });
});
