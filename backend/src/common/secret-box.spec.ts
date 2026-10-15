import { describe, expect, it } from 'vitest';

import { SecretBox } from './secret-box';

describe('SecretBox', () => {
  const box = new SecretBox(Buffer.alloc(32, 1));

  it('verschlüsselt und entschlüsselt; Chiffretext enthält den Klartext nicht und ist je Aufruf anders', () => {
    const a = box.seal('geheimes-passwort', 'newsletter:org-1');
    const b = box.seal('geheimes-passwort', 'newsletter:org-1');

    expect(a).not.toContain('geheimes');
    expect(a).not.toBe(b);
    expect(box.open(a, 'newsletter:org-1')).toBe('geheimes-passwort');
  });

  it('verweigert Entschlüsselung in anderem Kontext, mit anderem Schlüssel und bei Manipulation', () => {
    const versiegelt = box.seal('x', 'newsletter:org-1');
    const teile = versiegelt.split('.');
    const manipuliert = [teile[0], teile[1], teile[2], Buffer.from('anderer-inhalt').toString('base64url')].join('.');

    expect(() => box.open(versiegelt, 'newsletter:org-2')).toThrow('Geheimnis nicht lesbar');
    expect(() => new SecretBox(Buffer.alloc(32, 2)).open(versiegelt, 'newsletter:org-1')).toThrow('Geheimnis nicht lesbar');
    expect(() => box.open(manipuliert, 'newsletter:org-1')).toThrow('Geheimnis nicht lesbar');
    expect(() => box.open('v2.a.b.c', 'newsletter:org-1')).toThrow('Geheimnis nicht lesbar');
    expect(() => box.open('kein-format', 'newsletter:org-1')).toThrow('Geheimnis nicht lesbar');
  });

  it('meldet ohne Schlüssel 503 secrets_not_configured statt unverschlüsselt zu speichern', () => {
    const ohne = new SecretBox(null);

    expect(ohne.verfuegbar).toBe(false);
    expect(() => ohne.seal('x', 'k')).toThrowError(expect.objectContaining({ status: 503 }));
  });
});
