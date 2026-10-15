import { describe, expect, it } from 'vitest';

import { tageBisGeburtstag } from './dashboard.service';

const heute = new Date(Date.UTC(2026, 11, 28)); // 28.12.2026

describe('tageBisGeburtstag', () => {
  it('rechnet Tage bis zum nächsten Geburtstag, über den Jahreswechsel und ohne Geburtsjahr in der Ausgabe', () => {
    expect(tageBisGeburtstag('28.12.1990', heute)).toEqual({ tage: 0, text: '28.12.' });
    expect(tageBisGeburtstag('01.01.85', heute)).toEqual({ tage: 4, text: '01.01.' });
    expect(tageBisGeburtstag('27.12.2001', heute)).toEqual({ tage: 364, text: '27.12.' });
    expect(tageBisGeburtstag('3.7.', heute)).toEqual({ tage: 187, text: '03.07.' });
  });

  it('liefert null für unlesbare Werte', () => {
    for (const falsch of [null, '', 'unbekannt', '31', '32.01.2000', '10.13.2000', '00.05.1999', 'a.b.c']) expect(tageBisGeburtstag(falsch, heute), String(falsch)).toBeNull();
  });
});
