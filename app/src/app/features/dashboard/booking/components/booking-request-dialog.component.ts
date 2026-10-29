import {
    ChangeDetectionStrategy, Component, computed, effect, input, model, output, signal, untracked, viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { MONATSNAMEN, uhrzeit } from '../../../../shared/booking/booking-labels';
import type { BookingEntry, BookingPlan, Verfuegbarkeit } from '../../../../shared/booking/booking.models';
import { berlinUhr, berlinZeitpunkt, pruefeVerfuegbarkeit } from '../../../../shared/booking/zeitraum';
import type { BuchungEingabe, SerieEingabe, SerienVorschau } from '../domain/booking.repository';
import { BookingSeriesFormComponent } from './booking-series-form.component';

type Modus = 'einzeln' | 'serie';

/** Vorbelegung des Zeitraums, z. B. aus einem Klick auf freie Stunden (Berliner Datum, Stunden). */
export interface Vorgabe {
    jahr: number;
    monat: number;
    tag: number;
    von: number;
    bis: number;
}

@Component({
    selector: 'app-booking-request-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule, ReactiveFormsModule, DialogModule, ButtonModule, DatePickerModule, SelectModule, SelectButtonModule,
        InputTextModule, TextareaModule, ToggleSwitchModule, BookingSeriesFormComponent,
    ],
    templateUrl: './booking-request-dialog.component.html',
})
export class BookingRequestDialogComponent {
    readonly sichtbar = model(false);
    readonly plan = input.required<BookingPlan>();
    readonly eintraege = input.required<ReadonlyArray<BookingEntry>>();
    readonly vorgabe = input<Vorgabe | null>(null);
    /** Gesetzt = diese Buchung bearbeiten (Verwaltung, Leitung). */
    readonly eintrag = input<BookingEntry | null>(null);
    readonly vorschauLader = input.required<(serie: SerieEingabe) => Promise<SerienVorschau>>();
    readonly speichernBusy = input(false);
    protected readonly serieForm = viewChild(BookingSeriesFormComponent);

    readonly gespeichert = output<BuchungEingabe>();
    readonly geaendert = output<BuchungEingabe>();
    readonly serieGespeichert = output<SerieEingabe>();

    protected readonly modus = signal<Modus>('einzeln');
    protected readonly modusOptionen = [
        { label: 'Einzeln', value: 'einzeln' },
        { label: 'Serie', value: 'serie' },
    ];

    protected readonly form = new FormGroup({
        beginnDatum: new FormControl<Date | null>(null, Validators.required),
        beginnStunde: new FormControl<number>(8, { nonNullable: true }),
        endeDatum: new FormControl<Date | null>(null, Validators.required),
        endeStunde: new FormControl<number>(9, { nonNullable: true }),
        title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
        note: new FormControl('', { nonNullable: true, validators: Validators.maxLength(1000) }),
        is_public: new FormControl(false, { nonNullable: true }),
    });
    private readonly werte = toSignal(this.form.valueChanges, { initialValue: this.form.value });

    protected readonly bearbeitet = computed(() => !!this.eintrag());
    protected readonly leitung = computed(() => this.plan().my_role === 'lead' && !this.eintrag());
    protected readonly entscheidet = computed(() => this.plan().my_role === 'lead' || this.plan().my_role === 'manager');
    protected readonly ueberschrift = computed(() =>
        this.bearbeitet() ? 'Belegung bearbeiten' : this.entscheidet() ? 'Belegung eintragen' : 'Anfrage stellen',
    );
    protected readonly knopf = computed(() => (this.bearbeitet() ? 'Speichern' : this.entscheidet() ? 'Eintragen' : 'Anfragen'));
    protected readonly speichernMoeglich = computed(() =>
        this.modus() === 'serie' ? !!this.serieForm()?.kannSpeichern() : this.kannSpeichern(),
    );

    protected readonly startStunden = computed(() => this.stundenListe(this.plan().window_start, this.plan().window_end - 1));
    protected readonly endStunden = computed(() => this.stundenListe(this.plan().window_start + 1, this.plan().window_end));

    private stundenListe(von: number, bis: number): { label: string; value: number }[] {
        return Array.from({ length: bis - von + 1 }, (_, i) => ({ label: `${uhrzeit(von + i)} Uhr`, value: von + i }));
    }

    /** Früheste wählbare Tag für Buchende: heute ab Mitternacht (mit Uhrzeit wäre der heutige Tag „vergangen“ und würde geleert). */
    protected readonly heute = (() => {
        const h = berlinUhr(new Date());
        return new Date(h.jahr, h.monat - 1, h.tag);
    })();

    /** Zeitraum aus dem Formular; null, solange Datum fehlt. */
    private readonly zeitraum = computed(() => {
        const w = this.werte();
        if (!w.beginnDatum || !w.endeDatum || w.beginnStunde == null || w.endeStunde == null) return null;
        const b = w.beginnDatum;
        const e = w.endeDatum;
        return {
            beginn: berlinZeitpunkt(b.getFullYear(), b.getMonth() + 1, b.getDate(), w.beginnStunde),
            ende: berlinZeitpunkt(e.getFullYear(), e.getMonth() + 1, e.getDate(), w.endeStunde),
        };
    });

    /** Meldung zum gewählten Zeitraum: Fehler sperren das Speichern, Überschneidungen und Belegung werden benannt. */
    protected readonly pruefung = computed<
        | { art: 'fehler'; text: string }
        | { art: 'ergebnis'; ergebnis: Verfuegbarkeit }
        | null
    >(() => {
        const z = this.zeitraum();
        if (!z) return null;
        const plan = this.plan();
        if (z.ende <= z.beginn) return { art: 'fehler', text: 'Das Ende muss nach dem Beginn liegen.' };
        if ((z.ende.getTime() - z.beginn.getTime()) / 86400000 > 14) return { art: 'fehler', text: 'Eine Belegung dauert höchstens 14 Tage.' };
        const b = berlinUhr(z.beginn);
        const e = berlinUhr(z.ende);
        // Mitternacht zählt als Ende des Vortags (Zeitfenster bis 24 Uhr)
        const endeStunde = e.stunde === 0 && e.minute === 0 ? 24 : e.stunde;
        if (b.stunde < plan.window_start || b.stunde >= plan.window_end || endeStunde <= plan.window_start || endeStunde > plan.window_end) {
            return { art: 'fehler', text: `Beginn und Ende liegen im Zeitfenster ${uhrzeit(plan.window_start)}–${uhrzeit(plan.window_end)} Uhr.` };
        }
        if (!this.entscheidet() && z.beginn < new Date()) return { art: 'fehler', text: 'Anfragen sind nur für die Zukunft möglich.' };
        return { art: 'ergebnis', ergebnis: pruefeVerfuegbarkeit(this.eintraege(), z.beginn, z.ende, this.eintrag()?.id ?? null) };
    });

    protected readonly kannSpeichern = computed(() => {
        const p = this.pruefung();
        return this.form.valid && !!p && p.art === 'ergebnis' && p.ergebnis.art !== 'belegt';
    });

    constructor() {
        // Wird der Beginn auf einen späteren Tag gelegt, zieht das Ende mit (sonst bliebe „Ende vor Beginn“ stehen)
        this.form.controls.beginnDatum.valueChanges.pipe(takeUntilDestroyed()).subscribe((beginn) => {
            const ende = this.form.controls.endeDatum.value;
            if (beginn && (!ende || ende < beginn)) this.form.controls.endeDatum.setValue(beginn);
        });
        // Beim Öffnen zurücksetzen; nur `sichtbar` löst aus, sonst würde jede Änderung von Plan oder Einträgen die Eingaben verwerfen
        effect(() => {
            if (!this.sichtbar()) return;
            untracked(() => this.zuruecksetzen());
        });
    }

    private zuruecksetzen(): void {
        const e = this.eintrag();
        if (e) {
            const b = berlinUhr(e.start_at);
            const en = berlinUhr(e.end_at);
            // Mitternacht ist „24 Uhr“ des Vortags
            const mitternacht = en.stunde === 0 && en.minute === 0;
            this.modus.set('einzeln');
            this.form.reset({
                beginnDatum: new Date(b.jahr, b.monat - 1, b.tag),
                beginnStunde: b.stunde,
                endeDatum: new Date(en.jahr, en.monat - 1, mitternacht ? en.tag - 1 : en.tag),
                endeStunde: mitternacht ? 24 : en.stunde,
                title: e.title ?? '',
                note: e.note ?? '',
                is_public: e.is_public,
            });
            return;
        }
        const v = this.vorgabe();
        const plan = this.plan();
        const heute = berlinUhr(new Date());
        const tag = v ? new Date(v.jahr, v.monat - 1, v.tag) : new Date(heute.jahr, heute.monat - 1, heute.tag);
        this.modus.set('einzeln');
        this.form.reset({
            beginnDatum: tag,
            beginnStunde: v?.von ?? plan.window_start,
            endeDatum: tag,
            endeStunde: v?.bis ?? plan.window_start + 1,
            title: '',
            note: '',
            is_public: false,
        });
    }

    protected beschreibe(e: BookingEntry): string {
        const b = berlinUhr(e.start_at);
        const en = berlinUhr(e.end_at);
        const wer = e.requester_name ? `Anfrage von ${e.requester_name}` : 'Belegung';
        return `${wer} („${e.title ?? 'Belegt'}“), ${b.tag}. ${MONATSNAMEN[b.monat - 1]} ${uhrzeit(b.stunde)}–${uhrzeit(en.stunde)} Uhr`;
    }

    protected speichernAuswahl(): void {
        if (this.modus() === 'serie') this.serieForm()?.speichern();
        else this.speichern();
    }

    protected speichern(): void {
        const z = this.zeitraum();
        if (!z || !this.kannSpeichern()) {
            this.form.markAllAsTouched();
            return;
        }
        const w = this.form.getRawValue();
        const eingabe: BuchungEingabe = {
            title: w.title.trim(),
            note: w.note.trim() || null,
            start_at: z.beginn.toISOString(),
            end_at: z.ende.toISOString(),
            is_public: w.is_public,
        };
        if (this.bearbeitet()) this.geaendert.emit(eingabe);
        else this.gespeichert.emit(eingabe);
    }
}
