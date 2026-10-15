import { describe, expect, it } from 'vitest';

import { ConfigValidationError, loadAppConfig } from './configuration';

const gueltigeEnv: Record<string, string> = {
  JWT_SECRET: '64656661756c746f666661756c746f666661756c746f666661756c746f66666175', // 33 Bytes Hex
  JWT_ISSUER: 'pulsedeck',
  JWT_AUDIENCE: 'pulsedeck-app',
  APP_BASE_URL: 'https://app.pulsedeck.example',
  DATABASE_URL: 'postgres://runtime:pass@postgres:5432/pulsedeck',
  MAIL_TRANSPORT: 'log',
};

describe('loadAppConfig (Start-Validierung)', () => {
  it('liest die Pflichtwerte und dekodiert ein Hex-Secret zu 32 Bytes', () => {
    const config = loadAppConfig(gueltigeEnv);

    expect(config.jwt.secret.byteLength).toBeGreaterThanOrEqual(32);
    expect(config.jwt.issuer).toBe('pulsedeck');
    expect(config.appBaseUrl).toBe('https://app.pulsedeck.example');
    expect(config.databaseUrl).toBe(gueltigeEnv.DATABASE_URL);
    expect(config.rateLimits.login).toEqual({ max: 5, windowMs: 15 * 60 * 1000 });
    expect(config.rateLimits.mail).toEqual({ max: 3, windowMs: 60 * 60 * 1000 });
    expect(config.mail).toEqual({ transport: 'log' });
    expect(config.minResponseMs).toBe(200);
  });

  it('liest AUTH_MIN_RESPONSE_MS (0 deaktiviert die Mindestdauer, Unsinn wird abgelehnt)', () => {
    expect(loadAppConfig({ ...gueltigeEnv, AUTH_MIN_RESPONSE_MS: '0' }).minResponseMs).toBe(0);
    expect(loadAppConfig({ ...gueltigeEnv, AUTH_MIN_RESPONSE_MS: '350' }).minResponseMs).toBe(350);
    expect(() => loadAppConfig({ ...gueltigeEnv, AUTH_MIN_RESPONSE_MS: '-5' })).toThrow(/AUTH_MIN_RESPONSE_MS/);
  });

  it('akzeptiert ein Base64-Secret mit mindestens 32 Bytes', () => {
    // 32 Bytes als Base64
    const config = loadAppConfig({
      ...gueltigeEnv,
      JWT_SECRET: Buffer.alloc(32, 1).toString('base64'),
    });
    expect(config.jwt.secret.byteLength).toBe(32);
  });

  it('bricht mit verständlichen Meldungen ab, wenn Pflichtwerte fehlen oder ungültig sind', () => {
    const unvollstaendig: Record<string, string> = {
      JWT_SECRET: 'zu-kurz',
    };

    try {
      loadAppConfig(unvollstaendig);
      expect.unreachable('ConfigValidationError erwartet');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(ConfigValidationError);
      const meldung = (fehler as ConfigValidationError).message;
      expect(meldung).toContain('JWT_SECRET');
      expect(meldung).toContain('JWT_ISSUER');
      expect(meldung).toContain('JWT_AUDIENCE');
      expect(meldung).toContain('APP_BASE_URL');
      expect(meldung).toContain('DATABASE_URL');
      expect(meldung).toContain('MAIL_TRANSPORT');
    }
  });

  it('lehnt APP_BASE_URL ohne http/https ab (Redirect-Basis)', () => {
    expect(() =>
      loadAppConfig({ ...gueltigeEnv, APP_BASE_URL: 'ftp://example.org' })
    ).toThrow(ConfigValidationError);
  });

  it('akzeptiert MAIL_TRANSPORT=log nur außerhalb der Produktion', () => {
    expect(() =>
      loadAppConfig({ ...gueltigeEnv, NODE_ENV: 'production' })
    ).toThrow(/log/);
    expect(() => loadAppConfig(gueltigeEnv)).not.toThrow();
  });

  describe('Mail-Transport (O4)', () => {
    const smtpEnv = {
      ...gueltigeEnv,
      MAIL_TRANSPORT: 'smtp',
      MAIL_FROM: 'PulseDeck <noreply@pulsedeck.example>',
      SMTP_HOST: 'smtp.example.org',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'smtp-geheimnis',
    };
    const resendEnv = {
      ...gueltigeEnv,
      MAIL_TRANSPORT: 'resend',
      MAIL_FROM: 'PulseDeck <noreply@pulsedeck.example>',
      RESEND_API_KEY: 're_geheimer_key',
    };

    it('liest die SMTP-Konfiguration (Standardport 587, STARTTLS statt implizitem TLS)', () => {
      expect(loadAppConfig(smtpEnv).mail).toEqual({
        transport: 'smtp',
        from: 'PulseDeck <noreply@pulsedeck.example>',
        smtp: {
          host: 'smtp.example.org',
          port: 587,
          secure: false,
          user: 'mailer',
          password: 'smtp-geheimnis',
        },
      });
    });

    it('nimmt bei Port 465 implizites TLS an und erlaubt SMTP_SECURE zum Überschreiben', () => {
      expect(
        (loadAppConfig({ ...smtpEnv, SMTP_PORT: '465' }).mail as { smtp: { secure: boolean } }).smtp.secure
      ).toBe(true);
      expect(
        (loadAppConfig({ ...smtpEnv, SMTP_PORT: '2465', SMTP_SECURE: 'true' }).mail as {
          smtp: { secure: boolean };
        }).smtp.secure
      ).toBe(true);
    });

    it('erlaubt SMTP ohne Zugangsdaten (interner Relay), verlangt sonst beides', () => {
      const ohne = { ...smtpEnv, SMTP_USER: '', SMTP_PASSWORD: '' };
      expect(() => loadAppConfig(ohne)).not.toThrow();
      expect(() => loadAppConfig({ ...smtpEnv, SMTP_PASSWORD: '' })).toThrow(/SMTP_PASSWORD/);
      expect(() => loadAppConfig({ ...smtpEnv, SMTP_USER: '' })).toThrow(/SMTP_USER/);
    });

    it('verlangt für SMTP Host und Absender, für Resend Key und Absender', () => {
      expect(() => loadAppConfig({ ...smtpEnv, SMTP_HOST: '' })).toThrow(/SMTP_HOST/);
      expect(() => loadAppConfig({ ...smtpEnv, MAIL_FROM: '' })).toThrow(/MAIL_FROM/);
      expect(() => loadAppConfig({ ...resendEnv, RESEND_API_KEY: '' })).toThrow(/RESEND_API_KEY/);
      expect(() => loadAppConfig({ ...resendEnv, MAIL_FROM: 'kein-absender' })).toThrow(/MAIL_FROM/);
    });

    it('liest die Resend-Konfiguration', () => {
      expect(loadAppConfig(resendEnv).mail).toEqual({
        transport: 'resend',
        from: 'PulseDeck <noreply@pulsedeck.example>',
        apiKey: 're_geheimer_key',
      });
    });

    it('lässt SMTP und Resend in der Produktion zu, nur der Log-Transport bleibt gesperrt', () => {
      const prod = { NODE_ENV: 'production', SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') };
      expect(() => loadAppConfig({ ...smtpEnv, ...prod })).not.toThrow();
      expect(() => loadAppConfig({ ...resendEnv, ...prod })).not.toThrow();
      expect(() => loadAppConfig({ ...gueltigeEnv, NODE_ENV: 'production' })).toThrow(/Produktion/);
    });

    it('lehnt unbekannte Transporte ab und nennt die erlaubten Werte', () => {
      expect(() => loadAppConfig({ ...gueltigeEnv, MAIL_TRANSPORT: 'sendgrid' })).toThrow(/log, smtp, resend/);
    });

    it('nennt Geheimnisse nie in Fehlermeldungen', () => {
      for (const env of [
        { ...smtpEnv, SMTP_HOST: '', SMTP_PORT: 'abc' },
        { ...resendEnv, MAIL_FROM: '' },
      ]) {
        try {
          loadAppConfig(env);
          expect.unreachable();
        } catch (fehler) {
          const meldung = (fehler as Error).message;
          expect(meldung).not.toContain('smtp-geheimnis');
          expect(meldung).not.toContain('re_geheimer_key');
        }
      }
    });
  });

  it('liest konfigurierbare Rate-Limit-Werte', () => {
    const config = loadAppConfig({
      ...gueltigeEnv,
      RATE_LIMIT_LOGIN_MAX: '10',
      RATE_LIMIT_LOGIN_WINDOW_MINUTES: '30',
      RATE_LIMIT_MAIL_MAX: '2',
      RATE_LIMIT_MAIL_WINDOW_MINUTES: '5',
    });
    expect(config.rateLimits.login).toEqual({ max: 10, windowMs: 30 * 60 * 1000 });
    expect(config.rateLimits.mail).toEqual({ max: 2, windowMs: 5 * 60 * 1000 });
  });

  describe('Hintergrundarbeit, Geheimnisse und Push', () => {
    const schluessel = Buffer.alloc(32, 5).toString('base64');

    it('hat sichere Standardwerte: Jobs an, Zeitzone Berlin, kein Push, keine privaten SMTP-Ziele', () => {
      const config = loadAppConfig(gueltigeEnv);

      expect(config.jobs).toEqual({ enabled: true, tickMs: 15_000 });
      expect(config).toMatchObject({ timeZone: 'Europe/Berlin', push: null, secretsKey: null, smtpAllowPrivateHosts: false });
    });

    it('verlangt SECRETS_ENCRYPTION_KEY in der Produktion und genau 32 Bytes', () => {
      const prod = { ...gueltigeEnv, NODE_ENV: 'production', MAIL_TRANSPORT: 'resend', MAIL_FROM: 'a@b.example', RESEND_API_KEY: 'k' };

      expect(() => loadAppConfig(prod)).toThrow(/SECRETS_ENCRYPTION_KEY fehlt/);
      expect(loadAppConfig({ ...prod, SECRETS_ENCRYPTION_KEY: schluessel }).secretsKey?.byteLength).toBe(32);
      expect(loadAppConfig({ ...gueltigeEnv, SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('hex') }).secretsKey?.byteLength).toBe(32);
      for (const falsch of [Buffer.alloc(16).toString('base64'), Buffer.alloc(33).toString('base64'), 'kein base64!!', 'abc']) {
        expect(() => loadAppConfig({ ...gueltigeEnv, SECRETS_ENCRYPTION_KEY: falsch }), falsch).toThrow(/SECRETS_ENCRYPTION_KEY muss genau 32 Bytes/);
      }
    });

    it('liest VAPID-Schlüssel nur vollständig und nennt den privaten Schlüssel nie in Fehlern', () => {
      const vapid = { VAPID_PUBLIC_KEY: 'oeffentlich', VAPID_PRIVATE_KEY: 'privat-geheim', VAPID_SUBJECT: 'mailto:admin@example.org' };

      expect(loadAppConfig({ ...gueltigeEnv, ...vapid }).push).toEqual({ publicKey: 'oeffentlich', privateKey: 'privat-geheim', subject: 'mailto:admin@example.org' });
      expect(() => loadAppConfig({ ...gueltigeEnv, VAPID_PUBLIC_KEY: 'x' })).toThrow(/VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY/);
      try {
        loadAppConfig({ ...gueltigeEnv, ...vapid, VAPID_SUBJECT: 'kontakt' });
        expect.unreachable();
      } catch (fehler) {
        expect((fehler as Error).message).toContain('VAPID_SUBJECT');
        expect((fehler as Error).message).not.toContain('privat-geheim');
      }
    });

    it('liest Jobs, Zeitzone und SMTP-Freigabe und lehnt Unsinn ab', () => {
      expect(loadAppConfig({ ...gueltigeEnv, JOBS_ENABLED: 'false', JOBS_TICK_SECONDS: '30' }).jobs).toEqual({ enabled: false, tickMs: 30_000 });
      expect(loadAppConfig({ ...gueltigeEnv, SMTP_ALLOW_PRIVATE_HOSTS: 'true', APP_TIMEZONE: 'America/New_York' })).toMatchObject({ smtpAllowPrivateHosts: true, timeZone: 'America/New_York' });
      expect(() => loadAppConfig({ ...gueltigeEnv, JOBS_ENABLED: 'vielleicht' })).toThrow(/JOBS_ENABLED/);
      expect(() => loadAppConfig({ ...gueltigeEnv, APP_TIMEZONE: 'Mars/Olympus' })).toThrow(/APP_TIMEZONE/);
      expect(() => loadAppConfig({ ...gueltigeEnv, SMTP_ALLOW_PRIVATE_HOSTS: 'ja' })).toThrow(/SMTP_ALLOW_PRIVATE_HOSTS/);
    });
  });
});
