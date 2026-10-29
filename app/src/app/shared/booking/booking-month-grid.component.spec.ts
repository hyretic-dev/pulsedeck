import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { BookingEntry, RasterPlan } from './booking.models';
import { BookingMonthGridComponent, StundenAuswahl } from './booking-month-grid.component';
import { TagRef, berlinZeitpunkt, wochenTage } from './zeitraum';

const plan: RasterPlan = { window_start: 8, window_end: 22, state: null };

@Component({
    imports: [BookingMonthGridComponent],
    template: `<app-booking-month-grid [jahr]="2026" [monat]="10" [plan]="plan" [eintraege]="eintraege()" [tage]="tage()"
        (stundenGewaehlt)="stunden = $event" (tagGewaehlt)="tag = $event" (eintragGewaehlt)="eintrag = $event" />`,
})
class Host {
    plan = plan;
    eintraege = signal<BookingEntry[]>([]);
    tage = signal<TagRef[] | null>(wochenTage({ jahr: 2026, monat: 10, tag: 26 })); // Mo 26.10. bis So 1.11.
    stunden: StundenAuswahl | null = null;
    tag: TagRef | null = null;
    eintrag: BookingEntry | null = null;
}

describe('BookingMonthGridComponent', () => {
    function rendern() {
        const fixture = TestBed.createComponent(Host);
        fixture.detectChanges();
        return fixture;
    }
    const zeilen = (f: ReturnType<typeof rendern>) => [...(f.nativeElement as HTMLElement).querySelectorAll('.zeile')];

    it('zeigt eine Woche über die Monatsgrenze: sieben Zeilen, Monatswechsel inklusive', () => {
        const f = rendern();
        const labels = zeilen(f).map((z) => `${z.querySelector('.wt')?.textContent} ${z.querySelector('.datum')?.textContent}`);
        expect(labels).toEqual(['Mo 26.', 'Di 27.', 'Mi 28.', 'Do 29.', 'Fr 30.', 'Sa 31.', 'So 1.']);
    });

    it('meldet bei Klick auf den Tag das Datum samt Monat (die Ansicht bleibt Sache des Aufrufers)', () => {
        const f = rendern();
        (zeilen(f)[6].querySelector('.tag-knopf') as HTMLButtonElement).click();
        expect(f.componentInstance.tag).toEqual({ jahr: 2026, monat: 11, tag: 1 });
    });

    it('wählt eine freie Stunde am Tag des Folgemonats mit dem richtigen Monat', () => {
        const f = rendern();
        (zeilen(f)[6].querySelector('.stunde[data-stunde="10"]') as HTMLButtonElement).click();
        expect(f.componentInstance.stunden).toEqual({ jahr: 2026, monat: 11, tag: 1, von: 10, bis: 11 });
    });

    it('findet Buchungen auf dem richtigen Tag der Woche, auch am 1. des Folgemonats', () => {
        const f = rendern();
        f.componentInstance.eintraege.set([
            {
                id: 'b', plan_id: 'p', title: 'Sonntagsbrunch', note: null, is_public: false, requester_name: null, is_mine: false, series_id: null,
                event_id: null, decision_reason: null, status: 'approved',
                start_at: berlinZeitpunkt(2026, 11, 1, 10).toISOString(), end_at: berlinZeitpunkt(2026, 11, 1, 12).toISOString(),
            },
        ]);
        f.detectChanges();
        expect(zeilen(f)[6].querySelector('.balken')?.textContent).toContain('Sonntagsbrunch');
        expect(zeilen(f)[0].querySelector('.balken')).toBeNull();
        (zeilen(f)[6].querySelector('.balken') as HTMLButtonElement).click();
        expect(f.componentInstance.eintrag?.id).toBe('b');
    });

    it('springt mit den Pfeiltasten zeilenweise, auch über die Monatsgrenze (31. → 1.)', () => {
        const f = rendern();
        const sa = zeilen(f)[5].querySelector('.stunde[data-stunde="9"]') as HTMLButtonElement;
        sa.focus();
        sa.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement).toBe(zeilen(f)[6].querySelector('.stunde[data-stunde="9"]'));
    });

    it('zeigt ohne Wochenvorgabe die Tage des Monats', () => {
        const f = rendern();
        f.componentInstance.tage.set(null);
        f.detectChanges();
        expect(zeilen(f)).toHaveLength(31); // Oktober 2026
    });
});
