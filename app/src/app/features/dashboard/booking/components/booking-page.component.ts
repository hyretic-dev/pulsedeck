import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TabsModule } from 'primeng/tabs';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { ConfirmationService, MessageService } from 'primeng/api';

import { BookingLegendComponent } from '../../../../shared/booking/booking-legend.component';
import { MONATSNAMEN, WOCHENTAG_LANG, uhrzeit } from '../../../../shared/booking/booking-labels';
import { BookingDayListComponent } from '../../../../shared/booking/booking-day-list.component';
import { BookingDayPanelComponent, TagesStunde } from '../../../../shared/booking/booking-day-panel.component';
import { BookingMonthGridComponent, StundenAuswahl } from '../../../../shared/booking/booking-month-grid.component';
import { BookingStatusChipComponent } from '../../../../shared/booking/booking-status-chip.component';
import { AuthService } from '../../../../shared/services/auth.service';
import { BookingYearGridComponent, TagAuswahl } from '../../../../shared/booking/booking-year-grid.component';
import { BookingEntry, darfAnfragen, darfEntscheiden } from '../../../../shared/booking/booking.models';
import { BUNDESLAENDER } from '../../../../shared/booking/feiertage';
import { TagRef, berlinUhr, ueberschneiden, wochentag } from '../../../../shared/booking/zeitraum';
import { Ansicht, Bereich, BookingStore } from '../application/booking.store';
import type { BuchungEingabe, PlanEingabe, SerieEingabe } from '../domain/booking.repository';
import { BookingCalendarDialogComponent } from './booking-calendar-dialog.component';
import { BookingEntryDialogComponent } from './booking-entry-dialog.component';
import { BookingRequestDialogComponent, Vorgabe } from './booking-request-dialog.component';

@Component({
    selector: 'app-booking-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule, ButtonModule, ConfirmDialogModule, DialogModule, ProgressSpinnerModule,
        SelectModule, SelectButtonModule, TabsModule, TextareaModule, ToastModule, InputTextModule,
        BookingLegendComponent, BookingDayListComponent, BookingMonthGridComponent, BookingStatusChipComponent, BookingYearGridComponent,
        BookingDayPanelComponent, BookingEntryDialogComponent, BookingRequestDialogComponent, BookingCalendarDialogComponent,
    ],
    providers: [BookingStore, ConfirmationService, MessageService],
    templateUrl: './booking-page.component.html',
    styleUrl: './booking-page.component.css',
})
export class BookingPageComponent implements OnInit {
    protected readonly store = inject(BookingStore);
    private readonly confirm = inject(ConfirmationService);
    private readonly toast = inject(MessageService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly auth = inject(AuthService);

    protected readonly istAdmin = this.auth.isAdmin;
    protected readonly ladeFehler = signal<string | null>(null);

    /** Unter `md` (768 px) gilt die schmale Darstellung; Android-App eingeschlossen. */
    protected readonly schmal = signal(false);

    protected readonly anfrageSichtbar = signal(false);
    protected readonly vorgabe = signal<Vorgabe | null>(null);
    protected readonly bearbeitenEintrag = signal<BookingEntry | null>(null);
    protected readonly planDialogSichtbar = signal(false);
    protected readonly planDialogNeu = signal(false);
    protected readonly serieDialogSichtbar = signal(false);
    protected readonly serieZiel = signal<BookingEntry | null>(null);
    protected serieTitel = '';
    protected readonly speichert = signal(false);
    protected readonly detail = signal<BookingEntry | null>(null);
    protected readonly detailSichtbar = signal(false);
    protected readonly tagesPanel = signal<TagRef | null>(null);
    protected readonly tagesPanelSichtbar = signal(false);
    protected readonly ablehnenZiel = signal<BookingEntry | null>(null);
    protected readonly ablehnenSichtbar = signal(false);
    protected ablehnenGrund = '';

    protected readonly ansichtOptionen: { label: string; value: Ansicht }[] = [
        { label: 'Jahr', value: 'jahr' },
        { label: 'Monat', value: 'monat' },
        { label: 'Woche', value: 'woche' },
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

    protected readonly titelZeile = computed(() => {
        switch (this.store.ansicht()) {
            case 'jahr':
                return String(this.store.jahr());
            case 'monat':
                return `${MONATSNAMEN[this.store.monat() - 1]} ${this.store.jahr()}`;
            case 'woche': {
                const tage = this.store.wochenTage();
                const [von, bis] = [tage[0], tage[6]];
                return `KW ${this.store.kalenderwoche().woche} · ${von.tag}.${von.monat}. – ${bis.tag}.${bis.monat}.${bis.jahr}`;
            }
        }
    });

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
        try {
            await this.store.start(this.destroyRef);
        } catch (fehler) {
            this.ladeFehler.set((fehler as Error).message);
        }
    }

    protected symbol(art: 'place' | 'item'): string {
        return art === 'place' ? 'pi-building' : 'pi-box';
    }

    protected planGewaehlt(id: string | number | undefined): void {
        if (typeof id === 'string') void this.store.planWaehlen(id);
    }

    /** Ein Tag in Jahr, Monat oder Woche öffnet die Tagesansicht als Seitenpanel; die Ansicht dahinter bleibt. */
    protected oeffneTagesPanel(tag: TagRef | TagAuswahl): void {
        this.tagesPanel.set({ jahr: tag.jahr, monat: tag.monat, tag: tag.tag });
        this.tagesPanelSichtbar.set(true);
    }

    protected neueAnfrage(auswahl: StundenAuswahl | null = null): void {
        this.bearbeitenEintrag.set(null);
        this.vorgabe.set(auswahl);
        this.anfrageSichtbar.set(true);
    }

    protected bearbeiten(e: BookingEntry): void {
        this.detailSichtbar.set(false);
        this.vorgabe.set(null);
        this.bearbeitenEintrag.set(e);
        this.anfrageSichtbar.set(true);
    }

    /** Freie Stunde im Tagespanel: Anfrage-Dialog, das Panel bleibt offen und zeigt danach die neue Belegung. */
    protected stundeAusPanel(auswahl: TagesStunde): void {
        this.neueAnfrage(auswahl);
    }

    protected zeigeDetail(e: BookingEntry): void {
        this.detail.set(e);
        this.detailSichtbar.set(true);
    }

    /** Führt eine Aktion aus; Fehler des Servers (z. B. „schon belegt“) erscheinen als Meldung statt als Absturz. */
    private async ausfuehren(aktion: () => Promise<void>): Promise<boolean> {
        this.speichert.set(true);
        try {
            await aktion();
            return true;
        } catch (fehler) {
            this.toast.add({ severity: 'error', summary: 'Das hat nicht geklappt', detail: (fehler as Error).message, life: 6000 });
            return false;
        } finally {
            this.speichert.set(false);
        }
    }

    protected async speichern(eingabe: BuchungEingabe): Promise<void> {
        const ok = await this.ausfuehren(async () => {
            const eintrag = await this.store.buchen(eingabe);
            this.meldung(
                'success',
                eintrag.status === 'approved' ? 'Eingetragen' : 'Angefragt',
                eintrag.status === 'approved' ? 'Die Belegung gilt sofort.' : 'Die Verwaltung entscheidet und du bekommst eine Mail.',
            );
        });
        if (ok) this.anfrageSichtbar.set(false);
    }

    protected async aenderungSpeichern(eingabe: BuchungEingabe): Promise<void> {
        const ziel = this.bearbeitenEintrag();
        if (!ziel) return;
        const ok = await this.ausfuehren(async () => {
            await this.store.bearbeiten(ziel.id, eingabe);
            this.meldung('success', 'Gespeichert', 'Die Belegung ist geändert.');
        });
        if (ok) this.anfrageSichtbar.set(false);
    }

    protected async serieSpeichern(serie: SerieEingabe): Promise<void> {
        const ok = await this.ausfuehren(async () => {
            const ergebnis = await this.store.serieAnlegen(serie);
            const abgelehnt = ergebnis.declined_requests ? ` ${ergebnis.declined_requests} offene Anfrage(n) wurden abgelehnt.` : '';
            this.meldung('success', 'Serie angelegt', `${ergebnis.created} Termine sind eingetragen.${abgelehnt}`);
        });
        if (ok) this.anfrageSichtbar.set(false);
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
                ? `„${e.title ?? 'Belegt'}“ wird bestätigt. Dabei ${betroffen.length === 1 ? 'wird diese überschneidende Anfrage' : 'werden diese überschneidenden Anfragen'} abgelehnt: ${betroffen.map((x) => `„${x.title ?? 'Belegt'}“${x.requester_name ? ` (${x.requester_name})` : ''}`).join(', ')}.`
                : `„${e.title ?? 'Belegt'}“ wird bestätigt und die anfragende Person bekommt eine Mail.`,
            accept: () =>
                void this.ausfuehren(async () => {
                    await this.store.annehmen(e.id);
                    this.meldung('success', 'Angenommen', betroffen.length ? `${betroffen.length} überschneidende Anfrage(n) abgelehnt.` : 'Die Belegung ist bestätigt.');
                }),
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
        const ok = await this.ausfuehren(async () => {
            await this.store.ablehnen(e.id, this.ablehnenGrund.trim() || null);
            this.meldung('info', 'Abgelehnt', 'Die anfragende Person bekommt eine Mail.');
        });
        if (ok) this.ablehnenSichtbar.set(false);
    }

    protected stornieren(e: BookingEntry): void {
        this.detailSichtbar.set(false);
        void this.ausfuehren(async () => {
            await this.store.stornieren(e.id);
            this.meldung('info', e.status === 'requested' ? 'Zurückgezogen' : 'Storniert', 'Der Zeitraum ist wieder frei.');
        });
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
            accept: () =>
                void this.ausfuehren(async () => {
                    await this.store.loeschen(e.id);
                    this.meldung('info', 'Gelöscht', 'Der Zeitraum ist wieder frei.');
                }),
        });
    }

    // ── Serien verwalten (Leitung) ──────────────────────────────────────────────

    protected serieUmbenennenFragen(e: BookingEntry): void {
        this.detailSichtbar.set(false);
        this.serieTitel = e.title ?? '';
        this.serieZiel.set(e);
        this.serieDialogSichtbar.set(true);
    }

    protected async serieUmbenennen(): Promise<void> {
        const e = this.serieZiel();
        const titel = this.serieTitel.trim();
        if (!e?.series_id || !titel) return;
        const ok = await this.ausfuehren(async () => {
            await this.store.serieUmbenennen(e.series_id as string, titel);
            this.meldung('success', 'Umbenannt', 'Alle Termine der Serie tragen jetzt den neuen Namen.');
        });
        if (ok) this.serieDialogSichtbar.set(false);
    }

    protected serieBeendenFragen(e: BookingEntry): void {
        this.detailSichtbar.set(false);
        const ab = berlinUhr(e.start_at);
        const datum = `${ab.jahr}-${String(ab.monat).padStart(2, '0')}-${String(ab.tag).padStart(2, '0')}`;
        this.confirm.confirm({
            header: 'Serie beenden',
            icon: 'pi pi-stop-circle',
            acceptButtonProps: { severity: 'danger' },
            acceptLabel: 'Beenden',
            rejectLabel: 'Abbrechen',
            rejectButtonProps: { severity: 'secondary', text: true },
            message: `Alle Termine von „${e.title ?? 'Belegt'}“ ab dem ${ab.tag}.${ab.monat}.${ab.jahr} (einschließlich) entfallen. Frühere bleiben bestehen.`,
            accept: () =>
                void this.ausfuehren(async () => {
                    const entfernt = await this.store.serieBeenden(e.series_id as string, datum);
                    this.meldung('info', 'Serie beendet', `${entfernt} Termine sind entfallen.`);
                }),
        });
    }

    // ── Pläne verwalten ─────────────────────────────────────────────────────────

    protected neuerPlan(): void {
        this.planDialogNeu.set(true);
        this.planDialogSichtbar.set(true);
    }

    protected planEinstellungen(): void {
        this.planDialogNeu.set(false);
        this.planDialogSichtbar.set(true);
    }

    protected async planSpeichern(eingabe: PlanEingabe): Promise<void> {
        const neu = this.planDialogNeu();
        const ok = await this.ausfuehren(async () => {
            if (neu) {
                const plan = await this.store.planAnlegen(eingabe);
                this.meldung('success', 'Plan angelegt', `„${plan.name}“ ist bereit. Benenne unter „Einstellungen“ die Personen, die buchen dürfen.`);
            } else {
                await this.store.planAendern(eingabe);
                this.meldung('success', 'Gespeichert', 'Die Einstellungen gelten sofort.');
            }
        });
        if (ok) this.planDialogSichtbar.set(false);
    }

    protected planLoeschenFragen(): void {
        const plan = this.store.plan();
        if (!plan) return;
        this.confirm.confirm({
            header: 'Belegungsplan löschen',
            icon: 'pi pi-trash',
            acceptButtonProps: { severity: 'danger' },
            acceptLabel: 'Löschen',
            rejectLabel: 'Abbrechen',
            rejectButtonProps: { severity: 'secondary', text: true },
            message: `„${plan.name}“ wird mit allen Buchungen, Serien und Rollen gelöscht. Das lässt sich nicht rückgängig machen.`,
            accept: () =>
                void this.ausfuehren(async () => {
                    await this.store.planLoeschen();
                    this.planDialogSichtbar.set(false);
                    this.meldung('info', 'Plan gelöscht', 'Der Belegungsplan ist entfernt.');
                }),
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
