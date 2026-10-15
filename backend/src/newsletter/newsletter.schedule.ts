export interface Zeitplan {
  frequency: string;
  day_of_week: number;
  time_of_day: string;
}

const WOCHENTAGE: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wandzeit in der Zeitzone, als UTC-Millisekunden kodiert (nur zum Vergleichen), plus Wochentag (0 = Sonntag). */
function wandzeit(zeitpunkt: Date, zone: string): { ms: number; wochentag: number; jahr: number; monat: number; tag: number } {
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(zeitpunkt)
      .map((t) => [t.type, t.value])
  );
  const [jahr, monat, tag] = [Number(teile.year), Number(teile.month), Number(teile.day)];
  return { ms: Date.UTC(jahr, monat - 1, tag, Number(teile.hour), Number(teile.minute)), wochentag: WOCHENTAGE[teile.weekday], jahr, monat, tag };
}

/**
 * Letzter planmäßiger Versandzeitpunkt (Wandzeit) vor oder gleich `jetzt`:
 * `weekly` = jeder Woche am `day_of_week` (0 = Sonntag) zur `time_of_day`,
 * `monthly` = am ersten `day_of_week` jedes Monats zur `time_of_day`, `manual` = nie.
 */
export function letzterTermin(plan: Zeitplan, jetzt: Date, zone: string): number | null {
  if (plan.frequency !== 'weekly' && plan.frequency !== 'monthly') return null;
  const [stunde, minute] = plan.time_of_day.split(':').map(Number);
  const heute = wandzeit(jetzt, zone);
  if (plan.frequency === 'weekly') {
    const kandidat = Date.UTC(heute.jahr, heute.monat - 1, heute.tag - ((heute.wochentag - plan.day_of_week + 7) % 7), stunde, minute);
    return kandidat > heute.ms ? kandidat - 7 * 86_400_000 : kandidat;
  }
  for (const versatz of [0, -1]) {
    const ersterWochentag = new Date(Date.UTC(heute.jahr, heute.monat - 1 + versatz, 1)).getUTCDay();
    const tag = 1 + ((plan.day_of_week - ersterWochentag + 7) % 7);
    const kandidat = Date.UTC(heute.jahr, heute.monat - 1 + versatz, tag, stunde, minute);
    if (kandidat <= heute.ms) return kandidat;
  }
  return null;
}

/** Fällig, wenn seit dem letzten planmäßigen Zeitpunkt noch nichts versendet wurde. */
export function istFaellig(plan: Zeitplan, zuletztGesendet: Date | null, jetzt: Date, zone: string): boolean {
  const termin = letzterTermin(plan, jetzt, zone);
  if (termin === null) return false;
  return zuletztGesendet === null || wandzeit(zuletztGesendet, zone).ms < termin;
}
