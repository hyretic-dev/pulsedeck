import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';

import { stubMatchMedia, stubResizeObserver } from '../../../../../testing/browser-stubs';
import { PUBLIC_BOOKING_REPOSITORY } from '../domain/public-booking.repository';
import { PublicBookingStore } from '../application/public-booking.store';
import { testOeffentlicherPlan, testOeffentlicheBuchung, testOeffentlichesRepository } from '../testing';
import { PublicBookingComponent } from './public-booking.component';

@Component({ imports: [PublicBookingComponent], template: `<app-public-booking slug="alpha" farbe="#2e5bd8" />` })
class Host {}

describe('PublicBookingComponent', () => {
    function rendern(zusatz: Parameters<typeof testOeffentlichesRepository>[0] = {}) {
        stubMatchMedia();
        stubResizeObserver();
        const repo = testOeffentlichesRepository(zusatz);
        TestBed.configureTestingModule({
            imports: [Host],
            providers: [provideNoopAnimations(), { provide: Router, useValue: { navigate: vi.fn() } }],
        });
        // Die Komponente bindet ihren Port selbst (Komponenten-Provider); im Test steht dort die Attrappe
        TestBed.overrideComponent(PublicBookingComponent, { set: { providers: [{ provide: PUBLIC_BOOKING_REPOSITORY, useValue: repo }, PublicBookingStore] } });
        const fixture = TestBed.createComponent(Host);
        return { fixture, repo, router: TestBed.inject(Router) as unknown as { navigate: ReturnType<typeof vi.fn> } };
    }
    async function stabil(fixture: ReturnType<typeof rendern>['fixture']) {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    it('zeigt ohne öffentliche Pläne nichts', async () => {
        const { fixture } = rendern({ plaene: vi.fn(async () => []) });
        await stabil(fixture);
        expect(fixture.nativeElement.querySelector('section')).toBeNull();
    });

    it('zeigt den Plan als Jahresübersicht, nur zur Ansicht und ohne Buchungsknöpfe', async () => {
        const { fixture, repo } = rendern();
        await stabil(fixture);
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('Belegung');
        expect(text).toContain('Bürgerhaus Saal');
        expect(fixture.nativeElement.querySelector('app-booking-year-grid')).not.toBeNull();
        const knoepfe = [...fixture.nativeElement.querySelectorAll('button')].map((b) => (b as HTMLElement).textContent?.trim() ?? '');
        expect(knoepfe.join('|')).not.toMatch(/Anfragen|Eintragen|Anfrage stellen|Reservieren/);
        expect(text).toContain('Nur Ansicht');
        expect(repo.plaene).toHaveBeenCalledWith('alpha');
    });

    it('übernimmt die Organisationsfarbe für die Raster', async () => {
        const { fixture } = rendern();
        await stabil(fixture);
        const host = fixture.nativeElement.querySelector('app-public-booking') as HTMLElement;
        expect(host.style.getPropertyValue('--linke-rgb')).toBe('46 91 216');
    });

    it('startet bei Plänen mit Monatsanzeige im Monat und öffnet bei einer Buchung zu einem öffentlichen Termin dessen Seite', async () => {
        const jetzt = new Date();
        const heute = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate(), 10)).toISOString();
        const spaeter = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate(), 12)).toISOString();
        const { fixture, router } = rendern({
            plaene: vi.fn(async () => [testOeffentlicherPlan({ public_view: 'month' })]),
            eintraege: vi.fn(async () => [testOeffentlicheBuchung({ start_at: heute, end_at: spaeter, event_id: 'ev-1', title: 'Konzert' })]),
        });
        await stabil(fixture);
        expect(fixture.nativeElement.querySelector('app-booking-month-grid')).not.toBeNull();
        (fixture.nativeElement.querySelector('.balken') as HTMLButtonElement).click();
        expect(router.navigate).toHaveBeenCalledWith(['/event', 'ev-1']);
    });

    it('lässt Buchungen ohne öffentlichen Termin anklickbar, aber ohne Ziel', async () => {
        const jetzt = new Date();
        const von = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate(), 10)).toISOString();
        const bis = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate(), 12)).toISOString();
        const { fixture, router } = rendern({
            plaene: vi.fn(async () => [testOeffentlicherPlan({ public_view: 'month' })]),
            eintraege: vi.fn(async () => [testOeffentlicheBuchung({ start_at: von, end_at: bis })]),
        });
        await stabil(fixture);
        (fixture.nativeElement.querySelector('.balken') as HTMLButtonElement).click();
        expect(router.navigate).not.toHaveBeenCalled();
    });
});
