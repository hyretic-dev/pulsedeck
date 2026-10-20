import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiError, ApiService } from '../../../core/api.service';
import {
    BoardEintrag,
    BoardFilter,
    BoardThema,
    bauRegelErfuellt,
    brauchtRueckmeldung,
    filtere,
    rueckmeldungsEntwurf,
    themaKuerzel,
} from './feedback-board.logic';

interface PlattformOrganisation {
    id: string;
    name: string;
    slug: string;
    created_at: string;
    acquisition_source: string | null;
    acquisition_ref: string | null;
    pilot_requested: boolean;
    pilot_wish: string | null;
}

type Reiter = 'meldungen' | 'themen' | 'organisationen';

const STATUS_NAMEN: Record<BoardEintrag['status'], string> = { new: 'Neu', in_progress: 'In Arbeit', done: 'Erledigt', live: 'Live' };
const HERKUNFT_NAMEN: Record<string, string> = {
    workshop: 'Workshop', empfehlung: 'Empfehlung', suche: 'Suche', blog: 'Blog', event_gast: 'Termin/Gast', social: 'Social Media', sonstiges: 'Sonstiges',
};

/**
 * Feedback-Board für Plattformadministratoren: Meldungen aus App, Gesprächen und Mails mit dem eigentlichen Problem, Thema,
 * Entscheidung und persönlicher Rückmeldung; dazu Themen nach Zahl der Organisationen (Bau-Regel) und die Herkunft neuer Organisationen.
 */
@Component({
    selector: 'app-feedback-board',
    standalone: true,
    imports: [FormsModule, DatePipe],
    templateUrl: './feedback-board.component.html',
})
export class FeedbackBoardComponent implements OnInit {
    private readonly api = inject(ApiService);

    readonly reiter = signal<Reiter>('meldungen');
    readonly laedt = signal(true);
    readonly fehler = signal<string | null>(null);
    readonly eintraege = signal<BoardEintrag[]>([]);
    readonly themen = signal<BoardThema[]>([]);
    readonly organisationen = signal<PlattformOrganisation[]>([]);

    readonly filter = signal<BoardFilter>({ nurOffene: false, nurBlockierend: false, nurOhneRueckmeldung: false });
    readonly sichtbar = computed(() => filtere(this.eintraege(), this.filter()));
    readonly ohneRueckmeldung = computed(() => this.eintraege().filter(brauchtRueckmeldung).length);
    readonly pilotAnfragen = computed(() => this.organisationen().filter((o) => o.pilot_requested));

    /** Entwurf der Rückmeldung je Eintrag; wird beim ersten Öffnen vorbelegt. */
    readonly entwuerfe = signal<Record<string, string>>({});
    readonly offeneRueckmeldung = signal<string | null>(null);

    readonly neu = signal(false);
    formular = { type: 'suggestion' as 'bug' | 'suggestion', source: 'gespraech' as 'gespraech' | 'mail', organization_id: '', description: '', problem: '', topic: '', blocks_activation: false };

    readonly statusNamen = STATUS_NAMEN;
    readonly statusListe = Object.keys(STATUS_NAMEN) as BoardEintrag['status'][];
    readonly bauRegelErfuellt = bauRegelErfuellt;
    readonly brauchtRueckmeldung = brauchtRueckmeldung;

    themaFuer(e: BoardEintrag): BoardThema | undefined {
        return e.topic ? this.themen().find((t) => t.topic === e.topic) : undefined;
    }

    herkunftName(wert: string | null): string {
        return wert ? (HERKUNFT_NAMEN[wert] ?? wert) : 'keine Angabe';
    }

    ngOnInit(): void {
        void this.laden();
    }

    async laden(): Promise<void> {
        this.fehler.set(null);
        try {
            const [eintraege, themen, organisationen] = await Promise.all([
                this.api.get<BoardEintrag[]>('/platform/feedback', { limit: 200 }),
                this.api.get<BoardThema[]>('/platform/feedback/topics'),
                this.api.get<PlattformOrganisation[]>('/platform/organizations'),
            ]);
            this.eintraege.set(eintraege);
            this.themen.set(themen);
            this.organisationen.set(organisationen);
        } catch (e) {
            this.fehler.set(this.meldung(e));
        }
        this.laedt.set(false);
    }

    setzeFilter(feld: keyof BoardFilter, wert: boolean): void {
        this.filter.update((f) => ({ ...f, [feld]: wert }));
    }

    /** Ändert ein Feld und übernimmt die Antwort des Servers in die Liste. */
    async aendere(e: BoardEintrag, aenderung: Record<string, unknown>): Promise<void> {
        this.fehler.set(null);
        try {
            const neu = await this.api.patch<BoardEintrag>(`/platform/feedback/${e.id}`, aenderung);
            this.eintraege.update((liste) => liste.map((x) => (x.id === e.id ? { ...x, ...neu } : x)));
            if ('topic' in aenderung) this.themen.set(await this.api.get<BoardThema[]>('/platform/feedback/topics'));
        } catch (err) {
            this.fehler.set(this.meldung(err));
        }
    }

    aendereThema(e: BoardEintrag, text: string): void {
        const kuerzel = themaKuerzel(text);
        if ((kuerzel || null) !== e.topic) void this.aendere(e, { topic: kuerzel || null });
    }

    aendereProblem(e: BoardEintrag, text: string): void {
        if ((text.trim() || null) !== e.problem) void this.aendere(e, { problem: text.trim() || null });
    }

    oeffneRueckmeldung(e: BoardEintrag): void {
        this.entwuerfe.update((d) => ({ ...d, [e.id]: d[e.id] ?? rueckmeldungsEntwurf(e.description) }));
        this.offeneRueckmeldung.set(e.id);
    }

    setzeEntwurf(id: string, text: string): void {
        this.entwuerfe.update((d) => ({ ...d, [id]: text }));
    }

    /** `senden = false`: nur als beantwortet markieren (z. B. am Telefon zurückgemeldet). */
    async antworte(e: BoardEintrag, senden: boolean): Promise<void> {
        const text = (this.entwuerfe()[e.id] ?? '').trim();
        if (!text) return;
        this.fehler.set(null);
        try {
            const neu = await this.api.post<BoardEintrag>(`/platform/feedback/${e.id}/reply`, { text, send: senden });
            this.eintraege.update((liste) => liste.map((x) => (x.id === e.id ? { ...x, ...neu } : x)));
            this.offeneRueckmeldung.set(null);
        } catch (err) {
            this.fehler.set(this.meldung(err));
        }
    }

    async anlegen(): Promise<void> {
        const f = this.formular;
        if (!f.description.trim()) return;
        this.fehler.set(null);
        try {
            await this.api.post('/platform/feedback', {
                type: f.type,
                source: f.source,
                description: f.description.trim(),
                ...(f.organization_id ? { organization_id: f.organization_id } : {}),
                ...(f.problem.trim() ? { problem: f.problem.trim() } : {}),
                ...(themaKuerzel(f.topic) ? { topic: themaKuerzel(f.topic) } : {}),
                ...(f.blocks_activation ? { blocks_activation: true } : {}),
            });
            this.formular = { ...this.formular, organization_id: '', description: '', problem: '', topic: '', blocks_activation: false };
            this.neu.set(false);
            await this.laden();
        } catch (err) {
            this.fehler.set(this.meldung(err));
        }
    }

    private meldung(e: unknown): string {
        return e instanceof ApiError || e instanceof Error ? e.message : 'Unbekannter Fehler';
    }
}
