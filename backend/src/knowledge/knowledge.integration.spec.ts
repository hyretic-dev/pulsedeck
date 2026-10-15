import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

import { MEMBERSHIP_REPOSITORY } from '../tenancy/tenancy.tokens';

import { KnowledgeService } from './knowledge.service';

/** Ein-Themen-Vektor: gleiche Schlüsselwörter = Kosinus 1, verschiedene = 0 (Schwelle 0,7 trennt sauber). */
const THEMEN = ['Finanzen', 'Grillen', 'Technik', 'Satzung', 'Nitric', 'Sommerfest', 'Vorstandsklausur', 'Winterfest'];
const vektor = (text: string): number[] => {
  const v = Array.from({ length: 1024 }, () => 0);
  const treffer = THEMEN.findIndex((t) => text.includes(t));
  v[treffer === -1 ? 1023 : treffer] = 1; // ohne Schlüsselwort: eigener Themenvektor, der zu keiner Frage passt
  return v;
};

/**
 * Wissensbasis (RAG) gegen echtes PostgreSQL mit pgvector: Indexierung von Text und PDF, Rechtefilter beim Abruf
 * (Dateien nach Sichtbarkeit, Termine nach Rollenstufe, Mandantentrennung), inkrementelle Aktualisierung.
 * Alpha: Olga (Admin), Clara (Vorstand), Anna (Mitglied, AG Technik), Paul (Mitglied). Beta: Bernd (Admin).
 */
describe('Wissensbasis (echtes PostgreSQL mit pgvector)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let wissen: KnowledgeService;
  let technik: string;
  const d = (org: string, rest = '') => `/api/v1/orgs/${org}/files${rest}`;
  const absatz = (thema: string) => `${thema}: ${'Dies ist ein längerer Absatz mit ausreichend Text für einen Abschnitt. '.repeat(2)}`;

  async function datei(konto: string, name: string, inhalt: Buffer | string, felder: Record<string, string> = {}, typ = 'text/plain', org = ids.alpha): Promise<string> {
    let anfrage = f.api('post', d(org), konto).attach('file', Buffer.from(inhalt), { filename: name, contentType: typ });
    for (const [k, v] of Object.entries(felder)) anfrage = anfrage.field(k, v);
    const antwort = await anfrage;
    expect(antwort.status, JSON.stringify(antwort.body)).toBe(201);
    return antwort.body.id;
  }
  const treffer = async (konto: string, frage: string, org = ids.alpha) => {
    const aufrufer = await f.app.get(MEMBERSHIP_REPOSITORY, { strict: false }).find(konto, org);
    if (!aufrufer) throw new Error('Keine Mitgliedschaft');
    return (await wissen.suche(org, aufrufer, frage)).map((t) => t.title);
  };

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_knowledge_test');
    ids = f.ids;
    wissen = f.app.get(KnowledgeService);
    technik = (await f.admin.query("INSERT INTO working_groups (organization_id, name, description, lead, next_meeting, contact_type, contact_icon, category) VALUES ($1, 'Technik', 'Kümmert sich um Technik und Server', 'l', 'n', 'Email', 'pi-envelope', 'AGs') RETURNING id", [ids.alpha])).rows[0].id;
    await f.admin.query("INSERT INTO ag_memberships (working_group_id, member_id, role) VALUES ($1, $2, 'member')", [technik, ids.annaMitglied]);
  });
  afterAll(async () => {
    await f.schliessen();
  });
  beforeEach(() => {
    f.pgApp.llm.einbetten.mockReset().mockImplementation(async (texte: string[]) => texte.map(vektor));
  });

  describe('Indexierung von Dateien', () => {
    it('nimmt Aufträge nur von Hochladenden und Administratoren an und lehnt ungeeignete Dateien ab', async () => {
      const text = await datei(ids.anna, 'protokoll.txt', absatz('Sitzungsprotokoll'));
      const bild = await datei(ids.anna, 'bild.png', Buffer.from('89504e47', 'hex'), {}, 'image/png');
      const gross = await datei(ids.anna, 'gross.txt', 'x');
      await f.admin.query('UPDATE files SET size_bytes = 11000000 WHERE id = $1', [gross]);

      expect((await f.api('post', d(ids.alpha, `/${text}/index`), ids.paul)).status).toBe(403);
      expect((await f.api('post', d(ids.alpha, `/${text}/index`), ids.bernd)).status).toBe(403);
      expect((await f.api('post', d(ids.alpha, `/${ids.unbekannt}/index`), ids.anna)).status).toBe(404);
      expect((await f.api('post', d(ids.alpha, `/${bild}/index`), ids.anna)).body).toMatchObject({ success: false, message: expect.stringContaining('nicht unterstützt') });
      expect((await f.api('post', d(ids.alpha, `/${gross}/index`), ids.anna)).body).toMatchObject({ success: false, message: expect.stringContaining('10 MB') });
      const ok = await f.api('post', d(ids.alpha, `/${text}/index`), ids.anna);
      expect(ok.status).toBe(202);
      expect(ok.body.success).toBe(true);
      expect((await f.admin.query('SELECT count(*)::int AS n FROM index_jobs')).rows[0].n).toBe(1);
      expect((await f.api('post', d(ids.alpha, `/${text}/index`), ids.olga)).status).toBe(202); // Admin darf auch fremde; Auftrag nicht doppelt
      expect((await f.admin.query('SELECT count(*)::int AS n FROM index_jobs')).rows[0].n).toBe(1);
    });

    it('indiziert Text und PDF mit Dateikontext, setzt is_indexed und entfernt den Auftrag; Neuindizierung ersetzt alte Abschnitte', async () => {
      await f.admin.query('DELETE FROM index_jobs');
      const text = (await f.admin.query("SELECT id FROM files WHERE name = 'protokoll.txt'")).rows[0].id;
      const pdf = await datei(ids.anna, 'artikel.pdf', readFileSync(join(__dirname, '../../test/fixtures/beispiel.pdf')), {}, 'application/pdf');
      await f.api('post', d(ids.alpha, `/${text}/index`), ids.anna);
      await f.api('post', d(ids.alpha, `/${pdf}/index`), ids.anna);

      expect(await wissen.auftraegeAbarbeiten(5)).toBe(2);

      const textZeilen = await f.admin.query("SELECT title, content, organization_id, source_type, source_id, file_id, content_hash FROM knowledge_base WHERE file_id = $1", [text]);
      expect(textZeilen.rows).toHaveLength(1);
      expect(textZeilen.rows[0]).toMatchObject({ title: 'Datei: protokoll.txt (Abschnitt 1)', organization_id: ids.alpha, source_type: 'file', source_id: text });
      expect(textZeilen.rows[0].content).toContain('Datei: protokoll.txt');
      expect(textZeilen.rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
      const pdfZeilen = await f.admin.query('SELECT content FROM knowledge_base WHERE file_id = $1', [pdf]);
      expect(pdfZeilen.rows.length).toBeGreaterThan(5);
      expect(pdfZeilen.rows.some((r) => r.content.includes('nitric oxide'))).toBe(true);
      expect((await f.admin.query('SELECT count(*)::int AS n FROM files WHERE is_indexed')).rows[0].n).toBe(2);
      expect((await f.admin.query('SELECT count(*)::int AS n FROM index_jobs')).rows[0].n).toBe(0);

      await f.api('post', d(ids.alpha, `/${text}/index`), ids.anna);
      await wissen.auftraegeAbarbeiten(5);
      expect((await f.admin.query('SELECT count(*)::int AS n FROM knowledge_base WHERE file_id = $1', [text])).rows[0].n).toBe(1); // ersetzt, nicht verdoppelt
    });

    it('wiederholt fehlgeschlagene Aufträge mit Wartezeit und gibt nach drei Versuchen auf', async () => {
      const id = await datei(ids.anna, 'kaputt.txt', absatz('Defekt'));
      await f.api('post', d(ids.alpha, `/${id}/index`), ids.anna);
      f.pgApp.llm.einbetten.mockRejectedValue(new Error('KI-Dienst antwortete mit HTTP 503'));

      await wissen.auftraegeAbarbeiten(5);
      const wartend = (await f.admin.query('SELECT attempts, last_error, next_attempt_at > now() AS spaeter FROM index_jobs WHERE file_id = $1', [id])).rows[0];
      expect(wartend).toMatchObject({ attempts: 1, spaeter: true });
      expect(wartend.last_error).toContain('503');
      for (let i = 2; i <= 3; i += 1) {
        await f.admin.query('UPDATE index_jobs SET next_attempt_at = now() WHERE file_id = $1', [id]);
        await wissen.auftraegeAbarbeiten(5);
      }
      expect((await f.admin.query('SELECT count(*)::int AS n FROM index_jobs WHERE file_id = $1', [id])).rows[0].n).toBe(0);
      expect((await f.admin.query('SELECT is_indexed FROM files WHERE id = $1', [id])).rows[0].is_indexed).toBe(false);
    });
  });

  describe('Abruf mit Rechtefilter', () => {
    beforeAll(async () => {
      f.pgApp.llm.einbetten.mockImplementation(async (texte: string[]) => texte.map(vektor));
      const inhalte: Array<[string, string, Record<string, string>]> = [
        ['Satzung.txt', absatz('Satzung'), { visibility: 'member' }],
        ['Vorstandsklausur.txt', absatz('Vorstandsklausur'), { visibility: 'committee' }],
        ['Finanzen.txt', absatz('Finanzen'), { visibility: 'admin' }],
        ['Technik.txt', absatz('Technik'), { visibility: 'ag-only', working_group_id: technik }],
        ['Grillen.txt', absatz('Grillen'), { visibility: 'public' }],
      ];
      for (const [name, text, felder] of inhalte) {
        const id = await datei(ids.olga, name, text, felder);
        await f.api('post', d(ids.alpha, `/${id}/index`), ids.olga);
      }
      const betaId = await datei(ids.bernd, 'Winterfest.txt', absatz('Winterfest'), { visibility: 'member' }, 'text/plain', ids.beta);
      await f.api('post', d(ids.beta, `/${betaId}/index`), ids.bernd);
      await wissen.auftraegeAbarbeiten(20);
    });

    it('liefert nur Abschnitte von Dateien, die der Nutzer sehen darf', async () => {
      expect(await treffer(ids.anna, 'Satzung')).toEqual([expect.stringContaining('Satzung.txt')]);
      expect(await treffer(ids.anna, 'Technik')).toEqual([expect.stringContaining('Technik.txt')]); // Anna ist in der AG
      expect(await treffer(ids.paul, 'Technik')).toEqual([]);
      expect(await treffer(ids.anna, 'Finanzen')).toEqual([]);
      expect(await treffer(ids.clara, 'Vorstandsklausur')).toEqual([expect.stringContaining('Vorstandsklausur.txt')]);
      expect(await treffer(ids.clara, 'Finanzen')).toEqual([]);
      expect(await treffer(ids.olga, 'Finanzen')).toEqual([expect.stringContaining('Finanzen.txt')]);
      expect(await treffer(ids.paul, 'Grillen')).toEqual([expect.stringContaining('Grillen.txt')]);
    });

    it('liefert nie Abschnitte anderer Organisationen, auch nicht bei passender Frage', async () => {
      expect(await treffer(ids.olga, 'Winterfest')).toEqual([]);
      expect(await treffer(ids.bernd, 'Winterfest', ids.beta)).toEqual([expect.stringContaining('Winterfest.txt')]);
      expect(await treffer(ids.bernd, 'Satzung', ids.beta)).toEqual([]);
    });

    it('berücksichtigt Sichtbarkeitsänderungen und das Löschen sofort', async () => {
      const finanzen = (await f.admin.query("SELECT id FROM files WHERE name = 'Finanzen.txt'")).rows[0].id;
      await f.api('patch', d(ids.alpha, `/${finanzen}`), ids.olga, { visibility: 'member' });
      expect(await treffer(ids.paul, 'Finanzen')).toEqual([expect.stringContaining('Finanzen.txt')]);
      await f.api('patch', d(ids.alpha, `/${finanzen}`), ids.olga, { visibility: 'admin' });
      expect(await treffer(ids.paul, 'Finanzen')).toEqual([]);
      await f.api('delete', d(ids.alpha, `/${finanzen}`), ids.olga);
      expect(await treffer(ids.olga, 'Finanzen')).toEqual([]);
      expect((await f.admin.query('SELECT count(*)::int AS n FROM knowledge_base WHERE file_id = $1', [finanzen])).rows[0].n).toBe(0); // Abschnitte fallen per FK
    });
  });

  describe('Stammdaten (Arbeitsgruppen, Termine, Dokumentation)', () => {
    it('legt Abschnitte für AGs und kommende Termine an und beachtet bei Terminen die Rollenstufe', async () => {
      const termin = (extra: object) => ({ title: 'Termin', date: '2099-01-01', start_time: '10:00', location: 'Halle', ...extra });
      await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, termin({ title: 'Sommerfest', description: 'Sommerfest für alle' }));
      await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, termin({ title: 'Vorstandsklausur Termin', description: 'Vorstandsklausur', allowed_roles: ['admin'] }));
      await f.admin.query("INSERT INTO events (organization_id, title, date, start_time, location, description) VALUES ($1, 'Altes Sommerfest', '2001-01-01', '10:00', 'x', 'Sommerfest')", [ids.alpha]);
      f.pgApp.llm.einbetten.mockImplementation(async (texte: string[]) => texte.map(vektor));
      await f.admin.query("INSERT INTO working_groups (organization_id, name, description, lead, next_meeting, contact_type, contact_icon) VALUES ($1, 'Beta-Orga', 'Organisiert das Sommerfest von Beta', 'l', 'n', 'Email', 'pi-envelope')", [ids.beta]);

      const ergebnis = await wissen.stammdatenAktualisieren();

      expect(ergebnis.eingefuegt).toBeGreaterThanOrEqual(3);
      const titel = (await f.admin.query("SELECT title FROM knowledge_base WHERE organization_id = $1 AND source_type IN ('working_group', 'event') ORDER BY title", [ids.alpha])).rows.map((r) => r.title);
      expect(titel).toEqual(['Arbeitsgruppe: Technik', 'Termin: Sommerfest', 'Termin: Vorstandsklausur Termin']);
      expect(await treffer(ids.paul, 'Sommerfest')).toEqual(['Termin: Sommerfest']); // nicht die Beta-AG mit gleichem Thema
      expect(await treffer(ids.bernd, 'Sommerfest', ids.beta)).toEqual(['Arbeitsgruppe: Beta-Orga']);
      expect(await treffer(ids.paul, 'Vorstandsklausur')).toEqual([]); // Admin-Termin für Mitglieder unsichtbar
      expect(await treffer(ids.olga, 'Vorstandsklausur')).toContain('Termin: Vorstandsklausur Termin');
      expect(await treffer(ids.paul, 'Technik')).toContain('Arbeitsgruppe: Technik');
    });

    it('bettet beim zweiten Lauf nur Geändertes neu ein und entfernt Veraltetes', async () => {
      f.pgApp.llm.einbetten.mockClear();
      const unveraendert = await wissen.stammdatenAktualisieren();
      expect(unveraendert).toEqual({ eingefuegt: 0, entfernt: 0 });
      expect(f.pgApp.llm.einbetten).not.toHaveBeenCalled();

      await f.admin.query("UPDATE events SET description = 'Neue Beschreibung zum Sommerfest' WHERE title = 'Sommerfest'");
      await f.admin.query("DELETE FROM events WHERE title = 'Vorstandsklausur Termin'");
      const geaendert = await wissen.stammdatenAktualisieren();

      expect(geaendert).toEqual({ eingefuegt: 1, entfernt: 2 }); // Sommerfest ersetzt (alt weg, neu da), Klausur entfernt
      expect((await f.admin.query("SELECT content FROM knowledge_base WHERE title = 'Termin: Sommerfest'")).rows[0].content).toContain('Neue Beschreibung');
    });

    it('liest die Produktdokumentation als globale Abschnitte (für alle Organisationen)', async () => {
      const { writeFileSync, mkdtempSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const pfad = join(mkdtempSync(join(tmpdir(), 'docs-')), 'DOCS.md');
      writeFileSync(pfad, `# Handbuch\n\nEinleitung.\n\n## Satzung bearbeiten\n\nSo bearbeitest du die Satzung im Verein, Schritt für Schritt erklärt.\n\n### Finanzen verwalten\n\nSo verwaltest du die Finanzen im Verein, Schritt für Schritt erklärt.\n`);
      const mitDocs = new KnowledgeService((wissen as any).pool, { ...f.pgApp.config, docsFile: pfad }, (wissen as any).speicher, (wissen as any).llm);

      await mitDocs.stammdatenAktualisieren();

      const globale = (await f.admin.query("SELECT title, organization_id FROM knowledge_base WHERE source_type = 'doc' ORDER BY title")).rows;
      expect(globale.map((r) => r.title)).toEqual(['PulseDeck Doc: Finanzen verwalten', 'PulseDeck Doc: Handbuch', 'PulseDeck Doc: Satzung bearbeiten']);
      expect(globale.every((r) => r.organization_id === null)).toBe(true);
      expect(await treffer(ids.bernd, 'Satzung', ids.beta)).toContain('PulseDeck Doc: Satzung bearbeiten');
    });
  });
});
