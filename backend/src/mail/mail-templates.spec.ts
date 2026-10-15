import { describe, expect, it } from 'vitest';

import { magicLinkMail, passwordResetMail, verificationMail } from './mail-templates';

/**
 * Mailtexte der Auth-Flüsse (Auftrag §5, §10). Anrede „du“ wie in der App,
 * Link im Text- und HTML-Teil, Hinweis auf begrenzte Gültigkeit und darauf,
 * dass die Mail ignoriert werden kann, wenn sie nicht angefordert wurde.
 */
describe('Mail-Templates', () => {
  const link = 'https://app.pulsedeck.example/auth/callback?type=verify&token=abc_DEF-123';

  it('Verifikation: Betreff, Link in Text und HTML, Gültigkeit 24 Stunden', () => {
    const mail = verificationMail(link);

    expect(mail.subject).toBe('Bitte bestätige deine E-Mail-Adresse bei PulseDeck');
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(`href="${link.replace('&', '&amp;')}"`);
    expect(mail.text).toContain('24 Stunden');
  });

  it('Magic-Link: eigener Betreff und Hinweis, die Mail zu ignorieren, wenn sie nicht angefordert wurde', () => {
    const mail = magicLinkMail(link);

    expect(mail.subject).toBe('Dein Anmelde-Link für PulseDeck');
    expect(mail.text).toContain(link);
    expect(mail.text).toContain('nicht angefordert');
  });

  it('Passwort-Reset: eigener Betreff, Link, Hinweis zur Ignorierbarkeit', () => {
    const mail = passwordResetMail(link);

    expect(mail.subject).toBe('Passwort für PulseDeck zurücksetzen');
    expect(mail.text).toContain(link);
    expect(mail.text).toContain('nicht angefordert');
  });

  it('maskiert Sonderzeichen im HTML (kein HTML-Einschleusen über den Link)', () => {
    const boese = 'https://app.example/x?a="><script>alert(1)</script>&t=1';

    const mail = verificationMail(boese);

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('&quot;');
  });
});
