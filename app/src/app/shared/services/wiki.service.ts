import { Injectable, inject, signal, OnDestroy } from '@angular/core';

import { ApiService } from '../../core/api.service';
import { pick } from '../../core/pick';
import { RealtimeService } from '../../core/realtime.service';
import { WikiDoc, WikiCategory } from '../models/wiki-doc.model';

const DOC_FELDER = ['title', 'description', 'content', 'category', 'status', 'allowed_roles', 'working_group_id'] as const;
const KATEGORIE_FELDER = ['name', 'icon', 'sort_order', 'working_group_id'] as const;

@Injectable({
    providedIn: 'root',
})
export class WikiService implements OnDestroy {
    private api = inject(ApiService);
    private realtime = inject(RealtimeService);
    private abmelden: (() => void) | null = null;
    private orgId: string | null = null;

    private _docs = signal<WikiDoc[]>([]);
    private _categories = signal<WikiCategory[]>([]);
    private _loading = signal(false);
    private _error = signal<string | null>(null);

    readonly docs = this._docs.asReadonly();
    readonly categories = this._categories.asReadonly();
    readonly loading = this._loading.asReadonly();
    readonly error = this._error.asReadonly();

    async fetchDocs(orgId: string): Promise<void> {
        this._loading.set(true);
        this._error.set(null);
        try {
            this._docs.set(await this.api.get<WikiDoc[]>(`/orgs/${orgId}/wiki/docs`));
            this.abonnieren(orgId);
        } catch (error) {
            this._error.set((error as Error).message);
        }
        this._loading.set(false);
    }

    async fetchCategories(orgId: string): Promise<void> {
        try {
            this._categories.set(await this.api.get<WikiCategory[]>(`/orgs/${orgId}/wiki/categories`));
        } catch (error) {
            console.error('Failed to fetch wiki categories:', error);
        }
    }

    /** Get global categories (working_group_id IS NULL) */
    globalCategories(): WikiCategory[] {
        return this._categories().filter((c) => !c.working_group_id);
    }

    /** Get categories for a specific working group */
    groupCategories(workingGroupId: string): WikiCategory[] {
        return this._categories().filter((c) => c.working_group_id === workingGroupId);
    }

    async addCategory(cat: Omit<WikiCategory, 'id' | 'created_at' | 'updated_at'>) {
        const neu = await this.api.post<WikiCategory>(`/orgs/${cat.organization_id}/wiki/categories`, pick(cat, KATEGORIE_FELDER));
        this._categories.update((cats) => [...cats, neu]);
        return neu;
    }

    async updateCategory(id: string, updates: Partial<WikiCategory>) {
        const orgId = this.orgId ?? this._categories().find((c) => c.id === id)?.organization_id;
        const geaendert = await this.api.patch<WikiCategory>(`/orgs/${orgId}/wiki/categories/${id}`, pick(updates, ['name', 'icon', 'sort_order']));
        this._categories.update((cats) => cats.map((c) => (c.id === id ? geaendert : c)));
        return geaendert;
    }

    async deleteCategory(id: string) {
        const orgId = this.orgId ?? this._categories().find((c) => c.id === id)?.organization_id;
        await this.api.delete(`/orgs/${orgId}/wiki/categories/${id}`);
        this._categories.update((cats) => cats.filter((c) => c.id !== id));
        // Dokumente der Kategorie behalten ihren Inhalt, die Kategorie wird leer
        this._docs.update((docs) => docs.map((d) => (d.category === id ? { ...d, category: null as unknown as string } : d)));
    }

    /** Nur erlaubte Felder; eine leere Kategorie bedeutet „keine“ (null), nicht eine leere Zeichenkette. */
    private bereinigt(doc: Partial<WikiDoc>): Partial<WikiDoc> {
        const koerper = pick(doc, DOC_FELDER) as Record<string, unknown>;
        for (const feld of ['category', 'working_group_id']) if (koerper[feld] === '') koerper[feld] = null;
        return koerper as Partial<WikiDoc>;
    }

    private abonnieren(orgId: string) {
        if (this.orgId === orgId) return;
        this.abmelden?.();
        this.orgId = orgId;
        this.abmelden = this.realtime.abonnieren(orgId, ['wiki_docs', 'wiki_categories'], () => void this.nachladen(orgId));
    }

    private async nachladen(orgId: string) {
        try {
            const [docs, kategorien] = await Promise.all([
                this.api.get<WikiDoc[]>(`/orgs/${orgId}/wiki/docs`),
                this.api.get<WikiCategory[]>(`/orgs/${orgId}/wiki/categories`),
            ]);
            this._docs.set(docs);
            this._categories.set(kategorien);
        } catch {
            // nächste Meldung versucht es erneut
        }
    }

    ngOnDestroy() {
        this.abmelden?.();
    }

    /** Autor und Änderungsdatum setzt der Server. */
    async addDoc(doc: Omit<WikiDoc, 'id' | 'created_at' | 'updated_at'>) {
        const neu = await this.api.post<WikiDoc>(`/orgs/${doc.organization_id}/wiki/docs`, this.bereinigt(doc));
        this._docs.update((docs) => [neu, ...docs.filter((d) => d.id !== neu.id)]);
        return neu;
    }

    async updateDoc(id: string, updates: Partial<WikiDoc>) {
        const orgId = this.orgId ?? updates.organization_id;
        const geaendert = await this.api.patch<WikiDoc>(`/orgs/${orgId}/wiki/docs/${id}`, this.bereinigt(updates));
        this._docs.update((docs) => docs.map((d) => (d.id === id ? geaendert : d)));
        return geaendert;
    }

    async deleteDoc(id: string) {
        const orgId = this.orgId ?? this._docs().find((d) => d.id === id)?.organization_id;
        await this.api.delete(`/orgs/${orgId}/wiki/docs/${id}`);
        this._docs.update((docs) => docs.filter((d) => d.id !== id));
    }
}
