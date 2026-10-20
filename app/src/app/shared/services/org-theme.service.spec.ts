import { TestBed } from '@angular/core/testing';

import { ApiService } from '../../core/api.service';
import { OrgThemeService } from './org-theme.service';
import { OrganizationService } from './organization.service';

describe('OrgThemeService', () => {
    const wert = (name: string): string => document.documentElement.style.getPropertyValue(name);
    const org = (farbe: string) => ({ id: 'o1', slug: 'a', name: 'A', primary_color: farbe, subscription_tier: 'free', max_members: 10 }) as never;

    beforeEach(() => {
        document.documentElement.removeAttribute('style');
        TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: {} }] });
    });

    it('setzt die Variablen der Organisation, wechselt mit der Organisation und räumt ohne Organisation auf', () => {
        const orgs = TestBed.inject(OrganizationService);
        TestBed.inject(OrgThemeService);

        TestBed.tick();
        expect(wert('--linke-rot')).toBe(''); // ohne Organisation gelten die Standardwerte aus styles.css

        orgs.currentOrganization.set(org('#2e5bd8'));
        TestBed.tick();
        expect(wert('--linke-rot')).toBe('#2e5bd8');
        expect(wert('--linke-rgb')).toBe('46 91 216');

        orgs.currentOrganization.set(org('#2f9e44'));
        TestBed.tick();
        expect(wert('--linke-rot')).toBe('#2f9e44');

        orgs.currentOrganization.set(null);
        TestBed.tick();
        expect(wert('--linke-rot')).toBe('');
        expect(wert('--p-button-primary-color')).toBe('');
    });

    it('zeigt eine Vorschau vor der gespeicherten Farbe und nimmt sie zurück', () => {
        const orgs = TestBed.inject(OrganizationService);
        const theme = TestBed.inject(OrgThemeService);
        orgs.currentOrganization.set(org('#2e5bd8'));
        TestBed.tick();

        theme.zeigeVorschau('#c2255c');
        TestBed.tick();
        expect(wert('--linke-rot')).toBe('#c2255c');

        theme.zeigeVorschau(null);
        TestBed.tick();
        expect(wert('--linke-rot')).toBe('#2e5bd8');
    });
});
