# Redaktionsplan pulsedeck.de (SEO und KI-Suche)

Stand: 17.10.2026. Grundlage: Recherche der Suchergebnisse zu den Kernthemen (Quellen unten), Funktionsumfang laut Handbuch.
**Grenze dieser Recherche:** Es lagen keine Suchvolumen-Daten vor (kein Zugriff auf Keyword-Planner, Sistrix, Ahrefs o. ä.). Die
Prioritäten unten folgen aus Suchintention, Wettbewerb in den Ergebnissen und Passung zum Produkt. Vor dem Schreiben jedes
Beitrags das Hauptkeyword mit Google Keyword Planner oder der Search Console prüfen und die Reihenfolge danach anpassen.

## 1. Positionierung: wo PulseDeck gewinnen kann

Die Suchergebnisse zu „Vereinssoftware“ und „Vereinsverwaltung“ werden von Vergleichsportalen (trusted.de, drweb.de, OMR Reviews)
und etablierten Anbietern (easyVerein, Vereinsplaner, WISO MeinVerein, campai) besetzt. Deren Schwerpunkt: Beiträge,
SEPA-Lastschrift, Buchhaltung. **PulseDeck hat davon nichts – und soll dort nicht frontal konkurrieren.**

Lücken, die PulseDeck besetzen kann:

1. **WhatsApp-Problem im Verein.** Verbände (Landessportbünde/VIBSS) warnen vor WhatsApp; die Ergebnisse zeigen vor allem
   Anbieter- und Verbandsmaterial, kaum neutrale, praktische Antworten auf „was dann?“. PulseDeck-Kernbotschaft passt exakt.
2. **Helferplanung / Ehrenamtskoordination.** Ergebnisse sind niederländische Tools, Schichtplan-Apps für bezahlte Teams oder
   PDF-Vorlagen. Kaum deutschsprachige Inhalte, die Vorlage *und* digitalen Ablauf verbinden.
3. **Parteigliederungen und Bündnisse.** Für „Ortsverband digital organisieren“ / „Wahlkampfhelfer koordinieren“ liefert die
   Suche fast nur Alt-Dokumente und englische Tools. Sehr dünnes Feld, klare Zielgruppe.
4. **Vereinsgedächtnis / Vorstandswechsel.** Übergabe-Checklisten existieren, aber kaum Inhalte zur laufenden Dokumentation
   (Wiki), die den Wissensverlust verhindert.

Leitbegriffe (aus Startseite und Produkt): *Vereinsapp, Mitgliederaktivierung, Helferplanung/Helferslots, Ehrenamt koordinieren,
WhatsApp-Alternative für Vereine, Vereinswiki, DSGVO/EU-Hosting*.

## 2. Regeln für jeden Beitrag (SEO und KI-Suche)

Antwortmaschinen (ChatGPT, Perplexity, Google AI Overviews, Claude) zitieren pro Frage nur wenige Quellen. Belegt ist vor allem:
klar strukturierte, eigenständige Abschnitte, Quellenangaben und Zahlen erhöhen die Chance, zitiert zu werden (Aggarwal et al.
2024, GEO-Studie; siehe Quellen). Daraus:

- **Antwort zuerst.** Unter dem H1 ein Absatz (2–4 Sätze), der die Suchfrage direkt beantwortet. Das ist der Satz, der zitiert wird.
- **Ein H2 = eine Frage.** Überschriften als Frage oder klare Aussage formulieren; jeder Abschnitt muss ohne den Rest verständlich
  sein (≈ 50–150 Wörter pro Unterabschnitt, dann Liste/Tabelle).
- **Belege statt Behauptungen.** Rechtliche Aussagen immer mit Primärquelle (Gesetzestext, Datenschutzbehörde, Landessportbund)
  und Datum. Keine Rechtsberatung versprechen; Hinweis „keine Rechtsberatung“ bei Rechtsthemen.
- **Eigene Erfahrung zeigen (E-E-A-T).** Beispiele aus echten Organisationen (mit Erlaubnis), Screenshots aus PulseDeck,
  konkrete Abläufe. Autor mit Namen und Rolle (Frontmatter `author`); geplant: Autorenseite.
- **Aktualität.** `date` und bei Überarbeitung `updated` setzen; Jahreszahl nur in den Titel, wenn der Inhalt wirklich jährlich
  aktualisiert wird.
- **FAQ-Block.** 3–5 echte Folgefragen im Frontmatter `faq` (wird angezeigt und als FAQPage ausgezeichnet). Google zeigt seit
  Mai 2026 keine FAQ-Rich-Results mehr, nutzt das Markup aber weiter zum Verständnis; für KI-Suche bleibt das Format nützlich.
- **Interne Links.** Jeder Beitrag verlinkt 1 Pillar, 2 Geschwister-Beiträge und das passende Handbuch-Kapitel; der Pillar
  verlinkt alle Beiträge seines Clusters zurück.
- **Länge nach Intention**, nicht nach Wortzahl. Die ersten Fassungen haben 500–1.000 Wörter plus FAQ; ausgebaut wird, wo die
  Search Console Impressionen ohne Klicks oder Positionen 5–20 zeigt (dann fehlen meist Tiefe, Beispiele oder Antworten auf Folgefragen).
- **Titel ≤ 60 Zeichen, Description 120–155 Zeichen**, Hauptkeyword vorne, Dateiname = Keyword-Slug ohne Stoppwörter.

## 3. Cluster und Beiträge

Spalten: *Intention* I = informierend, V = vergleichend/kommerziell, T = transaktional. *Prio* 1 = zuerst schreiben.

### Cluster A – WhatsApp und Vereinskommunikation (Pillar)

| Prio | Arbeitstitel (H1) | Slug | Hauptkeyword | I | Kern / was ihn zitierfähig macht |
|---|---|---|---|---|---|
| 1 | WhatsApp im Verein: Was ist erlaubt – und was sind die Alternativen? (**Pillar**) | `whatsapp-im-verein` | whatsapp verein datenschutz | I | Rechtslage mit Quellen (DSGVO, Adressbuchabgleich, Hinweise der Landessportbünde), klare Handlungsempfehlung, Entscheidungstabelle |
| 1 | WhatsApp-Alternativen für Vereine: Signal, Threema, Vereinsapps im Vergleich | `whatsapp-alternative-verein` | whatsapp alternative verein | V | Neutrale Vergleichstabelle (Verschlüsselung, Kosten, Serverstandort, Rollen, Termine); ehrlich, wofür ein Messenger reicht |
| 2 | Vereinskommunikation ohne Chat-Chaos: 7 Regeln, die wirklich funktionieren | `vereinskommunikation-regeln` | vereinskommunikation | I | Kanal-Matrix: was gehört in Chat, Feed, Mail, Kalender |
| 3 | Newsletter im Verein: DSGVO-konform versenden – Schritt für Schritt | `newsletter-verein-dsgvo` | newsletter verein dsgvo | I | Einwilligung vs. Mitgliederinformation (Quelle!), Abmeldelink, Versand über eigenen SMTP |

### Cluster B – Helferplanung und Ehrenamt (Pillar)

| Prio | Arbeitstitel (H1) | Slug | Hauptkeyword | I | Kern |
|---|---|---|---|---|---|
| 1 | Helferplan für das Vereinsfest: Vorlage und digitaler Ablauf (**Pillar**) | `helferplan-vereinsfest` | helferplan verein vorlage | I/T | Kostenlose Vorlage (PDF/CSV) + derselbe Ablauf mit Helferslots; Zeitplan „8 Wochen vorher bis Abbau“ |
| 2 | Schichtplan für Ehrenamtliche erstellen: so tragen sich Helfer selbst ein | `schichtplan-ehrenamt` | schichtplan ehrenamt | I | Selbsteintragung, Erinnerungen, Lücken sichtbar machen |
| 2 | Ehrenamtliche gewinnen und halten: was Engagement wirklich antreibt | `ehrenamtliche-motivieren` | ehrenamtliche motivieren | I | Motive laut Sportentwicklungsbericht/Verbandsmaterial (Quellen), Onboarding mit Ansprechperson, Wertschätzung |
| 3 | Vom passiven zum aktiven Mitglied: Mitgliederaktivierung in 5 Schritten | `mitgliederaktivierung` | mitglieder aktivieren verein | I | PulseDeck-Leitbegriff besetzen; Skills im Profil, niedrigschwellige Aufgaben |

### Cluster C – Parteien, Ortsverbände, Bündnisse (Pillar, wenig Wettbewerb)

| Prio | Arbeitstitel (H1) | Slug | Hauptkeyword | I | Kern |
|---|---|---|---|---|---|
| 1 | Ortsverband digital organisieren: Termine, Aufgaben und Wissen an einem Ort (**Pillar**) | `ortsverband-digital-organisieren` | ortsverband organisieren | I | Typischer Jahresablauf eines Ortsverbands, Rollen (Vorstand/AG/Mitglied), Datenschutz bei politischer Mitgliedschaft (Art. 9 DSGVO) |
| 2 | Wahlkampf-Helfer koordinieren: Infostände, Plakate, Haustür | `wahlkampf-helfer-koordinieren` | wahlkampf helfer organisieren | I | Schichten für Infostände, Plakatierrouten, Rückmeldungen; Checkliste |
| 2 | Aktionsbündnis organisieren: Zusammenarbeit ohne Vereinsstruktur | `aktionsbuendnis-organisieren` | bündnis organisieren | I | Mehrere Organisationen, AGs, gemeinsame Termine, wer darf was sehen |
| 3 | Politische Mitgliedsdaten schützen: was Parteigliederungen beachten müssen | `parteimitglieder-datenschutz` | partei mitgliederdaten datenschutz | I | Art. 9 DSGVO (besondere Kategorien) mit Quelle; keine Rechtsberatung |

### Cluster D – Vereinsgedächtnis und Organisation

| Prio | Arbeitstitel (H1) | Slug | Hauptkeyword | I | Kern |
|---|---|---|---|---|---|
| 1 | Vorstandswechsel ohne Wissensverlust: Übergabe-Checkliste für Vereine | `vorstandswechsel-checkliste` | vorstandswechsel verein checkliste | I/T | Checkliste (Verträge, Fristen, Zugänge, Register, Bank – Quellen: Paritätischer BW, Verbandsbüro), plus laufende Doku im Wiki |
| 2 | Vereinswiki aufbauen: welche Inhalte hineingehören und wie es lebendig bleibt | `vereinswiki-aufbauen` | vereinswiki | I | Struktur-Vorlage (Satzung, Protokolle, How-tos, Kontakte), Zuständigkeiten |
| 3 | Mitgliederliste in Excel: Risiken und bessere Wege | `mitgliederliste-excel` | mitgliederliste excel verein | I | Versionschaos, Weitergabe per Mail, DSGVO-Pflichten (Zugriff, Löschung, Export) |
| 3 | Online-Mitgliederversammlung: was § 32 BGB seit 2023 erlaubt | `online-mitgliederversammlung` | virtuelle mitgliederversammlung verein | I | Seit 21.03.2023 hybride Versammlungen per Einladung; rein virtuell nur unter Bedingungen – Quellen widersprechen sich in Details, daher Gesetzestext zitieren und Satzung prüfen lassen |

### Cluster E – Produkt und Entscheidung (Bottom of Funnel)

| Prio | Arbeitstitel (H1) | Slug | Hauptkeyword | I | Kern |
|---|---|---|---|---|---|
| 2 | Vereinsapp oder Vereinsverwaltung? Welche Software euer Verein wirklich braucht | `vereinsapp-oder-vereinsverwaltung` | vereinsapp | V | Ehrliche Abgrenzung: Buchhaltung/SEPA → Verwaltungssoftware; Engagement/Termine/Wissen → PulseDeck; beides kombinierbar |
| 2 | WhatsApp-Gruppe vs. PulseDeck: ein Sommerfest, zwei Wege | `whatsapp-gruppe-vs-pulsedeck` | – | V | Konkreter Vergleich an einem echten Ablauf, Screenshots |
| 3 | Warum PulseDeck in Deutschland gehostet wird – und was das für euch heißt | `hosting-deutschland-dsgvo` | vereinssoftware hosting deutschland | V | Hetzner/Nürnberg, AVV, Open Source (AGPLv3), Datenexport |
| laufend | Produkt-Neuigkeiten (Release-Notes) | `neu-in-pulsedeck-<monat>` | – | – | Monatlich; zeigt Aktivität, stärkt Aktualitätssignale |

**Reihenfolge für die ersten 8 Wochen** (2 Beiträge/Woche wären ideal, 1 ist das Minimum): A-Pillar → B-Pillar → C-Pillar →
WhatsApp-Alternativen → Vorstandswechsel-Checkliste → Ortsverband/Wahlkampf → Schichtplan → Vereinsapp-oder-Verwaltung.

## 3a. Stand: geschrieben (17.10.2026)

| Beitrag | Cluster | Art |
|---|---|---|
| [WhatsApp im Verein: Was ist erlaubt?](/blog/whatsapp-im-verein) | A (Pillar) | Ratgeber, Recht |
| [WhatsApp-Alternativen für Vereine](/blog/whatsapp-alternativen-verein) | A | Vergleich |
| [Helferplan für das Vereinsfest](/blog/helferplan-vereinsfest) | B (Pillar) | Ratgeber mit Vorlage |
| [Schichtplan für Ehrenamtliche](/blog/schichtplan-ehrenamt) | B | Ratgeber |
| [Ehrenamtliche gewinnen und halten](/blog/ehrenamtliche-gewinnen-halten) | B | Ratgeber mit Daten |
| [Ortsverband digital organisieren](/blog/ortsverband-digital-organisieren) | C (Pillar) | Ratgeber, Recht |
| [Vorstandswechsel im Verein: Checkliste](/blog/vorstandswechsel-verein-checkliste) | D | Checkliste, Recht |
| [Vereinswiki aufbauen](/blog/vereinswiki-aufbauen) | D | Ratgeber mit Vorlage |
| [Online-Mitgliederversammlung nach § 32 BGB](/blog/online-mitgliederversammlung) | D | Ratgeber, Recht |
| [Vereinsapp oder Vereinsverwaltung?](/blog/vereinsapp-oder-vereinsverwaltung) | E | Vergleich |

Vergleichsbeiträge: Anbieterangaben mit Quelle und „Stand Oktober 2026“; alle drei Monate prüfen und `updated` setzen. Vorschaubilder:
`node website/scripts/og-bilder.mjs` (siehe Kopf des Skripts).

## 4. Neue Seiten außerhalb des Blogs (höchster Hebel für Produkt-Keywords)

Blogbeiträge ranken für Fragen; für Produkt-Suchen braucht es eigene Landingpages:

| Seite | Ziel-Suche | Inhalt |
|---|---|---|
| `/vereine` | vereinsapp, app für vereine | Nutzen, Funktionen, Ablauf, FAQ, CTA |
| `/parteien` | app für ortsverband, software ortsverein | Ortsverband/Kreisverband, Wahlkampf, Datenschutz politischer Daten |
| `/ngos-und-buendnisse` | software für initiativen / bündnisse | Mehrere Gruppen, Bündnisarbeit |
| `/funktionen/helferplanung` | helferplanung app, helferslots | Funktionsseite mit Screenshots |
| `/funktionen/vereinswiki` | vereinswiki | dto. |
| `/sicherheit` (oder `/datenschutz-und-hosting`) | vereinssoftware dsgvo | Hosting, AVV, Verschlüsselung, Export – verlinkt auf Datenschutzerklärung |

Zusätzlich auf der Startseite: H2-Überschriften enthalten bisher keine Suchbegriffe („Dein persönlicher Feed.“). Vorschlag je
Abschnitt ein beschreibender Zusatz, z. B. „Helferslots: Engagement per Klick“, „Vereinswiki: das Gedächtnis des Vereins“ – erst
nach Abstimmung, weil es den Ton der Seite ändert.

## 5. Technische Basis (umgesetzt)

- Kanonische URLs ohne Schrägstrich, `www` → Domain per 301, HSTS, 404 mit `noindex`.
- Organisation, WebSite, SoftwareApplication, Breadcrumbs, TechArticle (Handbuch), BlogPosting, FAQPage (Handbuch-FAQ und
  Beitrags-FAQ) als verknüpfter JSON-LD-Graph.
- Open-Graph/Twitter mit Vorschaubild 1200×630 (`/og/pulsedeck.png`), `article:*`-Angaben für Beiträge; eigenes Bild pro
  Beitrag über Frontmatter `image`.
- Sitemap mit `lastmod` für Beiträge, RSS, `robots.txt` mit ausdrücklicher Freigabe für KI-Crawler, `llms.txt` und
  `llms-full.txt` (Nutzen für Zitate nicht belegt, aber kostenlos und hilfreich für KI-Werkzeuge).
- Blog: Inhaltsverzeichnis ab 3 Abschnitten, Lesezeit, verwandte Beiträge, Call-to-Action zur App.

## 6. Außerhalb des Codes (nötig für Rankings)

1. **Google Search Console** für `pulsedeck.de` und `app.pulsedeck.de`, Sitemaps einreichen (`https://pulsedeck.de/sitemap.xml`,
   `https://app.pulsedeck.de/sitemap.xml`).
2. **Bing Webmaster Tools** einrichten (Import aus der Search Console). ChatGPT-Suche greift auf den Bing-Index zurück.
   Nach jedem Deploy mit neuen oder geänderten Beiträgen `node website/scripts/indexnow.mjs` ausführen (IndexNow).
3. **Backlinks/Erwähnungen:** Eintrag in Vergleichsportalen (trusted.de, OMR Reviews, drweb.de – die ranken für alle
   Kernbegriffe), Gastbeiträge bei Landessportbünden/Ehrenamtsportalen, Open-Source-Verzeichnisse, GitHub-README mit Link.
4. **Autorenseite** mit echter Person (Name, Rolle, Bezug zu Vereinsarbeit) – stärkt E-E-A-T; nur mit Einverständnis.
5. **Messen:** Search Console (Klicks, Positionen je Beitrag), Erwähnungen in KI-Antworten stichprobenartig monatlich prüfen
   (eigene Liste mit 20 Testfragen, z. B. „Welche WhatsApp-Alternative eignet sich für Vereine?“).

## Quellen der Recherche

- Vergleichsportale Vereinssoftware: [drweb.de Vereinssoftware-Vergleich](https://www.drweb.de/vereinssoftware-vergleich/),
  [trusted.de Vereinsverwaltung](https://trusted.de/vereinsverwaltung), [OMR: Vereinsverwaltung kostenlos](https://omr.com/de/reviews/contenthub/vereinsverwaltung-kostenlos-software),
  [trusted.de Vereinsplaner vs. easyVerein](https://trusted.de/vereinsplaner-vs-easyverein)
- WhatsApp und Datenschutz im Verein: [Sportbund Rheinhessen/VIBSS – WhatsApp-Rechtslage](https://sportbund-rheinhessen.vibss.de/vereinsmanagement/digitalisierung/kommunikation/social-media/whatsapp/whatsapp-rechtslage-mit-einfuehrung-der-eu-dsgvo?type=123),
  [Vereinsplaner – WhatsApp im Verein](https://vereinsplaner.com/en/c/whatsapp-im-verein)
- Helfer und Ehrenamt: [Verbandsbüro – Helferplan-Vorlage](https://www.verbandsbuero.de/checklisten-vorlage/helferplan-fur-vereinsveranstaltungen/),
  [softguide – Freiwilligenmanagement](https://www.softguide.de/funktion/freiwilligenmanagement),
  [VIBSS – Motivation und Zufriedenheit](https://sportbund-rheinhessen.vibss.de/vereinsmanagement/ehrenamt-mitarbeiterinnen/bindung-und-entwicklung/motivation-und-zufriedenheit-wichtige-faktoren?type=123),
  [LSB Bremen – Motivation in Zahlen](https://lsb-bremen.vibss.de/vereinsmanagement/mitarbeiterinnen-management/einfuehrung/motive-fuer-das-ehrenamt/ehrenamtliche-motivation-in-zahlen-ausgedrueckt?type=123),
  [NaturFreunde – Lebendiger Verein](https://mobile.naturfreunde.de/sites/default/files/attachments/2021_dokumentation_lebendiger_verein.pdf)
- Vorstandswechsel: [Paritätischer BW – Vorstandswechsel im Verein](https://www.paritaet-bw.de/sites/default/files/2025-06/Vorstandswechsel%20im%20Verein.pdf),
  [Verbandsbüro – Vorstandswechsel](https://www.verbandsbuero.de/vorstandswechsel-verein-richtig-durchfuehren/)
- Online-Mitgliederversammlung: [Haufe – Gesetzesänderung](https://www.haufe.de/recht/weitere-rechtsgebiete/wirtschaftsrecht/gesetzesaenderung-virtuelle-mitgliederversammlung-im-verein_210_590540.html),
  [IHK Bodensee-Oberschwaben](https://www.ihk.de/bodensee-oberschwaben/recht/news/hybride-und-virtuelle-sitzungen-5785542),
  [LFV Bayern – Fachinformation](https://www.lfv-bayern.de/media/filer_public/00/ab/00ab2bd1-d633-4c31-9f0e-92c5a8949dcd/fachinformation_online_versammlungen.pdf)
- KI-Suche/GEO: [What Gets Cited (SIGIR 2026)](https://arxiv.org/pdf/2605.25517), [agentpatterns.ai – GEO](https://agentpatterns.ai/geo/)
  (u. a. llms.txt ohne messbaren Zitat-Effekt), [Mentionlytics – GEO Best Practices](https://www.mentionlytics.com/blog/generative-engine-optimization-best-practices)
- FAQ-Rich-Results: [TechWyse – FAQ Rich Results eingestellt](https://www.techwyse.com/news/ai-search/google-faq-rich-results-deprecated-2026),
  [The Frank Agency](https://thefrankagency.com/blog/google-kills-faq-rich-results/) – vor Umsetzung mit Google Search Central abgleichen.
