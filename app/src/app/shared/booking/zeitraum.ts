import type { BookingEntry, Verfuegbarkeit } from './booking.models';
import { datumsSchluessel } from './feiertage';

/**
 * Zeitrechnung für Belegungen in Europe/Berlin. Alle Funktionen sind rein; Tage mit 23 oder 25 Stunden
 * (Zeitumstellung) werden über die Zeitzone der Plattform aufgelöst, nicht über feste Stundenzahlen.
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
    const teile = Object.fromEntries(
        FORMAT.formatToParts(new Date(zeitpunkt)).map((t) => [t.type, Number(t.value)]),
    );
    return { jahr: teile['year'], monat: teile['month'], tag: teile['day'], stunde: teile['hour'], minute: teile['minute'] };
}

/** Versatz Berlin gegenüber UTC in Minuten zum Zeitpunkt `ms`. */
function versatzMinuten(ms: number): number {
    const u = berlinUhr(new Date(ms));
    return (Date.UTC(u.jahr, u.monat - 1, u.tag, u.stunde, u.minute) - Math.floor(ms / 60000) * 60000) / 60000;
}

/**
 * Zeitpunkt der Berliner Wanduhrzeit. Für Stunden, die es bei der Umstellung nicht gibt (02:00 bis 03:00 im März),
 * gilt die Zeit nach der Lücke.
 */
export function berlinZeitpunkt(jahr: number, monat: number, tag: number, stunde: number): Date {
    const wand = Date.UTC(jahr, monat - 1, tag, stunde);
    let ms = wand - versatzMinuten(wand) * 60000;
    ms = wand - versatzMinuten(ms) * 60000;
    return new Date(ms);
}

export function tageImMonat(jahr: number, monat: number): number {
    return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

/** Wochentag, 0 = Montag … 6 = Sonntag. */
export function wochentag(jahr: number, monat: number, tag: number): number {
    return (new Date(Date.UTC(jahr, monat - 1, tag)).getUTCDay() + 6) % 7;
}

export function istWochenende(jahr: number, monat: number, tag: number): boolean {
    return wochentag(jahr, monat, tag) >= 5;
}

/** Stunden, die der Berliner Kalendertag tatsächlich hat (23, 24 oder 25). */
export function stundenDesTages(jahr: number, monat: number, tag: number): number {
    const beginn = berlinZeitpunkt(jahr, monat, tag, 0).getTime();
    const ende = berlinZeitpunkt(jahr, monat, tag + 1, 0).getTime();
    return Math.round((ende - beginn) / 3600000);
}

/** Beginn abgerundet, Ende aufgerundet auf volle Stunden: 19:30 bis 21:15 → 19:00 bis 22:00. */
export function aufVolleStunden(beginn: Date | string | number, ende: Date | string | number): { beginn: Date; ende: Date } {
    const stunde = 3600000;
    const b = new Date(beginn).getTime();
    const e = new Date(ende).getTime();
    return { beginn: new Date(Math.floor(b / stunde) * stunde), ende: new Date(Math.ceil(e / stunde) * stunde) };
}

/**
 * Belegungszeitraum eines Termins: Beginn abgerundet, Ende aufgerundet auf volle Stunden (Berliner Datum, Zeiten
 * `HH:MM`). Ohne Ende kein Zeitraum (ein Termin mit Ortsreservierung braucht ein Ende); Ende vor Beginn ebenso.
 */
export function terminZuBelegung(
    datum: { jahr: number; monat: number; tag: number },
    start: string | null | undefined,
    ende: string | null | undefined,
): { beginn: Date; ende: Date } | null {
    const zeit = (text: string | null | undefined) => {
        const t = /^(\d{1,2}):(\d{2})$/.exec((text ?? '').trim());
        return t && Number(t[1]) < 24 && Number(t[2]) < 60 ? { h: Number(t[1]), m: Number(t[2]) } : null;
    };
    const von = zeit(start);
    const bis = zeit(ende);
    if (!von || !bis) return null;
    if (bis.h * 60 + bis.m <= von.h * 60 + von.m) return null;
    const bisStunde = bis.m > 0 ? bis.h + 1 : bis.h;
    return {
        beginn: berlinZeitpunkt(datum.jahr, datum.monat, datum.tag, von.h),
        ende: berlinZeitpunkt(datum.jahr, datum.monat, datum.tag, bisStunde),
    };
}

export function ueberschneiden(a: { start_at: string; end_at: string }, b: { start_at: string; end_at: string }): boolean {
    return new Date(a.start_at) < new Date(b.end_at) && new Date(b.start_at) < new Date(a.end_at);
}

/**
 * Prüft einen Zeitraum gegen die Belegung des Plans: angenommene Buchungen sperren, offene Anfragen sind
 * Planungszeiten und werden nur gemeldet. `ausser` nimmt eine Buchung aus (beim Bearbeiten).
 */
export function pruefeVerfuegbarkeit(
    eintraege: ReadonlyArray<BookingEntry>,
    beginn: Date,
    ende: Date,
    ausser: string | null = null,
): Verfuegbarkeit {
    const zeitraum = { start_at: beginn.toISOString(), end_at: ende.toISOString() };
    const treffer = eintraege.filter((e) => e.id !== ausser && ueberschneiden(e, zeitraum));
    const angenommen = treffer.find((e) => e.status === 'approved');
    if (angenommen) return { art: 'belegt', durch: angenommen };
    const offen = treffer.filter((e) => e.status === 'requested');
    return offen.length ? { art: 'ueberschneidung', mit: offen } : { art: 'frei' };
}

/** Ein Eintrag, auf einen Tag zugeschnitten: Stunden des Fensters, in denen er liegt. */
export interface TagesBalken {
    eintrag: BookingEntry;
    /** Erste belegte Stunde (inklusive) und Ende (exklusive), jeweils begrenzt auf das Zeitfenster. */
    von: number;
    bis: number;
    setztFortVorher: boolean;
    setztFortNachher: boolean;
}

export function balkenFuerTag(
    eintraege: ReadonlyArray<BookingEntry>,
    jahr: number,
    monat: number,
    tag: number,
    fensterStart: number,
    fensterEnde: number,
): TagesBalken[] {
    const tagBeginn = berlinZeitpunkt(jahr, monat, tag, 0);
    const tagEnde = berlinZeitpunkt(jahr, monat, tag + 1, 0);
    const balken: TagesBalken[] = [];
    for (const eintrag of eintraege) {
        if (eintrag.status === 'declined' || eintrag.status === 'cancelled') continue;
        const start = new Date(eintrag.start_at);
        const ende = new Date(eintrag.end_at);
        if (!(start < tagEnde && ende > tagBeginn)) continue;
        const setztFortVorher = start < tagBeginn;
        const setztFortNachher = ende > tagEnde;
        const von = setztFortVorher ? fensterStart : berlinUhr(start).stunde;
        const bis = setztFortNachher ? fensterEnde : berlinUhr(ende).stunde || 24;
        const v = Math.max(von, fensterStart);
        const b = Math.min(bis, fensterEnde);
        if (b > v) balken.push({ eintrag, von: v, bis: b, setztFortVorher, setztFortNachher });
    }
    return balken.sort((x, y) => x.von - y.von || x.bis - y.bis);
}

/** Verteilt Balken auf Bahnen, damit sich überschneidende Anfragen übereinander liegen. */
export function verteileAufBahnen(balken: ReadonlyArray<TagesBalken>): { balken: TagesBalken; bahn: number }[] {
    const bahnEnden: number[] = [];
    return balken.map((b) => {
        let bahn = bahnEnden.findIndex((ende) => ende <= b.von);
        if (bahn === -1) bahn = bahnEnden.length;
        bahnEnden[bahn] = b.bis;
        return { balken: b, bahn };
    });
}

/** Belegungsgrad eines Tages (0 = frei … 4 = voll) aus den angenommenen Buchungen im Zeitfenster. */
export function belegungsStufe(balken: ReadonlyArray<TagesBalken>, fensterStart: number, fensterEnde: number): 0 | 1 | 2 | 3 | 4 {
    const belegt = new Set<number>();
    for (const b of balken) {
        if (b.eintrag.status !== 'approved') continue;
        for (let h = b.von; h < b.bis; h++) belegt.add(h);
    }
    const anteil = belegt.size / Math.max(1, fensterEnde - fensterStart);
    if (anteil === 0) return 0;
    if (anteil <= 0.25) return 1;
    if (anteil <= 0.5) return 2;
    if (anteil < 1) return 3;
    return 4;
}

export function hatOffeneAnfrage(balken: ReadonlyArray<TagesBalken>): boolean {
    return balken.some((b) => b.eintrag.status === 'requested');
}

export function tagesSchluessel(d: Date): string {
    const u = berlinUhr(d);
    return datumsSchluessel(u.jahr, u.monat, u.tag);
}

/** Ein Berliner Kalendertag. */
export interface TagRef {
    jahr: number;
    monat: number;
    tag: number;
}

export function plusTage(t: TagRef, tage: number): TagRef {
    const d = new Date(Date.UTC(t.jahr, t.monat - 1, t.tag + tage));
    return { jahr: d.getUTCFullYear(), monat: d.getUTCMonth() + 1, tag: d.getUTCDate() };
}

/** Der Montag der Woche, in der der Tag liegt (Wochen laufen von Montag bis Sonntag). */
export function montagDerWoche(t: TagRef): TagRef {
    return plusTage(t, -wochentag(t.jahr, t.monat, t.tag));
}

/** Die sieben Tage der Woche ab dem Montag. */
export function wochenTage(montag: TagRef): TagRef[] {
    return Array.from({ length: 7 }, (_, i) => plusTage(montag, i));
}

/** ISO-8601-Kalenderwoche samt Wochenjahr (die Woche gehört zum Jahr ihres Donnerstags). */
export function isoKalenderwoche(t: TagRef): { woche: number; jahr: number } {
    const donnerstag = plusTage(montagDerWoche(t), 3);
    const ersterJanuar = Date.UTC(donnerstag.jahr, 0, 1);
    const tageSeitJahresbeginn = (Date.UTC(donnerstag.jahr, donnerstag.monat - 1, donnerstag.tag) - ersterJanuar) / 86_400_000;
    return { woche: Math.floor(tageSeitJahresbeginn / 7) + 1, jahr: donnerstag.jahr };
}

export function heuteBerlin(): TagRef {
    const h = berlinUhr(new Date());
    return { jahr: h.jahr, monat: h.monat, tag: h.tag };
}
