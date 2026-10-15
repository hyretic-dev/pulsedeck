import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LlmFehler, type LlmEreignis } from './llm';
import { MistralClient } from './mistral.client';

const vektor = (wert: number) => Array.from({ length: 1024 }, () => wert);

/** Mistral-Client gegen einen lokalen HTTP-Server mit dem dokumentierten Antwortformat. */
describe('MistralClient', () => {
  let server: Server;
  let client: MistralClient;
  let anfragen: Array<{ pfad: string; auth: string | undefined; body: any }>;
  let verhalten: (pfad: string, versuch: number) => { status: number; body: string; typ?: string };
  const zaehler = new Map<string, number>();

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      let roh = '';
      req.on('data', (c) => (roh += c));
      req.on('end', () => {
        const pfad = req.url as string;
        const versuch = (zaehler.get(pfad) ?? 0) + 1;
        zaehler.set(pfad, versuch);
        anfragen.push({ pfad, auth: req.headers.authorization, body: JSON.parse(roh) });
        const antwort = verhalten(pfad, versuch);
        res.writeHead(antwort.status, { 'Content-Type': antwort.typ ?? 'application/json' });
        res.end(antwort.body);
      });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    client = new MistralClient('geheimer-key', `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`);
  });
  afterAll(async () => {
    await new Promise<void>((ok) => server.close(() => ok()));
  });
  beforeEach(() => {
    anfragen = [];
    zaehler.clear();
  });

  const sse = (...delta: object[]) => delta.map((d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`).join('') + 'data: [DONE]\n\n';
  const sammle = async (generator: AsyncGenerator<LlmEreignis>) => {
    const ereignisse: LlmEreignis[] = [];
    for await (const e of generator) ereignisse.push(e);
    return ereignisse;
  };

  it('bettet Texte in Batches ein, sendet den Schlüssel als Bearer und liefert die Vektoren in Eingabereihenfolge', async () => {
    verhalten = (_p, _v) => ({ status: 200, body: JSON.stringify({ data: [{ index: 1, embedding: vektor(2) }, { index: 0, embedding: vektor(1) }] }) });

    const ergebnis = await client.einbetten(['eins', 'zwei']);

    expect(ergebnis.map((v) => v[0])).toEqual([1, 2]);
    expect(anfragen[0]).toMatchObject({ pfad: '/v1/embeddings', auth: 'Bearer geheimer-key', body: { model: 'mistral-embed', input: ['eins', 'zwei'] } });
    verhalten = (_p, _v) => ({ status: 200, body: JSON.stringify({ data: Array.from({ length: 16 }, (_, i) => ({ index: i, embedding: vektor(i) })) }) });
    anfragen = [];
    await client.einbetten(Array.from({ length: 16 }, (_, i) => `t${i}`)).then((v) => expect(v).toHaveLength(16));
    expect(anfragen).toHaveLength(1);
  });

  it('lehnt Antworten mit falscher Dimension oder Anzahl ab', async () => {
    verhalten = () => ({ status: 200, body: JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }) });
    await expect(client.einbetten(['x'])).rejects.toThrow('Unerwartete Antwort');
    verhalten = () => ({ status: 200, body: JSON.stringify({ data: [] }) });
    await expect(client.einbetten(['x'])).rejects.toThrow('Unerwartete Antwort');
  });

  it('wiederholt 429/5xx und meldet endgültige Fehler ohne Antworttext', async () => {
    verhalten = (_p, versuch) => (versuch < 3 ? { status: 503, body: 'Eingabe: geheim' } : { status: 200, body: JSON.stringify({ data: [{ index: 0, embedding: vektor(1) }] }) });
    await expect(client.einbetten(['x'])).resolves.toHaveLength(1);
    expect(anfragen).toHaveLength(3);

    zaehler.clear();
    verhalten = () => ({ status: 401, body: 'Invalid key geheimer-key' });
    const fehler = await client.einbetten(['x']).catch((e) => e);
    expect(fehler).toBeInstanceOf(LlmFehler);
    expect(fehler.status).toBe(401);
    expect(fehler.message).not.toContain('geheimer-key');
  });

  it('streamt Textteile und sammelt Werkzeugaufrufe (auch in Fragmenten)', async () => {
    verhalten = () => ({
      status: 200,
      typ: 'text/event-stream',
      body: sse({ content: 'Hallo ' }, { content: 'Welt' }, { tool_calls: [{ index: 0, id: 'a1', function: { name: 'getUpcomingEvents', arguments: '{"lim' } }] }, { tool_calls: [{ index: 0, function: { arguments: 'it":2}' } }] }),
    });

    const ereignisse = await sammle(client.chat({ nachrichten: [{ role: 'user', content: 'Hi' }], tools: [{ name: 'getUpcomingEvents', description: 'd', parameters: { type: 'object', properties: {} } }] }));

    expect(ereignisse).toEqual([
      { typ: 'text', text: 'Hallo ' },
      { typ: 'text', text: 'Welt' },
      { typ: 'tools', aufrufe: [{ id: 'a1', name: 'getUpcomingEvents', arguments: '{"limit":2}' }] },
    ]);
    expect(anfragen[0].body).toMatchObject({ model: 'mistral-small-latest', stream: true, tool_choice: 'auto', tools: [{ type: 'function', function: { name: 'getUpcomingEvents' } }] });
  });

  it('übersteht Chunks, die mitten in einer Zeile enden', async () => {
    // Ein Server, der die Antwort in Stücke teilt, die Ereigniszeilen zerschneiden
    const teilServer = createServer((_req, res) => {
      const ganz = sse({ content: 'Guten ' }, { content: 'Tag' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(ganz.slice(0, 20));
      setTimeout(() => res.end(ganz.slice(20)), 20);
    });
    await new Promise<void>((ok) => teilServer.listen(0, '127.0.0.1', ok));
    const c = new MistralClient('k', `http://127.0.0.1:${(teilServer.address() as AddressInfo).port}`);

    const ereignisse = await sammle(c.chat({ nachrichten: [], tools: [] }));

    expect(ereignisse.map((e) => (e.typ === 'text' ? e.text : '')).join('')).toBe('Guten Tag');
    await new Promise<void>((ok) => teilServer.close(() => ok()));
  });
});
