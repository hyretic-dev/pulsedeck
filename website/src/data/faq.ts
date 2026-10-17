/**
 * Häufige Fragen (Startseite, /faq, /preise). Nur belegbare Antworten; Preise und Grenzen wie in der App umgesetzt.
 * Early Access: alle Funktionen kostenlos, max_members 9999 (Migration 000017). Dauerhaft kostenloser Tarif danach: bis 10 Mitglieder.
 */
export interface Frage {
  frage: string;
  antwort: string;
}

export const FAQ_ALLGEMEIN: Frage[] = [
  {
    frage: 'Ersetzt PulseDeck unsere WhatsApp-Gruppe?',
    antwort: 'Nein, und das muss es auch nicht. Für den schnellen Austausch könnt ihr euren Messenger behalten. PulseDeck übernimmt das, was im Chat untergeht: Termine mit Zusagen, Helferschichten, Ankündigungen, Umfragen, Dokumente und Vereinswissen.',
  },
  {
    frage: 'Was kostet PulseDeck?',
    antwort: 'Während des Early Access nichts: Alle Funktionen sind kostenlos. Danach bleibt ein dauerhaft kostenloser Tarif für Organisationen bis 10 Mitglieder. Für größere Organisationen kommen faire, transparente Staffelpreise; wer im Early Access dabei ist, erfährt die Preise rechtzeitig vorher und entscheidet dann selbst.',
  },
  {
    frage: 'Wo liegen unsere Daten?',
    antwort: 'Auf Servern der Hetzner Online GmbH im Rechenzentrum Nürnberg. Wir betreiben die Software selbst. Für die Daten eurer Organisation handeln wir als Auftragsverarbeiter nach Art. 28 DSGVO. Einzelheiten stehen in der Datenschutzerklärung.',
  },
  {
    frage: 'Müssen unsere Mitglieder eine App installieren?',
    antwort: 'Nein. PulseDeck läuft im Browser auf Handy, Tablet und Computer. Angemeldet wird per E-Mail, eine Telefonnummer braucht niemand. Benachrichtigungen kommen auf Wunsch als Push-Nachricht im Browser.',
  },
  {
    frage: 'Kann PulseDeck Mitgliedsbeiträge und SEPA-Lastschriften?',
    antwort: 'Nein. Beiträge, SEPA und Buchhaltung können Vereinsverwaltungsprogramme besser. PulseDeck ist für das Miteinander gedacht und lässt sich gut mit einer Verwaltungssoftware kombinieren.',
  },
  {
    frage: 'Gibt es KI in PulseDeck?',
    antwort: 'Optional. Ein KI-Assistent beantwortet Fragen zur Bedienung und, wenn ihr Dokumente hochladet, zu euren eigenen Unterlagen. Er nutzt Modelle der Mistral AI aus Paris mit Verarbeitung in der EU und ist freiwillig.',
  },
  {
    frage: 'Wie schnell sind wir startklar?',
    antwort: 'Registrierung mit Name, E-Mail und Name der Organisation, dann die E-Mail bestätigen. Danach legt ihr den ersten Termin an und ladet Mitglieder per E-Mail oder Link ein.',
  },
];

export const FAQ_PREISE: Frage[] = [
  {
    frage: 'Gibt es im Early Access ein Mitgliederlimit?',
    antwort: 'Nein. Im Early Access nutzt ihr alle Funktionen kostenlos, auch mit mehr als 10 Mitgliedern. Die Grenze von 10 Mitgliedern gilt erst für den dauerhaft kostenlosen Tarif nach dem Early Access.',
  },
  {
    frage: 'Was passiert, wenn der Early Access endet?',
    antwort: 'Wir kündigen das Ende und die Preise rechtzeitig per E-Mail an. Organisationen bis 10 Mitglieder nutzen PulseDeck weiter kostenlos. Größere Organisationen wählen einen der Staffelpreise oder exportieren ihre Daten. Ohne eure Zustimmung wird nichts kostenpflichtig.',
  },
  {
    frage: 'Brauchen wir eine Kreditkarte?',
    antwort: 'Nein. Für die Registrierung braucht ihr nur Name, E-Mail-Adresse und den Namen eurer Organisation.',
  },
  {
    frage: 'Können wir unsere Daten mitnehmen?',
    antwort: 'Ja. Jedes Mitglied kann seine Daten im Profil exportieren. Bei Fragen zum Export der gesamten Organisation schreibt uns.',
  },
];

export const FAQ_SICHERHEIT: Frage[] = [
  {
    frage: 'Ist PulseDeck DSGVO-konform?',
    antwort: 'PulseDeck ist auf die DSGVO ausgelegt: Hosting in Deutschland, Auftragsverarbeitung nach Art. 28 DSGVO, keine Tracking- oder Werbedienste, Datensparsamkeit bei der Anmeldung. Ob euer Einsatz insgesamt datenschutzkonform ist, hängt auch davon ab, wie ihr ihn gestaltet, etwa welche Daten ihr erfasst und wer welche Rolle hat.',
  },
  {
    frage: 'Wer kann die Daten unserer Organisation sehen?',
    antwort: 'Nur Mitglieder eurer Organisation, und zwar nach den Rollen und Rechten, die ihr festlegt. Dateien, Wiki-Artikel und Beiträge lassen sich auf bestimmte Rollen oder Arbeitsgruppen beschränken.',
  },
  {
    frage: 'Was passiert mit unseren Daten, wenn wir die KI nutzen?',
    antwort: 'Der KI-Assistent ist optional. Wenn ihr ihn nutzt, verarbeitet Mistral AI aus Paris die Anfragen in der EU als Auftragsverarbeiter. Übermittelt werden nur Auszüge aus Dokumenten, die die fragende Person selbst sehen darf; die Rechte werden vorher geprüft. Einzelheiten stehen in Abschnitt 9 der Datenschutzerklärung.',
  },
  {
    frage: 'Wie melde ich eine Sicherheitslücke?',
    antwort: 'Bitte per E-Mail an kontakt@pulsedeck.de mit dem Betreff „Sicherheit“. Die Kontaktangabe steht auch maschinenlesbar in /.well-known/security.txt.',
  },
];
