/**
 * Die Rate-Limits zählen in Festfenstern, die an Vielfachen der Fensterlänge ausgerichtet sind. Ein Test, der ein Limit ausreizt,
 * wird rot, wenn mitten in seiner Schleife ein neues Fenster beginnt (Zähler wieder 0). Deshalb vorher warten, bis genug Zeit
 * im aktuellen Fenster bleibt.
 */
export async function frischesFenster(fensterMs = 60_000, mindestensMs = 15_000): Promise<void> {
  const rest = fensterMs - (Date.now() % fensterMs);
  if (rest < mindestensMs) await new Promise((fertig) => setTimeout(fertig, rest + 50));
}
