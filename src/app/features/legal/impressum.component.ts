import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

@Component({
    selector: 'app-impressum',
    standalone: true,
    imports: [CommonModule, RouterModule],
    template: `
        <div class="min-h-screen bg-[var(--color-bg)]">
            <div class="max-w-4xl mx-auto px-6 py-16">
                <a [routerLink]="backLink()" class="inline-flex items-center gap-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-8 transition-colors">
                    <i class="pi pi-arrow-left"></i>
                    Zurück zur Startseite
                </a>
                
                <h1 class="text-4xl font-bold text-[var(--color-text)] mb-8">Impressum</h1>
                
                <div class="max-w-none space-y-8">
                    <section>
                        <h2 class="text-2xl font-semibold text-[var(--color-text)] mb-4">Angaben gemäß § 5 TMG</h2>
                        <div class="bg-[var(--color-surface-raised)] rounded-xl p-6 border border-[var(--color-border)]">
                            <div class="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-[var(--color-text)]">
                                <i class="pi pi-info-circle mr-2 text-blue-500"></i>
                                <strong>Hinweis:</strong> Dieses Projekt befindet sich in der Early-Access-Phase und wird aktuell als privates, nicht-kommerzielles Open-Source-Projekt betrieben.
                            </div>
                            <p class="text-[var(--color-text-muted)]">
                                <strong class="text-[var(--color-text)]">PulseDeck</strong><br>
                                hyretic<br>
                                c/o Autorenglück #62015<br>
                                Albert-Einstein-Str. 47<br>
                                02977 Hoyerswerda<br>
                                Deutschland<br><br>
                                <span class="text-sm italic">Behörden können meine ladungsfähige Anschrift unter oben genannter Adresse erfragen.</span>
                            </p>
                        </div>
                    </section>

                    <section>
                        <h2 class="text-2xl font-semibold text-[var(--color-text)] mb-4">Kontakt</h2>
                        <div class="bg-[var(--color-surface-raised)] rounded-xl p-6 border border-[var(--color-border)]">
                            <p class="text-[var(--color-text-muted)]">
                                E-Mail: <a href="mailto:kontakt@pulsedeck.de" class="text-linke hover:text-linke-light">kontakt@pulsedeck.de</a>
                            </p>
                        </div>
                    </section>

                    <section>
                        <h2 class="text-2xl font-semibold text-[var(--color-text)] mb-4">EU-Streitschlichtung</h2>
                        <div class="bg-[var(--color-surface-raised)] rounded-xl p-6 border border-[var(--color-border)]">
                            <p class="text-[var(--color-text-muted)]">
                                Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: 
                                <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer" class="text-linke hover:text-linke-light">https://ec.europa.eu/consumers/odr/</a>.<br>
                                Unsere E-Mail-Adresse finden Sie oben im Impressum.
                            </p>
                        </div>
                    </section>

                    <section>
                        <h2 class="text-2xl font-semibold text-[var(--color-text)] mb-4">Verbraucherstreitbeilegung / Universalschlichtungsstelle</h2>
                        <div class="bg-[var(--color-surface-raised)] rounded-xl p-6 border border-[var(--color-border)]">
                            <p class="text-[var(--color-text-muted)]">
                                Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
                            </p>
                        </div>
                    </section>

                    <section>
                        <h2 class="text-2xl font-semibold text-[var(--color-text)] mb-4">Haftungsausschluss</h2>
                        
                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Haftung für Inhalte</h3>
                        <p class="text-[var(--color-text-muted)] leading-relaxed">
                            Die Inhalte unserer Seiten wurden mit größter Sorgfalt erstellt. Für die Richtigkeit, 
                            Vollständigkeit und Aktualität der Inhalte können wir jedoch keine Gewähr übernehmen. 
                            Als Diensteanbieter sind wir gemäß § 7 Abs.1 TMG für eigene Inhalte auf diesen Seiten 
                            nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als 
                            Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde 
                            Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige 
                            Tätigkeit hinweisen.
                        </p>

                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Haftung für Links</h3>
                        <p class="text-[var(--color-text-muted)] leading-relaxed">
                            Unser Angebot enthält Links zu externen Webseiten Dritter, auf deren Inhalte wir keinen 
                            Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. 
                            Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der 
                            Seiten verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche 
                            Rechtsverstöße überprüft. Rechtswidrige Inhalte waren zum Zeitpunkt der Verlinkung nicht erkennbar.
                        </p>

                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Urheberrecht</h3>
                        <p class="text-[var(--color-text-muted)] leading-relaxed">
                            Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen 
                            dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art 
                            der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung 
                            des jeweiligen Autors bzw. Erstellers.
                        </p>
                    </section>
                </div>

                <div class="mt-12 pt-8 border-t border-[var(--color-border)]">
                    <p class="text-[var(--color-text-muted)] text-sm">
                        Zuletzt aktualisiert: Januar 2024
                    </p>
                </div>
            </div>
        </div>
    `,
})
export class ImpressumComponent {
    auth = inject(AuthService);
    backLink = computed(() => {
        if (!this.auth.user()) return '/';
        const slug = localStorage.getItem('lastOrgSlug');
        return slug ? `/${slug}/dashboard` : '/organisationen';
    });
}
