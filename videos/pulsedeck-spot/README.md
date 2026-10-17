# PulseDeck-Werbespot (62 s, HyperFrames)

„Euer Chat bleibt, das Chaos geht.“ Ein Motion-Graphics-Spot in PulseDecks eigener Welt: Inter, Rot auf Tiefschwarz,
die echte Oberfläche der App, das Original-Logo. Gebaut mit [HyperFrames](https://github.com/heygen-com/hyperframes)
(HTML + GSAP, gerendert in Chrome).

## Geschichte

| # | Szene | Sprechertext | Was man sieht |
|---|-------|--------------|---------------|
| 1 | Chaos | Samstag ist Sommerfest. Und im Vereinschat? Dreihundert Nachrichten. Wer grillt? Wo ist das PDF? Und wer kommt eigentlich? | Gruppenchat läuft über, Benachrichtigungen stapeln sich, „300“ ungelesen, Fragen mit roten Markierungen, eine Kritzellinie wächst durchs Bild |
| 2 | Durchatmen | Durchatmen. Das ist PulseDeck. | Alles fällt in sich zusammen, die Kritzellinie glättet sich, schlägt als Puls aus und wird zum Logo |
| 3 | Claim | Euer Chat bleibt. Das Chaos geht. | Derselbe Chat, jetzt ruhig, mit PulseDeck-Link; „Chaos“ wird durchgestrichen |
| 4 | Feed | Wichtiges steht im Feed und bleibt dort. Dazu Umfragen, Newsletter und Push aufs Handy, wenn es zählt. | Nachgebauter Feed „Aktuelles“, angepinnte Umfrage, Balken füllen sich, Newsletter, Push auf dem Sperrbildschirm |
| 5 | Schichten | Termin anlegen, Schichten festlegen, Link in eure Gruppe teilen. Jeder trägt sich selbst ein. Ein Klick, Schicht besetzt. | Die drei Schritte der Website, Termin und Schichtkarten wie in der App, Link landet im Gruppenchat, Avatare tragen sich ein, „Schicht voll“ |
| 6 | Aktivieren | So werden aus Mitgliedern Aktive: mit Onboarding-Quest, Mikrotasks und Schichten, die zu ihren Fähigkeiten passen. | Mitglieder-Symbole leuchten auf, Dashboard mit Onboarding-Quest (20 % → 100 %), Mikrotasks, passende Skills |
| 7 | Wissen | Euer Wissen bleibt: in Wiki, Dateien und Arbeitsgruppen. Auf Wunsch kennt ein KI-Assistent eure Dokumente. | Wiki „Sommerfest von A bis Z“, Dateien mit Sichtbarkeit, Arbeitsgruppen, der PulseDeck AI Agent beantwortet eine Frage aus dem Wiki |
| 8 | Vertrauen | Gehostet in Deutschland. Keine Telefonnummern, kein Tracking, Open Source. | Vier Kacheln mit eigenen Strichskizzen |
| 9 | Abschluss | PulseDeck. Endlich Mitglieder nachhaltig aktivieren und informieren. Jetzt kostenlos starten, auf pulsedeck.de. | Logo, „Mitglieder aktivieren. Nachhaltig informieren.“, „Kostenlos starten“, Early Access, zwei Herzschläge |

Jede Aussage ist belegt: Handbuch (`website/src/content/handbook/`), Funktionsseiten (`website/src/data/funktionen.ts`),
Vertrauensaussagen (`website/src/data/vertrauen.ts`), Dashboard, Onboarding-Quest und Mikrotasks im App-Code
(`app/src/app/features/dashboard/dashboard-home/`, `app/src/app/shared/services/onboarding.service.ts`, `mikrotask.service.ts`).

## Gestaltung

- **Farben und Schrift** aus `app/src/styles.css`, `app/tailwind.config.js` und `website/src/styles/global.css`:
  Grund `#050505`, Flächen `#0f0f0f`/`#141414`/`#1c1c1c`, Rot `#ff0000`/`#e00000`/`#ff5050`, Türkis `#00b19c`,
  Indigo-Verlauf der Quest. Schrift Inter (wie in den Screenshots), Icons PrimeIcons 7 wie in der App.
- **Logo**: `assets/brand/pulsedeck-icon.svg` ist die Original-Datei aus `website/public/favicon.svg` (identisch mit
  `app/public/favicon.svg`), die Wortmarke wie in App und Website in Inter Bold.
- **Oberfläche**: in HTML nachgebaut nach den Screenshots in `website/src/assets/screenshots/` und den Angular-Templates,
  keine eingefügten Bilder.
- **Illustrationen**: Kritzellinie, Markierungen, Sommerfest-Skizze (Zelt, Wimpel, Grill), Schlüssel, Kachel-Skizzen
  und Mitglieder-Symbole sind eigene SVG-Strichzeichnungen im Strichstil der Marke.
- **Leitmotiv**: die Pulslinie aus dem Logo. Sie beginnt als Chaos-Kritzelei, wird zum Logo und zieht als Übergang durch den Spot.

## Ton

- **Stimme (Ziel)**: ElevenLabs, „Lola – Fresh & Dynamic“ (`SiMvlSW9cKKHDYT4BzOp`), Modell `eleven_v4`, Deutsch, je Szene ein Segment mit Wortzeiten.
  Lola stammt aus der Voice Library und ist über die API erst ab dem **Creator-Tarif** nutzbar.
- **Stimme (aktueller Entwurf)**: Das verwendete Konto ist ein Free-Konto. Der Spot nutzt deshalb vorerst die Standardstimme
  „Sarah“ (`EXAVITQu4vr4xnSDxMaL`, `eleven_v4`, Deutsch), siehe `vo/voice.json`. Free-Generierungen sind laut ElevenLabs
  nicht für kommerzielle Nutzung lizenziert: **nicht veröffentlichen**, vorher mit Lola auf einem bezahlten Konto neu erzeugen.
- **Sprachbearbeitung** (`tools/audio.py`): tonhöhen- und formanterhaltend um Faktor 1,1 beschleunigt (`voice.tempo`), Hochpass 80 Hz,
  sanfte Kompression 3:1; die Wortzeiten werden entsprechend umgerechnet.
- **Musik**: „Shiny Tech“ von Kevin MacLeod (incompetech.com), Lizenz Creative Commons BY 4.0
  (https://creativecommons.org/licenses/by/4.0/). Der Drop nach dem Intro liegt auf dem Wort „PulseDeck“, der Schlussschlag auf dem letzten Herzschlag.
  `tools/audio.py` lädt die Datei von einem festen GitHub-Commit (Prüfsumme im Skript), sie liegt nicht im Repo.
  **Namensnennung bei Veröffentlichung:** „Shiny Tech“ Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0 License.
- **Sounds**: alle selbst synthetisiert in `tools/audio.py` (Chat-Pops, Benachrichtigung, Schläge, Stift, Whooshes, Riser, Herzschlag, Glitzern, Klicks, Glocken, Stempel).
- **Lautheit** (ITU-R BS.1770, gemessen in `audio/loudness.json`): Stimme -14 LUFS, Musik -36 LUFS, Sounds -25 LUFS;
  die Summe wird auf **-12 LUFS** integriert gemastert, True Peak höchstens -1,5 dBTP.

## Neu erzeugen

```bash
cd videos/pulsedeck-spot
ELEVENLABS_API_KEY=... python3 -I tools/voiceover.py   # Lola + Wortzeiten nach vo/ (ab Creator-Tarif)
# ELEVENLABS_VOICE=draft ... tools/voiceover.py       # Entwurfsstimme aus vo/script.json
node tools/timing.mjs                                  # Szenen und Cues an die Wortzeiten anpassen (stempelt index.html)
python3 -I tools/audio.py                              # Sounds, Musik, Mix, Lautheitsbericht
npx --yes hyperframes@0.8.169 lint                     # Prüfung (0 Fehler; die Warnungen sind Strukturhinweise zu Sub-Kompositionen)
bash tools/deliver.sh renders/pulsedeck-spot.mp4      # Render in Lieferqualität, Master-Mix direkt ins MP4
```

Python braucht `numpy scipy soundfile pyloudnorm librosa`.
