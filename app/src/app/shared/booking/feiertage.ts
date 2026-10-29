/**
 * Gesetzliche Feiertage in Deutschland, lokal berechnet (keine externe API, CSP `connect-src 'self'`).
 * Reine Funktionen ohne DOM- und Framework-Zugriff. Das Backend führt eine eigene Kopie mit denselben Testfällen.
 */

export type Bundesland =
    | 'BW' | 'BY' | 'BE' | 'BB' | 'HB' | 'HH' | 'HE' | 'MV'
    | 'NI' | 'NW' | 'RP' | 'SL' | 'SN' | 'ST' | 'SH' | 'TH';

export const BUNDESLAENDER: ReadonlyArray<{ kuerzel: Bundesland; name: string }> = [
    { kuerzel: 'BW', name: 'Baden-Württemberg' },
    { kuerzel: 'BY', name: 'Bayern' },
    { kuerzel: 'BE', name: 'Berlin' },
    { kuerzel: 'BB', name: 'Brandenburg' },
    { kuerzel: 'HB', name: 'Bremen' },
    { kuerzel: 'HH', name: 'Hamburg' },
    { kuerzel: 'HE', name: 'Hessen' },
    { kuerzel: 'MV', name: 'Mecklenburg-Vorpommern' },
    { kuerzel: 'NI', name: 'Niedersachsen' },
    { kuerzel: 'NW', name: 'Nordrhein-Westfalen' },
    { kuerzel: 'RP', name: 'Rheinland-Pfalz' },
    { kuerzel: 'SL', name: 'Saarland' },
    { kuerzel: 'SN', name: 'Sachsen' },
    { kuerzel: 'ST', name: 'Sachsen-Anhalt' },
    { kuerzel: 'SH', name: 'Schleswig-Holstein' },
    { kuerzel: 'TH', name: 'Thüringen' },
];

/** Schlüssel `JJJJ-MM-TT` → Name des Feiertags. */
export type FeiertagsTabelle = ReadonlyMap<string, string>;

/** Ostersonntag nach der Gaußschen Osterformel in der Fassung von Meeus (gregorianischer Kalender). */
export function ostersonntag(jahr: number): { monat: number; tag: number } {
    const a = jahr % 19;
    const b = Math.floor(jahr / 100);
    const c = jahr % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const monat = Math.floor((h + l - 7 * m + 114) / 31);
    const tag = ((h + l - 7 * m + 114) % 31) + 1;
    return { monat, tag };
}

export function datumsSchluessel(jahr: number, monat: number, tag: number): string {
    return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

/** Verschiebt ein Datum um ganze Tage (über UTC, damit die Zeitumstellung keine Rolle spielt). */
function verschiebe(jahr: number, monat: number, tag: number, tage: number): string {
    const d = new Date(Date.UTC(jahr, monat - 1, tag + tage));
    return datumsSchluessel(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const FRONLEICHNAM: ReadonlyArray<Bundesland> = ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'];
const HEILIGE_DREI_KOENIGE: ReadonlyArray<Bundesland> = ['BW', 'BY', 'ST'];
const FRAUENTAG: ReadonlyArray<Bundesland> = ['BE', 'MV'];
const REFORMATIONSTAG: ReadonlyArray<Bundesland> = ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'];
const ALLERHEILIGEN: ReadonlyArray<Bundesland> = ['BW', 'BY', 'NW', 'RP', 'SL'];

/**
 * Feiertage eines Jahres. Ohne Bundesland nur die bundesweiten. Mariä Himmelfahrt gilt in Bayern nur in
 * Gemeinden mit überwiegend katholischer Bevölkerung und wird deshalb nur für das Saarland geführt.
 */
export function feiertageImJahr(jahr: number, land: Bundesland | null = null): FeiertagsTabelle {
    const ostern = ostersonntag(jahr);
    const relativ = (tage: number) => verschiebe(jahr, ostern.monat, ostern.tag, tage);
    const tabelle = new Map<string, string>([
        [datumsSchluessel(jahr, 1, 1), 'Neujahr'],
        [relativ(-2), 'Karfreitag'],
        [relativ(1), 'Ostermontag'],
        [datumsSchluessel(jahr, 5, 1), 'Tag der Arbeit'],
        [relativ(39), 'Christi Himmelfahrt'],
        [relativ(50), 'Pfingstmontag'],
        [datumsSchluessel(jahr, 10, 3), 'Tag der Deutschen Einheit'],
        [datumsSchluessel(jahr, 12, 25), '1. Weihnachtstag'],
        [datumsSchluessel(jahr, 12, 26), '2. Weihnachtstag'],
    ]);
    if (!land) return tabelle;

    if (HEILIGE_DREI_KOENIGE.includes(land)) tabelle.set(datumsSchluessel(jahr, 1, 6), 'Heilige Drei Könige');
    if (FRAUENTAG.includes(land) && (land === 'BE' ? jahr >= 2019 : jahr >= 2023)) {
        tabelle.set(datumsSchluessel(jahr, 3, 8), 'Internationaler Frauentag');
    }
    if (FRONLEICHNAM.includes(land)) tabelle.set(relativ(60), 'Fronleichnam');
    if (land === 'SL') tabelle.set(datumsSchluessel(jahr, 8, 15), 'Mariä Himmelfahrt');
    if (land === 'TH' && jahr >= 2019) tabelle.set(datumsSchluessel(jahr, 9, 20), 'Weltkindertag');
    if (REFORMATIONSTAG.includes(land)) tabelle.set(datumsSchluessel(jahr, 10, 31), 'Reformationstag');
    if (ALLERHEILIGEN.includes(land)) tabelle.set(datumsSchluessel(jahr, 11, 1), 'Allerheiligen');
    if (land === 'SN') {
        // Mittwoch vor dem 23. November: vom 22. November rückwärts bis zum Mittwoch
        const tagDerWoche = new Date(Date.UTC(jahr, 10, 22)).getUTCDay();
        tabelle.set(verschiebe(jahr, 11, 22, -((tagDerWoche - 3 + 7) % 7)), 'Buß- und Bettag');
    }
    return tabelle;
}

export function feiertagsName(tabelle: FeiertagsTabelle, jahr: number, monat: number, tag: number): string | null {
    return tabelle.get(datumsSchluessel(jahr, monat, tag)) ?? null;
}
