import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { DrawerModule } from 'primeng/drawer';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TabsModule } from 'primeng/tabs';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';

import { BookingLegendComponent } from '../../../../shared/booking/booking-legend.component';
import { MONATSNAMEN, WOCHENTAG_LANG, uhrzeit } from '../../../../shared/booking/booking-labels';
import { BookingMonthGridComponent, StundenAuswahl } from '../../../../shared/booking/booking-month-grid.component';
import { BookingStatusChipComponent } from '../../../../shared/booking/booking-status-chip.component';
import { BookingYearGridComponent, TagAuswahl } from '../../../../shared/booking/booking-year-grid.component';
import { BookingEntry, darfAnfragen, darfEntscheiden } from '../../../../shared/booking/booking.models';
import { BUNDESLAENDER } from '../../../../shared/booking/feiertage';
import { berlinUhr, ueberschneiden, wochentag } from '../../../../shared/booking/zeitraum';
import { Ansicht, Bereich, BookingStore } from '../application/booking.store';
import type { BuchungEingabe, SerieEingabe } from '../domain/booking.repository';
import { BookingDayHoursComponent } from './booking-day-hours.component';
import { BookingEntryDialogComponent } from './booking-entry-dialog.component';
import { BookingRequestDialogComponent, Vorgabe } from './booking-request-dialog.component';

@Component({
    selector: 'app-booking-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule, ButtonModule, ConfirmDialogModule, DialogModule, DrawerModule, ProgressSpinnerModule,
        SelectModule, SelectButtonModule, TabsModule, TextareaModule, ToastModule,
        BookingLegendComponent, BookingMonthGridComponent, BookingStatusChipComponent, BookingYearGridComponent,
        BookingDayHoursComponent, BookingEntryDialogComponent, BookingRequestDialogComponent,
    ],
    providers: [ConfirmationService, MessageService],
    templateUrl: './booking-page.component.html',
    styleUrl: './booking-page.component.css',
})
export class BookingPageComponent implements OnInit {
    protected readonly store = inject(BookingStore);
    private readonly confirm = inject(ConfirmationService);
    private readonly toast = inject(MessageService);
    private readonly destroyRef = inject(DestroyRef);

    /** Unter `md` (768 px) gilt die schmale Darstellung; Android-App eingeschlossen. */
    protected readonly schmal = signal(false);

    protected readonly anfrageSichtbar = signal(false);
    protected readonly vorgabe = signal<Vorgabe | null>(null);
    protected readonly speichert = signal(false);
    protected readonly detail = signal<BookingEntry | null>(null);
    protected readonly detailSichtbar = signal(false);
    protected readonly tagesPanel = signal<{ jahr: number; monat: number; tag: number } | null>(null);
    protected readonly tagesPanelSichtbar = signal(false);
    protected readonly ablehnenZiel = signal<BookingEntry | null>(null);
    protected readonly ablehnenSichtbar = signal(false);
    protected ablehnenGrund = '';

    protected readonly ansichtOptionen: { label: string; value: Ansicht }[] = [
        { label: 'Jahr', value: 'jahr' },
        { label: 'Monat', value: 'monat' },
    ];

    protected readonly entscheidet = computed(() => {
        const p = this.store.plan();
        return !!p && darfEntscheiden(p);
    });
    protected readonly darfAnfragen = computed(() => {
        const p = this.store.plan();
        return !!p && darfAnfragen(p);
    });
    protected readonly aktionLabel = computed(() => (this.entscheidet() ? 'Eintragen' : 'Anfragen'));
    /** Tabs passen in die Spalte neben der rechten Seitenleiste für höchstens drei Pläne, darüber das Auswahlfeld. */
    protected readonly planAlsAuswahl = computed(() => this.store.plaene().length > 3 || this.schmal());
    protected readonly bundesland = computed(
        () => BUNDESLAENDER.find((b) => b.kuerzel === this.store.plan()?.state)?.name ?? null,
    );

    /** Bereiche über dem Raster, je nach Rolle im Plan. */
    protected readonly bereichOptionen = computed(() => {
        const alle: { label: string; value: Bereich }[] = [{ label: 'Belegung', value: 'plan' }];
        if (this.entscheidet()) alle.push({ label: `Anfragen${this.store.offeneAnfragen().length ? ` (${this.store.offeneAnfragen().length})` : ''}`, value: 'eingang' });
        if (this.darfAnfragen()) alle.push({ label: this.schmal() ? 'Meine' : 'Meine Anfragen', value: 'meine' });
        return alle;
    });

    protected readonly titelZeile = computed(() =>
        this.store.ansicht() === 'jahr' ? String(this.store.jahr()) : `${MONATSNAMEN[this.store.monat() - 1]} ${this.store.jahr()}`,
    );

    /** Offene Anfragen mit den Anfragen, mit denen sie sich überschneiden. */
    protected readonly eingang = computed(() => {
        const offen = [...this.store.offeneAnfragen()].sort((a, b) => a.start_at.localeCompare(b.start_at));
        return offen.map((e) => ({
            eintrag: e,
            konflikte: offen.filter((x) => x.id !== e.id && ueberschneiden(x, e)),
        }));
    });

    protected readonly planTabs = computed(() => this.store.plaene());

    async ngOnInit(): Promise<void> {
        const mq = window.matchMedia('(max-width: 767px)');
        this.schmal.set(mq.matches);
        const handler = (e: MediaQueryListEvent) => this.schmal.set(e.matches);
        mq.addEventListener('change', handler);
        this.destroyRef.onDestroy(() => mq.removeEventListener('change', handler));
        await this.store.start();
    }

    protected symbol(art: 'place' | 'item'): string {
        return art === 'place' ? 'pi-building' : 'pi-box';
    }

    protected planGewaehlt(id: string | number | undefined): void {
        if (typeof id === 'string') void this.store.planWaehlen(id);
    }

    /** Schmal ist die Jahresansicht nur eine Übersicht: jedes Tippen öffnet den Monat, der Tag folgt dort im Seitenpanel. */
    protected tagImJahr(a: TagAuswahl): void {
        this.store.oeffneMonat(a.monat, a.jahr);
    }

    protected oeffneTagesPanel(jahr: number, monat: number, tag: number): void {
        this.tagesPanel.set({ jahr, monat, tag });
        this.tagesPanelSichtbar.set(true);
    }

    protected tagesPanelTitel(): string {
        const t = this.tagesPanel();
        return t ? `${WOCHENTAG_LANG[wochentag(t.jahr, t.monat, t.tag)]}, ${t.tag}. ${MONATSNAMEN[t.monat - 1]}` : '';
    }

    protected neueAnfrage(auswahl: StundenAuswahl | null = null): void {
        this.vorgabe.set(auswahl);
        this.anfrageSichtbar.set(true);
    }

    protected stundeAusPanel(stunde: number): void {
        const t = this.tagesPanel();
        if (!t) return;
        this.tagesPanelSichtbar.set(false);
        this.neueAnfrage({ ...t, von: stunde, bis: stunde + 1 });
    }

    protected zeigeDetail(e: BookingEntry): void {
        this.detail.set(e);
        this.detailSichtbar.set(true);
    }

    protected async speichern(eingabe: BuchungEingabe): Promise<void> {
        this.speichert.set(true);
        try {
            if (this.entscheidet()) await this.store.eintragen(eingabe);
            else await this.store.anfragen(eingabe);
            this.anfrageSichtbar.set(false);
            this.meldung('success', this.entscheidet() ? 'Eingetragen' : 'Angefragt', this.entscheidet() ? 'Die Belegung gilt sofort.' : 'Die Verwaltung entscheidet und du bekommst eine Mail.');
        } finally {
            this.speichert.set(false);
        }
    }

    protected async serieSpeichern(serie: SerieEingabe): Promise<void> {
        this.speichert.set(true);
        try {
            const anzahl = await this.store.serieAnlegen(serie);
            this.anfrageSichtbar.set(false);
            this.meldung('success', 'Serie angelegt', `${anzahl} Termine sind eingetragen.`);
        } finally {
            this.speichert.set(false);
        }
    }

    protected annehmen(e: BookingEntry): void {
        const betroffen = this.store.offeneAnfragen().filter((x) => x.id !== e.id && ueberschneiden(x, e));
        this.detailSichtbar.set(false);
        this.confirm.confirm({
            header: 'Anfrage annehmen',
            icon: 'pi pi-check-circle',
            acceptLabel: 'Annehmen',
            rejectLabel: 'Abbrechen',
            rejectButtonProps: { severity: 'secondary', text: true },
            message: betroffen.length
                ? `„${e.title}“ wird bestätigt. Dabei ${betroffen.length === 1 ? 'wird diese überschneidende Anfrage' : 'werden diese überschneidenden Anfragen'} abgelehnt: ${betroffen.map((x) => `„${x.title}“ (${x.requester_name})`).join(', ')}.`
                : `„${e.title}“ wird bestätigt und die anfragende Person bekommt eine Mail.`,
            accept: async () => {
                await this.store.annehmen(e.id);
                this.meldung('success', 'Angenommen', betroffen.length ? `${betroffen.length} überschneidende Anfrage(n) abgelehnt.` : 'Die Belegung ist bestätigt.');
            },
        });
    }

    protected ablehnenFragen(e: BookingEntry): void {
        this.detailSichtbar.set(false);
        this.ablehnenGrund = '';
        this.ablehnenZiel.set(e);
        this.ablehnenSichtbar.set(true);
    }

    protected async ablehnen(): Promise<void> {
        const e = this.ablehnenZiel();
        if (!e) return;
        await this.store.ablehnen(e.id, this.ablehnenGrund.trim() || null);
        this.ablehnenSichtbar.set(false);
        this.meldung('info', 'Abgelehnt', 'Die anfragende Person bekommt eine Mail.');
    }

    protected zurueckziehen(e: BookingEntry): void {
        this.detailSichtbar.set(false);
        void this.store.zurueckziehen(e.id).then(() => this.meldung('info', 'Zurückgezogen', 'Der Zeitraum ist wieder frei.'));
    }

    protected loeschen(e: BookingEntry): void {
        this.detailSichtbar.set(false);
        this.confirm.confirm({
            header: 'Belegung löschen',
            icon: 'pi pi-trash',
            acceptButtonProps: { severity: 'danger' },
            acceptLabel: 'Löschen',
            rejectLabel: 'Abbrechen',
            rejectButtonProps: { severity: 'secondary', text: true },
            message: `„${e.title ?? 'Belegt'}“ wird gelöscht. Der Zeitraum ist danach wieder frei.`,
            accept: async () => {
                await this.store.loeschen(e.id);
                this.meldung('info', 'Gelöscht', 'Der Zeitraum ist wieder frei.');
            },
        });
    }

    private meldung(severity: 'success' | 'info', summary: string, detail: string): void {
        this.toast.add({ severity, summary, detail, life: 4000 });
    }

    /** Kurzform „Di, 3.11., 18–20 Uhr“ für Listen. */
    protected zeitKurz(e: BookingEntry): string {
        const b = berlinUhr(e.start_at);
        const en = berlinUhr(e.end_at);
        const ende = en.stunde === 0 ? 24 : en.stunde;
        const wt = WOCHENTAG_LANG[wochentag(b.jahr, b.monat, b.tag)].slice(0, 2);
        const tag = `${wt}, ${b.tag}.${b.monat}.${b.jahr !== berlinUhr(new Date()).jahr ? b.jahr : ''}`;
        return b.tag === en.tag && b.monat === en.monat
            ? `${tag}, ${uhrzeit(b.stunde).slice(0, 2)}–${uhrzeit(ende).slice(0, 2)} Uhr`
            : `${tag} ${uhrzeit(b.stunde).slice(0, 2)} Uhr bis ${en.tag}.${en.monat}. ${uhrzeit(ende).slice(0, 2)} Uhr`;
    }

    protected readonly ladeLader = (serie: SerieEingabe) => this.store.serieVorschau(serie);
}
