import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkingGroupsService } from '../../../shared/services/working-groups.service';
import { WorkingGroup } from '../../../shared/models/working-group.model';
import { AgRole, Member } from '../../../shared/models/member.model';
import { AuthService } from '../../../shared/services/auth.service';
import {
  PermissionsService,
  AG_ROLE_LABELS,
} from '../../../shared/services/permissions.service';
import { OrganizationService } from '../../../shared/services/organization.service';

// PrimeNG Imports
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ChipModule } from 'primeng/chip';
import { AvatarModule } from 'primeng/avatar';
import { AvatarGroupModule } from 'primeng/avatargroup';
import { MessageModule } from 'primeng/message';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { SelectModule } from 'primeng/select';
import { RippleModule } from 'primeng/ripple';
import { AccordionModule } from 'primeng/accordion';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-working-groups',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    CardModule,
    TagModule,
    TooltipModule,
    ChipModule,
    AvatarModule,
    AvatarGroupModule,
    MessageModule,
    ToastModule,
    ConfirmDialogModule,
    ProgressSpinnerModule,
    IconFieldModule,
    InputIconModule,
    SelectModule,
    RippleModule,
    AccordionModule,
    AutoCompleteModule,
    RouterModule
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './working-groups.html',
  styleUrl: './working-groups.css',
})
export class WorkingGroupsComponent implements OnInit {
  public workingGroupsService = inject(WorkingGroupsService);
  private confirmationService = inject(ConfirmationService);
  private messageService = inject(MessageService);
  public auth = inject(AuthService);
  public permissions = inject(PermissionsService);
  private orgService = inject(OrganizationService);

  groups = this.workingGroupsService.workingGroups;
  loading = this.workingGroupsService.loading;
  error = this.workingGroupsService.error;
  myMemberships = this.workingGroupsService.myMemberships;
  myAgRoles = this.workingGroupsService.myAgRoles;
  agEvents = this.workingGroupsService.agEvents;

  dialogVisible = signal(false);
  editMode = signal(false);
  saving = signal(false);
  currentGroup: WorkingGroup = this.getEmptyGroup();
  tagsInput = ''; // Comma-separated string for tags input
  expandedGroups: Record<string, boolean> = {}; // Custom expand state

  // Kategorie-Filter
  /** Alle in der Organisation vorhandenen Kategorien (für AutoComplete + Filter-Chips). */
  availableCategories = signal<string[]>([]);
  /** Aktuell aktive Kategorie-Filter (Multiselect). */
  selectedCategoryFilters = signal<Set<string>>(new Set());
  /** AutoComplete-Vorschläge (gefiltert nach Eingabe). */
  categorySuggestions: string[] = [];

  /** Gefilterte Gruppenliste basierend auf selectedCategoryFilters. */
  filteredGroups = computed(() => {
    const active = this.selectedCategoryFilters();
    if (active.size === 0) return this.groups();
    return this.groups().filter((g) => {
      const cat = g.category ?? null;
      return cat !== null && active.has(cat);
    });
  });

  // AG Member Management
  membersDialogVisible = signal(false);
  currentAgForMembers = signal<WorkingGroup | null>(null);
  agMembers = signal<{ member_id: string; name: string; role: AgRole }[]>([]);
  loadingMembers = signal(false);

  // AG Role options
  agRoleOptions = [
    { label: 'Mitglied', value: 'member' },
    { label: 'Admin', value: 'admin' },
    { label: 'Leitung', value: 'lead' },
  ];
  agRoleLabels = AG_ROLE_LABELS;

  // Toggle expand/collapse for a group
  toggleExpand(groupId: string) {
    this.expandedGroups[groupId] = !this.expandedGroups[groupId];
  }

  // Helper to get events for a specific AG
  getAgEvents(groupId: string) {
    return this.agEvents().get(groupId) ?? [];
  }

  contactTypes = [
    {
      label: 'Discord',
      value: 'Discord',
      icon: 'pi pi-comments'
    },
    {
      label: 'E-Mail',
      value: 'Email',
      icon: 'pi pi-envelope'
    },
    {
      label: 'WhatsApp',
      value: 'WhatsApp',
      icon: 'pi pi-comment'
    },
    {
      label: 'Signal',
      value: 'Signal',
      icon: 'pi pi-send'
    },
  ];

  // Contact validation: count missing per AG
  missingContactCounts = signal<Map<string, number>>(
    new Map()
  );


  constructor() {
    // React to organization changes
    effect(() => {
      const currentOrg =
        this.orgService.currentOrgId();
      if (currentOrg) {
        this.workingGroupsService
          .fetchWorkingGroups();
      }
    });

    // React to Member changes
    effect(() => {
      const member = this.auth.currentMember();
      if (member && member.id) {
        this.workingGroupsService
          .fetchMyMemberships(member.id);
      }
    });

    // Contact validation on groups change
    effect(() => {
      const groups = this.groups();
      if (groups.length > 0) {
        this.loadContactValidation(groups);
      }
    });
  }

  ngOnInit(): void {
    this.workingGroupsService.fetchWorkingGroups();
    this.loadCategories();
  }

  /** Lädt alle eindeutigen Kategorien der aktuellen Organisation. */
  private async loadCategories(): Promise<void> {
    const cats = await this.workingGroupsService.fetchDistinctCategories();
    this.availableCategories.set(cats);
  }

  getEmptyGroup(): WorkingGroup {
    return {
      id: '',
      name: '',
      description: '',
      lead: '',
      members_count: 0,
      next_meeting: '',
      contact_type: 'Discord',
      contact_value: '',
      contact_link: '',
      contact_icon: 'pi pi-comments',
      tags: [],
      category: null,
    };
  }

  getIconForType(contactType: string): string {
    const iconMap: Record<string, string> = {
      'Discord': 'pi pi-comments',
      'Email': 'pi pi-envelope',
      'WhatsApp': 'pi pi-comment',
      'Signal': 'pi pi-send'
    };
    return iconMap[contactType] || 'pi pi-link';
  }

  openNew() {
    this.currentGroup = this.getEmptyGroup();
    this.tagsInput = '';
    this.editMode.set(false);
    this.dialogVisible.set(true);
  }

  editGroup(group: WorkingGroup) {
    this.currentGroup = { ...group };
    this.tagsInput = group.tags?.join(', ') || '';
    this.editMode.set(true);
    this.dialogVisible.set(true);
  }

  async saveGroup() {
    if (!this.currentGroup.name || !this.currentGroup.lead) return;

    // Parse tags from comma-separated input
    this.currentGroup.tags = this.tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    this.saving.set(true);

    // Set icon based on type
    const selectedType = this.contactTypes.find(t => t.value === this.currentGroup.contact_type);
    if (selectedType) {
      this.currentGroup.contact_icon = selectedType.icon;
    }

    try {
      if (this.editMode() && this.currentGroup.id) {
        await this.workingGroupsService.updateWorkingGroup(
          this.currentGroup.id,
          this.currentGroup
        );
        this.messageService.add({
          severity: 'success',
          summary: 'Erfolg',
          detail: 'AG aktualisiert',
        });
      } else {
        const { id, ...newGroup } = this.currentGroup;
        await this.workingGroupsService.addWorkingGroup(newGroup);
        this.messageService.add({
          severity: 'success',
          summary: 'Erfolg',
          detail: 'AG erstellt',
        });
      }
      this.dialogVisible.set(false);
      // Kategorien neu laden, da ggf. neue Kategorie hinzugekommen
      await this.loadCategories();
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Fehler',
        detail: (e as Error).message,
      });
    }
    this.saving.set(false);
  }

  confirmDelete(group: WorkingGroup) {
    if (!group.id) return;
    this.confirmationService.confirm({
      message: `Möchtest du die AG "${group.name}" wirklich löschen?`,
      header: 'Löschen bestätigen',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Ja, löschen',
      rejectLabel: 'Abbrechen',
      accept: async () => {
        try {
          if (group.id) {
            await this.workingGroupsService.deleteWorkingGroup(group.id);
            this.messageService.add({
              severity: 'success',
              summary: 'Gelöscht',
              detail: 'AG wurde gelöscht',
            });
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

  async toggleMembership(group: WorkingGroup) {
    if (!group.id) return;

    if (!this.auth.isLoggedIn()) {
      this.messageService.add({ severity: 'info', summary: 'Login erforderlich', detail: 'Bitte melde dich an, um beizutreten.' });
      return;
    }

    const member = this.auth.currentMember();
    if (!member || !member.id) {
      this.messageService.add({ severity: 'warn', summary: 'Profil fehlt', detail: 'Dein Benutzerkonto ist mit keinem Mitgliedsprofil verknüpft.' });
      return;
    }

    try {
      if (this.myMemberships().has(group.id)) {
        await this.workingGroupsService.leaveGroup(group.id, member.id);
        this.messageService.add({ severity: 'success', summary: 'Verlassen', detail: `Du hast die AG "${group.name}" verlassen.` });
      } else {
        await this.workingGroupsService.joinGroup(group.id, member.id);
        this.messageService.add({ severity: 'success', summary: 'Beigetreten', detail: `Du bist der AG "${group.name}" beigetreten!` });
      }
    } catch (e: any) {
      this.messageService.add({ severity: 'error', summary: 'Fehler', detail: e.message });
    }
  }

  // Helpers for template
  getInitials(name: string): string {
    if (!name) return '';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  getAvatarColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 50%)`;
  }

  /**
   * Check if current user can edit a specific AG
   */
  canEditAg(groupId: string): boolean {
    return this.permissions.canEditAg(groupId);
  }

  /**
   * Get role label for display
   */
  getRoleLabel(role: AgRole): string {
    return this.agRoleLabels[role];
  }

  /**
   * Get current user's role in an AG
   */
  getMyAgRole(groupId: string): AgRole | null {
    return this.myAgRoles().get(groupId) || null;
  }

  /**
   * Open member management dialog for an AG
   */
  async openMembersDialog(group: WorkingGroup): Promise<void> {
    if (!group.id) return;
    this.currentAgForMembers.set(group);
    this.loadingMembers.set(true);
    this.membersDialogVisible.set(true);

    try {
      const members = await this.workingGroupsService.getAgMembers(group.id);
      this.agMembers.set(members);
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Fehler',
        detail: 'Mitglieder konnten nicht geladen werden',
      });
    }
    this.loadingMembers.set(false);
  }

  /**
   * Update a member's role in the current AG
   */
  async updateMemberRole(
    memberId: string,
    newRole: AgRole
  ): Promise<void> {
    const ag = this.currentAgForMembers();
    if (!ag?.id) return;

    try {
      await this.workingGroupsService.updateMemberRole(
        ag.id,
        memberId,
        newRole
      );
      // Update local state
      this.agMembers.update(members =>
        members.map(m =>
          m.member_id === memberId
            ? { ...m, role: newRole }
            : m
        )
      );
      this.messageService.add({
        severity: 'success',
        summary: 'Erfolg',
        detail: 'Rolle aktualisiert',
      });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Fehler',
        detail: (e as Error).message,
      });
    }
  }

  /**
   * Filtert AutoComplete-Vorschläge nach dem eingegebenen Suchbegriff.
   */
  searchCategories(event: { query: string }): void {
    const q = event.query.toLowerCase();
    this.categorySuggestions = this.availableCategories().filter((c) =>
      c.toLowerCase().includes(q)
    );
  }

  /**
   * Schaltet einen Kategorie-Filter-Chip an oder aus.
   */
  toggleCategoryFilter(category: string): void {
    this.selectedCategoryFilters.update((active) => {
      const next = new Set(active);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  /** Setzt alle aktiven Kategorie-Filter zurück. */
  clearCategoryFilters(): void {
    this.selectedCategoryFilters.set(new Set());
  }

  /**
   * Dynamic link placeholder based on contact type.
   */
  getLinkPlaceholder(contactType: string): string {
    const placeholders: Record<string, string> = {
      Discord: 'https://discord.gg/...',
      Email: 'vorname@email.de',
      WhatsApp: 'https://wa.me/...',
      Signal: 'https://signal.group/...',
    };
    return (
      placeholders[contactType] ||
      'https://... oder Adresse'
    );
  }

  /**
   * Calculate the next meeting date and time from the group's events.
   * Returns "Nicht geplant" if no upcoming events exist.
   */
  calculateNextMeeting(groupId: string): string {
    const events = this.getAgEvents(groupId);
    if (!events || events.length === 0) return 'Nicht geplant';

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Filter and sort for the next upcoming event
    const futureEvents = events
      .filter((e) => e.date >= todayStr)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.start_time.localeCompare(b.start_time);
      });

    if (futureEvents.length === 0) return 'Nicht geplant';

    const next = futureEvents[0];
    const [y, m, d] = next.date.split('-');
    return `${d}.${m}.${y} - ${next.start_time} Uhr`;
  }

  /**
   * Get count of AG members missing the
   * contact channel matching the AG contact_type.
   */
  getMissingContactCount(
    groupId: string
  ): number {
    return (
      this.missingContactCounts().get(groupId) ?? 0
    );
  }

  /**
   * Load contact validation for all groups.
   * Checks which members are missing the
   * required contact channel.
   */
  private async loadContactValidation(
    groups: WorkingGroup[]
  ): Promise<void> {
    const counts = new Map<string, number>();

    try {
      for (const group of groups) {
        if (!group.id || !group.contact_type) {
          continue;
        }

        const members = await this
          .workingGroupsService
          .getAgMembers(group.id);

        if (members.length === 0) continue;

        // For each member, check if they have
        // the matching contact_channel filled
        // We need full member data with channels
        const { data: fullMembers, error } = await (
          this.workingGroupsService as any
        )
          .supabase.from('members')
          .select('id, contact_channels')
          .in(
            'id',
            members.map(m => m.member_id)
          );

        // Column may not exist yet (migration
        // not deployed) — skip silently
        if (error || !fullMembers) continue;

        let missing = 0;
        for (const fm of fullMembers) {
          const channels =
            fm.contact_channels || {};
          const key = group.contact_type;
          if (!channels[key]) {
            missing++;
          }
        }

        if (missing > 0) {
          counts.set(group.id, missing);
        }
      }
    } catch {
      // Gracefully ignore — column may not
      // exist until migration is deployed
    }

    this.missingContactCounts.set(counts);
  }
}
