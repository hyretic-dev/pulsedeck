import { describe, expect, it } from 'vitest';

import { erzeugeIcal, faltenZeile, maskiereIcalText, wandzeitNachUtc } from './ical';

describe('wandzeitNachUtc', () => {
  it('rechnet Berliner Wandzeit in UTC um (Winter +1, Sommer +2, Umstellungstage)', () => {
    expect(wandzeitNachUtc('2026-01-15', '19:00', 'Europe/Berlin').toISOString()).toBe('2026-01-15T18:00:00.000Z');
    expect(wandzeitNachUtc('2026-07-15', '19:00', 'Europe/Berlin').toISOString()).toBe('2026-07-15T17:00:00.000Z');
    expect(wandzeitNachUtc('2026-03-29', '12:00', 'Europe/Berlin').toISOString()).toBe('2026-03-29T10:00:00.000Z'); // nach Umstellung
    expect(wandzeitNachUtc('2026-10-25', '12:00', 'Europe/Berlin').toISOString()).toBe('2026-10-25T11:00:00.000Z');
    expect(wandzeitNachUtc('2026-01-15', '09:30', 'America/New_York').toISOString()).toBe('2026-01-15T14:30:00.000Z');
  });
});

describe('Text', () => {
  it('maskiert Trennzeichen und alle Zeilenumbrüche (keine Feldeinschleusung)', () => {
    expect(maskiereIcalText('a;b,c\\d\ne\r\nf\rg')).toBe('a\;b\\,c\\\\d\\ne\\nf\\ng');
    expect(maskiereIcalText('Titel\r\nEND:VEVENT\r\nBEGIN:VEVENT')).not.toMatch(/[\r\n]/);
    expect(maskiereIcalText(null)).toBe('');
  });

  it('faltet lange Zeilen auf höchstens 75 Oktette ohne Mehrbyte-Zeichen zu zerschneiden', () => {
    const lang = `DESCRIPTION:${'ä'.repeat(100)}`;
    const gefaltet = faltenZeile(lang);
    for (const zeile of gefaltet.split('\r\n')) expect(Buffer.byteLength(zeile)).toBeLessThanOrEqual(75);
    expect(gefaltet.replace(/\r\n /g, '')).toBe(lang);
    expect(faltenZeile('kurz')).toBe('kurz');
  });
});

describe('erzeugeIcal', () => {
  const termin = { id: 'abc', title: 'Treffen; wichtig', date: '2026-11-01', start_time: '19:00', end_time: '21:00', description: 'Zeile 1\nZeile 2', location: 'Halle, Berlin', ag_name: 'Technik' };

  it('erzeugt einen RFC-konformen Kalender mit CRLF, UTC-Zeiten und maskierten Feldern', () => {
    const ics = erzeugeIcal([termin, { ...termin, id: 'def', end_time: null, description: null, location: null, ag_name: null }], { kalenderName: 'PulseDeck - Technik', zone: 'Europe/Berlin', host: 'app.example.org', jetzt: new Date('2026-10-14T10:00:00Z') });

    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain('UID:abc@app.example.org');
    expect(ics).toContain('DTSTAMP:20261014T100000Z');
    expect(ics).toContain('DTSTART:20261101T180000Z'); // 19:00 Berlin (Winterzeit)
    expect(ics).toContain('DTEND:20261101T200000Z');
    expect(ics).toContain('SUMMARY:Treffen\; wichtig');
    expect(ics).toContain('DESCRIPTION:Zeile 1\\nZeile 2');
    expect(ics).toContain('LOCATION:Halle\\, Berlin');
    expect(ics).toContain('CATEGORIES:Technik');
    const zweiter = ics.split('BEGIN:VEVENT')[2];
    expect(zweiter).toContain('DTEND:20261101T180000Z'); // ohne Ende = Beginn
    expect(zweiter).not.toContain('DESCRIPTION');
  });
});
