import { describe, expect, it } from 'vitest';

import { istFaellig, letzterTermin } from './newsletter.schedule';

const ZONE = 'Europe/Berlin';
// Freitag 12:00 Uhr Berliner Zeit (Winter, UTC+1): 2026-01-09 11:00 UTC
const freitag12 = { frequency: 'weekly', day_of_week: 5, time_of_day: '12:00:00' };

describe('Newsletter-Zeitplan', () => {
  it('wöchentlich: vor der Zeit gilt der Vortermin, ab der Zeit der heutige', () => {
    const vor = new Date('2026-01-09T10:59:00Z'); // 11:59 Berlin
    const ab = new Date('2026-01-09T11:00:00Z'); // 12:00 Berlin

    expect(letzterTermin(freitag12, vor, ZONE)).toBe(Date.UTC(2026, 0, 2, 12, 0));
    expect(letzterTermin(freitag12, ab, ZONE)).toBe(Date.UTC(2026, 0, 9, 12, 0));
    expect(letzterTermin(freitag12, new Date('2026-01-12T08:00:00Z'), ZONE)).toBe(Date.UTC(2026, 0, 9, 12, 0)); // Montag
  });

  it('ist fällig, wenn seit dem letzten Termin nichts gesendet wurde, und danach nicht mehr', () => {
    const jetzt = new Date('2026-01-09T11:05:00Z');

    expect(istFaellig(freitag12, null, jetzt, ZONE)).toBe(true);
    expect(istFaellig(freitag12, new Date('2026-01-02T11:00:30Z'), jetzt, ZONE)).toBe(true); // letzte Woche gesendet
    expect(istFaellig(freitag12, new Date('2026-01-09T11:01:00Z'), jetzt, ZONE)).toBe(false); // heute schon gesendet
    expect(istFaellig(freitag12, null, new Date('2026-01-09T10:00:00Z'), ZONE)).toBe(true); // erster Lauf: Vortermin zählt
    expect(istFaellig(freitag12, new Date('2026-01-05T09:00:00Z'), new Date('2026-01-09T10:00:00Z'), ZONE)).toBe(false);
  });

  it('rechnet in der Zeitzone, auch im Sommer (UTC+2)', () => {
    const sommer = new Date('2026-07-10T09:59:00Z'); // 11:59 Berlin, Freitag
    expect(letzterTermin(freitag12, sommer, ZONE)).toBe(Date.UTC(2026, 6, 3, 12, 0));
    expect(letzterTermin(freitag12, new Date('2026-07-10T10:00:00Z'), ZONE)).toBe(Date.UTC(2026, 6, 10, 12, 0));
  });

  it('monatlich: am ersten Wochentag des Monats; davor der des Vormonats', () => {
    const monat = { frequency: 'monthly', day_of_week: 1, time_of_day: '09:00:00' }; // erster Montag
    expect(letzterTermin(monat, new Date('2026-03-04T12:00:00Z'), ZONE)).toBe(Date.UTC(2026, 2, 2, 9, 0)); // 2. März 2026 ist Montag
    expect(letzterTermin(monat, new Date('2026-03-01T12:00:00Z'), ZONE)).toBe(Date.UTC(2026, 1, 2, 9, 0)); // vor dem ersten Montag: Februar
  });

  it('manuell wird nie automatisch fällig', () => {
    expect(istFaellig({ frequency: 'manual', day_of_week: 5, time_of_day: '12:00:00' }, null, new Date(), ZONE)).toBe(false);
  });
});
