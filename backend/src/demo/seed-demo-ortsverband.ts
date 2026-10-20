import type { Pool } from 'pg';

import { inTransaction } from '../common/db';
import { OrganizationsService } from '../organizations/organizations.service';

/**
 * Demo-Organisation „Ortsverband Musterstadt“ für Workshops und Gespräche: zeigt laufende Arbeitsorganisation statt eines
 * einzelnen Festes (Arbeitsgruppen, Serientermine, Aufgaben als Schichten, Wiki mit Zuständigkeiten, Feed, Umfrage).
 *
 * Alle Personen sind erfunden; ihre Adressen enden auf `.invalid` (RFC 2606) und sind nie zustellbar. Termine liegen relativ zum
 * heutigen Tag, damit die Demo nie veraltet aussieht. Aufruf siehe `seed-demo.main.ts`.
 */
export const DEMO_STANDARD_SLUG = 'demo-ortsverband';
const DOMAIN = 'musterstadt.invalid';

export interface DemoOptionen {
  /** E-Mail-Adresse eines bestehenden Kontos: wird Admin der Demo-Organisation (Vorsitz). */
  besitzerEmail: string;
  slug?: string;
  /** Eine vorhandene Demo-Organisation mit diesem Kürzel vorher löschen. */
  zuruecksetzen?: boolean;
  /** Bezugstag für alle Termine (Test); Standard: heute. */
  heute?: Date;
}

export interface DemoErgebnis {
  organizationId: string;
  slug: string;
  mitglieder: number;
  arbeitsgruppen: number;
  termine: number;
  schichten: number;
  wikiSeiten: number;
}

const PERSONEN = [
  { name: 'Katrin Vogel', rolle: 'Schriftführerin', app: 'committee', skills: ['Texte schreiben', 'Abends verfügbar'] },
  { name: 'Jonas Heinrich', rolle: 'Kassierer', app: 'committee', skills: ['Wirtschaftspolitik', 'Abends verfügbar'] },
  { name: 'Mira Aksoy', rolle: 'Stellv. Vorsitz', app: 'committee', skills: ['Moderation', 'Kommunalpolitik'] },
  { name: 'Leon Bauer', rolle: 'Wahlkampfleitung', app: 'member', skills: ['Führerschein Klasse B', 'Wochenende verfügbar'] },
  { name: 'Sabine Koch', rolle: 'Pressesprecherin', app: 'member', skills: ['Social Media', 'Grafik/Design'] },
  { name: 'Tim Neumann', rolle: '', app: 'member', skills: ['Fotografie', 'Wochenende verfügbar'] },
  { name: 'Aylin Demir', rolle: '', app: 'member', skills: ['Erste Hilfe', 'Spontan einsetzbar'] },
  { name: 'Frank Lehmann', rolle: '', app: 'member', skills: ['Handwerklich geschickt', 'Mit PKW mobil'] },
  { name: 'Eva Brandt', rolle: 'Neumitglieder-Betreuung', app: 'member', skills: ['Moderation', 'Abends verfügbar'] },
  { name: 'Paul Schröder', rolle: '', app: 'member', skills: ['Führerschein mit Anhänger', 'Wochenende verfügbar'] },
  { name: 'Nadine Roth', rolle: '', app: 'member', skills: ['Texte schreiben', 'Öffentlichkeitsarbeit'] },
  { name: 'Omar Haddad', rolle: '', app: 'member', skills: ['Kochen/Catering', 'Wochenende verfügbar'] },
] as const;

const slugPerson = (name: string): string =>
  name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z]+/g, '.');

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const deutsch = (d: Date): string => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;

export async function seedeDemoOrtsverband(pool: Pool, optionen: DemoOptionen): Promise<DemoErgebnis> {
  const slug = optionen.slug ?? DEMO_STANDARD_SLUG;
  const heute = optionen.heute ?? new Date();
  const tag = (versatz: number): Date => new Date(Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth(), heute.getUTCDate() + versatz));

  const konto = await pool.query<{ id: string }>('SELECT id FROM auth_users WHERE email = $1', [optionen.besitzerEmail.trim()]);
  if (!konto.rows[0]) throw new Error(`Kein Konto mit dieser E-Mail-Adresse: erst normal registrieren und bestätigen (${optionen.besitzerEmail})`);
  const besitzerId = konto.rows[0].id;

  const vorhanden = await pool.query<{ id: string }>('SELECT id FROM organizations WHERE slug = $1', [slug]);
  if (vorhanden.rows[0]) {
    if (!optionen.zuruecksetzen) throw new Error(`Die Organisation „${slug}“ gibt es schon; mit --reset löschen und neu anlegen`);
    await pool.query('DELETE FROM organizations WHERE id = $1', [vorhanden.rows[0].id]); // alles Weitere folgt per ON DELETE CASCADE
  }

  const org = await new OrganizationsService(pool).anlegen(besitzerId, { name: 'Ortsverband Musterstadt', slug, ownerName: 'Demo-Vorsitz' });

  return inTransaction(pool, async (db) => {
    await db.query("UPDATE organizations SET description = $2, branding_enabled = true WHERE id = $1", [
      org.id,
      'Demo-Organisation: erfundene Personen und Inhalte, nur zum Ausprobieren und für Workshops.',
    ]);

    const rolle = (await db.query<{ id: string }>("SELECT id FROM organization_roles WHERE organization_id = $1 AND is_default", [org.id])).rows[0].id;
    const vorsitz = (await db.query<{ id: string }>("SELECT id FROM members WHERE organization_id = $1 AND user_id = $2", [org.id, besitzerId])).rows[0].id;
    await db.query("UPDATE members SET role = 'Vorsitz', department = 'Vorstand' WHERE id = $1", [vorsitz]);

    const mitglied: Record<string, string> = { 'Demo-Vorsitz': vorsitz };
    for (const [i, p] of PERSONEN.entries()) {
      const r = await db.query<{ id: string }>(
        `INSERT INTO members (organization_id, role_id, app_role, role, name, status, email, join_date)
         VALUES ($1, $2, $3, $4, $5, 'Active', $6, $7) RETURNING id`,
        [org.id, rolle, p.app, p.rolle || null, p.name, `${slugPerson(p.name)}@${DOMAIN}`, deutsch(tag(-400 + i * 23))]
      );
      mitglied[p.name] = r.rows[0].id;
      await db.query(
        `INSERT INTO member_skills (member_id, skill_id)
         SELECT $1, s.id FROM skills s WHERE s.organization_id = $2 AND s.name = ANY($3::text[])`,
        [r.rows[0].id, org.id, p.skills]
      );
    }
    const alle = Object.values(mitglied);
    const von = (...namen: string[]): string[] => namen.map((n) => mitglied[n]);

    // ── Arbeitsgruppen ───────────────────────────────────────────────────────────
    const ag = async (name: string, beschreibung: string, leitung: string, kategorie: string, kontakt: string, mitglieder: string[], naechstes: string): Promise<string> => {
      const r = await db.query<{ id: string }>(
        `INSERT INTO working_groups (organization_id, name, description, lead, members_count, next_meeting, contact_type, contact_value, contact_icon, category)
         VALUES ($1, $2, $3, $4, $5, $6, 'Email', $7, 'pi-envelope', $8) RETURNING id`,
        [org.id, name, beschreibung, leitung, mitglieder.length, naechstes, kontakt, kategorie]
      );
      for (const m of mitglieder) {
        await db.query("INSERT INTO ag_memberships (working_group_id, member_id, role) VALUES ($1, $2, $3)", [r.rows[0].id, mitglied[m], m === leitung ? 'lead' : 'member']);
      }
      return r.rows[0].id;
    };
    const agVorstand = await ag('Vorstand', 'Sitzungen, Beschlüsse, Finanzen und die Verteilung der Zuständigkeiten.', 'Demo-Vorsitz', 'Leitung', `vorstand@${DOMAIN}`, ['Demo-Vorsitz', 'Katrin Vogel', 'Jonas Heinrich', 'Mira Aksoy'], 'siehe Kalender');
    const agWahlkampf = await ag('AG Wahlkampf', 'Infostände, Plakatierung und Haustürgespräche für die Kommunalwahl.', 'Leon Bauer', 'Aktionen', `wahlkampf@${DOMAIN}`, ['Leon Bauer', 'Tim Neumann', 'Aylin Demir', 'Frank Lehmann', 'Paul Schröder', 'Omar Haddad'], 'siehe Kalender');
    const agPresse = await ag('AG Öffentlichkeitsarbeit', 'Pressemitteilungen, Social Media und der Newsletter des Ortsverbands.', 'Sabine Koch', 'Kommunikation', `presse@${DOMAIN}`, ['Sabine Koch', 'Nadine Roth', 'Tim Neumann', 'Katrin Vogel'], 'siehe Kalender');
    const agNeue = await ag('AG Neumitglieder', 'Einstieg für Neue: Patenschaften, erste Aufgaben, Antworten auf erste Fragen.', 'Eva Brandt', 'Mitglieder', `neue@${DOMAIN}`, ['Eva Brandt', 'Mira Aksoy', 'Nadine Roth'], 'siehe Kalender');

    // ── Termine (Serien), Aufgaben als Schichten ───────────────────────────────
    let termine = 0;
    let schichten = 0;
    const termin = async (
      t: { titel: string; tage: number; von: string; bis: string; ort: string; beschreibung: string; ag?: string; agName?: string; oeffentlich?: boolean; anmeldung?: boolean; serie?: 'biweekly' | 'monthly'; eltern?: string; art?: string }
    ): Promise<string> => {
      const r = await db.query<{ id: string }>(
        `INSERT INTO events (organization_id, title, date, start_time, end_time, location, description, ag_name, working_group_id, allowed_roles,
                             registration_required, location_type, meeting_reason, is_recurring, recurrence_interval, recurrence_parent_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [
          org.id, t.titel, iso(tag(t.tage)), t.von, t.bis, t.ort, t.beschreibung, t.agName ?? null, t.ag ?? null,
          t.oeffentlich ? ['public', 'member', 'committee', 'admin'] : ['member', 'committee', 'admin'],
          t.anmeldung ?? false, t.art ?? 'onsite', null, !!t.serie, t.serie ?? null, t.eltern ?? null,
        ]
      );
      termine++;
      return r.rows[0].id;
    };
    const schicht = async (eventId: string, titel: string, platz: number, von: string | null, bis: string | null, sortierung: number, dabei: string[] = []): Promise<void> => {
      const s = await db.query<{ id: string }>(
        'INSERT INTO event_slots (organization_id, event_id, title, start_time, end_time, max_helpers, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [org.id, eventId, titel, von, bis, platz, sortierung]
      );
      schichten++;
      for (const m of dabei) await db.query("INSERT INTO event_slot_signups (organization_id, slot_id, member_id, status) VALUES ($1, $2, $3, 'confirmed')", [org.id, s.rows[0].id, mitglied[m]]);
    };
    const serie = async (basis: Parameters<typeof termin>[0], intervallTage: number, anzahl: number): Promise<string> => {
      const eltern = await termin({ ...basis, serie: basis.serie });
      for (let i = 1; i < anzahl; i++) await termin({ ...basis, serie: basis.serie, eltern, tage: basis.tage + i * intervallTage });
      return eltern;
    };

    await serie({ titel: 'Vorstandssitzung', tage: 4, von: '19:00', bis: '21:00', ort: 'Bürgerhaus, Raum 2', beschreibung: 'Tagesordnung steht vorab im Wiki, Protokoll danach ebenfalls.', ag: agVorstand, agName: 'Vorstand', serie: 'monthly' }, 28, 3);
    await serie({ titel: 'AG Wahlkampf: Wochenplanung', tage: 2, von: '18:30', bis: '19:30', ort: 'Online (Videokonferenz)', beschreibung: 'Wer macht welche Aufgaben in den nächsten zwei Wochen?', ag: agWahlkampf, agName: 'AG Wahlkampf', serie: 'biweekly', art: 'zoom' }, 14, 3);
    await serie({ titel: 'AG Öffentlichkeitsarbeit: Redaktionsrunde', tage: 8, von: '19:00', bis: '20:00', ort: 'Online (Videokonferenz)', beschreibung: 'Themenplan, Pressemitteilungen und Beiträge für den Newsletter.', ag: agPresse, agName: 'AG Öffentlichkeitsarbeit', serie: 'monthly', art: 'zoom' }, 28, 2);

    const neuentreffen = await termin({ titel: 'Neumitglieder-Treffen: Einstieg im Ortsverband', tage: 6, von: '18:00', bis: '19:30', ort: 'Café am Markt', beschreibung: 'Kennenlernen, Überblick über die Arbeitsgruppen und die ersten konkreten Aufgaben.', ag: agNeue, agName: 'AG Neumitglieder', oeffentlich: true });
    await schicht(neuentreffen, 'Begrüßung und Rundgang', 1, null, null, 1, ['Eva Brandt']);
    await schicht(neuentreffen, 'Patenschaft übernehmen', 4, null, null, 2, ['Mira Aksoy', 'Nadine Roth']);

    const versammlung = await termin({ titel: 'Mitgliederversammlung', tage: 28, von: '19:00', bis: '21:30', ort: 'Bürgerhaus, großer Saal', beschreibung: 'Rechenschaftsbericht, Haushalt, Wahl der Delegierten. Einladung und Unterlagen im Wiki.', ag: agVorstand, agName: 'Vorstand', anmeldung: true });
    await schicht(versammlung, 'Einlass und Anwesenheitsliste', 2, '18:30', '19:15', 1, ['Katrin Vogel']);
    await schicht(versammlung, 'Protokoll führen', 1, '19:00', '21:30', 2, ['Katrin Vogel']);
    await schicht(versammlung, 'Technik und Beamer', 1, '18:15', '21:30', 3, []);
    await schicht(versammlung, 'Getränke und Snacks', 2, '18:30', '21:30', 4, ['Omar Haddad']);
    for (const m of alle.slice(0, 9)) await db.query("INSERT INTO event_registrations (event_id, member_id, status) VALUES ($1, $2, 'confirmed')", [versammlung, m]);

    const infostand = await termin({ titel: 'Infostand Marktplatz', tage: 9, von: '10:00', bis: '16:00', ort: 'Marktplatz Musterstadt', beschreibung: 'Samstags am Wochenmarkt: Gespräche, Flyer, Unterschriften für den Bürgerantrag.', ag: agWahlkampf, agName: 'AG Wahlkampf', oeffentlich: true });
    await schicht(infostand, 'Aufbau', 2, '09:30', '10:00', 1, ['Frank Lehmann', 'Paul Schröder']);
    await schicht(infostand, 'Stand 10 bis 12 Uhr', 3, '10:00', '12:00', 2, ['Leon Bauer', 'Aylin Demir']);
    await schicht(infostand, 'Stand 12 bis 14 Uhr', 3, '12:00', '14:00', 3, ['Tim Neumann']);
    await schicht(infostand, 'Stand 14 bis 16 Uhr und Abbau', 3, '14:00', '16:30', 4, []);

    const plakate = await termin({ titel: 'Plakatierung: Gebiete verteilen', tage: 16, von: '09:00', bis: '13:00', ort: 'Treffpunkt Lager Hafenstraße', beschreibung: 'Jedes Gebiet bekommt ein Team. Routen und Genehmigungen stehen im Wiki.', ag: agWahlkampf, agName: 'AG Wahlkampf' });
    await schicht(plakate, 'Gebiet Nord', 2, null, null, 1, ['Paul Schröder', 'Frank Lehmann']);
    await schicht(plakate, 'Gebiet Süd', 2, null, null, 2, ['Omar Haddad']);
    await schicht(plakate, 'Gebiet Mitte', 2, null, null, 3, []);
    await schicht(plakate, 'Gebiet Ost', 2, null, null, 4, []);

    await db.query('UPDATE working_groups g SET next_meeting = COALESCE((SELECT min(e.date) FROM events e WHERE e.working_group_id = g.id AND e.date >= $2), $3) WHERE g.organization_id = $1', [org.id, iso(tag(0)), 'Nicht geplant']);

    // ── Wiki: Zuständigkeiten, Protokolle, Übergaben ────────────────────────────
    let wikiSeiten = 0;
    const kategorie = async (name: string, icon: string, nr: number): Promise<string> =>
      (await db.query<{ id: string }>('INSERT INTO wiki_categories (organization_id, name, icon, sort_order) VALUES ($1, $2, $3, $4) RETURNING id', [org.id, name, icon, nr])).rows[0].id;
    const seite = async (kat: string, titel: string, beschreibung: string, inhalt: string, autor: string, gruppe?: string): Promise<void> => {
      await db.query(
        `INSERT INTO wiki_docs (organization_id, title, description, content, last_updated, author, status, category, working_group_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'Published', $7, $8)`,
        [org.id, titel, beschreibung, inhalt, deutsch(tag(-3)), autor, kat, gruppe ?? null]
      );
      wikiSeiten++;
    };
    const katOrga = await kategorie('Organisation', 'pi-sitemap', 1);
    const katVorstand = await kategorie('Vorstandsarbeit', 'pi-briefcase', 2);
    const katAktion = await kategorie('Aktionen', 'pi-megaphone', 3);

    await seite(katOrga, 'Wer macht was? Zuständigkeiten im Ortsverband', 'Aufgabe, zuständige Person, Vertretung und Rhythmus auf einen Blick.',
      ['## Zuständigkeiten', '', '| Aufgabe | Zuständig | Vertretung | Rhythmus |', '|---|---|---|---|',
        '| Einladungen und Protokolle | Katrin Vogel | Mira Aksoy | je Sitzung |', '| Kasse und Spendenbescheinigungen | Jonas Heinrich | Demo-Vorsitz | monatlich |',
        '| Pressemitteilungen | Sabine Koch | Nadine Roth | nach Bedarf |', '| Infostände und Plakate | Leon Bauer | Paul Schröder | wöchentlich im Wahlkampf |',
        '| Neumitglieder begrüßen | Eva Brandt | Mira Aksoy | innerhalb von 7 Tagen |', '', 'Änderungen bitte direkt hier eintragen und im nächsten Vorstandstreffen bestätigen.'].join('\n'), 'Demo-Vorsitz', agVorstand);
    await seite(katOrga, 'Einstieg für Neue: die ersten vier Wochen', 'Was neue Aktive in welcher Woche erledigen können.',
      ['## Woche 1', 'Profil ausfüllen, Fähigkeiten eintragen, Patin oder Paten kennenlernen.', '', '## Woche 2', 'Eine Arbeitsgruppe besuchen und eine kleine Aufgabe übernehmen (Schicht am Infostand).', '',
        '## Woche 3', 'Beim Neumitglieder-Treffen eine Frage stellen und eine Frage beantworten.', '', '## Woche 4', 'Eine eigene Aufgabe verantworten, zum Beispiel ein Plakatgebiet.'].join('\n'), 'Eva Brandt', agNeue);
    await seite(katVorstand, 'Protokoll Vorstandssitzung: Vorlage', 'So sieht ein Protokoll aus, damit alle Beschlüsse später auffindbar sind.',
      ['## Kopf', 'Datum, Ort, Anwesende, Protokollführung', '', '## Beschlüsse', '- Beschluss, wer ist zuständig, bis wann', '', '## Offene Punkte', '- Punkt, Verantwortliche, nächste Sitzung'].join('\n'), 'Katrin Vogel', agVorstand);
    await seite(katVorstand, 'Vorstandswechsel: Übergabe-Checkliste', 'Was die scheidende Person übergibt, damit nichts verloren geht.',
      ['- [ ] Zugänge (Postfach, Website, Social Media) übergeben und Passwörter wechseln', '- [ ] Laufende Verträge und Fristen auflisten', '- [ ] Kontoverfügungen und Kassenbuch klären',
        '- [ ] Ansprechpersonen im Kreisverband vorstellen', '- [ ] Offene Aufgaben mit Datum in dieses Wiki eintragen'].join('\n'), 'Demo-Vorsitz', agVorstand);
    await seite(katAktion, 'Plakatierung: Gebiete, Routen und Genehmigungen', 'Wer welches Gebiet übernimmt und was vorher beim Ordnungsamt zu klären ist.',
      ['## Gebiete', 'Nord, Süd, Mitte und Ost, je Gebiet ein Team mit zwei Personen.', '', '## Genehmigungen', 'Plakatierung ist vier Wochen vor der Wahl erlaubt, Ansprechperson im Ordnungsamt steht bei den Kontakten.', '',
        '## Material', 'Kabelbinder, Leiter und Anhänger liegen im Lager Hafenstraße.'].join('\n'), 'Leon Bauer', agWahlkampf);

    // ── Feed und Umfrage ────────────────────────────────────────────────────────
    const beitrag = async (titel: string, inhalt: string, autor: string, angepinnt: boolean, oeffentlich: boolean, tageZurueck: number): Promise<string> =>
      (await db.query<{ id: string }>(
        `INSERT INTO feed_items (organization_id, title, content, type, status, author_id, sent_at, is_public, is_pinned, created_at)
         VALUES ($1, $2, $3, 'article', 'sent', $4, $5, $6, $7, $5) RETURNING id`,
        [org.id, titel, inhalt, mitglied[autor], new Date(heute.getTime() - tageZurueck * 86_400_000), oeffentlich, angepinnt]
      )).rows[0].id;
    const willkommen = await beitrag('Willkommen: So arbeiten wir im Ortsverband', 'Zuständigkeiten stehen im Wiki, Aufgaben tragt ihr euch im Kalender selbst ein, Absprachen zwischendurch laufen im Messenger. Alles, was länger gelten soll, gehört hierher oder ins Wiki.', 'Demo-Vorsitz', true, true, 10);
    const protokoll = await beitrag('Protokoll der letzten Vorstandssitzung ist im Wiki', 'Drei Beschlüsse: Plakatgebiete sind verteilt, die Mitgliederversammlung ist terminiert, die Kasse ist geprüft.', 'Katrin Vogel', false, false, 3);
    for (const m of [...alle.slice(0, 9)]) await db.query('INSERT INTO feed_item_reads (feed_item_id, member_id, read_at) VALUES ($1, $2, $3)', [willkommen, m, new Date(heute.getTime() - 9 * 86_400_000)]);
    for (const m of alle.slice(0, 5)) await db.query('INSERT INTO feed_item_reads (feed_item_id, member_id) VALUES ($1, $2)', [protokoll, m]);

    const umfrage = (await db.query<{ id: string }>(
      `INSERT INTO feed_items (organization_id, title, content, type, status, author_id, sent_at, is_public, poll_config)
       VALUES ($1, 'Wann soll die Mitgliederversammlung beginnen?', 'Bitte bis Freitag abstimmen.', 'poll', 'sent', $2, now(), false, '{}'::jsonb) RETURNING id`,
      [org.id, vorsitz]
    )).rows[0].id;
    const optionen: string[] = [];
    for (const [i, text] of ['18:30 Uhr', '19:00 Uhr', '19:30 Uhr'].entries()) {
      optionen.push((await db.query<{ id: string }>('INSERT INTO poll_options (feed_item_id, text, sort_order) VALUES ($1, $2, $3) RETURNING id', [umfrage, text, i])).rows[0].id);
    }
    for (const [i, m] of alle.slice(0, 7).entries()) await db.query('INSERT INTO poll_votes (option_id, member_id) VALUES ($1, $2)', [optionen[[1, 1, 0, 1, 2, 1, 0][i]], m]);

    // ── Ansprechpersonen ────────────────────────────────────────────────────────
    for (const [name, funktion, beschreibung] of [
      ['Demo-Vorsitz', 'Vorsitz', 'Erste Anlaufstelle für Presse und Kreisverband'],
      ['Eva Brandt', 'Neumitglieder-Betreuung', 'Für alle, die mitmachen möchten'],
    ] as const) {
      await db.query('INSERT INTO contacts (organization_id, name, role, description, email, location) VALUES ($1, $2, $3, $4, $5, $6)', [org.id, name, funktion, beschreibung, `${slugPerson(name)}@${DOMAIN}`, 'Musterstadt']);
    }

    return { organizationId: org.id, slug, mitglieder: alle.length, arbeitsgruppen: 4, termine, schichten, wikiSeiten };
  });
}

