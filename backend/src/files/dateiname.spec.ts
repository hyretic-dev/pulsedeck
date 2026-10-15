import { describe, expect, it } from 'vitest';

import { bereinigeDateinamen } from './files.service';

describe('bereinigeDateinamen', () => {
  it('ersetzt Pfadtrenner und Steuerzeichen und begrenzt die Länge', () => {
    expect(bereinigeDateinamen('a\\b/c\u0001d.txt')).toBe('a_b_c_d.txt');
    expect(bereinigeDateinamen('x'.repeat(400))).toHaveLength(255);
  });

  it('repariert UTF-8, das als latin1 gelesen wurde (multer/busboy), und lässt echtes UTF-8 in Ruhe', () => {
    const mojibake = Buffer.from('Größe äöü.pdf', 'utf8').toString('latin1');
    expect(bereinigeDateinamen(mojibake)).toBe('Größe äöü.pdf');
    expect(bereinigeDateinamen('Größe.pdf')).toBe('Größe.pdf');
    expect(bereinigeDateinamen('Café.txt')).toBe('Café.txt');
  });

  it('ersetzt leere und Punkt-Namen durch „datei“', () => {
    for (const leer of ['', '   ', '.', '..']) expect(bereinigeDateinamen(leer), JSON.stringify(leer)).toBe('datei');
  });
});
