/**
 * Vertrauensaussagen der Website. Jede Aussage muss belegbar sein; die Quelle steht im Kommentar.
 * Absolute Versprechen („100 % DSGVO-konform“, „100 % sicher“) bewusst nicht verwenden: nicht nachweisbar, wettbewerbsrechtlich riskant.
 */
export const VERTRAUEN = [
  {
    icon: 'pi-server',
    titel: 'Gehostet in Deutschland',
    text: 'Anwendung, Datenbank und Dateien liegen auf Servern der Hetzner Online GmbH im Rechenzentrum Nürnberg. Wir betreiben die Software selbst.',
    // Quelle: Datenschutzerklärung, Abschnitt 3
  },
  {
    icon: 'pi-mobile',
    titel: 'Keine Telefonnummern nötig',
    text: 'Anmeldung per E-Mail und Magic Link. Anders als in Messenger-Gruppen sieht niemand automatisch die Nummern aller anderen.',
    // Quelle: Login per E-Mail (Handbuch „Erste Schritte“)
  },
  {
    icon: 'pi-ban',
    titel: 'Kein Tracking, keine Werbung',
    text: 'Keine Tracking-Cookies, keine Analyse- oder Werbedienste Dritter. Eure Daten werden nicht verkauft und nicht für Werbung genutzt.',
    // Quelle: Datenschutzerklärung, Abschnitte 5 und 13
  },
  {
    icon: 'pi-file-check',
    titel: 'Auftragsverarbeitung nach Art. 28 DSGVO',
    text: 'Für die Daten innerhalb eurer Organisation handeln wir als Auftragsverarbeiter. Ihr bleibt verantwortlich und behaltet die Kontrolle.',
    // Quelle: Datenschutzerklärung, Abschnitt 2
  },
  {
    icon: 'pi-lock',
    titel: 'Verschlüsselt und gesichert',
    text: 'Verbindungen per TLS, Passwörter nur als bcrypt-Hash, tägliche Datensicherung. Rollen und Rechte steuern, wer was sieht.',
    // Quelle: Datenschutzerklärung, Abschnitt 3; Rollenkonzept im Handbuch
  },
  {
    icon: 'pi-github',
    titel: 'Open Source (AGPLv3)',
    text: 'Der Quellcode ist offen lizenziert. Ihr müsst uns nicht blind vertrauen, und eure Daten könnt ihr jederzeit exportieren.',
    // Quelle: LICENSE (AGPLv3), Datenexport im Profil der App
  },
] as const;

/** Kurzform für die Leiste unter dem Hero */
export const VERTRAUEN_KURZ = ['Gehostet in Deutschland', 'Keine Telefonnummern nötig', 'Kein Tracking', 'Open Source'];
