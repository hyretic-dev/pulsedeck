export interface Zielgruppe {
  slug: 'vereine' | 'parteien' | 'initiativen';
  name: string;
  icon: string;
  seoTitel: string;
  beschreibung: string;
  h1: string;
  intro: string;
  probleme: Array<{ titel: string; text: string }>;
  /** Funktionen (Slugs aus funktionen.ts) in der Reihenfolge, die für diese Gruppe zählt */
  funktionen: string[];
  /** Ein typischer Ablauf, ausdrücklich als Beispiel gekennzeichnet (kein Kundenzitat) */
  beispiel: { titel: string; schritte: string[] };
  artikel: Array<{ titel: string; pfad: string }>;
}

export const ZIELGRUPPEN: Zielgruppe[] = [
  {
    slug: 'vereine',
    name: 'Vereine',
    icon: 'pi-flag',
    seoTitel: 'Vereinsapp für Helfer, Termine und Vereinswissen',
    beschreibung: 'PulseDeck für Sport-, Kultur- und Fördervereine: Helferschichten, Termine mit Zusagen, Vereinswiki und Dateien an einem Ort. Gehostet in Deutschland.',
    h1: 'Die Vereinsapp für alles, was im Chat untergeht',
    intro: 'Sommerfest, Arbeitseinsatz, Jahreshauptversammlung: Im Verein hängt fast alles an Ehrenamtlichen. PulseDeck sorgt dafür, dass alle wissen, wann sie wo gebraucht werden, und dass Wissen nicht mit dem Vorstand geht.',
    probleme: [
      { titel: 'Immer dieselben helfen', text: 'Aufrufe im Chat erreichen alle und verpflichten niemanden. Am Ende stehen wieder die Gleichen am Grill.' },
      { titel: 'Termine gehen unter', text: 'Zwischen Glückwünschen und Fotos ist die Einladung zur Versammlung nach zwei Tagen weg.' },
      { titel: 'Wissen hängt an Köpfen', text: 'Wer weiß, wo der Schlüssel liegt und wann man Getränke bestellt? Spätestens beim Vorstandswechsel fehlt es.' },
    ],
    funktionen: ['helferplanung', 'termine', 'vereinswiki', 'kommunikation', 'arbeitsgruppen', 'dateien'],
    beispiel: {
      titel: 'Beispiel: das Sommerfest eines Sportvereins',
      schritte: [
        'Der Festausschuss legt das Sommerfest als Termin an und darunter die Schichten: Aufbau, Grill, Kasse, Kinderprogramm, Abbau.',
        'Die Ankündigung geht in den Feed und per E-Mail, der Link zusätzlich in die bestehende WhatsApp-Gruppe.',
        'Mitglieder tragen sich selbst ein. Zwei Wochen vorher sind nur noch der Abbau und eine Kassenschicht offen, der Festausschuss fragt gezielt nach.',
        'Nach dem Fest landen Mengen, Lieferanten und Verbesserungen im Wiki, damit das nächste Fest schneller steht.',
      ],
    },
    artikel: [
      { titel: 'Helferplan für das Vereinsfest: Vorlage und Ablauf', pfad: '/blog/helferplan-vereinsfest' },
      { titel: 'Vorstandswechsel im Verein: Checkliste', pfad: '/blog/vorstandswechsel-verein-checkliste' },
      { titel: 'WhatsApp im Verein: Was ist erlaubt?', pfad: '/blog/whatsapp-im-verein' },
    ],
  },
  {
    slug: 'parteien',
    name: 'Ortsverbände',
    icon: 'pi-building-columns',
    seoTitel: 'Software für Ortsverbände: Wahlkampf und Mitglieder',
    beschreibung: 'PulseDeck für Orts- und Kreisverbände: Infostände und Plakatieren als Schichten, Termine, Wissen und Rollen für politische Daten. Gehostet in Deutschland.',
    h1: 'Ortsverband und Wahlkampf organisieren, ohne Chat-Chaos',
    intro: 'Infostände, Plakatier-Touren, Mitgliederversammlungen: In Orts- und Kreisverbänden entscheidet Organisation darüber, wie viele Aktive wirklich auf der Straße stehen. PulseDeck macht Einsätze planbar und schützt dabei besonders sensible Daten.',
    probleme: [
      { titel: 'Wahlkampf in Chatgruppen', text: '„Wer kann Samstag an den Stand?“ Vier sagen zu, drei ab, am Ende fehlt die Hälfte.' },
      { titel: 'Politische Daten sind sensibel', text: 'Wer Mitglied einer Partei ist, verrät eine politische Meinung (Art. 9 DSGVO). Offene Gruppen mit Telefonnummern passen dazu schlecht.' },
      { titel: 'Jedes Jahr von vorn', text: 'Wo dürfen Plakate hängen, wer liefert, welche Standorte funktionieren? Das Wissen steckt in wenigen Köpfen.' },
    ],
    funktionen: ['helferplanung', 'termine', 'arbeitsgruppen', 'vereinswiki', 'kommunikation', 'dateien'],
    beispiel: {
      titel: 'Beispiel: Infostände im Kommunalwahlkampf',
      schritte: [
        'Die Wahlkampfleitung legt für jeden Infostand einen Termin mit Schichten an, Plakatier-Touren als eigene Termine mit einer Schicht je Gebiet.',
        'Aktive tragen sich selbst ein. Über Rollen legt ihr fest, wer welche Termine, Dokumente und Wiki-Artikel sieht.',
        'Offene Schichten mit passenden Fähigkeiten schlägt das Dashboard den Aktiven gezielt vor.',
        'Nach der Wahl hält das Wiki fest, welche Standorte und Abläufe sich bewährt haben.',
      ],
    },
    artikel: [
      { titel: 'Ortsverband digital organisieren', pfad: '/blog/ortsverband-digital-organisieren' },
      { titel: 'Schichtplan für Ehrenamtliche', pfad: '/blog/schichtplan-ehrenamt' },
      { titel: 'Online-Mitgliederversammlung nach § 32 BGB', pfad: '/blog/online-mitgliederversammlung' },
    ],
  },
  {
    slug: 'initiativen',
    name: 'Initiativen & NGOs',
    icon: 'pi-heart',
    seoTitel: 'Software für Initiativen, NGOs und Bündnisse',
    beschreibung: 'PulseDeck für Initiativen, NGOs und Aktionsbündnisse: Aktionen planen, Aktive einbinden, Wissen sichern. Ohne Telefonnummern, gehostet in Deutschland.',
    h1: 'Aktive einbinden, Aktionen planen, Wissen halten',
    intro: 'Initiativen und Bündnisse leben von Menschen, die mal mehr und mal weniger Zeit haben. PulseDeck macht es leicht, mitzumachen: konkrete Aufgaben statt allgemeiner Aufrufe, und alles Wichtige an einem Ort.',
    probleme: [
      { titel: 'Engagement ohne Einstieg', text: 'Neue wollen helfen, wissen aber nicht wo. Ohne konkrete Aufgaben verliert ihr sie nach dem ersten Treffen.' },
      { titel: 'Viele Gruppen, keine Übersicht', text: 'Jede Arbeitsgruppe hat ihren eigenen Chat. Was die anderen planen, erfährt man zufällig.' },
      { titel: 'Datenschutz als Anspruch', text: 'Wer sich für eine Sache engagiert, will nicht, dass die eigene Nummer in zehn Gruppen landet.' },
    ],
    funktionen: ['helferplanung', 'arbeitsgruppen', 'kommunikation', 'termine', 'vereinswiki', 'dateien'],
    beispiel: {
      titel: 'Beispiel: eine Aktionswoche im Bündnis',
      schritte: [
        'Jede beteiligte Gruppe bekommt eine Arbeitsgruppe; befreundete Organisationen lassen sich als Gäste zu Terminen einladen.',
        'Aktionen stehen als Termine mit Schichten im Kalender, Material und Vorlagen liegen in der Dateiablage.',
        'Neue Aktive starten mit einer kleinen Schicht und finden im Wiki, wie das Bündnis arbeitet.',
        'Ein Meinungsbild zum nächsten Thema holt ihr per Umfrage im Feed.',
      ],
    },
    artikel: [
      { titel: 'Ehrenamtliche gewinnen und halten', pfad: '/blog/ehrenamtliche-gewinnen-halten' },
      { titel: 'WhatsApp-Alternativen im Vergleich', pfad: '/blog/whatsapp-alternativen-verein' },
      { titel: 'Vereinswiki aufbauen', pfad: '/blog/vereinswiki-aufbauen' },
    ],
  },
];
