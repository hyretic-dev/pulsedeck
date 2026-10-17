/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  /** Adresse der Anwendung (z. B. https://app.pulsedeck.de); Ziel aller Anmelden-/Testen-Links. */
  readonly PUBLIC_APP_URL?: string;
  /** Adresse der Website selbst; wird für kanonische URLs und die Sitemap genutzt. */
  readonly PUBLIC_SITE_URL?: string;
}
