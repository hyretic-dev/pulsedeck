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
import { WikiDoc } from '../../../shared/models/wiki-doc.model';
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

  // Permission-based visibility
  canEdit = this.permissions.canEditWiki;

  docs = this.wikiService.docs;
  loading = this.wikiService.loading;
  error = this.wikiService.error;

  dialogVisible = signal(false);
  editMode = signal(false);
  saving = signal(false);
  selectedCategory = signal<string | null>(null);
  currentSearchTerm = signal('');
  selectedArticle = signal<WikiDoc | null>(null);

  /** Expanded state for each category */
  expandedCategories: Record<string, boolean> = {
    General: true,
    Finance: false,
    Tech: false,
    Legal: false
  };

  currentDoc: Partial<WikiDoc> = this.getEmptyDoc();
  tempVisibility = 'public';

  categoryOptions = [
    { label: 'Allgemein', value: 'General' },
    { label: 'Finanzen', value: 'Finance' },
    { label: 'Technik', value: 'Tech' },
    { label: 'Rechtliches', value: 'Legal' },
  ];

  // Permissions for publishing
  canPublish = signal(false);

  // Status options computed based on permissions (only committee/admin/ag-lead can publish)
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

  // Gruppen where current user is member
  myGroups = computed(() => {
    const all = this.wgService.workingGroups();
    const myIds = this.wgService.myMemberships();
    return all.filter(g => myIds.has(g.id || ''));
  });

  filteredDocs = computed(() => {
    let docs = this.docs();
    if (this.selectedCategory()) {
      docs = docs.filter((d) => d.category === this.selectedCategory());
    }
    const term = this.currentSearchTerm().toLowerCase();
    if (term) {
      docs = docs.filter(
        (d) =>
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
    // Track wiki visit for onboarding
    this.onboardingService.trackWikiVisit();
  }

  /** Toggle category expansion and filter */
  toggleCategory(category: string) {
    this.expandedCategories[category] = !this.expandedCategories[category];
    if (this.expandedCategories[category]) {
      this.selectedCategory.set(category);
    }
  }

  /** Filter by category (clicking on "All" or category header) */
  filterCategory(category: string | null) {
    this.selectedCategory.set(category);
    this.selectedArticle.set(null);
  }

  /** Get articles for a specific category */
  getDocsByCategory(category: string): WikiDoc[] {
    const term = this.currentSearchTerm().toLowerCase();
    let docs = this.docs();

    if (category.startsWith('AG:')) {
      const agId = category.split(':')[1];
      docs = docs.filter(d => d.working_group_id === agId);
    } else {
      // Standard categories: only show global docs (no working_group_id)
      docs = docs.filter(d => d.category === category && !d.working_group_id);
    }

    if (term) {
      docs = docs.filter(
        d =>
          d.title.toLowerCase().includes(term) ||
          d.description.toLowerCase().includes(term)
      );
    }
    return docs;
  }

  /** Select an article to view */
  selectArticle(doc: WikiDoc) {
    this.selectedArticle.set(doc);
    this.selectedCategory.set(doc.category);
  }

  getEmptyDoc(): Partial<WikiDoc> {
    return {
      title: '',
      description: '',
      content: '',
      author: '',
      category: 'General',
      status: 'Draft',
      organization_id: this.auth.currentOrgId() || undefined,
      last_updated: new Date().toISOString().split('T')[0],
      allowed_roles: ['public', 'member', 'committee', 'admin']
    };
  }

  openNew() {
    this.currentDoc = this.getEmptyDoc();

    // Auto-select AG context if active
    const cat = this.selectedCategory();
    if (cat && cat.startsWith('AG:')) {
      const agId = cat.split(':')[1];
      this.currentDoc.working_group_id = agId;

      // Check AG publish rights
      const isAgAdmin = this.permissions.isAgAdmin(agId);
      this.canPublish.set(this.permissions.isCommittee() || isAgAdmin);
    } else {
      this.currentDoc.working_group_id = undefined;
      this.canPublish.set(this.permissions.isCommittee());
    }

    this.tempVisibility = 'public';
    this.editMode.set(false);
    this.dialogVisible.set(true);
  }

  editDoc(doc: WikiDoc) {
    this.currentDoc = { ...doc };
    this.tempVisibility = this.getVisibilityFromRoles(doc.allowed_roles);

    // Check rights
    const isAgAdmin = doc.working_group_id ? this.permissions.isAgAdmin(doc.working_group_id) : false;
    this.canPublish.set(this.permissions.isCommittee() || isAgAdmin);

    this.editMode.set(true);
    this.dialogVisible.set(true);
  }

  async saveDoc() {
    if (!this.currentDoc.title || !this.currentDoc.description) return;

    // Fix: Ensure organization_id is set (DB constraint)
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

    // Fix: Ensure author is set (DB constraint)
    if (!this.currentDoc.author) {
      const member = this.auth.currentMember();
      this.currentDoc.author = member ? member.name : 'Vom System';
    }

    // Security: Check if user is allowed to publish or keep published status
    const isCommittee = this.permissions.isCommittee();
    const canPub = this.canPublish(); // Uses cached calculation from open/edit
    const currentStatus = this.currentDoc.status;

    if (!canPub && currentStatus === 'Published') {
      // Force change to Review if not allowed
      this.currentDoc.status = 'Review';
      this.messageService.add({
        severity: 'info',
        summary: 'Zur Prüfung',
        detail: 'Deine Änderungen müssen genehmigt werden.'
      });
    }

    this.currentDoc.last_updated = new Date().toISOString().split('T')[0];
    this.currentDoc.allowed_roles = this.getRolesFromVisibility(
      this.tempVisibility
    );

    this.saving.set(true);
    try {
      if (this.editMode() && this.currentDoc.id) {
        await this.wikiService.updateDoc(this.currentDoc.id, this.currentDoc);
        this.messageService.add({
          severity: 'success',
          summary: 'Erfolg',
          detail: 'Artikel aktualisiert',
        });
        // Update selected article if it was edited
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
          // Clear selection if deleted article was selected
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

  getCountByCategory(category: string): number {
    if (category.startsWith('AG:')) {
      const agId = category.split(':')[1];
      return this.docs().filter(d => d.working_group_id === agId).length;
    }
    return this.docs().filter(d => d.category === category && !d.working_group_id).length;
  }

  getCategorySeverity(category: string) {
    switch (category) {
      case 'General':
        return 'info';
      case 'Finance':
        return 'success';
      case 'Tech':
        return 'contrast';
      case 'Legal':
        return 'danger';
      default:
        return 'secondary';
    }
  }

  getCategoryLabel(category: string): string {
    if (category?.startsWith('AG:')) {
      const agId = category.split(':')[1];
      const ag = this.wgService.workingGroups().find(g => g.id === agId);
      return ag ? ag.name : 'Unknown AG';
    }
    const labels: Record<string, string> = {
      General: 'Allgemein',
      Finance: 'Finanzen',
      Tech: 'Technik',
      Legal: 'Rechtlich',
    };
    return labels[category] || category;
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
    if (roles.includes('committee') && !roles.includes('member'))
      return 'committee';
    if (roles.includes('admin') && !roles.includes('committee')) return 'admin';
    return 'public';
  }

  getRolesFromVisibility(vis: string): string[] {
    switch (vis) {
      case 'public':
        return ['public', 'member', 'committee', 'admin'];
      case 'member':
        return ['member', 'committee', 'admin'];
      case 'committee':
        return ['committee', 'admin'];
      case 'admin':
        return ['admin'];
      default:
        return ['public', 'member', 'committee', 'admin'];
    }
  }

}
