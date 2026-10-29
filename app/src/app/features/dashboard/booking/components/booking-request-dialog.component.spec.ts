import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { stubMatchMedia, stubResizeObserver } from '../../../../../testing/browser-stubs';
import type { BookingEntry, BookingPlan } from '../../../../shared/booking/booking.models';
import { berlinUhr, berlinZeitpunkt } from '../../../../shared/booking/zeitraum';
import type { BuchungEingabe } from '../domain/booking.repository';
import { testEintrag, testPlan } from '../testing';
import { BookingRequestDialogComponent, Vorgabe } from './booking-request-dialog.component';

@Component({
    imports: [BookingRequestDialogComponent],
    template: `<app-booking-request-dialog [(sichtbar)]="sichtbar" [plan]="plan()" [eintraege]="eintraege()" [vorgabe]="vorgabe()"
        [eintrag]="bearbeiten()" [vorschauLader]="lader" (gespeichert)="gespeichert = $event" (geaendert)="geaendert = $event" />`,
})
class Host {
    sichtbar = signal(false);
    plan = signal<BookingPlan>(testPlan({ my_role: 'requester' }));
    eintraege = signal<BookingEntry[]>([]);
    vorgabe = signal<Vorgabe | null>(null);
    bearbeiten = signal<BookingEntry | null>(null);
    lader = async () => ({ dates: [], skipped_booked: [], skipped_holidays: [], declined_requests: [] });
    gespeichert: BuchungEingabe | null = null;
    geaendert: BuchungEingabe | null = null;
}

describe('BookingRequestDialogComponent', () => {
    const morgen = berlinUhr(new Date(Date.now() + 86_400_000));
    const text = () => document.body.textContent ?? '';
    const feld = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
    const knopf = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === name);
    const tippe = (el: HTMLInputElement, wert: string) => {
        el.value = wert;
        el.dispatchEvent(new Event('input'));
    };

    async function oeffnen(anpassen: (h: Host) => void = () => undefined) {
        stubMatchMedia();
        stubResizeObserver();
        TestBed.configureTestingModule({ imports: [Host], providers: [provideNoopAnimations()] });
        const fixture = TestBed.createComponent(Host);
        anpassen(fixture.componentInstance);
        fixture.componentInstance.sichtbar.set(true);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture;
    }

    it('lässt Buchende mit dem heutigen Tag beginnen, ohne das Ende-Datum zu leeren (minDate gilt ab Mitternacht)', async () => {
        await oeffnen();
        const inputs = [...document.querySelectorAll<HTMLInputElement>('p-datepicker input')];
        expect(inputs).toHaveLength(2);
        expect(inputs.every((i) => i.value !== '')).toBe(true);
    });

    it('behält die Eingaben, wenn sich Plan oder Einträge ändern (Formular wird nur beim Öffnen zurückgesetzt)', async () => {
        const fixture = await oeffnen();
        tippe(feld('belegung-titel'), 'Kreisversammlung');
        fixture.detectChanges();
        fixture.componentInstance.eintraege.set([testEintrag({ id: 'neu' })]);
        fixture.componentInstance.plan.set(testPlan({ my_role: 'requester', name: 'Anderer Name' }));
        fixture.detectChanges();
        await fixture.whenStable();
        expect(feld('belegung-titel').value).toBe('Kreisversammlung');
    });

    it('meldet frei, Überschneidung mit Anfragen (Speichern erlaubt) und belegt (Speichern gesperrt)', async () => {
        const start = (h: number) => berlinZeitpunkt(morgen.jahr, morgen.monat, morgen.tag, h).toISOString();
        const fixture = await oeffnen((h) => {
            h.vorgabe.set({ jahr: morgen.jahr, monat: morgen.monat, tag: morgen.tag, von: 10, bis: 12 });
            h.eintraege.set([
                testEintrag({ id: 'a', status: 'approved', start_at: start(14), end_at: start(16) }),
                testEintrag({ id: 'o', status: 'requested', title: 'Planung', requester_name: 'Tim', start_at: start(11), end_at: start(13) }),
            ]);
        });
        tippe(feld('belegung-titel'), 'X');
        fixture.detectChanges();
        expect(text()).toContain('Planung überschneidet sich');
        expect(text()).toContain('Tim');
        expect(knopf('Anfragen')?.disabled).toBe(false);

        fixture.componentInstance.vorgabe.set({ jahr: morgen.jahr, monat: morgen.monat, tag: morgen.tag, von: 15, bis: 17 });
        fixture.componentInstance.sichtbar.set(false);
        fixture.detectChanges();
        fixture.componentInstance.sichtbar.set(true);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        tippe(feld('belegung-titel'), 'Y');
        fixture.detectChanges();
        expect(text()).toContain('Belegt.');
        expect(knopf('Anfragen')?.disabled).toBe(true);
    });

    it('sendet die Anfrage mit vollen Stunden als ISO-Zeitraum', async () => {
        const fixture = await oeffnen((h) => h.vorgabe.set({ jahr: morgen.jahr, monat: morgen.monat, tag: morgen.tag, von: 10, bis: 12 }));
        tippe(feld('belegung-titel'), '  Treffen  ');
        fixture.detectChanges();
        knopf('Anfragen')?.click();
        expect(fixture.componentInstance.gespeichert).toEqual({
            title: 'Treffen', note: null, is_public: false,
            start_at: berlinZeitpunkt(morgen.jahr, morgen.monat, morgen.tag, 10).toISOString(),
            end_at: berlinZeitpunkt(morgen.jahr, morgen.monat, morgen.tag, 12).toISOString(),
        });
    });

    it('sperrt vergangene Zeiten für Buchende, nicht aber für die Leitung', async () => {
        const gestern = berlinUhr(new Date(Date.now() - 2 * 86_400_000));
        const fixture = await oeffnen((h) => h.vorgabe.set({ jahr: gestern.jahr, monat: gestern.monat, tag: gestern.tag, von: 10, bis: 12 }));
        tippe(feld('belegung-titel'), 'Alt');
        fixture.detectChanges();
        expect(text()).toContain('nur für die Zukunft');
        expect(knopf('Anfragen')?.disabled).toBe(true);
    });

    it('bearbeitet eine Buchung: Felder vorbelegt, eigene Zeit gilt nicht als belegt, Ergebnis als Änderung', async () => {
        const eintrag = testEintrag({ id: 'self', title: 'Alt', start_at: berlinZeitpunkt(morgen.jahr, morgen.monat, morgen.tag, 10).toISOString(), end_at: berlinZeitpunkt(morgen.jahr, morgen.monat, morgen.tag, 12).toISOString() });
        const fixture = await oeffnen((h) => {
            h.plan.set(testPlan({ my_role: 'manager' }));
            h.bearbeiten.set(eintrag);
            h.eintraege.set([eintrag]);
        });
        expect(text()).toContain('Belegung bearbeiten');
        expect(feld('belegung-titel').value).toBe('Alt');
        expect(text()).not.toContain('Belegt.'); // die eigene Buchung blockiert sich nicht selbst
        tippe(feld('belegung-titel'), 'Neu');
        fixture.detectChanges();
        knopf('Speichern')?.click();
        expect(fixture.componentInstance.geaendert).toMatchObject({ title: 'Neu' });
        expect(fixture.componentInstance.gespeichert).toBeNull();
    });
});
