import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import type { BookingEntry, RasterPlan } from './booking.models';
import { BookingDayPanelComponent, TagesStunde } from './booking-day-panel.component';
import { TagRef, berlinZeitpunkt } from './zeitraum';

const plan: RasterPlan = { window_start: 8, window_end: 22, state: 'NW' };
const eintrag = (zusatz: Partial<BookingEntry>): BookingEntry => ({
    id: 'e', plan_id: 'p', title: 'Treffen', note: null, status: 'approved', is_public: false, requester_name: null, is_mine: false,
    series_id: null, event_id: null, decision_reason: null,
    start_at: berlinZeitpunkt(2026, 10, 29, 18).toISOString(), end_at: berlinZeitpunkt(2026, 10, 29, 20).toISOString(), ...zusatz,
});

@Component({
    imports: [BookingDayPanelComponent],
    template: `<app-booking-day-panel [(sichtbar)]="sichtbar" [(tag)]="tag" [plan]="plan" [eintraege]="eintraege()" [darfAnfragen]="anfragen()"
        (stundeGewaehlt)="stunde = $event" (eintragGewaehlt)="gewaehlt = $event" />`,
})
class Host {
    sichtbar = signal(true);
    tag = signal<TagRef | null>({ jahr: 2026, monat: 10, tag: 29 });
    plan = plan;
    eintraege = signal<BookingEntry[]>([]);
    anfragen = signal(true);
    stunde: TagesStunde | null = null;
    gewaehlt: BookingEntry | null = null;
}

describe('BookingDayPanelComponent', () => {
    async function rendern(anpassen: (h: Host) => void = () => undefined) {
        TestBed.configureTestingModule({ imports: [Host], providers: [provideNoopAnimations()] });
        const f = TestBed.createComponent(Host);
        anpassen(f.componentInstance);
        f.detectChanges();
        await f.whenStable();
        f.detectChanges();
        return f;
    }
    const text = () => document.body.textContent ?? '';
    const knoepfe = (muster: RegExp) => [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => muster.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));

    it('zeigt den Tag mit Wochentag, alle Stunden des Zeitfensters und freie Stunden zum Anfragen', async () => {
        await rendern();
        expect(text()).toContain('Donnerstag, 29. Oktober 2026');
        expect(document.querySelectorAll('ul[aria-label="Stunden des Tages"] > li')).toHaveLength(14); // 8 bis 21 Uhr
        expect(knoepfe(/Uhr anfragen/)).toHaveLength(14);
    });

    it('meldet die gewählte freie Stunde samt Datum, ohne den Tag zu verlassen', async () => {
        const f = await rendern();
        knoepfe(/^10:00 Uhr anfragen$/)[0].click();
        expect(f.componentInstance.stunde).toEqual({ jahr: 2026, monat: 10, tag: 29, von: 10, bis: 11 });
        expect(f.componentInstance.sichtbar()).toBe(true); // das Panel bleibt offen
    });

    it('zeigt Einträge in ihrer Anfangsstunde und die Fortsetzung in den Folgestunden, belegte Stunden sind nicht anfragbar', async () => {
        await rendern((h) => h.eintraege.set([eintrag({})]));
        expect(text()).toContain('18–20');
        expect(text()).toContain('↳ Treffen'); // 19 Uhr läuft weiter
        expect(knoepfe(/^18:00 Uhr anfragen$/)).toHaveLength(0);
        expect(knoepfe(/^19:00 Uhr anfragen$/)).toHaveLength(0);
        expect(knoepfe(/^20:00 Uhr anfragen$/)).toHaveLength(1);
    });

    it('öffnet den Eintrag per Klick und maskiert unbekannte Titel als „Belegt“', async () => {
        const f = await rendern((h) => h.eintraege.set([eintrag({ title: null })]));
        const chip = [...document.querySelectorAll<HTMLButtonElement>('.chip')][0];
        expect(chip.textContent).toContain('Belegt');
        chip.click();
        expect(f.componentInstance.gewaehlt?.id).toBe('e');
    });

    it('springt mit Vor und Zurück von Tag zu Tag, auch über die Monatsgrenze', async () => {
        const f = await rendern((h) => h.tag.set({ jahr: 2026, monat: 10, tag: 31 }));
        knoepfe(/^Nächster Tag$/)[0].click();
        f.detectChanges();
        expect(f.componentInstance.tag()).toEqual({ jahr: 2026, monat: 11, tag: 1 });
        expect(text()).toContain('Sonntag, 1. November 2026');
        knoepfe(/^Vorheriger Tag$/)[0].click();
        knoepfe(/^Vorheriger Tag$/)[0].click();
        expect(f.componentInstance.tag()).toEqual({ jahr: 2026, monat: 10, tag: 30 });
    });

    it('nennt den Feiertag und bleibt ohne Rolle eine reine Ansicht', async () => {
        await rendern((h) => {
            h.tag.set({ jahr: 2026, monat: 12, tag: 25 });
            h.anfragen.set(false);
        });
        expect(text()).toContain('1. Weihnachtstag');
        expect(knoepfe(/Uhr anfragen/)).toHaveLength(0);
        expect(text()).toContain('frei');
    });
});
