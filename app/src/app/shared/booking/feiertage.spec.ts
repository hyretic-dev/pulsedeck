import { describe, expect, it } from 'vitest';

import { feiertageImJahr, ostersonntag } from './feiertage';

describe('Feiertage', () => {
    it('berechnet den Ostersonntag nach Gauß/Meeus', () => {
        expect(ostersonntag(2026)).toEqual({ monat: 4, tag: 5 });
        expect(ostersonntag(2027)).toEqual({ monat: 3, tag: 28 });
        expect(ostersonntag(2024)).toEqual({ monat: 3, tag: 31 });
        expect(ostersonntag(2038)).toEqual({ monat: 4, tag: 25 });
    });

    it('liefert bundesweit genau neun Feiertage, davon die beweglichen aus Ostern', () => {
        const t = feiertageImJahr(2026);
        expect([...t.keys()].sort()).toEqual([
            '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14',
            '2026-05-25', '2026-10-03', '2026-12-25', '2026-12-26',
        ]);
        expect(t.get('2026-04-03')).toBe('Karfreitag');
        expect(t.get('2026-05-14')).toBe('Christi Himmelfahrt');
    });

    it('kennt Landesfeiertage nur im jeweiligen Bundesland', () => {
        expect(feiertageImJahr(2026, 'BY').get('2026-06-04')).toBe('Fronleichnam');
        expect(feiertageImJahr(2026, 'BE').has('2026-06-04')).toBe(false);
        expect(feiertageImJahr(2026, 'BW').get('2026-01-06')).toBe('Heilige Drei Könige');
        expect(feiertageImJahr(2026, 'TH').get('2026-09-20')).toBe('Weltkindertag');
        expect(feiertageImJahr(2026, 'SL').get('2026-08-15')).toBe('Mariä Himmelfahrt');
        expect(feiertageImJahr(2026, 'BY').has('2026-08-15')).toBe(false);
        expect(feiertageImJahr(2026, 'NI').get('2026-10-31')).toBe('Reformationstag');
        expect(feiertageImJahr(2026, 'NW').get('2026-11-01')).toBe('Allerheiligen');
        expect(feiertageImJahr(2026).has('2026-10-31')).toBe(false);
    });

    it('legt den Frauentag erst ab seiner Einführung an', () => {
        expect(feiertageImJahr(2026, 'BE').get('2026-03-08')).toBe('Internationaler Frauentag');
        expect(feiertageImJahr(2018, 'BE').has('2018-03-08')).toBe(false);
        expect(feiertageImJahr(2022, 'MV').has('2022-03-08')).toBe(false);
        expect(feiertageImJahr(2023, 'MV').has('2023-03-08')).toBe(true);
    });

    it('findet den Buß- und Bettag als Mittwoch vor dem 23. November', () => {
        expect(feiertageImJahr(2026, 'SN').get('2026-11-18')).toBe('Buß- und Bettag');
        expect(feiertageImJahr(2025, 'SN').get('2025-11-19')).toBe('Buß- und Bettag');
        // 22. November ist selbst ein Mittwoch
        expect(feiertageImJahr(2023, 'SN').get('2023-11-22')).toBe('Buß- und Bettag');
        expect(feiertageImJahr(2026, 'BY').has('2026-11-18')).toBe(false);
    });
});
