# PulseDeck - The Engagement Layer for Modern Organizations 🇪🇺

![PulseDeck Badge](https://img.shields.io/badge/Status-Early_Access-green) ![License](https://img.shields.io/badge/License-AGPLv3-blue) ![Made in EU](https://img.shields.io/badge/Made_in-EU-blue?labelColor=yellow)

PulseDeck ist keine weitere langweilige Vereinsverwaltung. Es ist dein **System of Engagement**.
Wir ersetzen das Chaos aus WhatsApp-Gruppen, Excel-Listen und verlorenen E-Mails durch eine strukturierte, datenschutzkonforme Plattform.

**Fokus:** Politische Parteien, NGOs, Aktionsbündnisse und moderne Vereine.

---

## 🚀 Warum PulseDeck?

### Das Problem
*   **Datenschutz-Albtraum:** In WhatsApp-Gruppen sieht jeder jede Handynummer.
*   **Info-Friedhof:** Wichtige Ankündigungen verschwinden nach 5 Minuten im Chat-Verlauf.
*   **Verbindlichkeit = 0:** "Wer bringt den Grill mit?" -> 50 Nachrichten, kein Ergebnis.

### Die Lösung
*   **📌 Pinned News:** Wichtiges bleibt oben. Lesebestätigungen (anonymisiert) für Vorstände.
*   **📅 Event Slots:** Klickbare Aufgabenverteilung. Einer klickt, Job erledigt.
*   **🔒 Privacy First:** Volle Datensouveränität. Gehostet in der EU. Sicher vor dem US Cloud Act.
*   **🔔 Push statt Spam:** Benachrichtigungen nur, wenn es wirklich wichtig ist.

---

## 🛠 Tech Stack

PulseDeck setzt auf moderne, robuste Technologien:

*   **Website:** [Astro](https://astro.build) (statisch, Markdown mit Frontmatter für das Handbuch) in `website/` – Startseite, Handbuch, Impressum, Datenschutz, unter `pulsedeck.de`
*   **Anwendung (Frontend):** [Angular 21](https://angular.dev) (Standalone Components, Signals), unter `app.pulsedeck.de`
*   **UI Library:** [PrimeNG](https://primeng.org) + [Tailwind CSS](https://tailwindcss.com) (für Utility-Styling)
*   **Backend / DB:** [NestJS](https://nestjs.com) (REST-API, Auth, Jobs, Echtzeit per SSE) + [PostgreSQL 17](https://www.postgresql.org) mit pgvector; Dateien im Volume. Alles selbst gehostet (Docker Compose).
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
*   Node.js (v22)
*   Docker (PostgreSQL und Backend; Compose-Stack siehe `docs/betrieb/selfhosting.md`)

### Repo-Aufbau

| Ordner | Inhalt | Adresse |
|---|---|---|
| `app/` | Angular-Anwendung (inkl. Vereinsdashboard, Android per Capacitor) | `app.pulsedeck.de` |
| `backend/` | NestJS-API, Migrationen | intern, `/api/` der App |
| `website/` | Astro-Website: Startseite, Handbuch, Blog, Impressum, Datenschutz (Markdown mit Frontmatter) | `pulsedeck.de` |
| `docker/`, `docker-compose*.yml`, `scripts/`, `docs/`, `e2e/` | Betrieb, Prüfskripte, Doku | |

### Setup

1.  **Repo klonen:**
    ```bash
    git clone https://github.com/julienstack/pulsedeck.git
    cd pulsedeck
    ```

2.  **Abhängigkeiten der Anwendung installieren:**
    ```bash
    cd app && npm install
    ```

3.  **Backend und Datenbank starten:**
    ```bash
    cp .env.example .env   # Secrets eintragen (Hinweise in der Datei)
    docker compose up -d --build
    # Oberfläche und API unter http://localhost:8080 (nginx proxyt /api/ an das Backend)
    ```

4.  **Frontend im Entwicklungsmodus (optional):**
    ```bash
    cd app && npm start
    # Öffnet http://localhost:4200; die API-Basis ist /api/v1 (Proxy auf das Backend per proxy.conf, siehe angular.json)
    ```

5.  **Tests:**
    ```bash
    cd app && npm test -- --watch=false              # Anwendung
    cd backend && npx tsc --noEmit && npm test      # Backend, braucht PostgreSQL auf Port 5433 (backend/scripts/test-db-setup.mjs)
    bash scripts/smoke-compose.sh                   # Compose-Stack Ende-zu-Ende
    ```

### Android Build (Capacitor)

```bash
cd app
npm run build
npx cap sync
npx cap open android
```

---

## 🤖 AI / RAG Aktualisieren

Die Wissensbasis (RAG) des PulseDeck AI Agents wird vom Backend selbst gepflegt: Der nächtliche Job liest das mitgelieferte Handbuch (`DOCS_FILE`, das Verzeichnis `website/src/content/handbook/`) und die Stammdaten der Organisationen ein und erzeugt nur für geänderte Inhalte neue Embeddings (Mistral, `MISTRAL_API_KEY`). Hochgeladene Dateien werden beim Upload im Hintergrund indiziert (`POST /api/v1/orgs/:orgId/files/:fileId/index` löst es manuell aus).

---

## 🤝 Contributing & Support

PulseDeck ist Open Source, um demokratische Strukturen zu stärken.
Trag gerne Code bei, melde Bugs oder gib uns Feedback!

---

## 📄 Lizenz

Dieses Projekt ist lizenziert unter der **GNU Affero General Public License v3.0 (AGPLv3)**.
Das bedeutet: Wenn du PulseDeck nutzt, veränderst und als Service anbietest, musst du deine Änderungen ebenfalls der Community zur Verfügung stellen.

*Datensouveränität ist kein Feature, sondern ein Grundrecht.* 🛡️

---

## 🌐 Website entwickeln

Die öffentliche Website (Werbung, Beschreibung, Handbuch, Rechtliches) ist von der Anwendung getrennt:

```bash
cd website
npm install
PUBLIC_APP_URL=http://localhost:4200 npm run dev   # http://localhost:4321
```

Das Handbuch besteht aus einer Markdown-Datei je Kapitel in `website/src/content/handbook/` (Frontmatter: `title`, `description`, `order`, `icon`). Das Blog liegt in `website/src/content/blog/` (eine Datei je Beitrag, Frontmatter: `title`, `description`, `date`, optional `updated`, `author`, `tags`, `draft`, `image`, `faq`; Dateiname = URL; RSS unter `/blog/rss.xml`). Redaktionsplan und Schreibregeln für SEO und KI-Suche: `docs/marketing/redaktionsplan.md`.
Dieselben Dateien liest das Backend für die Wissensbasis der KI.
