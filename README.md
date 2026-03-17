🚧 WIP / ALPHA STATUS 🚧
Willkommen! Dieses Projekt ist aktuell in einer sehr frühen Alpha-Phase. Der Code ist an vielen Stellen noch experimentell, unaufgeräumt und ein "Work in Progress". Ich mache das Repo jetzt schon öffentlich im Sinne von "Build in Public".
Alpha-Tester für die App sind herzlich willkommen! Wenn ihr den Code lest: Bitte habt Nachsicht mit dem Chaos. Pull Requests für große Refactorings sind aktuell noch verfrüht, aber Bug-Reports in den Issues sind extrem wertvoll!


# PulseDeck - The Engagement Layer for Modern Organizations 🇪🇺

![PulseDeck Badge](https://img.shields.io/badge/Status-Alpha-orange) ![License](https://img.shields.io/badge/License-AGPLv3-blue) ![Made in EU](https://img.shields.io/badge/Made_in-EU-blue?labelColor=yellow)

PulseDeck ist keine weitere langweilige Vereinsverwaltung. Es ist dein **System of Engagement**.
Wir ersetzen das Chaos aus WhatsApp-Gruppen, Excel-Listen und verlorenen E-Mails durch eine strukturierte, datenschutzkonforme Plattform.

**Fokus:** Politische Parteien, NGOs, Aktionsbündnisse und moderne Vereine.

---

## 🚀 Warum PulseDeck?

### Das Problem (The Horror)
*   **Datenschutz-Albtraum:** In WhatsApp-Gruppen sieht jeder jede Handynummer.
*   **Info-Friedhof:** Wichtige Ankündigungen verschwinden nach 5 Minuten im Chat-Verlauf.
*   **Verbindlichkeit = 0:** "Wer bringt den Grill mit?" -> 50 Nachrichten, kein Ergebnis.

### Die Lösung (The Fix)
*   **📌 Pinned News:** Wichtiges bleibt oben. Lesebestätigungen (anonymisiert) für Vorstände.
*   **📅 Event Slots:** Klickbare Aufgabenverteilung. Einer klickt, Job erledigt.
*   **🔒 Privacy First:** Volle Datensouveränität. Gehostet in der EU. Sicher vor dem US Cloud Act.
*   **🔔 Push statt Spam:** Benachrichtigungen nur, wenn es wirklich wichtig ist.

---

## 🛠 Tech Stack

PulseDeck setzt auf moderne, robuste Technologien:

*   **Frontend:** [Angular 18](https://angular.io) (Standalone Components, Signals)
*   **UI Library:** [PrimeNG](https://primeng.org) + [Tailwind CSS](https://tailwindcss.com) (für Utility-Styling)
*   **Backend / DB:** [Supabase](https://supabase.com) (PostgreSQL, Auth, Edge Functions)
*   **Mobile:** [Capacitor](https://capacitorjs.com) (Native Android/iOS Apps)
*   **Deploy:** Docker / Coolify

---

## 📦 Features (Aktuell)

*   **Dashboard:** Personalisierter Feed mit News und anstehenden Terminen.
*   **Kalender:** Terminverwaltung mit Helfer-Slots ("Wer macht Schicht 1?").
*   **Wiki:** Zentraler Wissensspeicher für Protokolle und Satzungen.
*   **Mitgliederverwaltung:** Einfache Listen, Filterung nach AGs (Arbeitsgruppen).
*   **Rollen & Rechte:** Granulares Rechtesystem (Admin, Vorstand, Mitglied).

---

## 🔧 Installation & Entwicklung

### Voraussetzungen
*   Node.js (v20+)
*   Docker (optional, für lokales Supabase)

### Setup

1.  **Repo klonen:**
    ```bash
    git clone https://github.com/julienstack/pulsedeck.git
    cd pulsedeck
    ```

2.  **Abhängigkeiten installieren:**
    ```bash
    npm install
    ```

3.  **Environment konfigurieren:**
    Erstelle eine `.env` Datei oder passe `src/environments/environment.ts` an mit deinen Supabase-Credentials.

4.  **Starten:**
    ```bash
    npm start
    # Öffnet http://localhost:4200
    ```

### Android Build (Capacitor)

```bash
npm run build
npx cap sync
npx cap open android
```

---

## 🤝 Contributing & Support

PulseDeck ist Open Source, um demokratische Strukturen zu stärken.
Trag gerne Code bei, melde Bugs oder gib uns Feedback!

---

## 📄 Lizenz

Dieses Projekt ist lizenziert unter der **GNU Affero General Public License v3.0 (AGPLv3)**.
Das bedeutet: Wenn du PulseDeck nutzt, veränderst und als Service anbietest, musst du deine Änderungen ebenfalls der Community zur Verfügung stellen.

*Datensouveränität ist kein Feature, sondern ein Grundrecht.* 🛡️
