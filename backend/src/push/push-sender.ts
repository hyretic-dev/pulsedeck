import webpush from 'web-push';

import type { PushConfig } from '../config/configuration';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushAbo {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Fehler des Push-Dienstes mit HTTP-Status (404/410 = Abo abgelaufen). */
export class PushFehler extends Error {
  constructor(public readonly status: number | undefined) {
    super(`Push-Zustellung fehlgeschlagen${status ? ` (HTTP ${status})` : ''}`);
  }
}

export interface PushSender {
  send(abo: PushAbo, nutzlast: string): Promise<void>;
}

export class WebPushSender implements PushSender {
  constructor(private readonly config: PushConfig) {}

  async send(abo: PushAbo, nutzlast: string): Promise<void> {
    try {
      await webpush.sendNotification(abo, nutzlast, {
        vapidDetails: { subject: this.config.subject, publicKey: this.config.publicKey, privateKey: this.config.privateKey },
        TTL: 24 * 60 * 60,
        timeout: 10_000,
      });
    } catch (fehler) {
      throw new PushFehler((fehler as { statusCode?: number }).statusCode);
    }
  }
}
