import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import type { BookingPlan } from '../../../../shared/booking/booking.models';
import { stubResizeObserver } from '../../../../../testing/browser-stubs';
import { BOOKING_REPOSITORY, MEMBER_DIRECTORY, type PlanEingabe } from '../domain/booking.repository';
import { testPlan, testRepository } from '../testing';
import { BookingCalendarDialogComponent } from './booking-calendar-dialog.component';

@Component({
    imports: [BookingCalendarDialogComponent],
    template: `<app-booking-calendar-dialog [(sichtbar)]="sichtbar" [plan]="plan()" [istAdmin]="admin()" (gespeichert)="gespeichert = $event" (loeschen)="geloescht = true" />`,
})
class Host {
    sichtbar = signal(false);
    plan = signal<BookingPlan | null>(null);
    admin = signal(true);
    gespeichert: PlanEingabe | null = null;
    geloescht = false;
}

describe('BookingCalendarDialogComponent', () => {
    const repo = testRepository({
        rollen: vi.fn(async () => [{ member_id: 'm1', name: 'Paul', role: 'manager' as const }]),
    });

    beforeEach(() => {
        stubResizeObserver();
        TestBed.configureTestingModule({
            providers: [
                provideNoopAnimations(),
                { provide: BOOKING_REPOSITORY, useValue: repo },
                { provide: MEMBER_DIRECTORY, useValue: { mitglieder: async () => [{ id: 'm1', name: 'Paul' }, { id: 'm2', name: 'Anna' }] } },
            ],
        });
    });

    async function oeffnen(plan: BookingPlan | null) {
        const fixture = TestBed.createComponent(Host);
        fixture.componentInstance.plan.set(plan);
        fixture.componentInstance.sichtbar.set(true);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture;
    }
    const text = () => document.body.textContent ?? '';
    const knopf = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === name);

    it('legt einen Plan mit den Standardwerten an: Ort, 8 bis 22 Uhr, nicht öffentlich, Anfragen nur mit Rolle', async () => {
        const fixture = await oeffnen(null);
        expect(text()).toContain('Belegungsplan anlegen');
        expect(document.querySelector('p-tab[value="personen"]')).toBeNull(); // Personen gibt es erst, wenn der Plan existiert
        const name = document.querySelector<HTMLInputElement>('#plan-name') as HTMLInputElement;
        name.value = '  Bürgerhaus  ';
        name.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        knopf('Anlegen')?.click();
        expect(fixture.componentInstance.gespeichert).toEqual({
            name: 'Bürgerhaus', kind: 'place', address: null, state: null, window_start: 8, window_end: 22,
            all_members_can_request: false, public_view: 'none',
        });
    });

    it('speichert nicht ohne Namen', async () => {
        const fixture = await oeffnen(null);
        knopf('Anlegen')?.click();
        expect(fixture.componentInstance.gespeichert).toBeNull();
    });

    it('zeigt bei Einstellungen die Werte des Plans, die Löschen-Aktion nur für Administratoren und lädt die Personen', async () => {
        const fixture = await oeffnen(testPlan({ name: 'Sporthalle', address: 'Am Sportpark 3', window_end: 21, public_view: 'month' }));
        expect((document.querySelector('#plan-name') as HTMLInputElement).value).toBe('Sporthalle');
        expect((document.querySelector('#plan-adresse') as HTMLInputElement).value).toBe('Am Sportpark 3');
        expect(text()).toContain('Plan löschen');
        knopf('Plan löschen')?.click();
        expect(fixture.componentInstance.geloescht).toBe(true);
        expect(repo.rollen).toHaveBeenCalledWith('p1');
    });

    it('verbirgt „Plan löschen“ für die Leitung ohne Administratorrechte', async () => {
        const fixture = TestBed.createComponent(Host);
        fixture.componentInstance.admin.set(false);
        fixture.componentInstance.plan.set(testPlan());
        fixture.componentInstance.sichtbar.set(true);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(text()).not.toContain('Plan löschen');
    });
});
