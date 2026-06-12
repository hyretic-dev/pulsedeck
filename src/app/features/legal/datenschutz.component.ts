import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

@Component({
    selector: 'app-datenschutz',
    standalone: true,
    imports: [CommonModule, RouterModule],
    template: `
        <div class="min-h-screen bg-[var(--color-bg)]">
            <div class="max-w-4xl mx-auto px-6 py-16">
                <a [routerLink]="backLink()" class="inline-flex items-center gap-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-8 transition-colors">
                    <i class="pi pi-arrow-left"></i>
                    Zurück zur Startseite
                </a>
                
                <h1 class="text-4xl font-bold text-[var(--color-text)] mb-8">Datenschutzerklärung</h1>
                
                <div class="max-w-none space-y-12">
                    
                    <!-- 1. Überblick -->
                    <section>
                        <h2 class="text-2xl font-semibold text-[var(--color-text)] mb-6 pb-2 border-b border-[var(--color-border)]">1. Datenschutz auf einen Blick</h2>
                        
                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Allgemeine Hinweise</h3>
                        <p class="text-[var(--color-text-muted)] leading-relaxed">
                            Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren personenbezogenen Daten passiert, 
                            wenn Sie diese Website besuchen. Personenbezogene Daten sind alle Daten, mit denen Sie persönlich identifiziert werden können. 
                            Ausführliche Informationen zum Thema Datenschutz entnehmen Sie unserer unter diesem Text aufgeführten Datenschutzerklärung.
                        </p>

                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Datenerfassung auf dieser Website</h3>
                        <div class="space-y-4 text-[var(--color-text-muted)]">
                            <p>
                                <strong class="text-[var(--color-text)]">Wer ist verantwortlich für die Datenerfassung auf dieser Website?</strong><br>
                                Die Datenverarbeitung auf dieser Website erfolgt durch den Websitebetreiber. Dessen Kontaktdaten können Sie dem Abschnitt 
                                "Hinweis zur verantwortlichen Stelle" in dieser Datenschutzerklärung entnehmen.
                            </p>
                            <p>
                                <strong class="text-[var(--color-text)]">Wie erfassen wir Ihre Daten?</strong><br>
                                Ihre Daten werden zum einen dadurch erhoben, dass Sie uns diese mitteilen. Hierbei kann es sich z.B. um Daten handeln, 
                                die Sie in ein Kontaktformular eingeben oder bei der Registrierung angeben.<br>
                                Andere Daten werden automatisch oder nach Ihrer Einwilligung beim Besuch der Website durch unsere IT-Systeme erfasst. 
                                Das sind vor allem technische Daten (z.B. Internetbrowser, Betriebssystem oder Uhrzeit des Seitenaufrufs). 
                                Die Erfassung dieser Daten erfolgt automatisch, sobald Sie diese Website betreten.
                            </p>
                            <p>
                                <strong class="text-[var(--color-text)]">Wofür nutzen wir Ihre Daten?</strong><br>
                                Ein Teil der Daten wird erhoben, um eine fehlerfreie Bereitstellung der Website zu gewährleisten. 
                                Andere Daten können zur Analyse Ihres Nutzerverhaltens verwendet werden. Die bei der Registrierung angegebenen Daten 
                                dienen der Bereitstellung unseres Dienstes.
                            </p>
                        </div>
                    </section>

                    <!-- 2. Hosting -->
                    <section>
                        <h2 class="text-2xl font-semibold text-[var(--color-text)] mb-6 pb-2 border-b border-[var(--color-border)]">2. Hosting</h2>
                        <div class="bg-[var(--color-surface-raised)] rounded-xl p-6 border border-[var(--color-border)]">
                            <h3 class="text-lg font-medium text-[var(--color-text)] mb-3">Externes Hosting</h3>
                            <p class="text-[var(--color-text-muted)] leading-relaxed mb-4">
                                Diese Website wird extern gehostet. Die personenbezogenen Daten, die auf dieser Website erfasst werden, 
                                werden auf den Servern des Hosters gespeichert. Hierbei kann es sich v.a. um IP-Adressen, Kontaktanfragen, 
                                Meta- und Kommunikationsdaten, Vertragsdaten, Kontaktdaten, Namen, Websitezugriffe und sonstige Daten, 
                                die über eine Website generiert werden, handeln.
                            </p>
                            <p class="text-[var(--color-text-muted)] leading-relaxed">
                                Das externe Hosting erfolgt zum Zwecke der Vertragserfüllung gegenüber unseren potenziellen und bestehenden 
                                Kunden (Art. 6 Abs. 1 lit. b DSGVO) und im Interesse einer sicheren, schnellen und effizienten Bereitstellung 
                                unseres Online-Angebots durch einen professionellen Anbieter (Art. 6 Abs. 1 lit. f DSGVO). 
                                Sofern eine entsprechende Einwilligung abgefragt wurde, erfolgt die Verarbeitung ausschließlich auf Grundlage 
                                von Art. 6 Abs. 1 lit. a DSGVO; die Einwilligung ist jederzeit widerrufbar.
                            </p>
                            <p class="text-[var(--color-text-muted)] mt-4 text-sm">
                                Wir setzen folgenden Hoster ein:<br>
                                <strong>Supabase Inc.</strong> (als Backend-Provider)<br>
                                970 Toa Payoh North #07-04, Singapore 318992<br>
                                (Serverstandort: EU/Frankfurt, sofern nicht anders konfiguriert)
                            </p>
                        </div>
                    </section>

                    <!-- 3. Allgemeine Hinweise -->
                    <section>
                        <h2 class="text-2xl font-semibold text-[var(--color-text)] mb-6 pb-2 border-b border-[var(--color-border)]">3. Allgemeine Hinweise und Pflichtinformationen</h2>
                        
                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Datenschutz</h3>
                        <p class="text-[var(--color-text-muted)] leading-relaxed">
                            Die Betreiber dieser Seiten nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Wir behandeln Ihre personenbezogenen 
                            Daten vertraulich und entsprechend den gesetzlichen Datenschutzvorschriften sowie dieser Datenschutzerklärung.<br>
                            Wenn Sie diese Website benutzen, werden verschiedene personenbezogene Daten erhoben. 
                            Personenbezogene Daten sind Daten, mit denen Sie persönlich identifiziert werden können. 
                            Die vorliegende Datenschutzerklärung erläutert, welche Daten wir erheben und wofür wir sie nutzen. 
                            Sie erläutert auch, wie und zu welchem Zweck das geschieht.
                        </p>

                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Hinweis zur verantwortlichen Stelle</h3>
                        <div class="bg-[var(--color-surface-raised)] rounded-xl p-6 border border-[var(--color-border)] mt-4">
                            <p class="text-[var(--color-text-muted)]">
                                Die verantwortliche Stelle für die Datenverarbeitung auf dieser Website ist:<br><br>
                                <strong class="text-[var(--color-text)]">PulseDeck</strong><br>
                                hyretic<br>
                                c/o Autorenglück #62015<br>
                                Albert-Einstein-Str. 47<br>
                                02977 Hoyerswerda<br><br>
                                <span class="text-sm italic">Behörden können meine ladungsfähige Anschrift unter oben genannter Adresse erfragen.</span><br><br>
                                E-Mail: kontakt@pulsedeck.de
                            </p>
                            <p class="text-[var(--color-text-muted)] text-sm mt-4 italic">
                                Verantwortliche Stelle ist die natürliche oder juristische Person, die allein oder gemeinsam mit anderen über 
                                die Zwecke und Mittel der Verarbeitung von personenbezogenen Daten (z.B. Namen, E-Mail-Adressen o. Ä.) entscheidet.
                            </p>
                        </div>

                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Speicherdauer</h3>
                        <p class="text-[var(--color-text-muted)] leading-relaxed">
                            Soweit innerhalb dieser Datenschutzerklärung keine speziellere Speicherdauer genannt wurde, verbleiben Ihre personenbezogenen 
                            Daten bei uns, bis der Zweck für die Datenverarbeitung entfällt. Wenn Sie ein berechtigtes Löschersuchen geltend machen 
                            oder eine Einwilligung zur Datenverarbeitung widerrufen, werden Ihre Daten gelöscht, sofern wir keine anderen rechtlich 
                            zulässigen Gründe für die Speicherung Ihrer personenbezogenen Daten haben (z.B. steuer- oder handelsrechtliche 
                            Aufbewahrungsfristen); im letztgenannten Fall erfolgt die Löschung nach Fortfall dieser Gründe.
                        </p>
                    </section>

                    <!-- 4. Datenerfassung -->
                    <section>
                        <h2 class="text-2xl font-semibold text-[var(--color-text)] mb-6 pb-2 border-b border-[var(--color-border)]">4. Datenerfassung auf dieser Website</h2>
                        
                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Cookies</h3>
                        <p class="text-[var(--color-text-muted)] leading-relaxed">
                            Unsere Internetseiten verwenden so genannte „Cookies". Cookies sind kleine Textdateien und richten auf Ihrem Endgerät keinen Schaden an. 
                            Sie werden entweder vorübergehend für die Dauer einer Sitzung (Session-Cookies) oder dauerhaft (permanente Cookies) auf Ihrem Endgerät gespeichert. 
                            Session-Cookies werden nach Ende Ihres Besuchs automatisch gelöscht. Permanente Cookies bleiben auf Ihrem Endgerät gespeichert, bis Sie diese 
                            selbst löschen oder eine automatische Löschung durch Ihren Webbrowser erfolgt.<br><br>
                            Technisch notwendige Cookies, die zur Durchführung des elektronischen Kommunikationsvorgangs oder zur Bereitstellung bestimmter, 
                            von Ihnen erwünschter Funktionen erforderlich sind, werden auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO gespeichert. 
                            Der Websitebetreiber hat ein berechtigtes Interesse an der Speicherung von Cookies zur technisch fehlerfreien und optimierten 
                            Bereitstellung seiner Dienste.
                        </p>

                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Server-Log-Dateien</h3>
                        <p class="text-[var(--color-text-muted)] leading-relaxed">
                            Der Provider der Seiten erhebt und speichert automatisch Informationen in so genannten Server-Log-Dateien, 
                            die Ihr Browser automatisch an uns übermittelt. Dies sind:
                        </p>
                        <ul class="list-disc list-inside text-[var(--color-text-muted)] mt-2 mb-4 ml-4">
                            <li>Browsertyp und Browserversion</li>
                            <li>Verwendetes Betriebssystem</li>
                            <li>Referrer URL</li>
                            <li>Hostname des zugreifenden Rechners</li>
                            <li>Uhrzeit der Serveranfrage</li>
                            <li>IP-Adresse</li>
                        </ul>
                        <p class="text-[var(--color-text-muted)] leading-relaxed">
                            Eine Zusammenführung dieser Daten mit anderen Datenquellen wird nicht vorgenommen. 
                            Die Erfassung dieser Daten erfolgt auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. Der Websitebetreiber hat ein berechtigtes 
                            Interesse an der technisch fehlerfreien Darstellung und der Optimierung seiner Website - hierzu müssen die Server-Log-Files erfasst werden.
                        </p>

                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Registrierung auf dieser Website</h3>
                        <p class="text-[var(--color-text-muted)] leading-relaxed">
                            Sie können sich auf dieser Website registrieren, um zusätzliche Funktionen auf der Seite zu nutzen. Die dazu eingegebenen Daten 
                            verwenden wir nur zum Zwecke der Nutzung des jeweiligen Angebotes oder Dienstes, für den Sie sich registriert haben. 
                            Die bei der Registrierung abgefragten Pflichtangaben müssen vollständig angegeben werden. Anderenfalls werden wir die Registrierung ablehnen.
                            Für wichtige Änderungen etwa beim Angebotsumfang oder bei technisch notwendigen Änderungen nutzen wir die bei der Registrierung 
                            angegebene E-Mail-Adresse, um Sie auf diesem Wege zu informieren.<br>
                            Die Verarbeitung der bei der Registrierung eingegebenen Daten erfolgt zum Zwecke der Durchführung des durch die Registrierung 
                            begründeten Nutzungsverhältnisses und ggf. zur Anbahnung weiterer Verträge (Art. 6 Abs. 1 lit. b DSGVO).
                        </p>
                    </section>

                    <!-- 5. Plugins und Tools -->
                    <section>
                        <h2 class="text-2xl font-semibold text-[var(--color-text)] mb-6 pb-2 border-b border-[var(--color-border)]">5. Plugins und Tools</h2>
                        
                        <h3 class="text-xl font-medium text-[var(--color-text)] mt-6 mb-3">Google Fonts (Web Fonts)</h3>
                        <p class="text-[var(--color-text-muted)] leading-relaxed">
                            Diese Seite nutzt zur einheitlichen Darstellung von Schriftarten so genannte Web Fonts, die von Google bereitgestellt werden. 
                            Beim Aufruf einer Seite lädt Ihr Browser die benötigten Web Fonts in ihren Browsercache, um Texte und Schriftarten korrekt anzuzeigen.<br>
                            Zu diesem Zweck muss der von Ihnen verwendete Browser Verbindung zu den Servern von Google aufnehmen. Hierdurch erlangt Google Kenntnis darüber, 
                            dass über Ihre IP-Adresse diese Website aufgerufen wurde. Die Nutzung von Google Fonts erfolgt auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. 
                            Der Websitebetreiber hat ein berechtigtes Interesse an der einheitlichen Darstellung des Schriftbildes auf seiner Website. 
                            Sofern eine entsprechende Einwilligung abgefragt wurde, erfolgt die Verarbeitung ausschließlich auf Grundlage von Art. 6 Abs. 1 lit. a DSGVO.<br><br>
                            Weitere Informationen zu Google Fonts finden Sie unter <a href="https://developers.google.com/fonts/faq" target="_blank" class="text-linke hover:underline">https://developers.google.com/fonts/faq</a> 
                            und in der Datenschutzerklärung von Google: <a href="https://policies.google.com/privacy?hl=de" target="_blank" class="text-linke hover:underline">https://policies.google.com/privacy?hl=de</a>.
                        </p>
                    </section>

                    <!-- 6. Rechte -->
                    <section>
                        <h2 class="text-2xl font-semibold text-[var(--color-text)] mb-6 pb-2 border-b border-[var(--color-border)]">6. Ihre Rechte</h2>
                        
                        <div class="grid gap-4 mt-6">
                            <div class="bg-[var(--color-surface-raised)] rounded-xl p-5 border border-[var(--color-border)]">
                                <h4 class="text-[var(--color-text)] font-medium mb-2">Recht auf Auskunft</h4>
                                <p class="text-[var(--color-text-muted)] text-sm">
                                    Sie haben im Rahmen der geltenden gesetzlichen Bestimmungen jederzeit das Recht auf unentgeltliche Auskunft über Ihre 
                                    gespeicherten personenbezogenen Daten, deren Herkunft und Empfänger und den Zweck der Datenverarbeitung und ggf. 
                                    ein Recht auf Berichtigung oder Löschung dieser Daten.
                                </p>
                            </div>
                            <div class="bg-[var(--color-surface-raised)] rounded-xl p-5 border border-[var(--color-border)]">
                                <h4 class="text-[var(--color-text)] font-medium mb-2">Recht auf Einschränkung der Verarbeitung</h4>
                                <p class="text-[var(--color-text-muted)] text-sm">
                                    Sie haben das Recht, die Einschränkung der Verarbeitung Ihrer personenbezogenen Daten zu verlangen. 
                                    Dies gilt in bestimmten Situationen, z.B. wenn Sie die Richtigkeit Ihrer bei uns gespeicherten Daten bestreiten.
                                </p>
                            </div>
                            <div class="bg-[var(--color-surface-raised)] rounded-xl p-5 border border-[var(--color-border)]">
                                <h4 class="text-[var(--color-text)] font-medium mb-2">Widerruf Ihrer Einwilligung</h4>
                                <p class="text-[var(--color-text-muted)] text-sm">
                                    Viele Datenverarbeitungsvorgänge sind nur mit Ihrer ausdrücklichen Einwilligung möglich. Sie können eine bereits erteilte 
                                    Einwilligung jederzeit widerrufen. Die Rechtmäßigkeit der bis zum Widerruf erfolgten Datenverarbeitung bleibt vom Widerruf unberührt.
                                </p>
                            </div>
                            <div class="bg-[var(--color-surface-raised)] rounded-xl p-5 border border-[var(--color-border)]">
                                <h4 class="text-[var(--color-text)] font-medium mb-2">Beschwerderecht</h4>
                                <p class="text-[var(--color-text-muted)] text-sm">
                                    Im Falle von Verstößen gegen die DSGVO steht den Betroffenen ein Beschwerderecht bei einer Aufsichtsbehörde zu, 
                                    insbesondere in dem Mitgliedstaat ihres gewöhnlichen Aufenthalts, ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes.
                                </p>
                            </div>
                        </div>
                    </section>

                </div>

                <div class="mt-12 pt-8 border-t border-[var(--color-border)]">
                    <p class="text-[var(--color-text-muted)] text-sm">
                        Stand: Januar 2026
                    </p>
                </div>
            </div>
        </div>
    `,
})
export class DatenschutzComponent {
    auth = inject(AuthService);
    backLink = computed(() => {
        if (!this.auth.user()) return '/';
        const slug = localStorage.getItem('lastOrgSlug');
        return slug ? `/${slug}/dashboard` : '/organisationen';
    });
}
