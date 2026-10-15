const MAX_ABSCHNITT = 1500;
const MIN_ABSCHNITT = 50;

/** Absätze (durch Leerzeilen getrennt); zu kurze Reste fallen weg, zu lange werden hart geteilt. */
export function teileInAbschnitte(text: string): string[] {
  const ergebnis: string[] = [];
  for (const absatz of text.split(/\n\s*\n/).map((a) => a.trim()).filter((a) => a.length > MIN_ABSCHNITT)) {
    for (let i = 0; i < absatz.length; i += MAX_ABSCHNITT) ergebnis.push(absatz.slice(i, i + MAX_ABSCHNITT));
  }
  return ergebnis;
}

/** Produktdokumentation: Abschnitte an Überschriften der Ebene 2 und 3. */
export function teileDokumentation(text: string): Array<{ titel: string; inhalt: string }> {
  return text
    .split(/\n#{2,3} /)
    .map((c, i) => (i === 0 ? c : `## ${c}`))
    .filter((c) => c.trim().length > 20)
    .map((inhalt) => ({ titel: inhalt.trim().split('\n')[0].replace(/#/g, '').trim(), inhalt }));
}
