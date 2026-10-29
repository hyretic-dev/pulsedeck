import { getHolidays } from 'feiertagejs';

/**
 * Gesetzliche Feiertage in Deutschland, lokal berechnet (keine externe API, CSP `connect-src 'self'`) mit der Bibliothek
 * `feiertagejs`, die auch historische Sonderfälle kennt (Reformationstag 2017, Frauentag ab Einführung). Das Backend nutzt
 * dieselbe Bibliothek mit denselben Testfällen (Frontend und Backend teilen keinen Code).
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

export function datumsSchluessel(jahr: number, monat: number, tag: number): string {
    return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

/** Sonntage sind ohnehin Wochenende und würden die Feiertagsfärbung verfälschen. */
const NUR_SONNTAGE = new Set(['OSTERSONNTAG', 'PFINGSTSONNTAG']);

/**
 * Feiertage eines Jahres; ohne Bundesland die bundesweiten. Mariä Himmelfahrt gilt in Bayern in den meisten Gemeinden
 * und wird mitgeführt (für „Feiertage auslassen“ ist ein zu viel ausgelassener Tag harmloser als ein vergessener).
 */
export function feiertageImJahr(jahr: number, land: Bundesland | null = null): FeiertagsTabelle {
    const tabelle = new Map<string, string>();
    for (const feiertag of getHolidays(jahr, land ?? 'BUND')) {
        if (NUR_SONNTAGE.has(feiertag.name)) continue;
        tabelle.set(feiertag.dateString, feiertag.translate('de') ?? feiertag.name);
    }
    return tabelle;
}

export function feiertagsName(tabelle: FeiertagsTabelle, jahr: number, monat: number, tag: number): string | null {
    return tabelle.get(datumsSchluessel(jahr, monat, tag)) ?? null;
}
