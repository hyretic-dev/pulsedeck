import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { SupabaseService } from './supabase';
import { WikiDoc, WikiCategory } from '../models/wiki-doc.model';
import { RealtimeChannel } from '@supabase/supabase-js';

@Injectable({
    providedIn: 'root',
})
export class WikiService implements OnDestroy {
    private supabase = inject(SupabaseService);
    private readonly TABLE_NAME = 'wiki_docs';
    private readonly CAT_TABLE = 'wiki_categories';
    private realtimeChannel: RealtimeChannel | null = null;

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

        const { data, error } = await this.supabase
            .from(this.TABLE_NAME)
            .select('*')
            .eq('organization_id', orgId)
            .order('last_updated', { ascending: false });

        if (error) {
            this._error.set(error.message);
        } else {
            this._docs.set(data ?? []);
        }

        this._loading.set(false);
        this.subscribeToRealtime();
    }

    async fetchCategories(orgId: string): Promise<void> {
        const { data, error } = await this.supabase
            .from(this.CAT_TABLE)
            .select('*')
            .eq('organization_id', orgId)
            .order('sort_order', { ascending: true });

        if (error) {
            console.error('Failed to fetch wiki categories:', error);
        } else {
            this._categories.set(data ?? []);
        }
    }

    /** Get global categories (working_group_id IS NULL) */
    globalCategories(): WikiCategory[] {
        return this._categories().filter(c => !c.working_group_id);
    }

    /** Get categories for a specific working group */
    groupCategories(workingGroupId: string): WikiCategory[] {
        return this._categories().filter(c => c.working_group_id === workingGroupId);
    }

    async addCategory(cat: Omit<WikiCategory, 'id' | 'created_at' | 'updated_at'>) {
        const { data, error } = await this.supabase
            .from(this.CAT_TABLE)
            .insert(cat)
            .select()
            .single();

        if (error) throw new Error(error.message);
        this._categories.update(cats => [...cats, data]);
        return data;
    }

    async updateCategory(id: string, updates: Partial<WikiCategory>) {
        const { data, error } = await this.supabase
            .from(this.CAT_TABLE)
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw new Error(error.message);
        this._categories.update(cats =>
            cats.map(c => (c.id === id ? data : c))
        );
        return data;
    }

    async deleteCategory(id: string) {
        const { error } = await this.supabase
            .from(this.CAT_TABLE)
            .delete()
            .eq('id', id);

        if (error) throw new Error(error.message);
        this._categories.update(cats => cats.filter(c => c.id !== id));
    }

    private subscribeToRealtime() {
        if (this.realtimeChannel) return;

        this.realtimeChannel = this.supabase.subscribeToTable(
            this.TABLE_NAME,
            (payload: any) => {
                this.handleRealtimeUpdate(payload);
            }
        );
    }

    private handleRealtimeUpdate(payload: any) {
        const eventType = payload.eventType;
        const newRecord = payload.new as WikiDoc;
        const oldRecord = payload.old as WikiDoc;

        switch (eventType) {
            case 'INSERT':
                this._docs.update(docs => [newRecord, ...docs]);
                break;
            case 'UPDATE':
                this._docs.update(docs =>
                    docs.map(d => (d.id === newRecord.id ? newRecord : d))
                );
                break;
            case 'DELETE':
                this._docs.update(docs =>
                    docs.filter(d => d.id !== oldRecord.id)
                );
                break;
        }
    }

    ngOnDestroy() {
        if (this.realtimeChannel) {
            this.supabase.unsubscribe(this.realtimeChannel);
        }
    }

    async addDoc(doc: Omit<WikiDoc, 'id' | 'created_at' | 'updated_at'>) {
        const { data, error } = await this.supabase
            .from(this.TABLE_NAME)
            .insert(doc)
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    async updateDoc(id: string, updates: Partial<WikiDoc>) {
        const { data, error } = await this.supabase
            .from(this.TABLE_NAME)
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    async deleteDoc(id: string) {
        const { error } = await this.supabase
            .from(this.TABLE_NAME)
            .delete()
            .eq('id', id);

        if (error) throw new Error(error.message);
    }
}
