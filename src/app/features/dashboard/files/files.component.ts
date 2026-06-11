import {
    Component,
    OnInit,
    inject,
    signal,
    computed,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import {
    FileUploadModule,
    FileUploadHandlerEvent,
} from 'primeng/fileupload';
import { TagModule } from 'primeng/tag';
import { MessageService, ConfirmationService } from 'primeng/api';

// Services
import {
    FileService,
    FileMetadata,
    FileVisibility,
    FolderMetadata,
} from '../../../shared/services/file.service';
import { AuthService } from '../../../shared/services/auth.service';
import { WorkingGroupsService } from '../../../shared/services/working-groups.service';

type ViewMode = 'overview' | 'folder';

interface BreadcrumbItem {
    label: string;
    folderId: string | null;
}

@Component({
    selector: 'app-files',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        DatePipe,
        ButtonModule,
        DialogModule,
        InputTextModule,
        TextareaModule,
        SelectModule,
        ProgressSpinnerModule,
        ToastModule,
        ConfirmDialogModule,
        TooltipModule,
        FileUploadModule,
        TagModule,
    ],
    providers: [MessageService, ConfirmationService],
    templateUrl: './files.component.html',
})
export class FilesComponent implements OnInit {
    public fileService = inject(FileService);
    public auth = inject(AuthService);
    private wgService = inject(WorkingGroupsService);
    private msg = inject(MessageService);
    private confirm = inject(ConfirmationService);

    workingGroups = this.wgService.workingGroups;

    // View state
    viewMode = signal<ViewMode>('overview');
    breadcrumbs = signal<BreadcrumbItem[]>([
        { label: 'Dateien', folderId: null },
    ]);

    // Dialogs
    uploadDialogVisible = signal(false);
    uploading = signal(false);
    createFolderDialogVisible = signal(false);
    moveFileDialogVisible = signal(false);

    // Search
    searchQuery = signal('');
    searchResults = signal<FileMetadata[]>([]);
    isSearching = signal(false);

    // Upload form
    uploadVisibility: FileVisibility = 'member';
    uploadDescription = '';
    uploadWorkingGroupId: string | null = null;

    // Create folder form
    newFolderName = '';

    // Move file
    moveFileTarget: FileMetadata | null = null;
    moveTargetFolderId: string | null = null;
    allFolders = signal<FolderMetadata[]>([]);

    visibilityOptions = [
        { label: 'Alle Mitglieder', value: 'member' },
        { label: 'Nur Vorstand', value: 'committee' },
        { label: 'Nur Admin', value: 'admin' },
        { label: 'Nur AG-Mitglieder', value: 'ag-only' },
    ];

    /** True wenn der User Admin oder Committee ist */
    canManage = computed(() => {
        const role = this.auth.currentMember()?.app_role;
        return role === 'admin' || role === 'committee';
    });

    ngOnInit(): void {
        this.loadOverview();
        this.wgService.fetchWorkingGroups();
    }

    // --- Overview ---

    async loadOverview(): Promise<void> {
        this.viewMode.set('overview');
        this.breadcrumbs.set([
            { label: 'Dateien', folderId: null },
        ]);
        this.fileService.loading.set(true);

        await Promise.all([
            this.fileService.fetchPinnedFiles(),
            this.fileService.fetchRecentFiles(8),
            this.fileService.fetchFolderList(null),
            this.fileService.fetchFilesByFolderId(null),
        ]);

        this.fileService.loading.set(false);
    }

    // --- Folder Navigation ---

    async openFolder(folder: FolderMetadata): Promise<void> {
        this.viewMode.set('folder');
        this.clearSearch();

        const crumbs = [...this.breadcrumbs()];
        crumbs.push({
            label: folder.name,
            folderId: folder.id,
        });
        this.breadcrumbs.set(crumbs);

        this.fileService.loading.set(true);
        await Promise.all([
            this.fileService.fetchFolderList(folder.id),
            this.fileService.fetchFilesByFolderId(folder.id),
        ]);
        this.fileService.loading.set(false);
    }

    async navigateToBreadcrumb(
        item: BreadcrumbItem
    ): Promise<void> {
        if (!item.folderId) {
            await this.loadOverview();
            return;
        }

        const crumbs = this.breadcrumbs();
        const idx = crumbs.findIndex(
            c => c.folderId === item.folderId
        );
        if (idx >= 0) {
            this.breadcrumbs.set(crumbs.slice(0, idx + 1));
        }

        this.viewMode.set('folder');
        this.fileService.loading.set(true);
        await Promise.all([
            this.fileService.fetchFolderList(item.folderId),
            this.fileService.fetchFilesByFolderId(item.folderId),
        ]);
        this.fileService.loading.set(false);
    }

    // --- Upload ---

    openUploadDialog(): void {
        this.uploadVisibility = 'member';
        this.uploadDescription = '';
        this.uploadWorkingGroupId = null;
        this.uploadDialogVisible.set(true);
    }

    async handleUpload(
        event: FileUploadHandlerEvent
    ): Promise<void> {
        const file = event.files[0];
        if (!file) return;

        this.uploading.set(true);
        const folderId =
            this.fileService.currentFolderId() ?? undefined;

        try {
            await this.fileService.uploadFile(
                file,
                this.fileService.currentFolder(),
                {
                    visibility: this.uploadVisibility,
                    description:
                        this.uploadDescription || undefined,
                    workingGroupId:
                        this.uploadWorkingGroupId || undefined,
                    folderId,
                }
            );

            this.msg.add({
                severity: 'success',
                summary: 'Hochgeladen',
                detail: `${file.name} wurde hochgeladen.`,
            });

            this.uploadDialogVisible.set(false);
            await this.refreshCurrentView();
        } catch (e) {
            this.msg.add({
                severity: 'error',
                summary: 'Fehler',
                detail: (e as Error).message,
            });
        }

        this.uploading.set(false);
    }

    // --- Create Folder ---

    openCreateFolderDialog(): void {
        this.newFolderName = '';
        this.createFolderDialogVisible.set(true);
    }

    async createFolder(): Promise<void> {
        const name = this.newFolderName.trim();
        if (!name) return;

        try {
            const parentId =
                this.fileService.currentFolderId();
            await this.fileService.createPersistentFolder(
                name,
                parentId
            );

            this.msg.add({
                severity: 'success',
                summary: 'Ordner erstellt',
                detail: `„${name}" wurde angelegt.`,
            });

            this.createFolderDialogVisible.set(false);
            await this.refreshCurrentView();
        } catch (e) {
            this.msg.add({
                severity: 'error',
                summary: 'Fehler',
                detail: (e as Error).message,
            });
        }
    }

    // --- Pin / Unpin ---

    async togglePin(file: FileMetadata): Promise<void> {
        const newState = !file.is_pinned;
        try {
            await this.fileService.togglePin(
                file.id!,
                newState
            );
            this.msg.add({
                severity: 'success',
                summary: newState ? 'Angepinnt' : 'Gelöst',
                detail: newState
                    ? `${file.name} wurde angepinnt.`
                    : `${file.name} wurde gelöst.`,
            });
            await this.refreshCurrentView();
        } catch (e) {
            this.msg.add({
                severity: 'error',
                summary: 'Fehler',
                detail: (e as Error).message,
            });
        }
    }

    // --- Move File ---

    async openMoveDialog(
        file: FileMetadata
    ): Promise<void> {
        this.moveFileTarget = file;
        this.moveTargetFolderId = null;

        const orgId = this.fileService['org'].currentOrgId();
        if (!orgId) return;

        const { data } = await this.fileService[
            'supabase'
        ].client
            .from('folders')
            .select('*')
            .eq('organization_id', orgId)
            .order('name', { ascending: true });

        this.allFolders.set(
            (data as FolderMetadata[]) || []
        );
        this.moveFileDialogVisible.set(true);
    }

    async moveFile(): Promise<void> {
        if (!this.moveFileTarget?.id) return;

        try {
            await this.fileService.moveFile(
                this.moveFileTarget.id,
                this.moveTargetFolderId
            );

            this.msg.add({
                severity: 'success',
                summary: 'Verschoben',
                detail: `${this.moveFileTarget.name} wurde verschoben.`,
            });

            this.moveFileDialogVisible.set(false);
            this.moveFileTarget = null;
            await this.refreshCurrentView();
        } catch (e) {
            this.msg.add({
                severity: 'error',
                summary: 'Fehler',
                detail: (e as Error).message,
            });
        }
    }

    // --- Download ---

    async downloadFile(
        file: FileMetadata
    ): Promise<void> {
        try {
            await this.fileService.downloadFile(file);
        } catch (e) {
            this.msg.add({
                severity: 'error',
                summary: 'Fehler',
                detail: 'Download fehlgeschlagen.',
            });
        }
    }

    // --- Delete File ---

    confirmDelete(file: FileMetadata): void {
        this.confirm.confirm({
            message: `„${file.name}" wirklich löschen?`,
            header: 'Löschen bestätigen',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Ja, löschen',
            rejectLabel: 'Abbrechen',
            accept: async () => {
                try {
                    await this.fileService.deleteFile(file);
                    this.msg.add({
                        severity: 'success',
                        summary: 'Gelöscht',
                        detail: 'Datei wurde gelöscht.',
                    });
                    await this.refreshCurrentView();
                } catch (e) {
                    this.msg.add({
                        severity: 'error',
                        summary: 'Fehler',
                        detail: (e as Error).message,
                    });
                }
            },
        });
    }

    // --- Delete Folder ---

    confirmDeleteFolder(folder: FolderMetadata): void {
        this.confirm.confirm({
            message: `Ordner „${folder.name}" und alle Inhalte löschen?`,
            header: 'Ordner löschen',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Ja, löschen',
            rejectLabel: 'Abbrechen',
            accept: async () => {
                try {
                    await this.fileService.deleteFolder(
                        folder.id
                    );
                    this.msg.add({
                        severity: 'success',
                        summary: 'Gelöscht',
                        detail: 'Ordner wurde gelöscht.',
                    });
                    await this.refreshCurrentView();
                } catch (e) {
                    this.msg.add({
                        severity: 'error',
                        summary: 'Fehler',
                        detail: (e as Error).message,
                    });
                }
            },
        });
    }

    // --- Search ---

    async onSearch(): Promise<void> {
        const query = this.searchQuery().trim();
        if (!query) {
            this.clearSearch();
            return;
        }

        this.isSearching.set(true);
        try {
            const results =
                await this.fileService.searchFiles(query);
            this.searchResults.set(results);
        } catch (e) {
            console.error('Search error:', e);
        }
    }

    clearSearch(): void {
        this.searchQuery.set('');
        this.searchResults.set([]);
        this.isSearching.set(false);
    }

    // --- Helpers ---

    canDelete(file: FileMetadata): boolean {
        const member = this.auth.currentMember();
        if (!member) return false;
        return (
            file.uploaded_by === member.id ||
            member.app_role === 'admin'
        );
    }

    getVisibilityLabel(visibility: FileVisibility): string {
        const labels: Record<FileVisibility, string> = {
            public: 'Öffentlich',
            member: 'Mitglieder',
            committee: 'Vorstand',
            admin: 'Admin',
            'ag-only': 'AG',
        };
        return labels[visibility];
    }

    getVisibilitySeverity(
        visibility: FileVisibility
    ): string {
        const map: Record<FileVisibility, string> = {
            public: 'success',
            member: 'info',
            committee: 'warn',
            admin: 'danger',
            'ag-only': 'secondary',
        };
        return map[visibility];
    }

    getMoveTargetOptions(): {
        label: string;
        value: string | null;
    }[] {
        const root = [
            { label: '/ Hauptverzeichnis', value: null as string | null },
        ];
        const folderOpts = this.allFolders().map(f => ({
            label: f.name,
            value: f.id as string | null,
        }));
        return [...root, ...folderOpts];
    }

    private async refreshCurrentView(): Promise<void> {
        if (this.viewMode() === 'overview') {
            await this.loadOverview();
            return;
        }
        const folderId =
            this.fileService.currentFolderId();
        await Promise.all([
            this.fileService.fetchFolderList(folderId),
            this.fileService.fetchFilesByFolderId(folderId),
            this.fileService.fetchPinnedFiles(),
            this.fileService.fetchRecentFiles(8),
        ]);
    }
}
