import { berechneTheme, farbHinweise, kontrast, normalisiereFarbe, schriftAufFarbe, STANDARD_FARBE } from './org-theme';

describe('Organisations-Theme', () => {
    describe('normalisiereFarbe', () => {
        it('akzeptiert drei- und sechsstellige Werte mit und ohne Raute, in beliebiger Schreibweise', () => {
            expect(normalisiereFarbe('#ABC')).toBe('#aabbcc');
            expect(normalisiereFarbe('e3000f')).toBe('#e3000f');
            expect(normalisiereFarbe('  #2E5BD8 ')).toBe('#2e5bd8');
        });

        it('lehnt alles andere ab', () => {
            for (const falsch of ['', 'rot', '#12', '#12345', '#1234567', '#ggg', 'rgb(1,2,3)', null, undefined]) {
                expect(normalisiereFarbe(falsch as never), String(falsch)).toBeNull();
            }
        });
    });

    describe('berechneTheme', () => {
        it('leitet aus der Primärfarbe alle Variablen ab und setzt rgb-Werte für Tailwind-Deckkraft', () => {
            const theme = berechneTheme('#2e5bd8');

            expect(theme['--linke-rot']).toBe('#2e5bd8');
            expect(theme['--primary-color']).toBe('#2e5bd8');
            expect(theme['--color-primary']).toBe('#2e5bd8');
            expect(theme['--linke-rgb']).toBe('46 91 216');
            expect(theme['--linke-light']).not.toBe(theme['--linke-dunkelrot']);
            expect(kontrast(theme['--linke-light'], '#000000')).toBeGreaterThan(kontrast('#2e5bd8', '#000000')); // heller als die Primärfarbe
            expect(kontrast(theme['--linke-dunkelrot'], '#000000')).toBeLessThan(kontrast('#2e5bd8', '#000000')); // dunkler
            expect(theme['--linke-rgb']).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
        });

        it('fällt bei ungültiger Eingabe auf die Standardfarbe zurück, statt kaputte Werte zu setzen', () => {
            for (const falsch of ['', 'blau', null, undefined, '#zz']) {
                expect(berechneTheme(falsch as never)['--linke-rot'], String(falsch)).toBe(STANDARD_FARBE);
            }
        });

        it('wählt die Schriftfarbe auf Schaltflächen nach Kontrast: dunkle Farbe → weiß, helle Farbe → dunkel', () => {
            expect(berechneTheme('#1a1a8c')['--p-button-primary-color']).toBe('#ffffff');
            expect(berechneTheme('#ffe066')['--p-button-primary-color']).toBe('#111111');
            for (const farbe of ['#e3000f', '#2f9e44', '#ffe066', '#000000', '#ffffff', '#808080']) {
                expect(kontrast(farbe, schriftAufFarbe(farbe)), farbe).toBeGreaterThanOrEqual(4.5);
            }
        });
    });

    describe('farbHinweise', () => {
        it('warnt vor Farben, die auf dunklem oder hellem Grund kaum zu erkennen sind', () => {
            expect(farbHinweise('#101010').join(' ')).toContain('Dunkelmodus');
            expect(farbHinweise('#fafafa').join(' ')).toContain('hellen Modus');
            expect(farbHinweise('#2e5bd8')).toEqual([]);
            expect(farbHinweise('kaputt')).toEqual(['Das ist keine gültige Farbe (z. B. #e3000f).']);
        });
    });
});
