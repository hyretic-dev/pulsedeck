import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { OrganizationService } from './organization.service';

export type FileVisibility =
    'public' | 'member' | 'committee' | 'admin' | 'ag-only';

export interface FileMetadata {
    id?: string;
    name: string;
    original_name: string;
    storage_path: string;
    mime_type?: string;
    size_bytes?: number;
    folder: string;
    folder_id?: string | null;
    description?: string;
    is_pinned?: boolean;
    uploaded_by?: string;
    working_group_id?: string;
    visibility: FileVisibility;
    organization_id?: string;
    is_indexed?: boolean;
    created_at?: string;
    updated_at?: string;
    // Joined
    uploader?: { name: string };
    working_group?: { name: string };
}

export interface FolderMetadata {
    id: string;
    name: string;
    parent_id: string | null;
    organization_id: string;
    created_by?: string;
    created_at?: string;
    file_count?: number;
}

@Injectable({ providedIn: 'root' })
export class FileService {
    private api = inject(ApiService);
    private org = inject(OrganizationService);

    files = signal<FileMetadata[]>([]);
    pinnedFiles = signal<FileMetadata[]>([]);
    recentFiles = signal<FileMetadata[]>([]);
    folderList = signal<FolderMetadata[]>([]);
    agFiles = signal<Map<string, FileMetadata[]>>(new Map());
    loading = signal(false);
    currentFolder = signal('/');
    currentFolderId = signal<string | null>(null);

    private orgId(): string | undefined {
        return this.org.currentOrgId();
    }

    private async liste(query: Record<string, string | number | boolean | undefined>): Promise<FileMetadata[]> {
        const orgId = this.orgId();
        if (!orgId) return [];
        return this.api.get<FileMetadata[]>(`/orgs/${orgId}/files`, query);
    }

    /**
     * Fetch pinned files for the organization
     */
    async fetchPinnedFiles(): Promise<void> {
        try {
            this.pinnedFiles.set(await this.liste({ pinned: true }));
        } catch (error) {
            console.error('Error fetching pinned files:', error);
        }
    }

    /**
     * Fetch recently uploaded files
     */
    async fetchRecentFiles(limit = 8): Promise<void> {
        try {
            this.recentFiles.set(await this.liste({ sort: 'recent', limit }));
        } catch (error) {
            console.error('Error fetching recent files:', error);
        }
    }

    /**
     * Fetch folders for a given parent (null = root); `file_count` zählt nur Dateien, die der Nutzer sehen darf
     */
    async fetchFolderList(parentId: string | null = null): Promise<void> {
        const orgId = this.orgId();
        if (!orgId) return;
        try {
            this.folderList.set(await this.api.get<FolderMetadata[]>(`/orgs/${orgId}/folders`, { parent_id: parentId ?? 'root' }));
        } catch (error) {
            console.error('Error fetching folders:', error);
        }
    }

    /**
     * Fetch files by folder_id (UUID-based)
     */
    async fetchFilesByFolderId(folderId: string | null): Promise<void> {
        this.loading.set(true);
        this.currentFolderId.set(folderId);
        try {
            this.files.set(await this.liste({ folder_id: folderId ?? 'root', sort: 'name' }));
        } catch (error) {
            console.error('Error fetching files:', error);
        }
        this.loading.set(false);
    }

    /**
     * Fetch pinned files for a specific working group
     */
    async fetchFilesByAg(agId: string): Promise<void> {
        try {
            const dateien = await this.liste({ working_group_id: agId, pinned: true });
            this.agFiles.update((map) => new Map(map).set(agId, dateien));
        } catch (error) {
            console.error('Error fetching AG files:', error);
        }
    }

    /**
     * Search files by name
     */
    async searchFiles(query: string): Promise<FileMetadata[]> {
        return this.liste({ q: query, sort: 'name', limit: 50 });
    }

    /**
     * Upload a file (multipart). Speicherort, Organisation und Uploader bestimmt der Server.
     */
    async uploadFile(
        file: File,
        _folder: string = '/',
        options: {
            visibility?: FileVisibility;
            description?: string;
            workingGroupId?: string;
            folderId?: string;
        } = {}
    ): Promise<FileMetadata> {
        const orgId = this.orgId();
        if (!orgId) throw new Error('Nicht eingeloggt');
        const form = new FormData();
        form.append('visibility', options.visibility || 'member');
        if (options.description) form.append('description', options.description);
        if (options.workingGroupId) form.append('working_group_id', options.workingGroupId);
        if (options.folderId) form.append('folder_id', options.folderId);
        form.append('file', file, file.name); // Datei zuletzt, damit der Server die Felder vor dem Inhalt kennt
        return this.api.post<FileMetadata>(`/orgs/${orgId}/files`, form);
    }

    /**
     * Request RAG ingestion for a specific file (läuft im Hintergrund)
     */
    async triggerFileIngestion(fileId: string): Promise<{ success: boolean; message?: string }> {
        try {
            return await this.api.post<{ success: boolean; message?: string }>(`/orgs/${this.orgId()}/files/${fileId}/index`);
        } catch (e) {
            console.error('Ingestion trigger failed:', e);
            return { success: false, message: (e as Error).message };
        }
    }

    /**
     * Toggle pin status of a file
     */
    async togglePin(fileId: string, pinned: boolean): Promise<void> {
        await this.api.patch(`/orgs/${this.orgId()}/files/${fileId}`, { is_pinned: pinned });
    }

    /**
     * Move a file to a different folder
     */
    async moveFile(fileId: string, folderId: string | null): Promise<void> {
        await this.api.patch(`/orgs/${this.orgId()}/files/${fileId}`, { folder_id: folderId });
    }

    /**
     * Create a persistent folder
     */
    async createPersistentFolder(name: string, parentId: string | null = null): Promise<FolderMetadata> {
        const orgId = this.orgId();
        if (!orgId) throw new Error('Nicht eingeloggt');
        return this.api.post<FolderMetadata>(`/orgs/${orgId}/folders`, { name, parent_id: parentId });
    }

    /**
     * Alle Ordner der Organisation (für den Verschieben-Dialog), ebenenweise geladen
     */
    async fetchAllFolders(): Promise<FolderMetadata[]> {
        const orgId = this.orgId();
        if (!orgId) return [];
        const alle: FolderMetadata[] = [];
        let ebene: (string | null)[] = [null];
        for (let tiefe = 0; ebene.length > 0 && tiefe < 10; tiefe += 1) {
            const kinder = (await Promise.all(ebene.map((p) => this.api.get<FolderMetadata[]>(`/orgs/${orgId}/folders`, { parent_id: p ?? 'root' })))).flat();
            alle.push(...kinder);
            ebene = kinder.map((k) => k.id);
        }
        return alle.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Delete a folder (Administratoren)
     */
    async deleteFolder(folderId: string): Promise<void> {
        await this.api.delete(`/orgs/${this.orgId()}/folders/${folderId}`);
    }

    /**
     * Download a file: Inhalt mit Anmeldung laden und als Datei speichern
     */
    async downloadFile(file: FileMetadata): Promise<void> {
        const blob = await this.api.blob(`/orgs/${this.orgId()}/files/${file.id}/content`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.original_name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }

    /**
     * Update file metadata (Name, Beschreibung, Sichtbarkeit, Arbeitsgruppe)
     */
    async updateFile(id: string, updates: Partial<FileMetadata>): Promise<void> {
        const { name, description, visibility, working_group_id, folder_id, is_pinned } = updates;
        const body = { name, description, visibility, working_group_id, folder_id, is_pinned };
        await this.api.patch(`/orgs/${this.orgId()}/files/${id}`, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === '' && (k === 'working_group_id' || k === 'folder_id') ? null : v])));
    }

    /**
     * Delete a file (Inhalt und Metadaten)
     */
    async deleteFile(file: FileMetadata): Promise<void> {
        await this.api.delete(`/orgs/${this.orgId()}/files/${file.id}`);
    }

    /**
     * Get all folders as paths is no longer needed; kept for API compatibility
     */
    createFolder(parentFolder: string, name: string): string {
        return parentFolder === '/' ? `/${name}` : `${parentFolder}/${name}`;
    }

    /**
     * Format file size for display
     */
    formatFileSize(bytes?: number): string {
        if (!bytes) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        if (bytes < 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    /**
     * Get file icon based on mime type
     */
    getFileIcon(mimeType?: string): string {
        if (!mimeType) return 'pi-file';

        if (mimeType.startsWith('image/')) return 'pi-image';
        if (mimeType.startsWith('video/')) return 'pi-video';
        if (mimeType.startsWith('audio/')) {
            return 'pi-volume-up';
        }
        if (mimeType.includes('pdf')) return 'pi-file-pdf';
        if (
            mimeType.includes('word') ||
            mimeType.includes('document')
        ) {
            return 'pi-file-word';
        }
        if (
            mimeType.includes('excel') ||
            mimeType.includes('spreadsheet')
        ) {
            return 'pi-file-excel';
        }
        if (
            mimeType.includes('zip') ||
            mimeType.includes('archive')
        ) {
            return 'pi-file-zip';
        }

        return 'pi-file';
    }
}
