const ohneSchluss = (url: string) => url.replace(/\/+$/, '');

/** Die Anwendung (Angular-App); alle Registrieren-/Login-Links der Website zeigen hierher. */
export const APP_URL = ohneSchluss(import.meta.env.PUBLIC_APP_URL || 'https://app.pulsedeck.de');
export const SITE_URL = ohneSchluss(import.meta.env.PUBLIC_SITE_URL || 'https://pulsedeck.de');
export const KONTAKT = 'kontakt@pulsedeck.de';
