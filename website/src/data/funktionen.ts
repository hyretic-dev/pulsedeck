import type { ImageMetadata } from 'astro';
import dashboard from '../assets/screenshots/dashboard.webp';
import helferschichten from '../assets/screenshots/helferschichten.webp';
import termine from '../assets/screenshots/termine.webp';
import wiki from '../assets/screenshots/wiki.webp';
import feed from '../assets/screenshots/feed.webp';
import gruppen from '../assets/screenshots/gruppen.webp';
import dateien from '../assets/screenshots/dateien.webp';

export interface Funktion {
  slug: string;
  /** Kurzname für Menüs */
  name: string;
  icon: string;
  /** Nutzen zuerst: H2 auf der Startseite, H1 auf der Funktionsseite */
  titel: string;
  /** Ein Satz für Karten und Meta-Beschreibung (≤ 155 Zeichen) */
  kurz: string;
  text: string;
  punkte: string[];
  bild: ImageMetadata;
  bildAlt: string;
  /** Hochformat (Dialog-Ausschnitt) statt Bildschirmfoto im Querformat */
  hochformat?: boolean;
  /** Passendes Handbuch-Kapitel */
  handbuch: string;
  /** Suchbegriffe, für die die Funktionsseite gedacht ist */
  seoTitel: string;
}

/** Funktionsumfang laut Handbuch und Code; nichts hier aufnehmen, was die App nicht kann. */
export const FUNKTIONEN: Funktion[] = [
  {
    slug: 'helferplanung',
    name: 'Helferplanung',
    icon: 'pi-check-square',
    titel: 'Helferschichten, in die sich alle selbst eintragen',
    kurz: 'Schichten mit festen Plätzen an jedem Termin: Mitglieder tragen sich mit einem Klick ein, Lücken sind sofort sichtbar.',
    text: 'Statt „Wer kann?“ im Chat legt ihr an jedem Termin Schichten an: Aufgabe, Uhrzeit, Zahl der Plätze und auf Wunsch die passenden Fähigkeiten. Mitglieder tragen sich selbst ein und können sich wieder austragen, volle Schichten sind voll, freie Plätze sieht jeder.',
    punkte: ['Schichten mit Uhrzeit und Platzzahl', 'Selbsteintragung mit Notiz („bringe Pavillon mit“)', 'Gewünschte Fähigkeiten je Schicht', 'Offene Schichten erscheinen im Dashboard'],
    bild: helferschichten,
    bildAlt: 'Helferschichten für ein Sommerfest in PulseDeck: Aufbau 5 von 6 Plätzen belegt, Grill voll, Getränke 1 von 2',
    hochformat: true,
    handbuch: '/handbuch/kalender-events',
    seoTitel: 'Helferplanung für Vereine: Schichten online verteilen',
  },
  {
    slug: 'termine',
    name: 'Termine',
    icon: 'pi-calendar',
    titel: 'Termine mit Zusagen, im eigenen Kalender abonnierbar',
    kurz: 'Alle Termine eurer Organisation an einem Ort, mit Zu- und Absagen, Arbeitsgruppen und Abo für Google, Outlook oder das Handy.',
    text: 'Vom Training bis zur Jahreshauptversammlung: Termine stehen in einem gemeinsamen Kalender, Mitglieder sagen mit einem Klick zu. Wer will, abonniert den Vereinskalender in seiner Kalender-App. Termine können eine öffentliche Seite bekommen, die ihr teilen könnt, auch in eure WhatsApp-Gruppe.',
    punkte: ['Zu- und Absagen mit Teilnehmerübersicht', 'Kalender-Abo (iCal) für Google, Outlook, Apple', 'Öffentliche Terminseite zum Teilen', 'Befreundete Organisationen als Gäste einladen'],
    bild: termine,
    bildAlt: 'Terminübersicht in PulseDeck mit Training, Redaktionstreffen, Arbeitseinsatz und Jahreshauptversammlung',
    handbuch: '/handbuch/kalender-events',
    seoTitel: 'Vereinskalender mit Zusagen und Kalender-Abo',
  },
  {
    slug: 'vereinswiki',
    name: 'Wiki & Wissen',
    icon: 'pi-book',
    titel: 'Vereinswissen, das den nächsten Vorstandswechsel überlebt',
    kurz: 'Abläufe, Anleitungen und Protokolle in einem Wiki, sortiert nach Kategorien und Arbeitsgruppen, mit Rechten je Rolle.',
    text: 'Wie läuft das Sommerfest, wer hat welchen Schlüssel, was steht in der Satzung? Im Wiki haltet ihr fest, wie euer Verein funktioniert. Artikel lassen sich Kategorien und Arbeitsgruppen zuordnen und nur für bestimmte Rollen freigeben. Auf Wunsch beantwortet ein KI-Assistent Fragen auf Grundlage eurer Dokumente.',
    punkte: ['Artikel nach Kategorien und Arbeitsgruppen', 'Sichtbarkeit je Rolle', 'Optionaler KI-Assistent für Fragen zu euren Dokumenten', 'Arbeitsgruppen pflegen ihre Inhalte selbst'],
    bild: wiki,
    bildAlt: 'Wiki-Artikel „Sommerfest von A bis Z“ mit Zeitplan in PulseDeck',
    handbuch: '/handbuch/dateien-wiki',
    seoTitel: 'Vereinswiki: Wissen im Verein sichern',
  },
  {
    slug: 'kommunikation',
    name: 'Feed & Umfragen',
    icon: 'pi-megaphone',
    titel: 'Ankündigungen, die nicht im Chatverlauf untergehen',
    kurz: 'Ein Feed für Wichtiges, Umfragen für schnelle Meinungsbilder und Newsletter per E-Mail, ohne 300 Nachrichten zu lesen.',
    text: 'Wichtiges steht im Feed und bleibt dort auffindbar, auch nach Wochen. Für schnelle Meinungsbilder gibt es Umfragen, für alle, die lieber Mails lesen, den Newsletter im Design eurer Organisation. Beiträge lassen sich Arbeitsgruppen zuordnen und vor der Veröffentlichung prüfen.',
    punkte: ['Feed mit Beiträgen und Umfragen', 'E-Mail-Newsletter über euren eigenen Mailserver', 'Beiträge je Arbeitsgruppe filtern', 'Freigabe vor der Veröffentlichung'],
    bild: feed,
    bildAlt: 'Feed in PulseDeck mit einer Umfrage zum Motto des Sommerfests',
    handbuch: '/handbuch/kommunikation',
    seoTitel: 'Vereinskommunikation: Feed, Umfragen und Newsletter',
  },
  {
    slug: 'arbeitsgruppen',
    name: 'Arbeitsgruppen',
    icon: 'pi-users',
    titel: 'Arbeitsgruppen mit eigenen Terminen und Dokumenten',
    kurz: 'Festausschuss, Jugend, Öffentlichkeitsarbeit: jede Gruppe mit Mitgliedern, Terminen, Dokumenten und Zuständigen.',
    text: 'Arbeitsgruppen geben Neuen einen überschaubaren Einstieg und den Aktiven einen eigenen Raum. Jede Gruppe hat ihre Mitglieder, Termine und angepinnten Dokumente. Mitglieder treten selbst bei und sehen danach die passenden Termine.',
    punkte: ['Beitreten und Verlassen per Klick', 'Termine und Dateien je Gruppe', 'Leitung pflegt Inhalte der Gruppe', 'Sichtbarkeit nur für Gruppenmitglieder möglich'],
    bild: gruppen,
    bildAlt: 'Arbeitsgruppen in PulseDeck: Festausschuss, Jugendabteilung, Platz & Technik, Öffentlichkeitsarbeit',
    handbuch: '/handbuch/mitglieder-gruppen',
    seoTitel: 'Arbeitsgruppen im Verein organisieren',
  },
  {
    slug: 'dateien',
    name: 'Dateien',
    icon: 'pi-folder',
    titel: 'Dokumente an einem Ort, mit Rechten statt Mailanhängen',
    kurz: 'Satzung, Protokolle und Vorlagen in Ordnern, mit Sichtbarkeit je Rolle oder Arbeitsgruppe und angepinnten Downloads.',
    text: 'Keine abgelaufenen Transfer-Links und keine fünf Versionen im Postfach: Dateien liegen in Ordnern, die aktuelle Fassung findet jeder. Für jede Datei legt ihr fest, wer sie sehen darf. Häufig gebrauchte Downloads pinnt ihr oben an.',
    punkte: ['Ordner und angepinnte Dateien', 'Sichtbarkeit: alle Mitglieder, Vorstand, Admins oder eine Arbeitsgruppe', 'Hochladen per Drag & Drop', 'PDFs und Texte durchsucht der KI-Assistent mit, wenn er aktiv ist'],
    bild: dateien,
    bildAlt: 'Dateiablage in PulseDeck mit Satzung, Protokoll und Hallenplan',
    handbuch: '/handbuch/dateien-wiki',
    seoTitel: 'Dateiablage für Vereine mit Zugriffsrechten',
  },
];

export const DASHBOARD_BILD = dashboard;
