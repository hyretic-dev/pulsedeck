import { datumsSchluessel, wochentag } from './zeit';

export interface SerienRhythmus {
  weekdays: number[];
  every_n_weeks: number;
  valid_from: string;
  valid_to: string;
}

const TAG = 86_400_000;

/** Montag-basierte Wochennummer seit 1970 (der 1.1.1970 war ein Donnerstag). */
function wochenIndex(ms: number): number {
  return Math.floor((ms / TAG + 3) / 7);
}

/** Alle Berliner Daten (`JJJJ-MM-TT`) einer Serie im Gültigkeitszeitraum; der Rhythmus zählt ab der Woche des ersten passenden Tages. */
export function tageDerSerie(serie: SerienRhythmus): string[] {
  const [vj, vm, vt] = serie.valid_from.split('-').map(Number);
  const [bj, bm, bt] = serie.valid_to.split('-').map(Number);
  const start = Date.UTC(vj, vm - 1, vt);
  const ende = Date.UTC(bj, bm - 1, bt);
  const tage: string[] = [];
  let anker: number | null = null;
  for (let ms = start; ms <= ende; ms += TAG) {
    const d = new Date(ms);
    const [j, m, t] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    if (!serie.weekdays.includes(wochentag(j, m, t))) continue;
    anker ??= wochenIndex(ms);
    if ((wochenIndex(ms) - anker) % serie.every_n_weeks !== 0) continue;
    tage.push(datumsSchluessel(j, m, t));
  }
  return tage;
}
