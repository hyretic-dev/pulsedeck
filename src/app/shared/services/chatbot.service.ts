import { Injectable, signal, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { environment } from '../../../environments/environment';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    created_at?: string;
}

@Injectable({
    providedIn: 'root'
})
export class ChatbotService {
    private supabaseService = inject(SupabaseService);

    isOpen = signal(false);
    isLoading = signal(false);
    messages = signal<ChatMessage[]>([]);
    sessionId = signal<string | null>(null);
    isDesktopSidebarVisible = signal(false);

    constructor() { }

    toggle() {
        this.isOpen.update(v => !v);
        if (this.isOpen() && this.messages().length === 0) {
            this.loadHistory();
        }
    }

    async loadHistory() {
        this.isLoading.set(true);
        try {
            // Holt die neueste Session
            const { data: sessionDataRaw, error: sessionError } = await this.supabaseService.client
                .from('chat_sessions')
                .select('id')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            const sessionData = sessionDataRaw as any;

            if (sessionError) {
                // Keine Session vorhanden, starte mit Begrüßung
                this.messages.set([
                    {
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: 'Hallo! Ich bin dein PulseDeck Onboarding-Assistent. Wie kann ich dir helfen?'
                    }
                ]);
                return;
            }

            this.sessionId.set(sessionData.id);

            // Lade Nachrichten der Session
            const { data: messagesDataRaw, error: messagesError } = await this.supabaseService.client
                .from('chat_messages')
                .select('*')
                .eq('session_id', sessionData.id)
                .order('created_at', { ascending: true });
            const messagesData = messagesDataRaw as any;

            if (!messagesError && messagesData) {
                this.messages.set(messagesData as ChatMessage[]);
            }

            if (this.messages().length === 0) {
                this.messages.set([
                    {
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: 'Hallo! Ich bin dein PulseDeck Onboarding-Assistent. Wie kann ich dir helfen?'
                    }
                ]);
            }
        } catch (error) {
            console.error('Fehler beim Laden des Chatverlaufs:', error);
        } finally {
            this.isLoading.set(false);
        }
    }

    async sendMessage(content: string) {
        if (!content.trim()) return;

        const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content
        };

        this.messages.update(msgs => [...msgs, userMsg]);
        this.isLoading.set(true);

        const currentMessages = this.messages().map(m => ({
            role: m.role,
            content: m.content
        }));

        try {
            const { data: { session } } = await this.supabaseService.client.auth.getSession();
            if (!session) throw new Error('Nicht authentifiziert');

            const response = await fetch(`${environment.supabase.url}/functions/v1/chatbot`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': environment.supabase.anonKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: currentMessages,
                    session_id: this.sessionId()
                })
            });

            if (!response.ok) throw new Error('Netzwerkfehler bei der Edge Function');

            const returnedSessionId = response.headers.get('x-chat-session-id');
            if (returnedSessionId && !this.sessionId()) {
                this.sessionId.set(returnedSessionId);
            }

            // Wir parsen den Vercel AI SDK Data Stream
            // Sehr rudimentäres Parsing für Text-Chunks (Format: 0:"Text...")
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let done = false;

            const assistantMsgId = crypto.randomUUID();
            this.messages.update(msgs => [...msgs, { id: assistantMsgId, role: 'assistant', content: '' }]);

            while (reader && !done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    lines.map((line: string) => {
                        if (line.startsWith('0:')) {
                            try {
                                // Extract the JSON string part: 0:"Hello" -> "Hello"
                                const textChunk = JSON.parse(line.substring(2));
                                this.messages.update(msgs => {
                                    const newMsgs = [...msgs];
                                    const lastMsg = newMsgs[newMsgs.length - 1];
                                    if (lastMsg.role === 'assistant') {
                                        lastMsg.content += textChunk;
                                    }
                                    return newMsgs;
                                });
                            } catch (e) {
                                // Ignore parse errors for partial lines
                            }
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Fehler beim Senden der Nachricht:', error);
            this.messages.update(msgs => [
                ...msgs,
                { id: crypto.randomUUID(), role: 'assistant', content: 'Entschuldigung, es gab einen Fehler bei der Verarbeitung deiner Anfrage.' }
            ]);
        } finally {
            this.isLoading.set(false);
        }
    }
}
