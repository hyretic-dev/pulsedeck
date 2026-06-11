import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
import { AuthService } from './auth.service';
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

const STORAGE_BUCKET = 'files';

const FILE_SELECT = `
    *,
    uploader:members!uploaded_by(name),
    working_group:working_groups(name)
`;

@Injectable({ providedIn: 'root' })
export class FileService {
    private supabase = inject(SupabaseService);
    private auth = inject(AuthService);
    private org = inject(OrganizationService);

    files = signal<FileMetadata[]>([]);
    pinnedFiles = signal<FileMetadata[]>([]);
    recentFiles = signal<FileMetadata[]>([]);
    folderList = signal<FolderMetadata[]>([]);
    folders = signal<string[]>([]);
    agFiles = signal<Map<string, FileMetadata[]>>(new Map());
    loading = signal(false);
    currentFolder = signal('/');
    currentFolderId = signal<string | null>(null);

    /**
     * Fetch pinned files for the organization
     */
    async fetchPinnedFiles(): Promise<void> {
        const orgId = this.org.currentOrgId();
        if (!orgId) return;

        const { data, error } = await this.supabase.client
            .from('files')
            .select(FILE_SELECT)
            .eq('organization_id', orgId)
            .eq('is_pinned', true)
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching pinned files:', error);
            return;
        }
        this.pinnedFiles.set(data as FileMetadata[]);
    }

    /**
     * Fetch recently uploaded files
     */
    async fetchRecentFiles(limit = 8): Promise<void> {
        const orgId = this.org.currentOrgId();
        if (!orgId) return;

        const { data, error } = await this.supabase.client
            .from('files')
            .select(FILE_SELECT)
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Error fetching recent files:', error);
            return;
        }
        this.recentFiles.set(data as FileMetadata[]);
    }

    /**
     * Fetch folders for a given parent (null = root)
     */
    async fetchFolderList(
        parentId: string | null = null
    ): Promise<void> {
        const orgId = this.org.currentOrgId();
        if (!orgId) return;

        let query = this.supabase.client
            .from('folders')
            .select('*')
            .eq('organization_id', orgId)
            .order('name', { ascending: true });

        if (parentId) {
            query = query.eq('parent_id', parentId);
        } else {
            query = query.is('parent_id', null);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching folders:', error);
            return;
        }

        // Count files per folder
        const foldersWithCount: FolderMetadata[] = [];
        for (const folder of (data || [])) {
            const { count } = await this.supabase.client
                .from('files')
                .select('id', { count: 'exact', head: true })
                .eq('folder_id', folder.id);

            foldersWithCount.push({
                ...folder,
                file_count: count ?? 0,
            } as FolderMetadata);
        }

        this.folderList.set(foldersWithCount);
    }

    /**
     * Fetch files in a specific folder
     */
    async fetchFiles(folder: string = '/'): Promise<void> {
        this.loading.set(true);
        this.currentFolder.set(folder);

        const orgId = this.org.currentOrgId();

        let query = this.supabase.client
            .from('files')
            .select(FILE_SELECT)
            .eq('folder', folder)
            .order('name', { ascending: true });

        if (orgId) {
            query = query.eq('organization_id', orgId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching files:', error);
        } else {
            this.files.set(data as FileMetadata[]);
        }

        this.loading.set(false);
    }

    /**
     * Fetch files by folder_id (UUID-based)
     */
    async fetchFilesByFolderId(
        folderId: string | null
    ): Promise<void> {
        this.loading.set(true);
        this.currentFolderId.set(folderId);

        const orgId = this.org.currentOrgId();
        if (!orgId) {
            this.loading.set(false);
            return;
        }

        let query = this.supabase.client
            .from('files')
            .select(FILE_SELECT)
            .eq('organization_id', orgId)
            .order('name', { ascending: true });

        if (folderId) {
            query = query.eq('folder_id', folderId);
        } else {
            query = query.is('folder_id', null);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching files:', error);
        } else {
            this.files.set(data as FileMetadata[]);
        }

        this.loading.set(false);
    }

    /**
     * Fetch files for a specific working group
     */
    async fetchFilesByAg(agId: string): Promise<void> {
        const { data, error } = await this.supabase.client
            .from('files')
            .select(FILE_SELECT)
            .eq('working_group_id', agId)
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching AG files:', error);
            return;
        }

        this.agFiles.update(map => {
            const newMap = new Map(map);
            newMap.set(agId, data as FileMetadata[]);
            return newMap;
        });
    }

    /**
     * Fetch all unique folders (legacy)
     */
    async fetchFolders(): Promise<void> {
        const orgId = this.org.currentOrgId();
        let query = this.supabase.client
            .from('files')
            .select('folder');

        if (orgId) {
            query = query.eq('organization_id', orgId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching folders:', error);
            return;
        }

        const uniqueFolders = [
            ...new Set(data?.map(f => f.folder) || []),
        ];
        this.folders.set(uniqueFolders.sort());
    }

    /**
     * Search files by name
     */
    async searchFiles(query: string): Promise<FileMetadata[]> {
        const orgId = this.org.currentOrgId();
        let q = this.supabase.client
            .from('files')
            .select(FILE_SELECT)
            .ilike('name', `%${query}%`)
            .order('name', { ascending: true })
            .limit(50);

        if (orgId) {
            q = q.eq('organization_id', orgId);
        }

        const { data, error } = await q;

        if (error) throw new Error(error.message);
        return data as FileMetadata[];
    }

    /**
     * Upload a file
     */
    async uploadFile(
        file: File,
        folder: string = '/',
        options: {
            visibility?: FileVisibility;
            description?: string;
            workingGroupId?: string;
            folderId?: string;
        } = {}
    ): Promise<FileMetadata> {
        const memberId = this.auth.currentMember()?.id;
        if (!memberId) throw new Error('Nicht eingeloggt');

        const timestamp = Date.now();
        const safeName = file.name
            .replace(/[^a-zA-Z0-9.-]/g, '_');
        const prefix = folder === '/' ? '' : folder;
        const storagePath = `${prefix}/${timestamp}_${safeName}`;

        const { error: uploadError } = await this.supabase.client
            .storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, file, {
                cacheControl: '3600',
                upsert: false,
            });

        if (uploadError) throw new Error(uploadError.message);

        const orgId = this.org.currentOrgId();

        const metadata: Record<string, unknown> = {
            name: file.name,
            original_name: file.name,
            storage_path: storagePath,
            mime_type: file.type,
            size_bytes: file.size,
            folder,
            folder_id: options.folderId || null,
            description: options.description,
            uploaded_by: memberId,
            working_group_id: options.workingGroupId,
            visibility: options.visibility || 'member',
            ...(orgId && { organization_id: orgId }),
        };

        const { data, error } = await this.supabase.client
            .from('files')
            .insert(metadata)
            .select()
            .single();

        if (error) {
            await this.supabase.client.storage
                .from(STORAGE_BUCKET).remove([storagePath]);
            throw new Error(error.message);
        }

        return data as FileMetadata;
    }

    /**
     * Trigger RAG ingestion for a specific file
     */
    async triggerFileIngestion(fileId: string): Promise<{ success: boolean; message?: string }> {
        try {
            const { data, error } = await this.supabase.client.functions.invoke('ingest-file', {
                body: { file_id: fileId }
            });
            
            if (error) {
                console.error("Ingestion error:", error);
                return { success: false, message: "Konnte Datei nicht für KI indizieren." };
            }
            
            return data as { success: boolean; message?: string };
        } catch (e: any) {
            console.error("Ingestion trigger failed:", e);
            return { success: false, message: e.message };
        }
    }

    /**
     * Toggle pin status of a file
     */
    async togglePin(
        fileId: string,
        pinned: boolean
    ): Promise<void> {
        const { error } = await this.supabase.client
            .from('files')
            .update({ is_pinned: pinned })
            .eq('id', fileId);

        if (error) throw new Error(error.message);
    }

    /**
     * Move a file to a different folder
     */
    async moveFile(
        fileId: string,
        folderId: string | null
    ): Promise<void> {
        const { error } = await this.supabase.client
            .from('files')
            .update({ folder_id: folderId })
            .eq('id', fileId);

        if (error) throw new Error(error.message);
    }

    /**
     * Create a persistent folder
     */
    async createPersistentFolder(
        name: string,
        parentId: string | null = null
    ): Promise<FolderMetadata> {
        const orgId = this.org.currentOrgId();
        const memberId = this.auth.currentMember()?.id;

        if (!orgId || !memberId) {
            throw new Error('Nicht eingeloggt');
        }

        const { data, error } = await this.supabase.client
            .from('folders')
            .insert({
                name,
                parent_id: parentId,
                organization_id: orgId,
                created_by: memberId,
            })
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data as FolderMetadata;
    }

    /**
     * Delete a folder
     */
    async deleteFolder(folderId: string): Promise<void> {
        const { error } = await this.supabase.client
            .from('folders')
            .delete()
            .eq('id', folderId);

        if (error) throw new Error(error.message);
    }

    /**
     * Get download URL for a file
     */
    getDownloadUrl(storagePath: string): string {
        const { data } = this.supabase.client
            .storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(storagePath);

        return data.publicUrl;
    }

    /**
     * Get signed download URL (for private files)
     */
    async getSignedUrl(
        storagePath: string,
        expiresIn = 3600
    ): Promise<string> {
        const { data, error } = await this.supabase.client
            .storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(storagePath, expiresIn);

        if (error) throw new Error(error.message);
        return data.signedUrl;
    }

    /**
     * Download a file
     */
    async downloadFile(file: FileMetadata): Promise<void> {
        try {
            const url = await this.getSignedUrl(
                file.storage_path
            );

            const a = document.createElement('a');
            a.href = url;
            a.download = file.original_name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            console.error('Download error:', e);
            throw e;
        }
    }

    /**
     * Update file metadata
     */
    async updateFile(
        id: string,
        updates: Partial<FileMetadata>
    ): Promise<void> {
        const { error } = await this.supabase.client
            .from('files')
            .update({
                ...updates,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id);

        if (error) throw new Error(error.message);
    }

    /**
     * Delete a file
     */
    async deleteFile(file: FileMetadata): Promise<void> {
        const { error: storageError } = await this.supabase
            .client.storage
            .from(STORAGE_BUCKET)
            .remove([file.storage_path]);

        if (storageError) {
            console.warn('Storage delete failed:', storageError);
        }

        const { error } = await this.supabase.client
            .from('files')
            .delete()
            .eq('id', file.id);

        if (error) throw new Error(error.message);
    }

    /**
     * Create a new folder (virtual - just by having files in it)
     */
    createFolder(parentFolder: string, name: string): string {
        return parentFolder === '/'
            ? `/${name}`
            : `${parentFolder}/${name}`;
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
