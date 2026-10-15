export interface IcalTermin {
  id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string | null;
  description: string | null;
  location: string | null;
  ag_name: string | null;
}

/** Wandzeit einer Zeitzone als UTC-Zeitpunkt (ohne VTIMEZONE-Block: Kalender-Clients bekommen eindeutige UTC-Zeiten). */
export function wandzeitNachUtc(datum: string, uhrzeit: string, zone: string): Date {
  const [jahr, monat, tag] = datum.split('-').map(Number);
  const [stunde, minute] = uhrzeit.split(':').map(Number);
  const raten = Date.UTC(jahr, monat - 1, tag, stunde, minute);
  // Versatz der Zone an diesem Zeitpunkt bestimmen und anwenden (zweimal, damit Sommerzeitgrenzen stimmen)
  let utc = raten;
  for (let i = 0; i < 2; i += 1) {
    const teile = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
        .formatToParts(new Date(utc))
        .map((t) => [t.type, Number(t.value)])
    );
    const alsWand = Date.UTC(teile.year, teile.month - 1, teile.day, teile.hour, teile.minute);
    utc += raten - alsWand;
  }
  return new Date(utc);
}

const formatUtc = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Text nach RFC 5545 maskieren (Backslash, Semikolon, Komma, Zeilenumbrüche – auch \r, sonst ließen sich Felder einschleusen). */
export function maskiereIcalText(text: string | null | undefined): string {
  return (text ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Zeilen länger als 75 Oktette falten (Fortsetzungszeile beginnt mit einem Leerzeichen), ohne Mehrbyte-Zeichen zu zerschneiden. */
export function faltenZeile(zeile: string): string {
  if (Buffer.byteLength(zeile) <= 75) return zeile;
  const teile: string[] = [];
  let aktuell = '';
  let grenze = 75;
  for (const zeichen of zeile) {
    if (Buffer.byteLength(aktuell + zeichen) > grenze) {
      teile.push(aktuell);
      aktuell = zeichen;
      grenze = 74; // das führende Leerzeichen zählt mit
    } else {
      aktuell += zeichen;
    }
  }
  teile.push(aktuell);
  return teile.join('\r\n ');
}

export function erzeugeIcal(termine: IcalTermin[], optionen: { kalenderName: string; zone: string; host: string; jetzt?: Date }): string {
  const stempel = formatUtc(optionen.jetzt ?? new Date());
  const zeilen = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PulseDeck//Vereinsverwaltung//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${maskiereIcalText(optionen.kalenderName)}`,
    `X-WR-TIMEZONE:${optionen.zone}`,
  ];
  for (const t of termine) {
    const start = wandzeitNachUtc(t.date, t.start_time, optionen.zone);
    const ende = t.end_time ? wandzeitNachUtc(t.date, t.end_time, optionen.zone) : start;
    zeilen.push('BEGIN:VEVENT', `UID:${t.id}@${optionen.host}`, `DTSTAMP:${stempel}`, `DTSTART:${formatUtc(start)}`, `DTEND:${formatUtc(ende)}`, `SUMMARY:${maskiereIcalText(t.title)}`);
    if (t.description) zeilen.push(`DESCRIPTION:${maskiereIcalText(t.description)}`);
    if (t.location) zeilen.push(`LOCATION:${maskiereIcalText(t.location)}`);
    if (t.ag_name) zeilen.push(`CATEGORIES:${maskiereIcalText(t.ag_name)}`);
    zeilen.push('END:VEVENT');
  }
  zeilen.push('END:VCALENDAR');
  return `${zeilen.map(faltenZeile).join('\r\n')}\r\n`;
}
