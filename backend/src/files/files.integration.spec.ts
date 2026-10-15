import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

/**
 * Dateien, Ordner und Download gegen echtes PostgreSQL und ein echtes Dateisystem-Volume: Sichtbarkeitsstufen auch beim
 * Byte-Abruf, Rechte, sichere Auslieferung, kurzlebige Links, Mandantentrennung.
 * Alpha: Olga (Admin), Clara (Vorstand), Anna (Mitglied, AG Technik), Paul (Mitglied). Beta: Bernd (Admin), Clara (Mitglied).
 */
describe('Dateien (echtes PostgreSQL und Dateisystem)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let technik: string;
  let betaAg: string;
  const d = (org: string, rest = '') => `/api/v1/orgs/${org}/files${rest}`;
  const ordnerPfad = (org: string, rest = '') => `/api/v1/orgs/${org}/folders${rest}`;
  const speicherPfad = (org: string, id: string) => join(f.pgApp.config.storage.dir, org, id);

  async function lade(konto: string, name: string, inhalt: Buffer | string, felder: Record<string, string | undefined> = {}, typ = 'text/plain', org = ids.alpha) {
    let anfrage = f.api('post', d(org), konto).attach('file', Buffer.from(inhalt), { filename: name, contentType: typ });
    for (const [k, v] of Object.entries(felder)) if (v !== undefined) anfrage = anfrage.field(k, v);
    return anfrage;
  }
  async function hochgeladen(konto: string, name: string, felder: Record<string, string> = {}, inhalt: Buffer | string = `Inhalt von ${name}`, typ = 'text/plain', org = ids.alpha): Promise<string> {
    const antwort = await lade(konto, name, inhalt, felder, typ, org);
    expect(antwort.status, JSON.stringify(antwort.body)).toBe(201);
    return antwort.body.id;
  }

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_files_test');
    ids = f.ids;
    const ag = async (org: string, name: string) =>
      (await f.admin.query("INSERT INTO working_groups (organization_id, name, description, lead, next_meeting, contact_type, contact_icon) VALUES ($1, $2, 'd', 'l', 'n', 'Email', 'pi-envelope') RETURNING id", [org, name])).rows[0].id;
    technik = await ag(ids.alpha, 'Technik');
    betaAg = await ag(ids.beta, 'Beta-AG');
    await f.admin.query("INSERT INTO ag_memberships (working_group_id, member_id, role) VALUES ($1, $2, 'member')", [technik, ids.annaMitglied]);
  });
  afterAll(async () => {
    await f.schliessen();
  });

  it('lädt Dateien hoch: Metadaten, Speicherschlüssel aus UUIDs, Inhalt im Volume, Audit', async () => {
    const antwort = await lade(ids.anna, 'Protokoll Größe.txt', 'Hallo Welt', { description: 'Sitzung', visibility: 'member' });

    expect(antwort.status).toBe(201);
    expect(antwort.body).toMatchObject({
      name: 'Protokoll Größe.txt', original_name: 'Protokoll Größe.txt', mime_type: 'text/plain', size_bytes: 10, visibility: 'member', description: 'Sitzung',
      organization_id: ids.alpha, uploaded_by: ids.annaMitglied, folder_id: null, is_pinned: false, is_indexed: false, uploader: { name: 'Anna' },
    });
    expect(antwort.body.storage_path).toBe(`${ids.alpha}/${antwort.body.id}`);
    expect(existsSync(speicherPfad(ids.alpha, antwort.body.id))).toBe(true);
    const audit = await f.admin.query("SELECT operation, performed_by FROM audit_logs WHERE table_name = 'files' AND record_id = $1", [antwort.body.id]);
    expect(audit.rows).toEqual([{ operation: 'INSERT', performed_by: ids.anna }]);
  });

  it('bereinigt Dateinamen (Pfadtrenner, Steuerzeichen) und lehnt ungültige Uploads ab', async () => {
    const boese = await lade(ids.anna, '../../etc/passwd', 'x');
    expect(boese.body.name).toBe('passwd'); // multer entfernt den Pfad; der Name beeinflusst den Speicherort ohnehin nie
    expect(boese.body.storage_path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/); // Name beeinflusst den Speicherort nie

    const gross = await lade(ids.anna, 'gross.bin', Buffer.alloc(1024 * 1024 + 1), {}, 'application/octet-stream');
    expect(gross.status).toBe(413);
    expect((await f.api('post', d(ids.alpha), ids.anna).field('visibility', 'member')).status).toBe(400); // keine Datei
    expect((await lade(ids.anna, 'leer.txt', '')).status).toBe(400);
    for (const felder of [{ visibility: 'geheim' }, { organization_id: ids.beta }, { uploaded_by: ids.olgaMitglied }, { visibility: 'ag-only' }, { working_group_id: 'keine-uuid' }, { folder_id: ids.unbekannt }]) {
      expect((await lade(ids.anna, 'x.txt', 'x', felder)).status, JSON.stringify(felder)).toBe(400);
    }
    expect((await lade(ids.anna, 'x.txt', 'x', { visibility: 'ag-only', working_group_id: betaAg })).status).toBe(400); // fremde Organisation
    expect((await lade(ids.paul, 'x.txt', 'x', { visibility: 'ag-only', working_group_id: technik })).status).toBe(403); // nicht Mitglied der AG
    expect((await lade(ids.bernd, 'x.txt', 'x')).status).toBe(403);
    expect((await f.api('post', d(ids.alpha), null).attach('file', Buffer.from('x'), 'x.txt')).status).toBe(401);
  });

  it('zeigt jeder Stufe nur ihre Dateien – in Liste, Metadaten, Inhalt und Download-Link', async () => {
    const dateien = {
      public: await hochgeladen(ids.olga, 'V-public.txt', { visibility: 'public' }),
      member: await hochgeladen(ids.olga, 'V-member.txt', { visibility: 'member' }),
      committee: await hochgeladen(ids.olga, 'V-committee.txt', { visibility: 'committee' }),
      admin: await hochgeladen(ids.olga, 'V-admin.txt', { visibility: 'admin' }),
      ag: await hochgeladen(ids.olga, 'V-ag.txt', { visibility: 'ag-only', working_group_id: technik }),
      pauls: await hochgeladen(ids.paul, 'V-pauls.txt', { visibility: 'admin' }),
    };
    const namen = async (konto: string) => (await f.api('get', d(ids.alpha), konto)).body.map((x: { name: string }) => x.name).filter((n: string) => n.startsWith('V-')).sort();

    expect(await namen(ids.olga)).toEqual(['V-admin.txt', 'V-ag.txt', 'V-committee.txt', 'V-member.txt', 'V-pauls.txt', 'V-public.txt']);
    expect(await namen(ids.clara)).toEqual(['V-committee.txt', 'V-member.txt', 'V-public.txt']);
    expect(await namen(ids.anna)).toEqual(['V-ag.txt', 'V-member.txt', 'V-public.txt']);
    expect(await namen(ids.paul)).toEqual(['V-member.txt', 'V-pauls.txt', 'V-public.txt']); // eigene Admin-Datei bleibt sichtbar

    const verborgen: Array<[string, string]> = [[ids.anna, dateien.admin], [ids.anna, dateien.committee], [ids.paul, dateien.ag], [ids.clara, dateien.admin], [ids.clara, dateien.ag], [ids.paul, dateien.committee]];
    for (const [konto, id] of verborgen) {
      for (const [methode, pfad] of [['get', d(ids.alpha, `/${id}`)], ['get', d(ids.alpha, `/${id}/content`)], ['post', d(ids.alpha, `/${id}/download-link`)]] as const) {
        expect((await f.api(methode, pfad, konto)).status, `${konto} ${methode} ${pfad}`).toBe(404);
      }
    }
    expect((await f.api('get', d(ids.alpha, `/${dateien.ag}/content`), ids.anna)).status).toBe(200);
    expect((await f.api('get', d(ids.alpha, `/${dateien.pauls}/content`), ids.paul)).status).toBe(200);
  });

  it('liefert Inhalte sicher aus: Anhang mit nosniff und Sandbox, Inline nur für harmlose Typen, UTF-8-Dateiname', async () => {
    const html = await hochgeladen(ids.anna, 'seite.html', {}, '<script>alert(1)</script>', 'text/html');
    const png = await hochgeladen(ids.anna, 'bild äö.png', {}, PNG, 'image/png');
    const svg = await hochgeladen(ids.anna, 'logo.svg', {}, '<svg onload="alert(1)"/>', 'image/svg+xml');
    const weird = await hochgeladen(ids.anna, 'x.bin');
    await f.admin.query("UPDATE files SET mime_type = 'text/html; charset=utf-8; <script>' WHERE id = $1", [weird]); // z. B. aus Altbestand importiert

    const a = await f.api('get', d(ids.alpha, `/${html}/content?inline=1`), ids.anna);
    expect(a.status).toBe(200);
    expect(a.headers['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''seite\.html$/);
    expect(a.headers['x-content-type-options']).toBe('nosniff');
    expect(a.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    expect(a.headers['cache-control']).toBe('private, no-store');
    expect(a.text).toBe('<script>alert(1)</script>');

    const p = await f.api('get', d(ids.alpha, `/${png}/content?inline=1`), ids.anna).buffer(true).parse((res, cb) => { const t: Buffer[] = []; res.on('data', (c) => t.push(c)); res.on('end', () => cb(null, Buffer.concat(t))); });
    expect(p.headers['content-disposition']).toBe("inline; filename*=UTF-8''bild%20%C3%A4%C3%B6.png");
    expect(p.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(p.body as Buffer, PNG)).toBe(0);
    expect((await f.api('get', d(ids.alpha, `/${png}/content`), ids.anna)).headers['content-disposition']).toMatch(/^attachment/);
    expect((await f.api('get', d(ids.alpha, `/${svg}/content?inline=1`), ids.anna)).headers['content-disposition']).toMatch(/^attachment/);
    expect((await f.api('get', d(ids.alpha, `/${weird}/content`), ids.anna)).headers['content-type']).toMatch(/^application\/octet-stream/); // ungültiger Typ wird nie weitergereicht
  });

  it('beschränkt Ändern, Anheften, Verschieben und Löschen auf Hochladende und Administratoren', async () => {
    const id = await hochgeladen(ids.anna, 'A-datei.txt', { visibility: 'member' });
    const ordner = (await f.api('post', ordnerPfad(ids.alpha), ids.olga, { name: 'Verträge' })).body.id;

    expect((await f.api('patch', d(ids.alpha, `/${id}`), ids.paul, { description: 'Hack' })).status).toBe(403); // sichtbar, aber fremd
    expect((await f.api('delete', d(ids.alpha, `/${id}`), ids.paul)).status).toBe(403);
    const vonAutor = await f.api('patch', d(ids.alpha, `/${id}`), ids.anna, { name: 'Neu benannt.txt', description: 'Beschreibung', is_pinned: true, folder_id: ordner });
    expect(vonAutor.body).toMatchObject({ name: 'Neu benannt.txt', description: 'Beschreibung', is_pinned: true, folder_id: ordner });
    expect((await f.api('patch', d(ids.alpha, `/${id}`), ids.olga, { visibility: 'committee' })).body.visibility).toBe('committee'); // Admin darf fremde Dateien ändern
    for (const falsch of [{ organization_id: ids.beta }, { storage_path: 'x/y' }, { uploaded_by: ids.olgaMitglied }, { visibility: 'ag-only' }, { visibility: 'geheim' }, { folder_id: ids.unbekannt }, { working_group_id: betaAg }]) {
      expect((await f.api('patch', d(ids.alpha, `/${id}`), ids.anna, falsch)).status, JSON.stringify(falsch)).toBe(400);
    }
    // Wer eine Datei hochgeladen hat, behält sie im Blick, auch wenn er sie auf „nur Admin“ stellt; andere verlieren den Zugriff
    expect((await f.api('patch', d(ids.alpha, `/${id}`), ids.anna, { visibility: 'admin' })).body.visibility).toBe('admin');
    expect((await f.api('get', d(ids.alpha, `/${id}`), ids.paul)).status).toBe(404);
  });

  it('löscht Datei samt Inhalt im Volume; Rest anderer Organisationen bleibt unberührt', async () => {
    const eigene = await hochgeladen(ids.anna, 'weg.txt');
    const beta = await hochgeladen(ids.bernd, 'beta.txt', {}, 'Beta', 'text/plain', ids.beta);
    expect(existsSync(speicherPfad(ids.alpha, eigene))).toBe(true);

    expect((await f.api('delete', d(ids.alpha, `/${beta}`), ids.olga)).status).toBe(404);
    expect((await f.api('delete', d(ids.alpha, `/${eigene}`), ids.anna)).status).toBe(204);

    expect(existsSync(speicherPfad(ids.alpha, eigene))).toBe(false);
    expect(existsSync(speicherPfad(ids.beta, beta))).toBe(true);
    expect((await f.api('get', d(ids.alpha, `/${eigene}`), ids.olga)).status).toBe(404);
    const audit = await f.admin.query("SELECT operation FROM audit_logs WHERE table_name = 'files' AND record_id = $1 ORDER BY created_at", [eigene]);
    expect(audit.rows.map((r) => r.operation)).toEqual(['INSERT', 'DELETE']);
  });

  it('filtert nach Ordner, Anheftung, Arbeitsgruppe und Suchbegriff (Wildcards wörtlich)', async () => {
    const ordner = (await f.api('post', ordnerPfad(ids.alpha), ids.olga, { name: 'Filter' })).body.id;
    await hochgeladen(ids.olga, 'F-im-ordner.txt', { folder_id: ordner });
    await hochgeladen(ids.olga, 'F-im-root.txt');
    const angeheftet = await hochgeladen(ids.olga, 'F-pin_100%.txt', { visibility: 'ag-only', working_group_id: technik });
    await f.api('patch', d(ids.alpha, `/${angeheftet}`), ids.olga, { is_pinned: true });
    const namen = async (query: string, konto = ids.olga) => (await f.api('get', d(ids.alpha, `?${query}`), konto)).body.map((x: { name: string }) => x.name).filter((n: string) => n.startsWith('F-')).sort();

    expect(await namen(`folder_id=${ordner}`)).toEqual(['F-im-ordner.txt']);
    expect((await namen('folder_id=root')).sort()).toEqual(['F-im-root.txt', 'F-pin_100%.txt']);
    expect(await namen('pinned=true')).toEqual(['F-pin_100%.txt']);
    expect(await namen(`working_group_id=${technik}&pinned=true`)).toEqual(['F-pin_100%.txt']);
    expect(await namen('q=F-im')).toEqual(['F-im-ordner.txt', 'F-im-root.txt']);
    expect(await namen('q=%25')).toEqual(['F-pin_100%.txt']); // „%“ sucht wörtlich
    expect(await namen('q=_')).toEqual(['F-pin_100%.txt']); // „_“ ebenso
    expect(await namen('pinned=true', ids.paul)).toEqual([]); // AG-Datei für Paul unsichtbar
    expect((await f.api('get', d(ids.alpha, '?sort=recent&limit=2'), ids.olga)).body).toHaveLength(2);
    for (const falsch of ['folder_id=x', 'limit=0', 'limit=500', 'sort=zufall', 'pinned=vielleicht', 'q=']) expect((await f.api('get', d(ids.alpha, `?${falsch}`), ids.olga)).status, falsch).toBe(400);
  });

  describe('Ordner', () => {
    it('legt Ordner nur durch Vorstand/Admin an, prüft Eltern der eigenen Organisation und benennt um', async () => {
      const wurzel = await f.api('post', ordnerPfad(ids.alpha), ids.clara, { name: ' Protokolle ' });
      expect(wurzel.status).toBe(201);
      expect(wurzel.body).toMatchObject({ name: 'Protokolle', parent_id: null, organization_id: ids.alpha, created_by: ids.claraAlpha, file_count: 0 });
      const kind = await f.api('post', ordnerPfad(ids.alpha), ids.olga, { name: '2026', parent_id: wurzel.body.id });
      expect(kind.status).toBe(201);

      expect((await f.api('post', ordnerPfad(ids.alpha), ids.anna, { name: 'Hack' })).status).toBe(403);
      const betaOrdner = (await f.api('post', ordnerPfad(ids.beta), ids.bernd, { name: 'Beta' })).body.id;
      expect((await f.api('post', ordnerPfad(ids.alpha), ids.olga, { name: 'X', parent_id: betaOrdner })).status).toBe(400);
      expect((await f.api('post', ordnerPfad(ids.alpha), ids.olga, { name: '', organization_id: ids.beta })).status).toBe(400);
      expect((await f.api('patch', ordnerPfad(ids.alpha, `/${betaOrdner}`), ids.olga, { name: 'Hack' })).status).toBe(404);
      expect((await f.api('patch', ordnerPfad(ids.alpha, `/${wurzel.body.id}`), ids.anna, { name: 'Hack' })).status).toBe(403);
      expect((await f.api('patch', ordnerPfad(ids.alpha, `/${wurzel.body.id}`), ids.clara, { name: 'Sitzungen' })).body.name).toBe('Sitzungen');
      const kinder = await f.api('get', ordnerPfad(ids.alpha, `?parent_id=${wurzel.body.id}`), ids.anna);
      expect(kinder.body.map((o: { name: string }) => o.name)).toEqual(['2026']);
      expect((await f.api('get', ordnerPfad(ids.alpha, '?parent_id=root'), ids.anna)).body.map((o: { name: string }) => o.name)).toContain('Sitzungen');
      expect((await f.api('get', ordnerPfad(ids.alpha, '?parent_id=x'), ids.anna)).status).toBe(400);
    });

    it('zählt nur sichtbare Dateien und löscht nur durch Administratoren; Dateien fallen auf die oberste Ebene', async () => {
      const ordner = (await f.api('post', ordnerPfad(ids.alpha), ids.olga, { name: 'Zählen' })).body.id;
      const offen = await hochgeladen(ids.olga, 'Z-offen.txt', { folder_id: ordner });
      await hochgeladen(ids.olga, 'Z-admin.txt', { folder_id: ordner, visibility: 'admin' });
      const anzahl = async (konto: string) => (await f.api('get', ordnerPfad(ids.alpha, '?parent_id=root'), konto)).body.find((o: { id: string }) => o.id === ordner).file_count;

      expect(await anzahl(ids.olga)).toBe(2);
      expect(await anzahl(ids.paul)).toBe(1);

      expect((await f.api('delete', ordnerPfad(ids.alpha, `/${ordner}`), ids.clara)).status).toBe(403);
      expect((await f.api('delete', ordnerPfad(ids.alpha, `/${ordner}`), ids.olga)).status).toBe(204);
      expect((await f.api('get', d(ids.alpha, `/${offen}`), ids.olga)).body.folder_id).toBeNull();
      expect((await f.api('delete', ordnerPfad(ids.alpha, `/${ordner}`), ids.olga)).status).toBe(404);
    });
  });

  describe('Download-Links und öffentliche Dateien', () => {
    it('stellt kurzlebige Links aus, die ohne Authorization-Header funktionieren und Rechte erneut prüfen', async () => {
      const id = await hochgeladen(ids.anna, 'link.txt', { visibility: 'member' }, 'Linkinhalt');
      const link = await f.api('post', d(ids.alpha, `/${id}/download-link`), ids.anna);
      expect(link.status).toBe(200);
      expect(link.body.expires_in).toBe(300);
      expect(link.body.url).toMatch(/^\/api\/v1\/files\/download\/ey/);

      const abruf = await f.api('get', link.body.url, null);
      expect(abruf.status).toBe(200);
      expect(abruf.text).toBe('Linkinhalt');
      expect(abruf.headers['content-disposition']).toMatch(/^attachment/);

      // Nach Entzug der Mitgliedschaft ist der noch gültige Link wertlos
      await f.admin.query('UPDATE members SET user_id = NULL WHERE id = $1', [ids.paulMitglied]);
      const paulsLink = await f.api('post', d(ids.alpha, `/${id}/download-link`), ids.paul);
      expect(paulsLink.status).toBe(403);
      await f.admin.query('UPDATE members SET user_id = $2 WHERE id = $1', [ids.paulMitglied, ids.paul]);
      const paulsLink2 = (await f.api('post', d(ids.alpha, `/${id}/download-link`), ids.paul)).body.url;
      await f.admin.query('UPDATE members SET user_id = NULL WHERE id = $1', [ids.paulMitglied]);
      expect((await f.api('get', paulsLink2, null)).status).toBe(403);
      await f.admin.query('UPDATE members SET user_id = $2 WHERE id = $1', [ids.paulMitglied, ids.paul]);
    });

    it('verweigert gefälschte, abgelaufene und artfremde Tokens in beide Richtungen', async () => {
      const id = await hochgeladen(ids.anna, 'token.txt');
      const token = (await f.api('post', d(ids.alpha, `/${id}/download-link`), ids.anna)).body.url.split('/').pop();
      const { SignJWT } = await import('jose');
      const abgelaufen = await new SignJWT({ org: ids.alpha, fid: id }).setProtectedHeader({ alg: 'HS256' }).setSubject(ids.anna).setIssuer('pulsedeck-test').setAudience('pulsedeck-file-download').setIssuedAt(Math.floor(Date.now() / 1000) - 600).setExpirationTime(Math.floor(Date.now() / 1000) - 300).sign(f.pgApp.config.jwt.secret);
      const andereDatei = await new SignJWT({ org: ids.alpha }).setProtectedHeader({ alg: 'HS256' }).setSubject(ids.anna).setIssuer('pulsedeck-test').setAudience('pulsedeck-file-download').setExpirationTime('5m').sign(f.pgApp.config.jwt.secret);

      for (const kaputt of [`${token}x`, abgelaufen, andereDatei, 'kein-token']) expect((await f.api('get', `/api/v1/files/download/${kaputt}`, null)).status, kaputt.slice(0, 12)).toBe(401);
      // Download-Token ist kein Zugriffstoken …
      expect((await f.api('get', '/api/v1/me/organizations', null).set('Authorization', `Bearer ${token}`)).status).toBe(401);
      // … und ein Zugriffstoken kein Download-Token.
      expect((await f.api('get', `/api/v1/files/download/${await f.tokenFuer(ids.anna)}`, null)).status).toBe(401);
    });

    it('gibt nur „public“-Dateien anonym heraus', async () => {
      const oeffentlich = await hochgeladen(ids.olga, 'P-public.txt', { visibility: 'public' }, 'für alle');
      const intern = await hochgeladen(ids.olga, 'P-member.txt', { visibility: 'member' });

      const antwort = await f.api('get', `/api/v1/public/files/${oeffentlich}`, null);
      expect(antwort.status).toBe(200);
      expect(antwort.text).toBe('für alle');
      expect(antwort.headers['x-content-type-options']).toBe('nosniff');
      expect((await f.api('get', `/api/v1/public/files/${intern}`, null)).status).toBe(404);
      expect((await f.api('get', `/api/v1/public/files/${ids.unbekannt}`, null)).status).toBe(404);
      expect((await f.api('get', '/api/v1/public/files/keine-uuid', null)).status).toBe(400);
    });
  });
});
