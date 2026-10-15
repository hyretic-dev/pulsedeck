import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { apiFehler } from './http-error';

export const SECRET_BOX = Symbol('SECRET_BOX');

/**
 * Verschlüsselt gespeicherte Geheimnisse (AES-256-GCM, Schlüssel aus der Umgebung). Der Kontext
 * (z. B. `newsletter:<orgId>`) wird als authentifizierte Zusatzdaten gebunden: Ein kopierter
 * Chiffretext lässt sich in keiner anderen Zeile entschlüsseln.
 * Format: `v1.<iv>.<tag>.<chiffretext>` (Base64url).
 */
export class SecretBox {
  constructor(private readonly key: Buffer | null) {}

  get verfuegbar(): boolean {
    return this.key !== null;
  }

  private schluessel(): Buffer {
    if (!this.key) throw apiFehler(503, 'secrets_not_configured', 'Die Geheimnis-Verschlüsselung ist nicht eingerichtet (SECRETS_ENCRYPTION_KEY)');
    return this.key;
  }

  seal(klartext: string, kontext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.schluessel(), iv);
    cipher.setAAD(Buffer.from(kontext));
    const chiffre = Buffer.concat([cipher.update(klartext, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), chiffre.toString('base64url')].join('.');
  }

  /** Wirft bei jedem Fehler (falscher Schlüssel, falscher Kontext, Manipulation) dieselbe unspezifische Meldung. */
  open(versiegelt: string, kontext: string): string {
    const teile = versiegelt.split('.');
    try {
      if (teile.length !== 4 || teile[0] !== 'v1') throw new Error('Format');
      const decipher = createDecipheriv('aes-256-gcm', this.schluessel(), Buffer.from(teile[1], 'base64url'));
      decipher.setAAD(Buffer.from(kontext));
      decipher.setAuthTag(Buffer.from(teile[2], 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(teile[3], 'base64url')), decipher.final()]).toString('utf8');
    } catch (fehler) {
      if ((fehler as { status?: number }).status === 503) throw fehler;
      throw new Error('Geheimnis nicht lesbar');
    }
  }
}
