import { Injectable, signal, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { OrganizationService } from './organization.service';

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
    private api = inject(ApiService);
    private org = inject(OrganizationService);

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
        const orgId = this.org.currentOrgId();
        if (!orgId) return;
        this.isLoading.set(true);
        try {
            // Neueste Sitzung des Nutzers in dieser Organisation samt Verlauf
            const verlauf = await this.api.get<{ session_id: string | null; messages: ChatMessage[] }>(`/orgs/${orgId}/chat/history`);
            this.sessionId.set(verlauf.session_id);
            this.messages.set(
                verlauf.messages.length > 0
                    ? verlauf.messages
                    : [{ id: crypto.randomUUID(), role: 'assistant', content: 'Hallo! Ich bin dein PulseDeck Onboarding-Assistent. Wie kann ich dir helfen?' }]
            );
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

        // Der Server nimmt höchstens 40 Nachrichten zu je 4000 Zeichen an
        const currentMessages = this.messages().slice(-40).map(m => ({
            role: m.role,
            content: m.content.slice(0, 4000)
        }));

        try {
            const orgId = this.org.currentOrgId();
            if (!orgId) throw new Error('Keine Organisation ausgewählt');

            // Nur Nutzer-/Assistententexte; Rollen wie „system“ nimmt der Server nicht an
            const response = await this.api.stream('POST', `/orgs/${orgId}/chat`, {
                messages: currentMessages.filter((m) => m.role === 'user' || m.role === 'assistant'),
                ...(this.sessionId() ? { session_id: this.sessionId() } : {}),
            });

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

            let puffer = '';
            const anhaengen = (text: string) =>
                this.messages.update((msgs) => {
                    const neu = [...msgs];
                    const letzte = neu[neu.length - 1];
                    if (letzte.role === 'assistant') neu[neu.length - 1] = { ...letzte, content: letzte.content + text };
                    return neu;
                });
            const verarbeite = (zeile: string) => {
                // Datenstrom-Format: 0:"Text" = Textteil, 3:"Fehler" = Fehlermeldung des Servers
                if (zeile.startsWith('0:') || zeile.startsWith('3:')) {
                    try {
                        anhaengen(JSON.parse(zeile.substring(2)));
                    } catch {
                        // unvollständige Zeile ignorieren
                    }
                }
            };
            while (reader && !done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    puffer += decoder.decode(value, { stream: true });
                    const zeilen = puffer.split('\n');
                    puffer = zeilen.pop() ?? ''; // letzte, evtl. unvollständige Zeile abwarten
                    zeilen.forEach(verarbeite);
                }
            }
            if (puffer) verarbeite(puffer);
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
