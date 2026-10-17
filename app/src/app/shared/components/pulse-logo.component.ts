import { Component, input } from '@angular/core';

let laufendeNummer = 0;

/** Bildmarke von PulseDeck (Puls-Linie auf roter Kachel); gleiche Form wie favicon.svg. Dekorativ, der Name steht daneben. */
@Component({
    selector: 'app-pulse-logo',
    standalone: true,
    template: `
        <svg [attr.width]="groesse()" [attr.height]="groesse()" viewBox="0 0 512 512" aria-hidden="true" focusable="false" class="block">
            <defs>
                <linearGradient [attr.id]="verlaufId" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#ff2a2a" />
                    <stop offset="1" stop-color="#b80000" />
                </linearGradient>
            </defs>
            <rect width="512" height="512" rx="112" [attr.fill]="'url(#' + verlaufId + ')'" />
            <path d="M88 272H176L212 168L268 360L312 216L340 272H424" fill="none" stroke="#fff" stroke-width="44"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
    `,
})
export class PulseLogoComponent {
    /** Kantenlänge in Pixeln */
    groesse = input(32);
    /** Eindeutig je Instanz, sonst greifen mehrere SVGs auf denselben Verlauf zu */
    readonly verlaufId = `pd-verlauf-${++laufendeNummer}`;
}
