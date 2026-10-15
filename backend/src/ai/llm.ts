export const LLM_CLIENT = Symbol('LLM_CLIENT');

export interface ToolAufruf {
  id: string;
  name: string;
  /** JSON-Text der Argumente, wie vom Modell geliefert (nicht vertrauenswürdig, vor Gebrauch prüfen). */
  arguments: string;
}

export interface ChatNachricht {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolAufruf[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON-Schema der Parameter. */
  parameters: Record<string, unknown>;
}

export type LlmEreignis = { typ: 'text'; text: string } | { typ: 'tools'; aufrufe: ToolAufruf[] };

/** Port zum Sprachmodell-Anbieter (Einbettungen und Chat mit Werkzeugaufrufen). */
export interface LlmClient {
  einbetten(texte: string[], signal?: AbortSignal): Promise<number[][]>;
  chat(optionen: { nachrichten: ChatNachricht[]; tools: ToolDefinition[]; signal?: AbortSignal }): AsyncGenerator<LlmEreignis>;
}

export class LlmFehler extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
  }
}
