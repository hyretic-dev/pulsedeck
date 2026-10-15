import { LlmFehler, type ChatNachricht, type LlmClient, type LlmEreignis, type ToolAufruf, type ToolDefinition } from './llm';

const EMBED_MODELL = 'mistral-embed';
const CHAT_MODELL = 'mistral-small-latest';
const BATCH = 16;
const TIMEOUT_MS = 60_000;

/** Mistral über die REST-Schnittstelle (Einbettungen `mistral-embed` mit 1024 Dimensionen, Chat `mistral-small-latest`). */
export class MistralClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.mistral.ai/v1'
  ) {}

  private async anfrage(pfad: string, body: unknown, signal?: AbortSignal, versuche = 3): Promise<Response> {
    for (let versuch = 1; ; versuch += 1) {
      const antwort = await fetch(`${this.baseUrl}${pfad}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
      });
      if (antwort.ok) return antwort;
      // Nur Ratenbegrenzung und Serverfehler wiederholen; Antworttext (kann Eingaben spiegeln) nie weiterreichen.
      if ((antwort.status === 429 || antwort.status >= 500) && versuch < versuche) {
        await antwort.body?.cancel();
        await new Promise((ok) => setTimeout(ok, 500 * versuch));
        continue;
      }
      await antwort.body?.cancel();
      throw new LlmFehler(`KI-Dienst antwortete mit HTTP ${antwort.status}`, antwort.status);
    }
  }

  async einbetten(texte: string[], signal?: AbortSignal): Promise<number[][]> {
    const ergebnis: number[][] = [];
    for (let i = 0; i < texte.length; i += BATCH) {
      const antwort = await this.anfrage('/embeddings', { model: EMBED_MODELL, input: texte.slice(i, i + BATCH) }, signal);
      const daten = (await antwort.json()) as { data?: Array<{ embedding: number[]; index?: number }> };
      const teile = (daten.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (teile.length !== texte.slice(i, i + BATCH).length || teile.some((t) => t.embedding.length !== 1024)) throw new LlmFehler('Unerwartete Antwort des Einbettungsdienstes');
      ergebnis.push(...teile.map((t) => t.embedding));
    }
    return ergebnis;
  }

  async *chat(optionen: { nachrichten: ChatNachricht[]; tools: ToolDefinition[]; signal?: AbortSignal }): AsyncGenerator<LlmEreignis> {
    const antwort = await this.anfrage(
      '/chat/completions',
      {
        model: CHAT_MODELL,
        messages: optionen.nachrichten,
        stream: true,
        ...(optionen.tools.length > 0 ? { tools: optionen.tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' } : {}),
      },
      optionen.signal,
      2
    );
    if (!antwort.body) throw new LlmFehler('Leere Antwort des KI-Dienstes');
    const aufrufe = new Map<number, ToolAufruf>();
    const decoder = new TextDecoder();
    let rest = '';
    for await (const stueck of antwort.body as unknown as AsyncIterable<Uint8Array>) {
      rest += decoder.decode(stueck, { stream: true });
      const zeilen = rest.split('\n');
      rest = zeilen.pop() ?? '';
      for (const zeile of zeilen) {
        if (!zeile.startsWith('data:')) continue;
        const daten = zeile.slice(5).trim();
        if (daten === '[DONE]') continue;
        let delta: { content?: string | null; tool_calls?: Array<{ id?: string; index?: number; function?: { name?: string; arguments?: string } }> } | undefined;
        try {
          delta = (JSON.parse(daten) as { choices?: Array<{ delta?: typeof delta }> }).choices?.[0]?.delta;
        } catch {
          continue; // unvollständige/unbekannte Ereigniszeile ignorieren
        }
        if (delta?.content) yield { typ: 'text', text: delta.content };
        for (const [position, tc] of (delta?.tool_calls ?? []).entries()) {
          const index = tc.index ?? position;
          const bisher = aufrufe.get(index) ?? { id: '', name: '', arguments: '' };
          aufrufe.set(index, {
            id: tc.id || bisher.id,
            name: tc.function?.name || bisher.name,
            arguments: bisher.arguments + (typeof tc.function?.arguments === 'string' ? tc.function.arguments : tc.function?.arguments ? JSON.stringify(tc.function.arguments) : ''),
          });
        }
      }
    }
    if (aufrufe.size > 0) yield { typ: 'tools', aufrufe: [...aufrufe.values()].filter((a) => a.name) };
  }
}
