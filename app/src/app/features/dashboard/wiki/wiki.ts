import { Component, inject, OnInit, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService } from 'primeng/api';
import { EditorModule } from 'primeng/editor';
import { WikiService } from '../../../shared/services/wiki.service';
import { OrganizationService } from '../../../shared/services/organization.service';
import { WikiDoc, WikiCategory } from '../../../shared/models/wiki-doc.model';
import { AuthService } from '../../../shared/services/auth.service';
import { PermissionsService } from '../../../shared/services/permissions.service';
import { OnboardingService } from '../../../shared/services/onboarding.service';
import { WorkingGroupsService } from '../../../shared/services/working-groups.service';

import { RichTextRendererComponent } from '../../../shared/components/rich-text-renderer/rich-text-renderer.component';

@Component({
    selector: 'app-wiki',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        TagModule,
        ButtonModule,
        InputTextModule,
        TextareaModule,
        SelectModule,
        DialogModule,
        ProgressSpinnerModule,
        ConfirmDialogModule,
        ToastModule,
        TooltipModule,
        EditorModule,
        RichTextRendererComponent
    ],
    providers: [ConfirmationService, MessageService],
    templateUrl: './wiki.html',
    styleUrl: './wiki.css',
})
export class WikiComponent implements OnInit {
    private wikiService = inject(WikiService);
    private confirmationService = inject(ConfirmationService);
    private messageService = inject(MessageService);
    private onboardingService = inject(OnboardingService);
    public auth = inject(AuthService);
    public permissions = inject(PermissionsService);
    public wgService = inject(WorkingGroupsService);
    private orgService = inject(OrganizationService);

    canEdit = this.permissions.canEditWiki;

    docs = this.wikiService.docs;
    categories = this.wikiService.categories;
    loading = this.wikiService.loading;
    error = this.wikiService.error;

    dialogVisible = signal(false);
    editMode = signal(false);
    saving = signal(false);
    selectedCategoryId = signal<string | null>(null);
    currentSearchTerm = signal('');
    selectedArticle = signal<WikiDoc | null>(null);

    expandedCategories: Record<string, boolean> = {};

    currentDoc: Partial<WikiDoc> = this.getEmptyDoc();
    tempVisibility = 'public';

    canPublish = signal(false);
    selectedScope = signal<string>('global'); // 'global' or AG id

    scopeOptions = computed(() => {
        const opts: { label: string; value: string }[] = [
            { label: 'Global (Alle)', value: 'global' }
        ];
        for (const ag of this.myGroups()) {
            opts.push({ label: ag.name, value: ag.id! });
        }
        return opts;
    });

    /** Categories available for the currently selected scope in the dialog */
    dialogCategoryOptions = computed(() => {
        const scope = this.selectedScope();
        if (scope === 'global') {
            return this.globalCategories();
        }
        return this.agCategories(scope);
    });

    // Category management
    showCategoryManager = signal(false);
    catDialogVisible = signal(false);
    catEditMode = signal(false);
    catSaving = signal(false);
    catScope: 'global' | string = 'global'; // 'global' or AG id
    currentCategory: Partial<WikiCategory> = { name: '', icon: 'pi-folder', sort_order: 0 };

    statusOptions = computed(() => {
        const isCommittee = this.permissions.isCommittee();
        const canPub = this.canPublish();
        const opts = [
            { label: 'Entwurf', value: 'Draft' },
            { label: 'In Prüfung', value: 'Review' },
        ];
        if (isCommittee || canPub) {
            opts.unshift({ label: 'Veröffentlicht', value: 'Published' });
        }
        return opts;
    });

    visibilityOptions = [
        { label: 'Öffentlich (Alle)', value: 'public' },
        { label: 'Nur Mitglieder', value: 'member' },
        { label: 'Nur Vorstand', value: 'committee' },
        { label: 'Nur Admin', value: 'admin' },
    ];

    iconOptions = [
        { label: 'Info', value: 'pi-info-circle' },
        { label: 'Dollar', value: 'pi-dollar' },
        { label: 'Zahnrad', value: 'pi-cog' },
        { label: 'Schild', value: 'pi-shield' },
        { label: 'Ordner', value: 'pi-folder' },
        { label: 'Datei', value: 'pi-file' },
        { label: 'Buch', value: 'pi-book' },
        { label: 'Benutzer', value: 'pi-users' },
        { label: 'Kalender', value: 'pi-calendar' },
        { label: 'Stern', value: 'pi-star' },
        { label: 'Herz', value: 'pi-heart' },
        { label: 'Blitz', value: 'pi-bolt' },
    ];

    myGroups = computed(() => {
        const all = this.wgService.workingGroups();
        const myIds = this.wgService.myMemberships();
        return all.filter(g => myIds.has(g.id || ''));
    });

    /** Global categories only */
    globalCategories = computed(() =>
        this.categories().filter(c => !c.working_group_id)
    );

    /** Categories for a specific AG */
    agCategories(agId: string): WikiCategory[] {
        return this.categories().filter(c => c.working_group_id === agId);
    }

    /** All global categories + AG categories the user has access to */
    visibleCategories = computed(() => {
        const myAgIds = new Set(this.myGroups().map(g => g.id!));
        return this.categories().filter(c =>
            !c.working_group_id || myAgIds.has(c.working_group_id)
        );
    });

    filteredDocs = computed(() => {
        let docs = this.docs();
        if (this.selectedCategoryId()) {
            docs = docs.filter(d => d.category === this.selectedCategoryId());
        }
        const term = this.currentSearchTerm().toLowerCase();
        if (term) {
            docs = docs.filter(
                d =>
                    d.title.toLowerCase().includes(term) ||
                    d.description.toLowerCase().includes(term) ||
                    d.author.toLowerCase().includes(term)
            );
        }
        return docs;
    });

    constructor() {
        effect(() => {
            const orgId = this.orgService.currentOrgId();
            if (orgId) {
                this.wikiService.fetchDocs(orgId);
                this.wikiService.fetchCategories(orgId);
                this.wgService.fetchWorkingGroups();
            }
        });

        effect(() => {
            const member = this.auth.currentMember();
            if (member?.id) {
                this.wgService.fetchMyMemberships(member.id);
            }
        });
    }

    ngOnInit(): void {
        this.onboardingService.trackWikiVisit();
    }

    /** Find category by ID */
    getCategory(id: string): WikiCategory | undefined {
        return this.categories().find(c => c.id === id);
    }

    toggleCategoryExpand(key: string) {
        this.expandedCategories[key] = !this.expandedCategories[key];
    }

    filterByCategory(categoryId: string | null) {
        this.selectedCategoryId.set(categoryId);
        this.selectedArticle.set(null);
    }

    /** Get docs belonging to a specific wiki_category */
    getDocsByCategoryId(categoryId: string): WikiDoc[] {
        const term = this.currentSearchTerm().toLowerCase();
        let docs = this.docs().filter(d => d.category === categoryId);
        if (term) {
            docs = docs.filter(
                d =>
                    d.title.toLowerCase().includes(term) ||
                    d.description.toLowerCase().includes(term)
            );
        }
        return docs;
    }

    /** Get docs for an AG (all categories within that AG) */
    getDocsByAgId(agId: string): WikiDoc[] {
        const term = this.currentSearchTerm().toLowerCase();
        let docs = this.docs().filter(d => d.working_group_id === agId);
        if (term) {
            docs = docs.filter(
                d =>
                    d.title.toLowerCase().includes(term) ||
                    d.description.toLowerCase().includes(term)
            );
        }
        return docs;
    }

    countDocsInCategory(categoryId: string): number {
        return this.docs().filter(d => d.category === categoryId).length;
    }

    countDocsInAg(agId: string): number {
        return this.docs().filter(d => d.working_group_id === agId).length;
    }

    selectArticle(doc: WikiDoc) {
        this.selectedArticle.set(doc);
        this.selectedCategoryId.set(doc.category);
    }

    getEmptyDoc(): Partial<WikiDoc> {
        return {
            title: '',
            description: '',
            content: '',
            author: '',
            category: '',
            status: 'Draft',
            organization_id: this.auth.currentOrgId() || undefined,
            last_updated: new Date().toISOString().split('T')[0],
            allowed_roles: ['public', 'member', 'committee', 'admin']
        };
    }

    openNew() {
        this.currentDoc = this.getEmptyDoc();

        const catId = this.selectedCategoryId();
        if (catId) {
            const cat = this.getCategory(catId);
            if (cat) {
                this.currentDoc.category = catId;
                if (cat.working_group_id) {
                    this.selectedScope.set(cat.working_group_id);
                    this.currentDoc.working_group_id = cat.working_group_id;
                    const isAgAdmin = this.permissions.isAgAdmin(cat.working_group_id);
                    this.canPublish.set(this.permissions.isCommittee() || isAgAdmin);
                } else {
                    this.selectedScope.set('global');
                    this.currentDoc.working_group_id = undefined;
                    this.canPublish.set(this.permissions.isCommittee());
                }
            }
        } else {
            this.selectedScope.set('global');
            // Default to first global category
            const firstGlobal = this.globalCategories()[0];
            if (firstGlobal) {
                this.currentDoc.category = firstGlobal.id;
            }
            this.currentDoc.working_group_id = undefined;
            this.canPublish.set(this.permissions.isCommittee());
        }

        this.tempVisibility = 'public';
        this.editMode.set(false);
        this.dialogVisible.set(true);
    }

    /** Called when the user changes the scope dropdown in the dialog */
    onScopeChange(scope: string) {
        this.selectedScope.set(scope);
        if (scope === 'global') {
            this.currentDoc.working_group_id = undefined;
            const firstGlobal = this.globalCategories()[0];
            this.currentDoc.category = firstGlobal ? firstGlobal.id : '';
            this.canPublish.set(this.permissions.isCommittee());
        } else {
            this.currentDoc.working_group_id = scope;
            const firstAgCat = this.agCategories(scope)[0];
            this.currentDoc.category = firstAgCat ? firstAgCat.id : '';
            const isAgAdmin = this.permissions.isAgAdmin(scope);
            this.canPublish.set(this.permissions.isCommittee() || isAgAdmin);
        }
    }

    editDoc(doc: WikiDoc) {
        this.currentDoc = { ...doc };
        this.tempVisibility = this.getVisibilityFromRoles(doc.allowed_roles);

        const isAgAdmin = doc.working_group_id ? this.permissions.isAgAdmin(doc.working_group_id) : false;
        this.canPublish.set(this.permissions.isCommittee() || isAgAdmin);

        this.selectedScope.set(doc.working_group_id || 'global');

        this.editMode.set(true);
        this.dialogVisible.set(true);
    }

    async saveDoc() {
        if (!this.currentDoc.title || !this.currentDoc.description) return;

        if (!this.currentDoc.organization_id) {
            const orgId = this.auth.currentOrgId();
            if (!orgId) {
                this.messageService.add({
                    severity: 'error',
                    summary: 'Fehler',
                    detail: 'Keine aktive Organisation gefunden. Bitte neu laden.'
                });
                return;
            }
            this.currentDoc.organization_id = orgId;
        }

        if (!this.currentDoc.author) {
            const member = this.auth.currentMember();
            this.currentDoc.author = member ? member.name : 'Vom System';
        }

        // Ensure a category is set
        if (!this.currentDoc.category) {
            const firstGlobal = this.globalCategories()[0];
            if (firstGlobal) {
                this.currentDoc.category = firstGlobal.id;
            }
        }

        const isCommittee = this.permissions.isCommittee();
        const canPub = this.canPublish();
        const currentStatus = this.currentDoc.status;

        if (!canPub && currentStatus === 'Published') {
            this.currentDoc.status = 'Review';
            this.messageService.add({
                severity: 'info',
                summary: 'Zur Prüfung',
                detail: 'Deine Änderungen müssen genehmigt werden.'
            });
        }

        this.currentDoc.last_updated = new Date().toISOString().split('T')[0];
        this.currentDoc.allowed_roles = this.getRolesFromVisibility(this.tempVisibility);

        this.saving.set(true);
        try {
            if (this.editMode() && this.currentDoc.id) {
                await this.wikiService.updateDoc(this.currentDoc.id, this.currentDoc);
                this.messageService.add({
                    severity: 'success',
                    summary: 'Erfolg',
                    detail: 'Artikel aktualisiert',
                });
                if (this.selectedArticle()?.id === this.currentDoc.id) {
                    this.selectedArticle.set(this.currentDoc as WikiDoc);
                }
            } else {
                await this.wikiService.addDoc(this.currentDoc as WikiDoc);
                this.messageService.add({
                    severity: 'success',
                    summary: 'Erfolg',
                    detail: 'Artikel erstellt',
                });
            }
            this.dialogVisible.set(false);
        } catch (e) {
            this.messageService.add({
                severity: 'error',
                summary: 'Fehler',
                detail: (e as Error).message,
            });
        }
        this.saving.set(false);
    }

    confirmDelete(doc: WikiDoc) {
        this.confirmationService.confirm({
            message: `Möchtest du den Artikel "${doc.title}" wirklich löschen?`,
            header: 'Löschen bestätigen',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Ja, löschen',
            rejectLabel: 'Abbrechen',
            accept: async () => {
                try {
                    await this.wikiService.deleteDoc(doc.id!);
                    this.messageService.add({
                        severity: 'success',
                        summary: 'Gelöscht',
                        detail: 'Artikel wurde gelöscht',
                    });
                    if (this.selectedArticle()?.id === doc.id) {
                        this.selectedArticle.set(null);
                    }
                } catch (e) {
                    this.messageService.add({
                        severity: 'error',
                        summary: 'Fehler',
                        detail: (e as Error).message,
                    });
                }
            },
        });
    }

    onSearch(event: Event) {
        const input = event.target as HTMLInputElement;
        this.currentSearchTerm.set(input.value);
    }

    // --- Category Management ---

    isAGAdmin = computed(() => {
        for (const role of this.permissions.agRoles().values()) {
            if (role === 'admin' || role === 'lead') return true;
        }
        return false;
    });

    canManageCategories = computed(() => {
        return this.permissions.isCommittee() || this.isAGAdmin();
    });

    /** Open the category manager for global or a specific AG */
    openCategoryManager(scope: 'global' | string) {
        this.catScope = scope;
        this.showCategoryManager.set(true);
    }

    getCategoriesForScope(): WikiCategory[] {
        if (this.catScope === 'global') {
            return this.globalCategories();
        }
        return this.agCategories(this.catScope);
    }

    getScopeLabel(): string {
        if (this.catScope === 'global') return 'Globale Kategorien';
        const ag = this.wgService.workingGroups().find(g => g.id === this.catScope);
        return ag ? `Kategorien: ${ag.name}` : 'Kategorien';
    }

    openNewCategory() {
        this.catEditMode.set(false);
        this.currentCategory = {
            name: '',
            icon: 'pi-folder',
            sort_order: this.getCategoriesForScope().length,
            organization_id: this.auth.currentOrgId() || '',
            working_group_id: this.catScope === 'global' ? undefined : this.catScope,
        };
        this.catDialogVisible.set(true);
    }

    editCategory(cat: WikiCategory) {
        this.catEditMode.set(true);
        this.currentCategory = { ...cat };
        this.catDialogVisible.set(true);
    }

    async saveCategory() {
        if (!this.currentCategory.name) return;
        this.catSaving.set(true);
        try {
            const payload = {
                name: this.currentCategory.name!,
                icon: this.currentCategory.icon,
                sort_order: this.currentCategory.sort_order ?? 0,
                organization_id: this.auth.currentOrgId() || this.currentCategory.organization_id!,
                working_group_id: this.catScope === 'global' ? undefined : (this.currentCategory.working_group_id || this.catScope),
            };

            if (this.catEditMode() && this.currentCategory.id) {
                await this.wikiService.updateCategory(this.currentCategory.id, payload);
                this.messageService.add({ severity: 'success', summary: 'Erfolg', detail: 'Kategorie aktualisiert' });
            } else {
                await this.wikiService.addCategory(payload as any);
                this.messageService.add({ severity: 'success', summary: 'Erfolg', detail: 'Kategorie erstellt' });
            }
            this.catDialogVisible.set(false);
        } catch (e) {
            this.messageService.add({ severity: 'error', summary: 'Fehler', detail: (e as Error).message });
        }
        this.catSaving.set(false);
    }

    confirmDeleteCategory(cat: WikiCategory) {
        const count = this.countDocsInCategory(cat.id);
        const warning = count > 0
            ? `Diese Kategorie hat ${count} Artikel. Diese werden NICHT gelöscht, aber ihre Kategorie-Zuordnung geht verloren. `
            : '';
        this.confirmationService.confirm({
            message: `${warning}Möchtest du die Kategorie "${cat.name}" wirklich löschen?`,
            header: 'Kategorie löschen',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Ja, löschen',
            rejectLabel: 'Abbrechen',
            accept: async () => {
                try {
                    await this.wikiService.deleteCategory(cat.id);
                    this.messageService.add({ severity: 'success', summary: 'Gelöscht', detail: 'Kategorie wurde gelöscht' });
                } catch (e) {
                    this.messageService.add({ severity: 'error', summary: 'Fehler', detail: (e as Error).message });
                }
            },
        });
    }

    // --- Helpers ---

    getCategoryLabelForDoc(doc: WikiDoc): string {
        const cat = this.getCategory(doc.category);
        return cat ? cat.name : 'Unbekannt';
    }

    getCategoryIconForDoc(doc: WikiDoc): string {
        const cat = this.getCategory(doc.category);
        return cat?.icon || 'pi-folder';
    }

    getCategoryColorClass(cat: WikiCategory): string {
        if (cat.working_group_id) {
            return 'border-l-purple-500';
        }
        return 'border-l-linke';
    }

    getCategorySeverity(cat: WikiCategory | undefined): 'info' | 'success' | 'contrast' | 'danger' | 'secondary' {
        if (!cat) return 'secondary';
        if (cat.working_group_id) return 'contrast';
        const name = cat.name.toLowerCase();
        if (name.includes('allgemein') || name.includes('info')) return 'info';
        if (name.includes('finanz') || name.includes('geld')) return 'success';
        if (name.includes('technik') || name.includes('tech')) return 'contrast';
        if (name.includes('recht') || name.includes('legal')) return 'danger';
        return 'secondary';
    }

    getStatusLabel(status: string): string {
        const labels: Record<string, string> = {
            Published: 'Veröffentlicht',
            Draft: 'Entwurf',
            Review: 'In Prüfung',
        };
        return labels[status] || status;
    }

    getVisibilityFromRoles(roles: string[] = []): string {
        if (!roles || roles.length === 0) return 'public';
        if (roles.includes('public')) return 'public';
        if (roles.includes('member') && !roles.includes('public')) return 'member';
        if (roles.includes('committee') && !roles.includes('member')) return 'committee';
        if (roles.includes('admin') && !roles.includes('committee')) return 'admin';
        return 'public';
    }

    getRolesFromVisibility(vis: string): string[] {
        switch (vis) {
            case 'public': return ['public', 'member', 'committee', 'admin'];
            case 'member': return ['member', 'committee', 'admin'];
            case 'committee': return ['committee', 'admin'];
            case 'admin': return ['admin'];
            default: return ['public', 'member', 'committee', 'admin'];
        }
    }
}
