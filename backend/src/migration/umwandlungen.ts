import { randomBytes } from 'node:crypto';

import type { PasswordHasher } from '../auth/auth.service';
import { newsletterKontext } from '../newsletter/org-smtp';
import type { SecretBox } from '../common/secret-box';
import { MigrationError } from './errors';
import { FEEDBACK_STATUS, FEEDBACK_TYPEN } from './tables';

export type Zeile = Record<string, unknown>;

export interface Umwandlung {
  /** Umgewandelte Anzahl nach Beschreibung (landet im Importbericht). */
  zaehler: Map<string, number>;
  /** Werte, die auf eine neue Wertemenge abgebildet wurden (nur die Wertemenge, keine Personendaten). */
  abgebildet: Map<string, Set<string>>;
}

export interface Kontext {
  hasher: PasswordHasher;
  secretBox: SecretBox;
  exportZeitpunkt: Date;
  plattformAdmins: ReadonlySet<string>;
  /** Organisation für die frühere globale Newsletter-Konfiguration. */
  newsletterOrg: () => string;
  /** Organisationen je Konto (für feedback_submissions). */
  organisationenJeKonto: () => Map<string, string[]>;
  bericht: Umwandlung;
  /** Lädt, was eine Tabelle aus bereits importierten Tabellen braucht (z. B. Organisationen). */
  vorbereiten(tabelle: string): Promise<void>;
}

const zaehle = (k: Kontext, was: string): void => {
  k.bericht.zaehler.set(was, (k.bericht.zaehler.get(was) ?? 0) + 1);
};

const merke = (k: Kontext, was: string, wert: unknown): void => {
  const menge = k.bericht.abgebildet.get(was) ?? new Set<string>();
  menge.add(String(wert));
  k.bericht.abgebildet.set(was, menge);
};

/** Wertumwandlung je Zieltabelle. Gibt die Zeile in der Form des Zielschemas zurück. */
export const UMWANDLUNGEN: Record<string, (zeile: Zeile, k: Kontext) => Zeile> = {
  auth_users: (z, k) => {
    const { encrypted_password: hash, email_confirmed_at: bestaetigt, banned_until: gesperrtBis, deleted_at: _geloescht, email, ...rest } = z;
    // Supabase speichert bcrypt ($2a$/$2b$); dieselben Hashes prüft das neue Backend unverändert. Konten ohne Passwort
    // (nur Magic-Link/OAuth) erhalten einen unbenutzbaren Hash und passwordSet=false – sie melden sich per Magic-Link an.
    const nutzbar = typeof hash === 'string' && /^\$2[aby]\$\d\d\$/.test(hash);
    if (!nutzbar) zaehle(k, 'auth_users: Konto ohne Passwort-Hash → unbenutzbarer Hash, passwordSet=false');
    const gesperrt = typeof gesperrtBis === 'string' && new Date(gesperrtBis) > k.exportZeitpunkt;
    if (gesperrt) zaehle(k, 'auth_users: gesperrt (banned_until in der Zukunft) → is_blocked');
    if (bestaetigt) zaehle(k, 'auth_users: E-Mail bestätigt → email_verified');
    if (k.plattformAdmins.has(String(z.id))) zaehle(k, 'auth_users: Plattform-Administrator');
    return {
      ...rest,
      email: String(email).trim().toLowerCase(),
      password_hash: nutzbar ? hash : k.hasher.hash(randomBytes(32).toString('base64')),
      password_set: nutzbar,
      email_verified: Boolean(bestaetigt),
      is_blocked: gesperrt,
      is_platform_admin: k.plattformAdmins.has(String(z.id)),
    };
  },

  files: (z) => ({ ...z, storage_path: `${String(z.organization_id)}/${String(z.id)}` }),

  knowledge_base: (z) => ({ ...z, source_type: 'file', source_id: z.file_id, content_hash: null }),

  newsletter_config: (z, k) => {
    const { id: _id, smtp_pass: klartext, ...rest } = z;
    const orgId = k.newsletterOrg();
    if (typeof klartext === 'string' && klartext !== '') {
      if (!k.secretBox.verfuegbar) throw new MigrationError('MISSING_SECRET', 'SECRETS_ENCRYPTION_KEY fehlt: das SMTP-Passwort der Newsletter-Konfiguration kann nicht verschlüsselt werden');
      zaehle(k, 'newsletter_config: SMTP-Passwort im Klartext → verschlüsselt (AES-256-GCM)');
      return { ...rest, organization_id: orgId, smtp_pass_encrypted: k.secretBox.seal(klartext, newsletterKontext(orgId)) };
    }
    return { ...rest, organization_id: orgId, smtp_pass_encrypted: null };
  },

  feedback_submissions: (z, k) => {
    const typ = (FEEDBACK_TYPEN as readonly string[]).includes(String(z.type)) ? z.type : 'suggestion';
    const status = z.status === null || z.status === undefined ? 'new' : (FEEDBACK_STATUS as readonly string[]).includes(String(z.status)) ? z.status : 'new';
    if (typ !== z.type) {
      zaehle(k, 'feedback_submissions: unbekannter type → suggestion');
      merke(k, 'feedback_submissions.type', z.type);
    }
    if (status !== z.status) {
      zaehle(k, 'feedback_submissions: unbekannter/leerer status → new');
      merke(k, 'feedback_submissions.status', z.status);
    }
    // Das Feedback der Altsysteme war global; eindeutig zuordenbar ist es nur, wenn das Konto in genau einer Organisation Mitglied ist.
    const orgs = typeof z.user_id === 'string' ? (k.organisationenJeKonto().get(z.user_id) ?? []) : [];
    if (orgs.length === 1) zaehle(k, 'feedback_submissions: Organisation aus der einzigen Mitgliedschaft abgeleitet');
    else zaehle(k, 'feedback_submissions: ohne Organisation (Konto ohne oder mit mehreren Mitgliedschaften)');
    return { ...z, type: typ, status, organization_id: orgs.length === 1 ? orgs[0] : null };
  },
};
