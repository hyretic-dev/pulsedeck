import { describe, expect, it } from 'vitest';

import type { BookingEntry } from './booking.models';
import {
    aufVolleStunden, balkenFuerTag, belegungsStufe, berlinUhr, berlinZeitpunkt, pruefeVerfuegbarkeit,
    isoKalenderwoche, montagDerWoche, plusTage, stundenDesTages, tageImMonat, terminZuBelegung, verteileAufBahnen, wochentag,
} from './zeitraum';

function eintrag(id: string, start: string, ende: string, status: BookingEntry['status'] = 'approved'): BookingEntry {
    return {
        id, plan_id: 'p', title: id, note: null, start_at: start, end_at: ende, status, is_public: false,
        requester_name: null, is_mine: false, series_id: null, event_id: null, decision_reason: null,
    };
}

describe('Zeitraum', () => {
    it('kennt die Monatslängen inklusive Schaltjahr 2028', () => {
        expect(tageImMonat(2028, 2)).toBe(29);
        expect(tageImMonat(2026, 2)).toBe(28);
        expect(tageImMonat(2026, 4)).toBe(30);
        expect(tageImMonat(2026, 12)).toBe(31);
    });

    it('zählt Wochentage ab Montag', () => {
        expect(wochentag(2026, 10, 29)).toBe(3); // Donnerstag
        expect(wochentag(2026, 11, 1)).toBe(6); // Sonntag
    });

    it('rechnet Wanduhr in Berlin hin und zurück, Sommer wie Winter', () => {
        expect(berlinZeitpunkt(2026, 7, 1, 8).toISOString()).toBe('2026-07-01T06:00:00.000Z');
        expect(berlinZeitpunkt(2026, 1, 15, 8).toISOString()).toBe('2026-01-15T07:00:00.000Z');
        expect(berlinUhr('2026-07-01T06:00:00.000Z')).toMatchObject({ tag: 1, stunde: 8, minute: 0 });
    });

    it('hat am letzten Sonntag im März 23 und im Oktober 25 Stunden', () => {
        expect(stundenDesTages(2026, 3, 29)).toBe(23);
        expect(stundenDesTages(2026, 10, 25)).toBe(25);
        expect(stundenDesTages(2026, 6, 15)).toBe(24);
        expect(stundenDesTages(2027, 3, 28)).toBe(23);
        expect(stundenDesTages(2027, 10, 31)).toBe(25);
    });

    it('rechnet über die Umstellung hinweg richtig (Abend vor und nach der Nacht)', () => {
        // Sa 28.3.2026 22:00 (CET) bis So 29.3.2026 08:00 (CEST) = 9 echte Stunden
        const von = berlinZeitpunkt(2026, 3, 28, 22);
        const bis = berlinZeitpunkt(2026, 3, 29, 8);
        expect((bis.getTime() - von.getTime()) / 3600000).toBe(9);
        // Sa 24.10.2026 22:00 (CEST) bis So 25.10.2026 08:00 (CET) = 11 echte Stunden
        const von2 = berlinZeitpunkt(2026, 10, 24, 22);
        const bis2 = berlinZeitpunkt(2026, 10, 25, 8);
        expect((bis2.getTime() - von2.getTime()) / 3600000).toBe(11);
    });

    it('rundet Beginn ab und Ende auf volle Stunden (19:30 bis 21:15 → 19 bis 22 Uhr)', () => {
        const r = aufVolleStunden(berlinZeitpunkt(2026, 11, 3, 19).getTime() + 30 * 60000, berlinZeitpunkt(2026, 11, 3, 21).getTime() + 15 * 60000);
        expect(berlinUhr(r.beginn)).toMatchObject({ stunde: 19, minute: 0 });
        expect(berlinUhr(r.ende)).toMatchObject({ stunde: 22, minute: 0 });
    });

    it('sperrt bei angenommener Buchung und meldet offene Anfragen nur als Überschneidung', () => {
        const b = [
            eintrag('a', '2026-11-03T17:00:00Z', '2026-11-03T19:00:00Z'),
            eintrag('o', '2026-11-04T17:00:00Z', '2026-11-04T19:00:00Z', 'requested'),
        ];
        const t3 = (h: number) => berlinZeitpunkt(2026, 11, 3, h);
        const t4 = (h: number) => berlinZeitpunkt(2026, 11, 4, h);
        expect(pruefeVerfuegbarkeit(b, t3(19), t3(21)).art).toBe('belegt');
        expect(pruefeVerfuegbarkeit(b, t3(20), t3(22)).art).toBe('frei');
        expect(pruefeVerfuegbarkeit(b, t4(19), t4(21)).art).toBe('ueberschneidung');
        expect(pruefeVerfuegbarkeit(b, t3(19), t3(21), 'a').art).toBe('frei');
    });

    it('schneidet mehrtägige Buchungen auf Tage zu und verteilt Überschneidungen auf Bahnen', () => {
        const mehr = eintrag('m', berlinZeitpunkt(2026, 11, 3, 18).toISOString(), berlinZeitpunkt(2026, 11, 5, 12).toISOString());
        const mitte = balkenFuerTag([mehr], 2026, 11, 4, 8, 22);
        expect(mitte).toMatchObject([{ von: 8, bis: 22, setztFortVorher: true, setztFortNachher: true }]);
        const erster = balkenFuerTag([mehr], 2026, 11, 3, 8, 22);
        expect(erster).toMatchObject([{ von: 18, bis: 22, setztFortVorher: false, setztFortNachher: true }]);
        const letzter = balkenFuerTag([mehr], 2026, 11, 5, 8, 22);
        expect(letzter).toMatchObject([{ von: 8, bis: 12, setztFortVorher: true, setztFortNachher: false }]);

        const x = eintrag('x', berlinZeitpunkt(2026, 11, 3, 18).toISOString(), berlinZeitpunkt(2026, 11, 3, 20).toISOString(), 'requested');
        const y = eintrag('y', berlinZeitpunkt(2026, 11, 3, 19).toISOString(), berlinZeitpunkt(2026, 11, 3, 21).toISOString(), 'requested');
        const z = eintrag('z', berlinZeitpunkt(2026, 11, 3, 20).toISOString(), berlinZeitpunkt(2026, 11, 3, 21).toISOString(), 'requested');
        const bahnen = verteileAufBahnen(balkenFuerTag([x, y, z], 2026, 11, 3, 8, 22));
        expect(bahnen.map((b) => [b.balken.eintrag.id, b.bahn])).toEqual([['x', 0], ['y', 1], ['z', 0]]);
    });

    it('ignoriert abgelehnte und stornierte Einträge im Raster', () => {
        const e = eintrag('d', berlinZeitpunkt(2026, 11, 3, 18).toISOString(), berlinZeitpunkt(2026, 11, 3, 20).toISOString(), 'declined');
        expect(balkenFuerTag([e], 2026, 11, 3, 8, 22)).toEqual([]);
    });

    it('stuft den Belegungsgrad ein und zählt Anfragen nicht mit', () => {
        const ok = (von: number, bis: number, status: BookingEntry['status'] = 'approved') =>
            balkenFuerTag([eintrag('e', berlinZeitpunkt(2026, 11, 3, von).toISOString(), berlinZeitpunkt(2026, 11, 3, bis).toISOString(), status)], 2026, 11, 3, 8, 22);
        expect(belegungsStufe([], 8, 22)).toBe(0);
        expect(belegungsStufe(ok(18, 20), 8, 22)).toBe(1); // 2 von 14 Stunden
        expect(belegungsStufe(ok(10, 16), 8, 22)).toBe(2); // 6 von 14
        expect(belegungsStufe(ok(8, 20), 8, 22)).toBe(3); // 12 von 14
        expect(belegungsStufe(ok(8, 22), 8, 22)).toBe(4);
        expect(belegungsStufe(ok(8, 22, 'requested'), 8, 22)).toBe(0);
    });

    it('wandelt einen Termin in volle Stunden um und verlangt ein Ende', () => {
        const tag = { jahr: 2026, monat: 11, tag: 3 };
        const b = terminZuBelegung(tag, '19:30', '21:15');
        expect(b && berlinUhr(b.beginn)).toMatchObject({ stunde: 19, minute: 0 });
        expect(b && berlinUhr(b.ende)).toMatchObject({ stunde: 22, minute: 0 });
        const glatt = terminZuBelegung(tag, '19:00', '21:00');
        expect(glatt && berlinUhr(glatt.ende).stunde).toBe(21);
        expect(terminZuBelegung(tag, '19:00', '')).toBeNull();
        expect(terminZuBelegung(tag, '19:00', null)).toBeNull();
        expect(terminZuBelegung(tag, '21:00', '19:00')).toBeNull();
        expect(terminZuBelegung(tag, '19:10', '19:40')).not.toBeNull(); // 19 bis 20 Uhr
        expect(terminZuBelegung(tag, 'abends', '21:00')).toBeNull();
    });

    it('findet den Montag und die ISO-Kalenderwoche, auch über Monats- und Jahresgrenzen', () => {
        expect(montagDerWoche({ jahr: 2026, monat: 10, tag: 29 })).toEqual({ jahr: 2026, monat: 10, tag: 26 }); // Donnerstag
        expect(montagDerWoche({ jahr: 2026, monat: 11, tag: 1 })).toEqual({ jahr: 2026, monat: 10, tag: 26 }); // Sonntag gehört zur Woche davor
        expect(montagDerWoche({ jahr: 2026, monat: 10, tag: 26 })).toEqual({ jahr: 2026, monat: 10, tag: 26 });
        expect(isoKalenderwoche({ jahr: 2026, monat: 10, tag: 29 })).toEqual({ woche: 44, jahr: 2026 });
        expect(isoKalenderwoche({ jahr: 2026, monat: 1, tag: 1 })).toEqual({ woche: 1, jahr: 2026 }); // Donnerstag
        expect(isoKalenderwoche({ jahr: 2027, monat: 1, tag: 1 })).toEqual({ woche: 53, jahr: 2026 }); // Freitag, Woche 53 von 2026
        expect(isoKalenderwoche({ jahr: 2024, monat: 12, tag: 30 })).toEqual({ woche: 1, jahr: 2025 }); // Montag
        expect(isoKalenderwoche({ jahr: 2028, monat: 2, tag: 29 })).toEqual({ woche: 9, jahr: 2028 }); // Schaltjahr
        expect(plusTage({ jahr: 2026, monat: 12, tag: 31 }, 1)).toEqual({ jahr: 2027, monat: 1, tag: 1 });
        expect(plusTage({ jahr: 2028, monat: 2, tag: 28 }, 1)).toEqual({ jahr: 2028, monat: 2, tag: 29 });
    });
});
