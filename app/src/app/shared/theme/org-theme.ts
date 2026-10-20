/**
 * Organisations-Theme: aus einer Primärfarbe werden alle Farb-Variablen der Oberfläche abgeleitet (Tailwind-Klassen `linke`,
 * PrimeNG-Tokens, Schaltflächen). Reine Funktionen ohne DOM-Zugriff, damit sie sich testen lassen.
 */

export const STANDARD_FARBE = '#e3000f';

/** Vorschläge im Einstellungsdialog: Name und Farbe, alle mit lesbarem Kontrast auf hellem und dunklem Grund. */
export const FARB_VORSCHLAEGE: ReadonlyArray<{ name: string; farbe: string }> = [
    { name: 'Rot', farbe: '#e3000f' },
    { name: 'Orange', farbe: '#d9480f' },
    { name: 'Gelb', farbe: '#b8860b' },
    { name: 'Grün', farbe: '#2f9e44' },
    { name: 'Türkis', farbe: '#0b8f86' },
    { name: 'Blau', farbe: '#2e5bd8' },
    { name: 'Violett', farbe: '#8100a1' },
    { name: 'Pink', farbe: '#c2255c' },
];

type Rgb = readonly [number, number, number];

/** `#abc`, `abc`, `#AABBCC` → `#aabbcc`; ungültige Eingaben → null. */
export function normalisiereFarbe(roh: string | null | undefined): string | null {
    const text = (roh ?? '').trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(text)) return `#${text[0]}${text[0]}${text[1]}${text[1]}${text[2]}${text[2]}`;
    if (/^[0-9a-f]{6}$/.test(text)) return `#${text}`;
    return null;
}

function alsRgb(hex: string): Rgb {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function alsHex([r, g, b]: Rgb): string {
    return `#${[r, g, b].map((k) => Math.round(Math.min(255, Math.max(0, k))).toString(16).padStart(2, '0')).join('')}`;
}

/** Mischt `hex` mit `mit` (0 = nur hex, 1 = nur mit). */
function mischen(hex: string, mit: Rgb, anteil: number): string {
    const [r, g, b] = alsRgb(hex);
    return alsHex([r + (mit[0] - r) * anteil, g + (mit[1] - g) * anteil, b + (mit[2] - b) * anteil]);
}

const WEISS: Rgb = [255, 255, 255];
const SCHWARZ: Rgb = [0, 0, 0];

/** Relative Leuchtdichte nach WCAG 2. */
function leuchtdichte(hex: string): number {
    const [r, g, b] = alsRgb(hex).map((k) => {
        const s = k / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhältnis nach WCAG 2 (1 bis 21). */
export function kontrast(a: string, b: string): number {
    const [hell, dunkel] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x);
    return (hell + 0.05) / (dunkel + 0.05);
}

/** Schriftfarbe auf der Primärfarbe (Schaltflächen): Weiß oder fast Schwarz, je nach besserem Kontrast. */
export function schriftAufFarbe(hex: string): string {
    return kontrast(hex, '#ffffff') >= kontrast(hex, '#111111') ? '#ffffff' : '#111111';
}

const rgbText = (hex: string): string => alsRgb(hex).join(' ');

/** CSS-Variablen für eine Primärfarbe; bei ungültiger Farbe die Standardfarbe. */
export function berechneTheme(farbe: string | null | undefined): Record<string, string> {
    const primaer = normalisiereFarbe(farbe) ?? STANDARD_FARBE;
    const hell = mischen(primaer, WEISS, 0.35);
    const dunkel = mischen(primaer, SCHWARZ, 0.45);
    const sehrDunkel = mischen(primaer, SCHWARZ, 0.9);
    return {
        '--linke-rot': primaer,
        '--linke-light': hell,
        '--linke-dunkelrot': dunkel,
        '--linke-rgb': rgbText(primaer),
        '--linke-light-rgb': rgbText(hell),
        '--linke-dark-rgb': rgbText(dunkel),
        '--linke-darker-rgb': rgbText(sehrDunkel),
        '--primary-color': primaer,
        '--primary-hover': mischen(primaer, WEISS, 0.15),
        '--primary-active': mischen(primaer, SCHWARZ, 0.2),
        '--color-primary': primaer,
        '--p-button-primary-color': schriftAufFarbe(primaer),
    };
}

/** Hinweise, wenn eine Farbe als Text oder Symbol auf dem dunklen oder hellen Hintergrund schwer lesbar ist (Mindestkontrast 3:1). */
export function farbHinweise(farbe: string | null | undefined): string[] {
    const hex = normalisiereFarbe(farbe);
    if (!hex) return ['Das ist keine gültige Farbe (z. B. #e3000f).'];
    const hinweise: string[] = [];
    if (kontrast(hex, '#0f0f0f') < 3) hinweise.push('Im Dunkelmodus ist diese Farbe als Text oder Symbol schwer zu erkennen.');
    if (kontrast(hex, '#ffffff') < 3) hinweise.push('Im hellen Modus ist diese Farbe als Text oder Symbol schwer zu erkennen.');
    return hinweise;
}
