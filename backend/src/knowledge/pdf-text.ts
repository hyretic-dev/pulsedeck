import { createRequire } from 'node:module';

const ladeModul = createRequire(__filename);

type PdfParse = (daten: Buffer) => Promise<{ text: string }>;

/**
 * PDF-Text über pdf-parse. Der direkte Pfad zu `lib/pdf-parse.js` umgeht den Debug-Modus der Paket-Einstiegsdatei
 * (sie versucht beim Import eine Testdatei zu lesen). Die Extraktion läuft in-process; Größe ist auf 10 MB begrenzt.
 */
export async function extrahierePdfText(inhalt: Buffer): Promise<string> {
  const parse = ladeModul('pdf-parse/lib/pdf-parse.js') as PdfParse;
  return (await parse(inhalt)).text;
}
