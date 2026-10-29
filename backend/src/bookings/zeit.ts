/**
 * Zeitrechnung für Belegungen in Europe/Berlin. Reine Funktionen; Tage mit 23 oder 25 Stunden (Zeitumstellung) löst die
 * Zeitzone der Plattform auf, nicht eine feste Stundenzahl. Das Frontend führt eine eigene Kopie mit denselben Testfällen.
 */

const ZONE = 'Europe/Berlin';
const FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
});

export interface WandUhr {
  jahr: number;
  monat: number;
  tag: number;
  stunde: number;
  minute: number;
}

export function berlinUhr(zeitpunkt: Date | string): WandUhr {
  const teile = Object.fromEntries(FORMAT.formatToParts(new Date(zeitpunkt)).map((t) => [t.type, Number(t.value)]));
  return { jahr: teile.year, monat: teile.month, tag: teile.day, stunde: teile.hour, minute: teile.minute };
}

/** Versatz Berlin gegenüber UTC in Minuten zum Zeitpunkt `ms`. */
function versatzMinuten(ms: number): number {
  const u = berlinUhr(new Date(ms));
  return (Date.UTC(u.jahr, u.monat - 1, u.tag, u.stunde, u.minute) - Math.floor(ms / 60000) * 60000) / 60000;
}

/** Zeitpunkt der Berliner Wanduhrzeit; für Stunden, die es bei der Umstellung nicht gibt, gilt die Zeit nach der Lücke. */
export function berlinZeitpunkt(jahr: number, monat: number, tag: number, stunde: number): Date {
  const wand = Date.UTC(jahr, monat - 1, tag, stunde);
  let ms = wand - versatzMinuten(wand) * 60000;
  ms = wand - versatzMinuten(ms) * 60000;
  return new Date(ms);
}

/** Wochentag, 0 = Montag … 6 = Sonntag. */
export function wochentag(jahr: number, monat: number, tag: number): number {
  return (new Date(Date.UTC(jahr, monat - 1, tag)).getUTCDay() + 6) % 7;
}

export function datumsSchluessel(jahr: number, monat: number, tag: number): string {
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

/** Stunden, die der Berliner Kalendertag tatsächlich hat (23, 24 oder 25). */
export function stundenDesTages(jahr: number, monat: number, tag: number): number {
  return Math.round((berlinZeitpunkt(jahr, monat, tag + 1, 0).getTime() - berlinZeitpunkt(jahr, monat, tag, 0).getTime()) / 3600000);
}

export interface Zeitraum {
  beginn: Date;
  ende: Date;
}

/** Stunde des Endes im Berliner Tagesverlauf; Mitternacht zählt als 24 Uhr des Vortags. */
export function endStunde(ende: Date): number {
  const u = berlinUhr(ende);
  return u.stunde === 0 && u.minute === 0 ? 24 : u.stunde;
}

/**
 * Belegungszeitraum eines Termins: Beginn abgerundet, Ende aufgerundet auf volle Stunden (Berliner Datum `JJJJ-MM-TT`,
 * Zeiten `HH:MM`). Ohne Ende oder mit Ende vor dem Beginn kein Zeitraum.
 */
export function terminZuBelegung(datum: string, start: string | null | undefined, ende: string | null | undefined): Zeitraum | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  const zeit = (text: string | null | undefined) => {
    const t = /^(\d{1,2}):(\d{2})/.exec((text ?? '').trim());
    return t && Number(t[1]) < 24 && Number(t[2]) < 60 ? { h: Number(t[1]), m: Number(t[2]) } : null;
  };
  const von = zeit(start);
  const bis = zeit(ende);
  if (!d || !von || !bis || bis.h * 60 + bis.m <= von.h * 60 + von.m) return null;
  const [jahr, monat, tag] = [Number(d[1]), Number(d[2]), Number(d[3])];
  return {
    beginn: berlinZeitpunkt(jahr, monat, tag, von.h),
    ende: berlinZeitpunkt(jahr, monat, tag, bis.m > 0 ? bis.h + 1 : bis.h),
  };
}

export function ueberschneiden(a: Zeitraum, b: Zeitraum): boolean {
  return a.beginn < b.ende && b.beginn < a.ende;
}
