import { BoardEintrag, bauRegelErfuellt, brauchtRueckmeldung, filtere, rueckmeldungsEntwurf, themaKuerzel } from './feedback-board.logic';

const eintrag = (felder: Partial<BoardEintrag>): BoardEintrag => ({
    id: 'x', created_at: '2026-10-20T10:00:00Z', type: 'suggestion', description: 'Text', user_id: null, status: 'new', organization_id: null,
    organization_name: null, reporter_name: null, can_reply: false, source: 'gespraech', problem: null, topic: null, blocks_activation: false,
    decision: null, reply_text: null, replied_at: null, ...felder,
});

describe('Feedback-Board: Logik', () => {
    it('Bau-Regel: Thema ab 3 Organisationen oder wenn es die Aktivierung blockiert', () => {
        expect(bauRegelErfuellt({ organizations: 2, blocking: 0 })).toBe(false);
        expect(bauRegelErfuellt({ organizations: 3, blocking: 0 })).toBe(true);
        expect(bauRegelErfuellt({ organizations: 1, blocking: 1 })).toBe(true);
    });

    it('braucht eine Rückmeldung, sobald etwas umgesetzt ist und noch nicht beantwortet wurde', () => {
        expect(brauchtRueckmeldung(eintrag({ status: 'live' }))).toBe(true);
        expect(brauchtRueckmeldung(eintrag({ status: 'done' }))).toBe(true);
        expect(brauchtRueckmeldung(eintrag({ status: 'live', replied_at: '2026-10-21T08:00:00Z' }))).toBe(false);
        expect(brauchtRueckmeldung(eintrag({ status: 'in_progress' }))).toBe(false);
    });

    it('filtert nach offen, blockierend und ohne Rückmeldung, kombinierbar', () => {
        const liste = [
            eintrag({ id: 'a', status: 'new' }),
            eintrag({ id: 'b', status: 'in_progress', blocks_activation: true }),
            eintrag({ id: 'c', status: 'live' }),
            eintrag({ id: 'd', status: 'live', replied_at: '2026-10-21T08:00:00Z' }),
        ];
        const ids = (f: Partial<Parameters<typeof filtere>[1]>) => filtere(liste, { nurOffene: false, nurBlockierend: false, nurOhneRueckmeldung: false, ...f }).map((e) => e.id);

        expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
        expect(ids({ nurOffene: true })).toEqual(['a', 'b']);
        expect(ids({ nurBlockierend: true })).toEqual(['b']);
        expect(ids({ nurOhneRueckmeldung: true })).toEqual(['c']);
        expect(ids({ nurOffene: true, nurBlockierend: true })).toEqual(['b']);
    });

    it('schreibt einen Rückmeldungs-Entwurf mit gekürztem Zitat', () => {
        expect(rueckmeldungsEntwurf('Dunkelmodus\n  bitte')).toBe('Du hattest „Dunkelmodus bitte“ gemeldet, das ist jetzt live. Schau gern rein und sagt uns, ob es so passt.');
        const lang = rueckmeldungsEntwurf('x'.repeat(300));
        expect(lang).toContain('…“');
        expect(lang.length).toBeLessThan(260);
    });

    it('macht aus freiem Text ein gültiges Themen-Kürzel', () => {
        expect(themaKuerzel('Aufgaben ohne Termin!')).toBe('aufgaben-ohne-termin');
        expect(themaKuerzel('  Größe & Übersicht ')).toBe('groesse-uebersicht');
        expect(themaKuerzel('x'.repeat(100))).toHaveLength(60);
        expect(themaKuerzel('---')).toBe('');
    });
});
