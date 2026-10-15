/** Standardrollen einer neuen Organisation (Ersatz für den Bestands-Trigger trg_create_default_org_roles). */
export const STANDARD_ROLLEN = [
  {
    name: 'Admin',
    description: 'Systemadministrator',
    isSystemAdmin: true,
    isDefault: false,
    permissions: ['feed:create', 'feed:approve', 'wiki:edit', 'events:create', 'contacts:edit', 'view_issue_tracker'],
  },
  {
    name: 'Mitglied',
    description: 'Standardmitglied',
    isSystemAdmin: false,
    isDefault: true,
    permissions: ['feed:create'],
  },
] as const;

/** Standard-Skills einer neuen Organisation (Ersatz für create_default_skills). */
export const STANDARD_SKILLS: ReadonlyArray<{ name: string; category: string; icon: string; sortOrder: number }> = [
  { name: 'Führerschein Klasse B', category: 'ability', icon: 'pi-car', sortOrder: 1 },
  { name: 'Führerschein mit Anhänger', category: 'ability', icon: 'pi-car', sortOrder: 2 },
  { name: 'Texte schreiben', category: 'ability', icon: 'pi-pencil', sortOrder: 3 },
  { name: 'Social Media', category: 'ability', icon: 'pi-share-alt', sortOrder: 4 },
  { name: 'Grafik/Design', category: 'ability', icon: 'pi-palette', sortOrder: 5 },
  { name: 'Fotografie', category: 'ability', icon: 'pi-camera', sortOrder: 6 },
  { name: 'Erste Hilfe', category: 'ability', icon: 'pi-heart', sortOrder: 7 },
  { name: 'Moderation', category: 'ability', icon: 'pi-microphone', sortOrder: 8 },
  { name: 'Kochen/Catering', category: 'ability', icon: 'pi-utensils', sortOrder: 9 },
  { name: 'Handwerklich geschickt', category: 'ability', icon: 'pi-wrench', sortOrder: 10 },
  { name: 'Sozialpolitik', category: 'interest', icon: 'pi-users', sortOrder: 20 },
  { name: 'Umwelt & Klima', category: 'interest', icon: 'pi-globe', sortOrder: 21 },
  { name: 'Wirtschaftspolitik', category: 'interest', icon: 'pi-chart-line', sortOrder: 22 },
  { name: 'Bildungspolitik', category: 'interest', icon: 'pi-book', sortOrder: 23 },
  { name: 'Kommunalpolitik', category: 'interest', icon: 'pi-building', sortOrder: 24 },
  { name: 'Öffentlichkeitsarbeit', category: 'interest', icon: 'pi-megaphone', sortOrder: 25 },
  { name: 'Veranstaltungen', category: 'interest', icon: 'pi-calendar', sortOrder: 26 },
  { name: 'Wochenende verfügbar', category: 'availability', icon: 'pi-clock', sortOrder: 40 },
  { name: 'Abends verfügbar', category: 'availability', icon: 'pi-moon', sortOrder: 41 },
  { name: 'Spontan einsetzbar', category: 'availability', icon: 'pi-bolt', sortOrder: 42 },
  { name: 'Mit PKW mobil', category: 'availability', icon: 'pi-car', sortOrder: 43 },
];

/**
 * Slugs, die Frontend-Routen verdecken würden (feste Routen stehen vor `/:slug`).
 * Im Bestand nicht geprüft: eine Organisation „login“ wäre unerreichbar.
 */
export const RESERVIERTE_SLUGS: ReadonlySet<string> = new Set([
  'login', 'auth', 'registrieren', 'erstellen', 'organisationen', 'impressum', 'datenschutz',
  'docs', 'dashboard', 'event', 'api', 'assets', 'health', 'admin', 'sitemap', 'robots',
]);

/** Gleiche Umwandlung wie im Bestands-Frontend (OrganizationService.slugify). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
