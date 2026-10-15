/**
 * Wählt nur die genannten Felder aus (das Backend lehnt unbekannte Felder ab); `undefined` fällt weg.
 * Leere Eingabefelder der Oberfläche (`''`) werden für `leerAlsNull` zu `null`: Das Backend prüft Formate
 * (UUID, Uhrzeit, Adresse) und behandelt `null` als „nicht gesetzt“, eine leere Zeichenkette aber als ungültig.
 */
export function pick<T extends object>(quelle: T, felder: readonly string[], leerAlsNull: readonly string[] = []): Partial<T> {
    const ergebnis: Record<string, unknown> = {};
    for (const f of felder) {
        const wert = (quelle as Record<string, unknown>)[f];
        if (wert === undefined) continue;
        ergebnis[f] = wert === '' && leerAlsNull.includes(f) ? null : wert;
    }
    return ergebnis as Partial<T>;
}
