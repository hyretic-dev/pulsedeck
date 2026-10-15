/**
 * Was aus dem Supabase-Bestand übernommen wird – und in welcher Reihenfolge.
 *
 * Export (= „was“) wählt Zeilen aus und prüft sie; der Import (= „wie“) wandelt Werte um. Jede Auslassung und jede
 * Umwandlung steht hier mit Begründung und landet im Manifest bzw. im Importbericht – nichts passiert stillschweigend.
 */
export interface TableSpec {
  /** Name der Zieltabelle (und, falls `source` fehlt, der Quelltabelle im Schema `public`). */
  table: string;
  /** Quellrelation, wenn sie nicht `public.<table>` heißt. */
  source?: string;
  /** Die Tabelle kann im Bestand fehlen (Dashboard-Tabellen, die nie in den Migrationen standen). */
  optional?: boolean;
  /** SQL-Bedingung auf der Quelle; ausgeschlossene Zeilen werden gezählt und mit Grund im Manifest geführt. */
  where?: { sql: string; reason: string };
  /**
   * Einschränkung auf eine Organisation (`--only-org`): SQL-Bedingung auf der Quelle mit den Platzhaltern `{ORG}` (UUID der
   * Organisation) und `{KONTEN}` (Unterabfrage der Konten im Umfang). Ohne `scope` kommen alle Zeilen mit.
   */
  scope?: string;
  /** Selbstbezug: wird nach dem Einfügen aller Zeilen gesetzt, damit die Reihenfolge der Zeilen egal ist. */
  selfRef?: string;
  /** Explizite Exportspalten; Standard: alle Spalten der Quelle (bei `auth.users` bewusst nur die nötigen, nie Tokens). */
  columns?: string[];
  /** Quellspalten, die es im Ziel nicht gibt (Spalte → Grund). Jede andere unbekannte Spalte ist ein Schemafehler. */
  drop?: Record<string, string>;
  /** Spalten (SQL-Ausdrücke), die in die Prüfsumme eingehen. Standard: alle Quellspalten außer `drop`/`compareExclude`. */
  compare?: string[];
  /** Quellspalten, die durch den Import verändert werden und deshalb nicht in die Prüfsumme gehören. */
  compareExclude?: string[];
}

/** Abhängigkeitsreihenfolge: Eltern vor Kindern (ein Test prüft sie gegen die Fremdschlüssel des echten Schemas). */
export const TABLES: TableSpec[] = [
  {
    table: 'auth_users',
    scope: 'id IN {KONTEN}',
    source: 'auth.users',
    where: { sql: 'deleted_at IS NULL AND email IS NOT NULL', reason: 'in Supabase gelöschte Konten und Konten ohne E-Mail-Adresse (z. B. nur Telefon)' },
    // Passwort-Hash, Bestätigung und Sperre werden beim Import in das neue Modell überführt
    columns: ['id', 'email', 'encrypted_password', 'email_confirmed_at', 'banned_until', 'deleted_at', 'created_at', 'updated_at'],
    drop: { encrypted_password: 'wird zu password_hash', email_confirmed_at: 'wird zu email_verified', banned_until: 'wird zu is_blocked', deleted_at: 'Konto gelöscht → nicht übernommen' },
    compare: ['id', 'lower(btrim(email::text)) AS email', 'created_at', 'updated_at'],
  },
  { table: 'organizations', scope: 'id = {ORG}' },
  { table: 'organization_roles', scope: 'organization_id = {ORG}' },
  { table: 'members', scope: 'organization_id = {ORG}' },
  { table: 'skills', scope: 'organization_id = {ORG}' },
  { table: 'working_groups', scope: 'organization_id = {ORG}' },
  { table: 'wiki_categories', scope: 'organization_id = {ORG}' },
  { table: 'wiki_docs', scope: 'organization_id = {ORG}' },
  { table: 'folders', scope: 'organization_id = {ORG}', selfRef: 'parent_id' },
  {
    table: 'files',
    scope: 'organization_id = {ORG}',
    where: { sql: 'organization_id IS NOT NULL', reason: 'Dateien ohne Organisation sind für keinen Mandanten erreichbar und haben keinen Speicherschlüssel' },
    compareExclude: ['storage_path'],
  },
  { table: 'events', scope: 'organization_id = {ORG}', selfRef: 'recurrence_parent_id' },
  { table: 'event_slots', scope: 'organization_id = {ORG}' },
  { table: 'event_slot_signups', scope: 'organization_id = {ORG}' },
  { table: 'event_registrations', scope: 'event_id IN (SELECT id FROM public.events WHERE organization_id = {ORG})' },
  { table: 'event_guest_organizations', scope: 'host_organization_id = {ORG}' },
  { table: 'feed_items', scope: 'organization_id = {ORG}' },
  { table: 'poll_options', scope: 'feed_item_id IN (SELECT id FROM public.feed_items WHERE organization_id = {ORG})' },
  { table: 'poll_votes', scope: 'option_id IN (SELECT o.id FROM public.poll_options o JOIN public.feed_items f ON f.id = o.feed_item_id WHERE f.organization_id = {ORG})' },
  { table: 'feed_item_reads', scope: 'feed_item_id IN (SELECT id FROM public.feed_items WHERE organization_id = {ORG})', optional: true }, // in Produktion nie angelegt (Juli-Migration nicht eingespielt)
  { table: 'ag_memberships', scope: 'working_group_id IN (SELECT id FROM public.working_groups WHERE organization_id = {ORG})' },
  { table: 'working_group_members', scope: 'working_group_id IN (SELECT id FROM public.working_groups WHERE organization_id = {ORG})' },
  { table: 'member_skills', scope: 'member_id IN (SELECT id FROM public.members WHERE organization_id = {ORG})' },
  { table: 'onboarding_progress', scope: 'member_id IN (SELECT id FROM public.members WHERE organization_id = {ORG})' },
  { table: 'user_tasks', scope: 'member_id IN (SELECT id FROM public.members WHERE organization_id = {ORG})' },
  { table: 'contacts', scope: 'organization_id = {ORG}' },
  {
    table: 'newsletter_config',
    // Die alte Konfiguration war eine einzige globale Zeile mit Klartext-Passwort; sie wird einer Organisation zugeordnet
    // und das SMTP-Passwort verschlüsselt (smtp_pass_encrypted).
    drop: { id: 'war ein Singleton-Schlüssel; das Ziel führt organization_id', smtp_pass: 'wird verschlüsselt zu smtp_pass_encrypted' },
  },
  {
    table: 'knowledge_base',
    scope: 'organization_id = {ORG}',
    // Chunks aus Wiki, Arbeitsgruppen und Terminen erzeugt der nächtliche Job aus den Stammdaten neu (Herkunft ist im
    // Bestand nicht erfasst). Chunks aus Dateien behalten ihre Vektoren und werden der Datei zugeordnet.
    where: { sql: 'file_id IS NOT NULL AND organization_id IS NOT NULL', reason: 'Chunks ohne Dateibezug werden aus den Stammdaten neu erzeugt; ohne Organisation sind sie nicht abrufbar' },
  },
  { table: 'chat_sessions', scope: 'organization_id = {ORG}' },
  { table: 'chat_messages', scope: 'session_id IN (SELECT id FROM public.chat_sessions WHERE organization_id = {ORG})' },
  { table: 'analytics_events', scope: 'organization_id = {ORG}' },
  { table: 'audit_logs', scope: 'organization_id = {ORG}' },
  {
    table: 'feedback_submissions',
    scope: '(user_id IS NULL OR user_id IN {KONTEN})',
    // type/status werden auf die neuen Wertemengen abgebildet, organization_id aus der Mitgliedschaft abgeleitet
    compareExclude: ['type', 'status'],
  },
  { table: 'push_subscriptions', scope: 'member_id IN (SELECT id FROM public.members WHERE organization_id = {ORG})', optional: true },
];

/** Alt-Tabellen, die bewusst nicht übernommen werden. */
export const NICHT_UEBERNOMMEN: Record<string, string> = {
  active_sessions: 'flüchtige Präsenzdaten, werden im Betrieb neu aufgebaut',
};

/** Erlaubte Werte, auf die der Import Altdaten abbildet (siehe Migration 000016). */
export const FEEDBACK_TYPEN = ['bug', 'suggestion'] as const;
export const FEEDBACK_STATUS = ['new', 'in_progress', 'done'] as const;
