import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Pool } from 'pg';

import { LLM_CLIENT, type LlmClient } from '../ai/llm';
import { inTransaction } from '../common/db';
import { apiFehler, nichtGefunden, verboten } from '../common/http-error';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { sichtbarkeitsBedingung, sichtbarkeitsRang } from '../events/visibility';
import { dateiSichtbarkeitsBedingung } from '../files/file-visibility';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/object-storage';
import type { Membership } from '../tenancy/membership';
import { isAdmin } from '../tenancy/permissions';

import { teileDokumentation, teileInAbschnitte } from './chunking';
import { ladeDokumentation } from './docs-quelle';
import { extrahierePdfText } from './pdf-text';

const MAX_INDEX_BYTES = 10 * 1024 * 1024;
const MAX_VERSUCHE = 3;

export interface Wissensabschnitt {
  id: string;
  title: string;
  content: string;
  similarity: number;
}

interface Wunschabschnitt {
  sourceType: 'doc' | 'file' | 'working_group' | 'event';
  sourceId: string | null;
  titel: string;
  inhalt: string;
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const vektorLiteral = (v: number[]): string => `[${v.join(',')}]`;

/** Indexierbar: PDF und Text bis 10 MB (wie bisher); andere Typen werden nicht eingelesen. */
export function istIndexierbar(mime: string | null, groesse: number | null): { ok: true } | { ok: false; grund: string } {
  if (!(mime === 'application/pdf' || mime?.startsWith('text/'))) return { ok: false, grund: 'Dieser Dateityp wird für die KI nicht unterstützt (nur PDF und Text).' };
  if ((groesse ?? 0) > MAX_INDEX_BYTES) return { ok: false, grund: 'Die Datei ist über 10 MB groß und wird aus Performance-Gründen nicht in die KI indiziert.' };
  return { ok: true };
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger('Knowledge');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly speicher: ObjectStorage,
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null
  ) {}

  private brauchLlm(): LlmClient {
    if (!this.llm) throw apiFehler(503, 'ai_disabled', 'Die KI-Funktionen sind nicht eingerichtet (MISTRAL_API_KEY)');
    return this.llm;
  }

  // ── Abruf ───────────────────────────────────────────────────────────────────

  /**
   * Relevante Abschnitte für eine Frage. Der Rechtefilter wirkt in SQL **bevor** Text an das Modell geht:
   * Dateien nach ihrer Sichtbarkeit, Termine nach ihrer Rollenstufe, AGs und die Produktdokumentation für alle Mitglieder.
   * (Der Bestand lieferte Abschnitte aller Dateien der Organisation, unabhängig von Rolle und Arbeitsgruppe.)
   */
  async suche(orgId: string, aufrufer: Membership, frage: string, signal?: AbortSignal, anzahl = 3, schwelle = 0.7): Promise<Wissensabschnitt[]> {
    const [vektor] = await this.brauchLlm().einbetten([frage], signal);
    const { rows: gruppen } = await this.pool.query<{ working_group_id: string }>(
      'SELECT working_group_id FROM ag_memberships WHERE member_id = $1 UNION SELECT working_group_id FROM working_group_members WHERE member_id = $1',
      [aufrufer.member.id]
    );
    const { rows } = await this.pool.query<Wissensabschnitt>(
      `SELECT kb.id, kb.title, kb.content, 1 - (kb.embedding <=> $1::vector) AS similarity
         FROM knowledge_base kb
         LEFT JOIN files f ON kb.source_type = 'file' AND f.id = kb.source_id
         LEFT JOIN events e ON kb.source_type = 'event' AND e.id = kb.source_id
        WHERE kb.embedding IS NOT NULL AND (kb.organization_id IS NULL OR kb.organization_id = $2)
          AND CASE kb.source_type
                WHEN 'file' THEN f.id IS NOT NULL AND f.organization_id = $2 AND ${dateiSichtbarkeitsBedingung(3)}
                WHEN 'event' THEN e.id IS NOT NULL AND e.organization_id = $2 AND ${sichtbarkeitsBedingung(4)}
                ELSE true
              END
          AND 1 - (kb.embedding <=> $1::vector) > $6
        ORDER BY kb.embedding <=> $1::vector LIMIT $7`,
      [vektorLiteral(vektor), orgId, aufrufer.member.id, sichtbarkeitsRang(aufrufer), gruppen.map((g) => g.working_group_id), schwelle, anzahl]
    );
    return rows;
  }

  // ── Dateien indizieren ──────────────────────────────────────────────────────

  /** Auftrag für den Hintergrundlauf anlegen (Hochladende und Administratoren). */
  async indexAnfordern(orgId: string, aufrufer: Membership, fileId: string): Promise<{ success: boolean; message: string }> {
    this.brauchLlm();
    const { rows } = await this.pool.query('SELECT id, mime_type, size_bytes, uploaded_by, is_indexed FROM files WHERE id = $1 AND organization_id = $2', [fileId, orgId]);
    const datei = rows[0];
    if (!datei) throw nichtGefunden('Datei');
    if (!isAdmin(aufrufer) && datei.uploaded_by !== aufrufer.member.id) throw verboten();
    const pruefung = istIndexierbar(datei.mime_type, datei.size_bytes === null ? null : Number(datei.size_bytes));
    if (!pruefung.ok) return { success: false, message: pruefung.grund };
    await this.pool.query(
      `INSERT INTO index_jobs (file_id) VALUES ($1)
       ON CONFLICT (file_id) DO UPDATE SET attempts = 0, next_attempt_at = now(), locked_until = NULL, last_error = NULL`,
      [fileId]
    );
    return { success: true, message: 'Die Datei wird für die KI indiziert.' };
  }

  /** Arbeitet Indexaufträge ab (mehrere Instanzen sicher). */
  async auftraegeAbarbeiten(batch = 2): Promise<number> {
    if (!this.llm) return 0;
    const { rows } = await this.pool.query<{ file_id: string; attempts: number }>(
      `WITH faellig AS (
         SELECT file_id FROM index_jobs WHERE next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now())
          ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       UPDATE index_jobs j SET locked_until = now() + interval '10 minutes', attempts = j.attempts + 1
         FROM faellig WHERE j.file_id = faellig.file_id RETURNING j.file_id, j.attempts`,
      [batch]
    );
    for (const auftrag of rows) {
      try {
        await this.dateiIndizieren(auftrag.file_id);
        await this.pool.query('DELETE FROM index_jobs WHERE file_id = $1', [auftrag.file_id]);
      } catch (fehler) {
        const grund = fehler instanceof Error ? fehler.message.slice(0, 300) : 'unbekannt';
        this.logger.warn(`Indexierung ${auftrag.file_id} fehlgeschlagen (Versuch ${auftrag.attempts}): ${grund}`);
        if (auftrag.attempts >= MAX_VERSUCHE) await this.pool.query('DELETE FROM index_jobs WHERE file_id = $1', [auftrag.file_id]);
        else await this.pool.query('UPDATE index_jobs SET locked_until = NULL, last_error = $2, next_attempt_at = now() + make_interval(mins => $3) WHERE file_id = $1', [auftrag.file_id, grund, 5 * auftrag.attempts]);
      }
    }
    return rows.length;
  }

  private async dateiIndizieren(fileId: string): Promise<void> {
    const { rows } = await this.pool.query('SELECT id, name, description, mime_type, size_bytes, storage_path, organization_id FROM files WHERE id = $1', [fileId]);
    const datei = rows[0];
    if (!datei) return; // inzwischen gelöscht
    const pruefung = istIndexierbar(datei.mime_type, datei.size_bytes === null ? null : Number(datei.size_bytes));
    if (!pruefung.ok) {
      await this.pool.query('UPDATE files SET is_indexed = true WHERE id = $1', [fileId]); // nicht erneut versuchen
      return;
    }
    const { stream } = await this.speicher.get(datei.storage_path);
    const teile: Buffer[] = [];
    for await (const stueck of stream) teile.push(Buffer.from(stueck as Buffer));
    const inhalt = Buffer.concat(teile);
    const text = datei.mime_type === 'application/pdf' ? await extrahierePdfText(inhalt) : inhalt.toString('utf8');
    const abschnitte = teileInAbschnitte(text);
    const kontext = (a: string) => `Datei: ${datei.name}\n${datei.description ? `Beschreibung: ${datei.description}\n` : ''}\nInhalt:\n${a}`;
    const texte = abschnitte.map(kontext);
    const vektoren = texte.length > 0 ? await this.brauchLlm().einbetten(texte) : [];
    await inTransaction(this.pool, async (db) => {
      await db.query("DELETE FROM knowledge_base WHERE source_type = 'file' AND source_id = $1", [fileId]);
      for (const [i, t] of texte.entries()) {
        await db.query(
          `INSERT INTO knowledge_base (title, content, embedding, organization_id, file_id, source_type, source_id, content_hash)
           VALUES ($1, $2, $3::vector, $4, $5, 'file', $5, $6)`,
          [`Datei: ${datei.name} (Abschnitt ${i + 1})`, t, vektorLiteral(vektoren[i]), datei.organization_id, fileId, hash(t)]
        );
      }
      await db.query('UPDATE files SET is_indexed = true WHERE id = $1', [fileId]);
    });
  }

  // ── Stammdaten (Dokumentation, Arbeitsgruppen, Termine) ─────────────────────

  /**
   * Nächtlicher Abgleich: Es werden nur geänderte Abschnitte neu eingebettet (Prüfsumme), veraltete entfernt.
   * Termine: nur kommende. Jeder Abschnitt trägt Herkunft und Organisation, damit der Abruf Rechte prüfen kann.
   */
  async stammdatenAktualisieren(): Promise<{ eingefuegt: number; entfernt: number }> {
    if (!this.llm) return { eingefuegt: 0, entfernt: 0 };
    let eingefuegt = 0;
    let entfernt = 0;
    const abgleich = async (orgId: string | null, quellen: string[], wunsch: Wunschabschnitt[]) => {
      const { rows: vorhanden } = await this.pool.query<{ id: string; source_type: string; source_id: string | null; title: string; content_hash: string | null }>(
        'SELECT id, source_type, source_id, title, content_hash FROM knowledge_base WHERE organization_id IS NOT DISTINCT FROM $1 AND source_type = ANY($2::text[])',
        [orgId, quellen]
      );
      const schluessel = (q: string, s: string | null, t: string, h: string) => `${q}|${s ?? ''}|${t}|${h}`;
      const gewuenscht = new Map(wunsch.map((w) => [schluessel(w.sourceType, w.sourceId, w.titel, hash(w.inhalt)), w]));
      const bleibt = new Set<string>();
      const veraltet: string[] = [];
      for (const v of vorhanden) {
        const k = schluessel(v.source_type, v.source_id, v.title, v.content_hash ?? '');
        if (gewuenscht.has(k) && !bleibt.has(k)) bleibt.add(k);
        else veraltet.push(v.id);
      }
      const neu = [...gewuenscht.entries()].filter(([k]) => !bleibt.has(k)).map(([, w]) => w);
      const vektoren = neu.length > 0 ? await this.brauchLlm().einbetten(neu.map((w) => w.inhalt)) : [];
      await inTransaction(this.pool, async (db) => {
        if (veraltet.length > 0) await db.query('DELETE FROM knowledge_base WHERE id = ANY($1::uuid[])', [veraltet]);
        for (const [i, w] of neu.entries()) {
          await db.query(
            `INSERT INTO knowledge_base (title, content, embedding, organization_id, source_type, source_id, content_hash) VALUES ($1, $2, $3::vector, $4, $5, $6, $7)`,
            [w.titel, w.inhalt, vektorLiteral(vektoren[i]), orgId, w.sourceType, w.sourceId, hash(w.inhalt)]
          );
        }
      });
      eingefuegt += neu.length;
      entfernt += veraltet.length;
    };

    if (this.config.docsFile) {
      try {
        const text = await ladeDokumentation(this.config.docsFile);
        await abgleich(null, ['doc'], teileDokumentation(text).map((d) => ({ sourceType: 'doc', sourceId: null, titel: `PulseDeck Doc: ${d.titel}`, inhalt: d.inhalt })));
      } catch (fehler) {
        this.logger.warn(`Dokumentation nicht eingelesen: ${fehler instanceof Error ? fehler.message : 'unbekannt'}`);
      }
    }
    const heute = new Date().toISOString().split('T')[0];
    const { rows: organisationen } = await this.pool.query<{ id: string }>('SELECT id FROM organizations');
    for (const { id: orgId } of organisationen) {
      const { rows: gruppen } = await this.pool.query('SELECT id, name, category, description FROM working_groups WHERE organization_id = $1', [orgId]);
      const { rows: termine } = await this.pool.query(
        `SELECT e.id, e.title, e.date, e.start_time, e.end_time, e.location, e.description, g.name AS gruppe
           FROM events e LEFT JOIN working_groups g ON g.id = e.working_group_id WHERE e.organization_id = $1 AND e.date >= $2`,
        [orgId, heute]
      );
      await abgleich(orgId, ['working_group', 'event'], [
        ...gruppen.map((g): Wunschabschnitt => ({
          sourceType: 'working_group', sourceId: g.id, titel: `Arbeitsgruppe: ${g.name}`,
          inhalt: `Informationen zur Arbeitsgruppe (AG):\nName: ${g.name}\nKategorie: ${g.category || 'Keine'}\nBeschreibung: ${g.description || 'Keine Beschreibung vorhanden'}\nDiese AG dient der vereinsinternen Organisation.`,
        })),
        ...termine.map((t): Wunschabschnitt => ({
          sourceType: 'event', sourceId: t.id, titel: `Termin: ${t.title}`,
          inhalt: `Informationen zum Termin${t.gruppe ? ` (Gehört zur AG: ${t.gruppe})` : ''}:\nTitel: ${t.title}\nDatum: ${t.date}\nStartzeit: ${t.start_time}\nEndzeit: ${t.end_time || 'Nicht definiert'}\nOrt/Location: ${t.location}\nBeschreibung/Agenda: ${t.description || 'Keine weitere Beschreibung'}`,
        })),
      ]);
    }
    return { eingefuegt, entfernt };
  }
}
