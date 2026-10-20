import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

import { berechneTheme } from '../theme/org-theme';
import { OrganizationService } from './organization.service';

/**
 * Setzt die Primärfarbe der aktuellen Organisation als CSS-Variablen auf <html> (Tailwind-Klasse `linke`, PrimeNG-Tokens,
 * Schaltflächen). Ohne Organisation (Anmeldung, Registrierung) bleiben die Standardwerte aus styles.css. Eine Vorschau (Einstellungen) überlagert
 * die gespeicherte Farbe, bis sie zurückgenommen wird.
 */
@Injectable({ providedIn: 'root' })
export class OrgThemeService {
    private readonly dokument = inject(DOCUMENT);
    private readonly org = inject(OrganizationService);
    private gesetzt: string[] = [];

    /** Farbe aus der Vorschau im Einstellungsdialog; null = gespeicherte Farbe der Organisation. */
    private readonly vorschau = signal<string | null>(null);

    constructor() {
        effect(() => this.anwenden(this.vorschau() ?? this.org.currentOrganization()?.primary_color ?? null));
    }

    zeigeVorschau(farbe: string | null): void {
        this.vorschau.set(farbe);
    }

    private anwenden(farbe: string | null): void {
        const stil = this.dokument.documentElement.style;
        for (const name of this.gesetzt) stil.removeProperty(name);
        this.gesetzt = [];
        if (!farbe) return;
        const theme = berechneTheme(farbe);
        this.gesetzt = Object.keys(theme);
        for (const [name, wert] of Object.entries(theme)) stil.setProperty(name, wert);
    }
}
