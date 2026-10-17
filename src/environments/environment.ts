export const environment = {
    production: false,
    /** Basis der Backend-API; relativ, damit der Reverse Proxy (nginx) Frontend und API unter einer Adresse ausliefert. */
    apiBaseUrl: '/api/v1',
    /** Öffentliche Website (Startseite, Handbuch, Impressum, Datenschutz); läuft getrennt von der Anwendung. */
    websiteUrl: 'https://pulsedeck.de',
};
