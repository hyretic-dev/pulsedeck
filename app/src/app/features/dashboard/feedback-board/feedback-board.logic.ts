/** Reine Logik des Feedback-Boards (ohne Oberfläche, testbar). */

export interface BoardEintrag {
    id: string;
    created_at: string;
    type: 'bug' | 'suggestion';
    description: string;
    user_id: string | null;
    status: 'new' | 'in_progress' | 'done' | 'live';
    organization_id: string | null;
    organization_name: string | null;
    reporter_name: string | null;
    can_reply: boolean;
    source: 'app' | 'gespraech' | 'mail';
    problem: string | null;
    topic: string | null;
    blocks_activation: boolean;
    decision: 'bauen' | 'parken' | 'abgelehnt' | null;
    reply_text: string | null;
    replied_at: string | null;
}

export interface BoardThema {
    topic: string;
    organizations: number;
    entries: number;
    blocking: number;
    open: number;
}

export interface BoardFilter {
    nurOffene: boolean;
    nurBlockierend: boolean;
    nurOhneRueckmeldung: boolean;
}

/** Bau-Regel: ein Thema wird gebaut, wenn es die Aktivierung blockiert oder mindestens 3 Organisationen unabhängig voneinander betrifft. */
export const MIN_ORGANISATIONEN = 3;

export function bauRegelErfuellt(thema: Pick<BoardThema, 'organizations' | 'blocking'>): boolean {
    return thema.blocking > 0 || thema.organizations >= MIN_ORGANISATIONEN;
}

/** „Fertig“ aus Sicht der Rückmeldung: der Eintrag ist umgesetzt, die Person weiß es aber noch nicht. */
export function brauchtRueckmeldung(e: Pick<BoardEintrag, 'status' | 'replied_at'>): boolean {
    return (e.status === 'live' || e.status === 'done') && !e.replied_at;
}

export function filtere(eintraege: BoardEintrag[], f: BoardFilter): BoardEintrag[] {
    return eintraege.filter(
        (e) =>
            (!f.nurOffene || (e.status !== 'done' && e.status !== 'live')) &&
            (!f.nurBlockierend || e.blocks_activation) &&
            (!f.nurOhneRueckmeldung || brauchtRueckmeldung(e))
    );
}

/** Vorschlag für die Rückmeldung, vor dem Senden anpassbar. */
export function rueckmeldungsEntwurf(beschreibung: string): string {
    const kurz = beschreibung.replace(/\s+/g, ' ').trim();
    const zitat = kurz.length > 140 ? `${kurz.slice(0, 137).trimEnd()}…` : kurz;
    return `Du hattest „${zitat}“ gemeldet, das ist jetzt live. Schau gern rein und sagt uns, ob es so passt.`;
}

/** Kürzel für Themen: Kleinbuchstaben, Ziffern, Bindestriche (wie die Server-Prüfung). */
export function themaKuerzel(text: string): string {
    return text
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}
