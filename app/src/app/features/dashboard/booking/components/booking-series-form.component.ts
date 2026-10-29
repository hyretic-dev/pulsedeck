import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { MONATSNAMEN, WOCHENTAG_KUERZEL, uhrzeit } from '../../../../shared/booking/booking-labels';
import type { BookingPlan } from '../../../../shared/booking/booking.models';
import { datumsSchluessel } from '../../../../shared/booking/feiertage';
import { berlinUhr } from '../../../../shared/booking/zeitraum';
import type { SerieEingabe, SerienVorschau } from '../domain/booking.repository';

const VORSCHAU_VERZOEGERUNG_MS = 300;

/** Serie anlegen (nur Leitung): Wochentage, Rhythmus, Uhrzeit, Zeitraum, mit Vorschau vor dem Speichern. */
@Component({
    selector: 'app-booking-series-form',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ReactiveFormsModule, ButtonModule, CheckboxModule, DatePickerModule, InputTextModule, SelectModule,
        SelectButtonModule, TextareaModule, ToggleSwitchModule,
    ],
    templateUrl: './booking-series-form.component.html',
})
export class BookingSeriesFormComponent {
    readonly plan = input.required<BookingPlan>();
    readonly vorschauLader = input.required<(serie: SerieEingabe) => Promise<SerienVorschau>>();
    readonly gespeichert = output<SerieEingabe>();

    protected readonly wochentage = WOCHENTAG_KUERZEL.map((label, value) => ({ label, value }));
    protected readonly rhythmen = [
        { label: 'jede Woche', value: 1 },
        { label: 'jede 2. Woche', value: 2 },
        { label: 'jede 3. Woche', value: 3 },
        { label: 'jede 4. Woche', value: 4 },
    ];

    protected readonly form = new FormGroup({
        title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
        note: new FormControl('', { nonNullable: true, validators: Validators.maxLength(1000) }),
        is_public: new FormControl(false, { nonNullable: true }),
        weekdays: new FormControl<number[]>([], { nonNullable: true, validators: Validators.required }),
        every_n_weeks: new FormControl<1 | 2 | 3 | 4>(1, { nonNullable: true }),
        hour_from: new FormControl(18, { nonNullable: true }),
        hour_to: new FormControl(20, { nonNullable: true }),
        valid_from: new FormControl<Date | null>(null, Validators.required),
        valid_to: new FormControl<Date | null>(null, Validators.required),
        skip_holidays: new FormControl(true, { nonNullable: true }),
    });
    private readonly werte = toSignal(this.form.valueChanges, { initialValue: this.form.value });

    protected readonly vonStunden = computed(() => this.stundenListe(this.plan().window_start, this.plan().window_end - 1));
    protected readonly bisStunden = computed(() => this.stundenListe(this.plan().window_start + 1, this.plan().window_end));
    protected readonly vorschau = signal<SerienVorschau | null>(null);
    protected readonly vorschauFehler = signal<string | null>(null);
    protected readonly vorschauLaedt = signal(false);

    private stundenListe(von: number, bis: number): { label: string; value: number }[] {
        return Array.from({ length: bis - von + 1 }, (_, i) => ({ label: `${uhrzeit(von + i)} Uhr`, value: von + i }));
    }

    /** Eingabe, sobald sie vollständig und gültig ist (höchstens 12 Monate, Ende nach Beginn). */
    protected readonly serie = computed<SerieEingabe | null>(() => {
        const w = this.werte();
        if (!w.valid_from || !w.valid_to || !w.weekdays?.length || !w.title?.trim()) return null;
        const von = this.alsDatum(w.valid_from);
        const bis = this.alsDatum(w.valid_to);
        if (bis < von || !this.hoechstens12Monate(w.valid_from, w.valid_to)) return null;
        if ((w.hour_to ?? 0) <= (w.hour_from ?? 0)) return null;
        return {
            title: w.title.trim(),
            note: w.note?.trim() || null,
            is_public: !!w.is_public,
            weekdays: [...w.weekdays].sort((a, b) => a - b),
            every_n_weeks: w.every_n_weeks ?? 1,
            hour_from: w.hour_from ?? 18,
            hour_to: w.hour_to ?? 20,
            valid_from: von,
            valid_to: bis,
            skip_holidays: !!w.skip_holidays,
        };
    });

    /** Speichern ist möglich, sobald die Eingabe gültig ist und die Vorschau mindestens einen Termin ergibt. */
    readonly kannSpeichern = computed(() => !!this.serie() && !!this.vorschau()?.dates.length);

    protected readonly fehler = computed(() => {
        const server = this.vorschauFehler();
        if (server) return server;
        const w = this.werte();
        if ((w.hour_to ?? 0) <= (w.hour_from ?? 0)) return 'Das Ende muss nach dem Beginn liegen.';
        if (w.valid_from && w.valid_to) {
            if (this.alsDatum(w.valid_to) < this.alsDatum(w.valid_from)) return '„Gültig bis“ liegt vor „gültig von“.';
            if (!this.hoechstens12Monate(w.valid_from, w.valid_to)) return 'Eine Serie gilt höchstens 12 Monate.';
        }
        return null;
    });

    protected readonly datumsBereich = computed(() => {
        const w = this.werte();
        return w.valid_from ? new Date(w.valid_from.getFullYear() + 1, w.valid_from.getMonth(), w.valid_from.getDate()) : null;
    });

    constructor() {
        const heute = berlinUhr(new Date());
        const start = new Date(heute.jahr, heute.monat - 1, heute.tag);
        this.form.patchValue({ valid_from: start, valid_to: new Date(start.getFullYear(), start.getMonth() + 3, start.getDate()) });
        effect(() => {
            const plan = this.plan();
            this.form.patchValue({ hour_from: Math.max(plan.window_start, 18), hour_to: Math.min(plan.window_end, 20) }, { emitEvent: false });
        });
        // Vorschau vom Server, entprellt; Antworten veralteter Eingaben werden verworfen
        effect((aufraeumen) => {
            const s = this.serie();
            this.vorschau.set(null);
            this.vorschauFehler.set(null);
            if (!s) return;
            let veraltet = false;
            const timer = setTimeout(() => {
                this.vorschauLaedt.set(true);
                this.vorschauLader()(s)
                    .then((v) => !veraltet && this.vorschau.set(v))
                    .catch((fehler: Error) => !veraltet && this.vorschauFehler.set(fehler.message))
                    .finally(() => !veraltet && this.vorschauLaedt.set(false));
            }, VORSCHAU_VERZOEGERUNG_MS);
            aufraeumen(() => {
                veraltet = true;
                clearTimeout(timer);
            });
        });
    }

    private alsDatum(d: Date): string {
        return datumsSchluessel(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }

    private hoechstens12Monate(von: Date, bis: Date): boolean {
        return bis <= new Date(von.getFullYear() + 1, von.getMonth(), von.getDate());
    }

    protected datumLang(schluessel: string): string {
        const [j, m, t] = schluessel.split('-').map(Number);
        return `${t}. ${MONATSNAMEN[m - 1].slice(0, 3)}. ${j}`;
    }

    speichern(): void {
        const s = this.serie();
        if (s && this.kannSpeichern()) this.gespeichert.emit(s);
        else this.form.markAllAsTouched();
    }
}
