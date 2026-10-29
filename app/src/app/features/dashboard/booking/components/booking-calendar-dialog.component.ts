import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TabsModule } from 'primeng/tabs';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { uhrzeit } from '../../../../shared/booking/booking-labels';
import type { BookingPlan, OeffentlicheAnzeige, PlanArt, PlanRolle } from '../../../../shared/booking/booking.models';
import { BUNDESLAENDER, type Bundesland } from '../../../../shared/booking/feiertage';
import { PlanRolesService } from '../application/plan-roles.service';
import type { PlanEingabe } from '../domain/booking.repository';

type Reiter = 'einstellungen' | 'personen';

/** Plan anlegen (Administratoren) und Einstellungen sowie Personen eines Plans bearbeiten (Leitung). */
@Component({
    selector: 'app-booking-calendar-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule, ReactiveFormsModule, DialogModule, ButtonModule, InputTextModule, SelectModule, SelectButtonModule,
        TabsModule, ToggleSwitchModule,
    ],
    providers: [PlanRolesService],
    templateUrl: './booking-calendar-dialog.component.html',
})
export class BookingCalendarDialogComponent {
    protected readonly rollenDienst = inject(PlanRolesService);

    readonly sichtbar = model(false);
    /** Gesetzt = Einstellungen dieses Plans, sonst neuer Plan. */
    readonly plan = input<BookingPlan | null>(null);
    readonly istAdmin = input(false);
    readonly speichernBusy = input(false);

    readonly gespeichert = output<PlanEingabe>();
    readonly loeschen = output<void>();

    protected readonly reiter = signal<Reiter>('einstellungen');
    protected readonly personFehler = signal<string | null>(null);
    protected readonly neuePerson = signal<string | null>(null);
    protected readonly neueRolle = signal<PlanRolle>('requester');

    protected readonly artOptionen: { label: string; value: PlanArt }[] = [
        { label: 'Ort', value: 'place' },
        { label: 'Gegenstand', value: 'item' },
    ];
    protected readonly bundeslaender = [{ kuerzel: null, name: 'Nur bundesweite Feiertage' }, ...BUNDESLAENDER];
    protected readonly anzeigeOptionen: { label: string; value: OeffentlicheAnzeige }[] = [
        { label: 'Nicht öffentlich', value: 'none' },
        { label: 'Jahresansicht', value: 'year' },
        { label: 'Monatsansicht', value: 'month' },
    ];
    protected readonly rollenOptionen: { label: string; value: PlanRolle }[] = [
        { label: 'Leitung', value: 'lead' },
        { label: 'Verwaltung', value: 'manager' },
        { label: 'Buchende', value: 'requester' },
    ];
    protected readonly startStunden = Array.from({ length: 24 }, (_, h) => ({ label: `${uhrzeit(h)} Uhr`, value: h }));
    protected readonly endStunden = Array.from({ length: 24 }, (_, i) => ({ label: `${uhrzeit(i + 1)} Uhr`, value: i + 1 }));

    protected readonly form = new FormGroup({
        name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
        kind: new FormControl<PlanArt>('place', { nonNullable: true }),
        address: new FormControl('', { nonNullable: true, validators: Validators.maxLength(200) }),
        state: new FormControl<Bundesland | null>(null),
        window_start: new FormControl(8, { nonNullable: true }),
        window_end: new FormControl(22, { nonNullable: true }),
        all_members_can_request: new FormControl(false, { nonNullable: true }),
        public_view: new FormControl<OeffentlicheAnzeige>('none', { nonNullable: true }),
    });
    private readonly werte = toSignal(this.form.valueChanges, { initialValue: this.form.value });

    protected readonly bearbeitet = computed(() => !!this.plan());
    protected readonly ueberschrift = computed(() => (this.plan() ? `Einstellungen: ${this.plan()?.name}` : 'Belegungsplan anlegen'));
    protected readonly istOrt = computed(() => this.werte().kind !== 'item');
    protected readonly fensterFehler = computed(() => {
        const w = this.werte();
        return (w.window_end ?? 22) <= (w.window_start ?? 8) ? 'Das Zeitfenster muss mit einer späteren Stunde enden, als es beginnt.' : null;
    });
    protected readonly kannSpeichern = computed(() => {
        this.werte();
        return this.form.valid && !this.fensterFehler();
    });

    /** Personen, die noch keine Rolle haben. */
    protected readonly verfuegbarePersonen = computed(() => {
        const vergeben = new Set(this.rollenDienst.rollen().map((r) => r.member_id));
        return this.rollenDienst.personen().filter((p) => !vergeben.has(p.id));
    });

    constructor() {
        // Beim Öffnen vorbelegen; nur `sichtbar` löst aus, sonst würde jede Änderung des Plans die Eingaben verwerfen
        effect(() => {
            if (!this.sichtbar()) return;
            untracked(() => this.vorbelegen());
        });
    }

    private vorbelegen(): void {
        const plan = this.plan();
        this.reiter.set('einstellungen');
        this.personFehler.set(null);
        this.neuePerson.set(null);
        this.form.reset({
            name: plan?.name ?? '',
            kind: plan?.kind ?? 'place',
            address: plan?.address ?? '',
            state: plan?.state ?? null,
            window_start: plan?.window_start ?? 8,
            window_end: plan?.window_end ?? 22,
            all_members_can_request: plan?.all_members_can_request ?? false,
            public_view: plan?.public_view ?? 'none',
        });
        if (plan) void this.rollenDienst.laden(plan.id).catch((fehler: Error) => this.personFehler.set(fehler.message));
    }

    protected speichern(): void {
        if (!this.kannSpeichern()) {
            this.form.markAllAsTouched();
            return;
        }
        const w = this.form.getRawValue();
        this.gespeichert.emit({
            name: w.name.trim(),
            kind: w.kind,
            address: w.kind === 'place' ? w.address.trim() || null : null,
            state: w.state,
            window_start: w.window_start,
            window_end: w.window_end,
            all_members_can_request: w.all_members_can_request,
            public_view: w.public_view,
        });
    }

    protected reiterWaehlen(wert: string | number | undefined): void {
        if (wert === 'einstellungen' || wert === 'personen') this.reiter.set(wert);
    }

    protected async rolleAendern(memberId: string, rolle: PlanRolle): Promise<void> {
        await this.versuche(() => this.rollenDienst.setzen(this.plan()?.id ?? '', memberId, rolle));
    }

    protected async rolleEntfernen(memberId: string): Promise<void> {
        await this.versuche(() => this.rollenDienst.entfernen(this.plan()?.id ?? '', memberId));
    }

    protected async personHinzufuegen(): Promise<void> {
        const id = this.neuePerson();
        if (!id) return;
        await this.versuche(() => this.rollenDienst.setzen(this.plan()?.id ?? '', id, this.neueRolle()));
        this.neuePerson.set(null);
    }

    private async versuche(aktion: () => Promise<void>): Promise<void> {
        this.personFehler.set(null);
        try {
            await aktion();
        } catch (fehler) {
            this.personFehler.set((fehler as Error).message);
        }
    }
}
