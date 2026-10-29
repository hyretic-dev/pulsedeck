import { getHolidays } from 'feiertagejs';

export type Bundesland = 'BW' | 'BY' | 'BE' | 'BB' | 'HB' | 'HH' | 'HE' | 'MV' | 'NI' | 'NW' | 'RP' | 'SL' | 'SN' | 'ST' | 'SH' | 'TH';

/** Sonntage sind ohnehin Wochenende. */
const NUR_SONNTAGE = new Set(['OSTERSONNTAG', 'PFINGSTSONNTAG']);

/**
 * Gesetzliche Feiertage eines Jahres (`JJJJ-MM-TT` → Name), lokal mit `feiertagejs` berechnet (keine externe API).
 * Ohne Bundesland nur die bundesweiten. Das Frontend nutzt dieselbe Bibliothek mit denselben Testfällen.
 */
export function feiertageImJahr(jahr: number, land: Bundesland | null = null): ReadonlyMap<string, string> {
  const tabelle = new Map<string, string>();
  for (const feiertag of getHolidays(jahr, land ?? 'BUND')) {
    if (NUR_SONNTAGE.has(feiertag.name)) continue;
    tabelle.set(feiertag.dateString, feiertag.translate('de') ?? feiertag.name);
  }
  return tabelle;
}
