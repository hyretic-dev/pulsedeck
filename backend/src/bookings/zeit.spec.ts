import { describe, expect, it } from 'vitest';

import { feiertageImJahr } from './feiertage';
import { tageDerSerie } from './serie';
import { berlinUhr, berlinZeitpunkt, endStunde, stundenDesTages, terminZuBelegung, wochentag } from './zeit';

describe('Zeitrechnung (Europe/Berlin)', () => {
  it('rechnet Wanduhr und Zeitpunkt hin und zurück, Sommer wie Winter', () => {
    expect(berlinZeitpunkt(2026, 7, 1, 8).toISOString()).toBe('2026-07-01T06:00:00.000Z');
    expect(berlinZeitpunkt(2026, 1, 15, 8).toISOString()).toBe('2026-01-15T07:00:00.000Z');
    expect(berlinUhr('2026-07-01T06:00:00.000Z')).toMatchObject({ tag: 1, stunde: 8, minute: 0 });
    expect(wochentag(2026, 10, 29)).toBe(3);
  });

  it('hat am letzten Sonntag im März 23 und im Oktober 25 Stunden', () => {
    expect(stundenDesTages(2026, 3, 29)).toBe(23);
    expect(stundenDesTages(2026, 10, 25)).toBe(25);
    expect(stundenDesTages(2027, 3, 28)).toBe(23);
    expect(stundenDesTages(2027, 10, 31)).toBe(25);
    expect(stundenDesTages(2026, 6, 15)).toBe(24);
  });

  it('rechnet über die Umstellung hinweg die echte Dauer', () => {
    const nachtMaerz = berlinZeitpunkt(2026, 3, 29, 8).getTime() - berlinZeitpunkt(2026, 3, 28, 22).getTime();
    const nachtOktober = berlinZeitpunkt(2026, 10, 25, 8).getTime() - berlinZeitpunkt(2026, 10, 24, 22).getTime();
    expect(nachtMaerz / 3600000).toBe(9);
    expect(nachtOktober / 3600000).toBe(11);
  });

  it('wandelt einen Termin in volle Stunden um (19:30 bis 21:15 → 19 bis 22 Uhr) und verlangt ein Ende', () => {
    const z = terminZuBelegung('2026-11-03', '19:30', '21:15');
    expect(z && berlinUhr(z.beginn).stunde).toBe(19);
    expect(z && berlinUhr(z.ende).stunde).toBe(22);
    expect(terminZuBelegung('2026-11-03', '19:00', null)).toBeNull();
    expect(terminZuBelegung('2026-11-03', '21:00', '19:00')).toBeNull();
    expect(terminZuBelegung('03.11.2026', '19:00', '21:00')).toBeNull();
    expect(terminZuBelegung('2026-11-03', '19:10', '19:40')).not.toBeNull();
  });

  it('zählt Mitternacht als 24 Uhr des Vortags', () => {
    expect(endStunde(berlinZeitpunkt(2026, 11, 4, 0))).toBe(24);
    expect(endStunde(berlinZeitpunkt(2026, 11, 3, 21))).toBe(21);
  });
});

describe('Feiertage (feiertagejs)', () => {
  it('liefert bundesweit genau neun Feiertage, Ostersonntag 2026 = 5. April', () => {
    expect([...feiertageImJahr(2026).keys()].sort()).toEqual([
      '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25', '2026-10-03', '2026-12-25', '2026-12-26',
    ]);
    expect(feiertageImJahr(2027).has('2027-03-29')).toBe(true); // Ostermontag, Ostersonntag 28. März
  });

  it('kennt Landesfeiertage nur im Land (Fronleichnam 2026 = 4. Juni, Buß- und Bettag 2026 = 18. November)', () => {
    expect(feiertageImJahr(2026, 'BY').has('2026-06-04')).toBe(true);
    expect(feiertageImJahr(2026, 'BE').has('2026-06-04')).toBe(false);
    expect(feiertageImJahr(2026, 'SN').has('2026-11-18')).toBe(true);
    expect(feiertageImJahr(2026, 'BY').has('2026-11-18')).toBe(false);
    expect(feiertageImJahr(2026, 'BB').has('2026-04-05')).toBe(false); // Ostersonntag zählt nicht
  });
});

describe('Serien', () => {
  const serie = (z: object) => ({ weekdays: [1], every_n_weeks: 1, valid_from: '2026-11-01', valid_to: '2026-11-30', ...z });

  it('liefert jeden Dienstag im November 2026', () => {
    expect(tageDerSerie(serie({}))).toEqual(['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);
  });

  it('zählt den Rhythmus ab dem ersten passenden Tag', () => {
    expect(tageDerSerie(serie({ every_n_weeks: 2 }))).toEqual(['2026-11-03', '2026-11-17']);
    expect(tageDerSerie(serie({ every_n_weeks: 2, valid_from: '2026-11-10' }))).toEqual(['2026-11-10', '2026-11-24']);
  });

  it('unterstützt mehrere Wochentage und begrenzt auf den Zeitraum', () => {
    expect(tageDerSerie(serie({ weekdays: [0, 4], valid_from: '2026-11-04', valid_to: '2026-11-14' }))).toEqual(['2026-11-06', '2026-11-09', '2026-11-13']);
  });
});
