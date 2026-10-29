import { describe, expect, it } from 'vitest';

import { feiertageImJahr } from './feiertage';

describe('Feiertage', () => {
    it('liefert bundesweit genau neun Feiertage, die beweglichen aus Ostern (2026: Ostersonntag 5. April)', () => {
        const t = feiertageImJahr(2026);
        expect([...t.keys()].sort()).toEqual([
            '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14',
            '2026-05-25', '2026-10-03', '2026-12-25', '2026-12-26',
        ]);
        expect(t.get('2026-04-03')).toBe('Karfreitag');
        expect(t.get('2026-05-14')).toBe('Christi Himmelfahrt');
    });

    it('rechnet Ostern 2027 (28. März) und das Schaltjahr 2028 richtig', () => {
        expect(feiertageImJahr(2027).has('2027-03-26')).toBe(true); // Karfreitag
        expect(feiertageImJahr(2027).has('2027-03-29')).toBe(true); // Ostermontag
        expect(feiertageImJahr(2028).has('2028-04-14')).toBe(true); // Karfreitag
    });

    it('kennt Landesfeiertage nur im jeweiligen Bundesland', () => {
        expect(feiertageImJahr(2026, 'BY').get('2026-06-04')).toBe('Fronleichnam');
        expect(feiertageImJahr(2026, 'BE').has('2026-06-04')).toBe(false);
        expect(feiertageImJahr(2026, 'BW').has('2026-01-06')).toBe(true);
        expect(feiertageImJahr(2026, 'TH').has('2026-09-20')).toBe(true);
        expect(feiertageImJahr(2026, 'SL').has('2026-08-15')).toBe(true);
        expect(feiertageImJahr(2026, 'NI').has('2026-10-31')).toBe(true);
        expect(feiertageImJahr(2026, 'NW').has('2026-11-01')).toBe(true);
        expect(feiertageImJahr(2026).has('2026-10-31')).toBe(false);
    });

    it('beachtet das Einführungsjahr des Frauentags und die Ausnahme 2017', () => {
        expect(feiertageImJahr(2026, 'BE').has('2026-03-08')).toBe(true);
        expect(feiertageImJahr(2018, 'BE').has('2018-03-08')).toBe(false);
        expect(feiertageImJahr(2022, 'MV').has('2022-03-08')).toBe(false);
        expect(feiertageImJahr(2023, 'MV').has('2023-03-08')).toBe(true);
        expect(feiertageImJahr(2017, 'BY').has('2017-10-31')).toBe(true); // 500 Jahre Reformation
    });

    it('findet den Buß- und Bettag nur in Sachsen, als Mittwoch vor dem 23. November', () => {
        expect(feiertageImJahr(2026, 'SN').get('2026-11-18')).toBe('Buß- und Bettag');
        expect(feiertageImJahr(2023, 'SN').has('2023-11-22')).toBe(true);
        expect(feiertageImJahr(2026, 'BY').has('2026-11-18')).toBe(false);
    });

    it('führt keine reinen Sonntage (Ostern, Pfingsten) als Feiertag', () => {
        expect(feiertageImJahr(2026, 'BB').has('2026-04-05')).toBe(false);
    });
});
