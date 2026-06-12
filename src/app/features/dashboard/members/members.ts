import { Component, inject, OnInit, signal, computed, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as XLSX from 'xlsx';
import { FormsModule } from '@angular/forms';
// PrimeNG Imports
import { Table, TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { AvatarModule } from 'primeng/avatar';
import { MessageModule } from 'primeng/message';
import { ToastModule } from 'primeng/toast';
import { FileUploadModule } from 'primeng/fileupload';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { TooltipModule } from 'primeng/tooltip';
import { CheckboxModule } from 'primeng/checkbox';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';

import { MembersService } from '../../../shared/services/members.service';
import { Member, Permission, AppRole } from '../../../shared/models/member.model';
import { AuthService } from '../../../shared/services/auth.service';
import {
  PermissionsService,
  PERMISSION_LABELS,
  ALL_PERMISSIONS,
} from '../../../shared/services/permissions.service';
import { SkillService, Skill } from '../../../shared/services/skill.service';
import { OrganizationService } from '../../../shared/services/organization.service';
import { MultiSelectModule } from 'primeng/multiselect';

@Component({
  selector: 'app-members',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    TagModule,
    DialogModule,
    InputTextModule,
    SelectModule,
    AvatarModule,
    MessageModule,
    ToastModule,
    FileUploadModule,
    ConfirmDialogModule,
    ProgressSpinnerModule,
    IconFieldModule,
    InputIconModule,
    TooltipModule,
    CheckboxModule,
    MultiSelectModule,
    MenuModule
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './members.html',
  styleUrl: './members.css',
})
export class MembersComponent implements OnInit {
  @ViewChild('dt') dt!: Table;

  private membersService = inject(MembersService);
  private confirmationService = inject(ConfirmationService);
  private messageService = inject(MessageService);
  public auth = inject(AuthService);
  public permissionsService = inject(PermissionsService);
  public skillService = inject(SkillService);
  private orgService = inject(OrganizationService);

  members = this.membersService.members;
  loading = this.membersService.loading;
  error = this.membersService.error;

  // Filter state
  showFilters = signal(false);
  selectedSkillIds = signal<string[]>([]);
  locationFilter = signal('');
  memberSkillsMap = signal<Record<string, string[]>>({});

  selectedMembers: Member[] = [];
  mobileExpandedRows: Record<string, boolean> = {}; // Mobile-specific expand state

  // Toggle Row using Table API (desktop) or manual state (mobile)
  toggleRow(member: Member) {
    if (this.dt) {
      this.dt.toggleRow(member);
    }
    // Also toggle mobile state
    if (member.id) {
      this.mobileExpandedRows[member.id] = !this.mobileExpandedRows[member.id];
    }
  }

  isRowExpanded(member: Member): boolean {
    // Check mobile state first, then fall back to table
    if (member.id && this.mobileExpandedRows[member.id]) {
      return true;
    }
    return this.dt?.isRowExpanded(member) ?? false;
  }

  // Computed filter for search
  currentSearchTerm = signal('');

  filteredMembers = computed(() => {
    const term = this.currentSearchTerm().toLowerCase();
    const skillIds = this.selectedSkillIds();
    const location = this.locationFilter().toLowerCase().trim();
    const skillsMap = this.memberSkillsMap();

    let mList = this.members();

    // Text search filter
    if (term) {
      mList = mList.filter(m =>
        m.name.toLowerCase().includes(term) ||
        m.role?.toLowerCase().includes(term) ||
        m.email.toLowerCase().includes(term)
      );
    }

    // Skills filter (member must have ALL selected skills)
    if (skillIds.length > 0) {
      mList = mList.filter(m => {
        const memberSkills = skillsMap[m.id!] || [];
        return skillIds.every(sid => memberSkills.includes(sid));
      });
    }

    // Location filter (PLZ or city)
    if (location) {
      mList = mList.filter(m =>
        m.zip_code?.toLowerCase().includes(location) ||
        m.city?.toLowerCase().includes(location)
      );
    }

    return mList;
  });

  // Active filter count for badge
  activeFilterCount = computed(() => {
    let count = 0;
    if (this.selectedSkillIds().length > 0) count++;
    if (this.locationFilter().trim()) count++;
    return count;
  });

  dialogVisible = signal(false);
  editMode = signal(false);
  saving = signal(false);
  invitingMemberId: string | null = null;
  copyingMemberId: string | null = null;

  currentMember: Partial<Member> = this.getEmptyMember();

  importDialogVisible = signal(false);
  importStep = signal<'upload' | 'mapping' | 'preview' | 'processing'>('upload');
  importedData: any[] = [];
  detectedHeaders: string[] = [];
  mappingColumns: { key: string; label: string; required: boolean; mappedHeader?: string }[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'email', label: 'E-Mail', required: true },
    { key: 'role', label: 'Funktion', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'street', label: 'Straße', required: false },
    { key: 'zip_code', label: 'PLZ', required: false },
    { key: 'city', label: 'Ort', required: false },
    { key: 'phone', label: 'Telefon', required: false },
    { key: 'birthday', label: 'Geburtstag', required: false },
    { key: 'join_date', label: 'Beitritt', required: false }
  ];

  statusOptions = [
    { label: 'Aktiv', value: 'Active' },
    { label: 'Inaktiv', value: 'Inactive' },
    { label: 'Ausstehend', value: 'Pending' },
  ];

  appRoleOptions = [
    { label: 'Mitglied', value: 'member' },
    { label: 'Vorstand', value: 'committee' },
    { label: 'Administrator', value: 'admin' },
  ];

  allPermissions = ALL_PERMISSIONS;
  permissionLabels = PERMISSION_LABELS;

  constructor() {
    // Reload skills when Organization changes
    effect(() => {
      const org = this.orgService.currentOrganization();
      if (org?.id) {
        this.skillService.loadSkills(org.id);
      }
    });

    // Reload members when Organization changes
    effect(() => {
      const org = this.orgService.currentOrganization();
      if (org?.id) {
        this.membersService.fetchMembers();
      }
    });

    // Reload mappings when Organization OR Members change
    effect(() => {
      const org = this.orgService.currentOrganization();
      const members = this.members(); // Dependency on members list

      if (org?.id && members.length > 0) {
        this.loadMemberSkillsMap(org.id);
      }
    });
  }

  ngOnInit(): void {
    // Initial fetch is now handled by the effect in constructor
  }

  /**
   * Load all member skill assignments for filtering (optimized bulk load)
   */
  private async loadMemberSkillsMap(orgId: string): Promise<void> {
    const map = await this.skillService.getAllMemberSkills(orgId);
    this.memberSkillsMap.set(map);
  }

  /**
   * Clear all filters
   */
  clearFilters(): void {
    this.selectedSkillIds.set([]);
    this.locationFilter.set('');
    this.currentSearchTerm.set('');
  }

  /**
   * Toggle filter panel visibility
   */
  toggleFilters(): void {
    this.showFilters.set(!this.showFilters());
  }

  getEmptyMember(): Partial<Member> {
    return {
      name: '',
      role: 'Mitglied',
      department: '',
      status: 'Active',
      email: '',
      join_date: new Date().toLocaleDateString('de-DE'),
      avatar_url: '',
      app_role: 'member',
      permissions: [],
      user_id: '',
      street: '',
      zip_code: '',
      city: '',
      phone: '',
      birthday: '',
      custom_info: ''
    };
  }

  openNew() {
    this.currentMember = this.getEmptyMember();
    this.editMode.set(false);
    this.dialogVisible.set(true);
  }

  editMember(member: Member) {
    this.currentMember = {
      ...member,
      permissions: member.permissions || []
    };
    this.editMode.set(true);
    this.dialogVisible.set(true);
  }

  hasPermission(perm: Permission): boolean {
    return (this.currentMember.permissions || []).includes(perm);
  }

  togglePermission(perm: Permission, enabled: boolean): void {
    const perms = new Set(this.currentMember.permissions || []);
    if (enabled) {
      perms.add(perm);
    } else {
      perms.delete(perm);
    }
    this.currentMember.permissions = Array.from(perms);
  }

  getAppRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      public: 'Öffentlich',
      member: 'Mitglied',
      committee: 'Vorstand',
      admin: 'Administrator'
    };
    return labels[role] || role;
  }

  async saveMember() {
    if (!this.currentMember.name || !this.currentMember.email) return;

    const memberData = { ...this.currentMember };
    if (memberData.user_id === '') delete memberData.user_id;

    this.saving.set(true);
    try {
      if (this.editMode() && this.currentMember.id) {
        await this.membersService.updateMember(
          this.currentMember.id,
          memberData
        );
        this.messageService.add({
          severity: 'success',
          summary: 'Erfolg',
          detail: 'Mitglied aktualisiert',
        });
      } else {
        await this.membersService.addMember(memberData as Member);
        this.messageService.add({
          severity: 'success',
          summary: 'Erfolg',
          detail: 'Mitglied hinzugefügt',
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

  confirmDelete(member: Member) {
    this.confirmationService.confirm({
      message: `Möchtest du "${member.name}" wirklich löschen?`,
      header: 'Löschen bestätigen',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Ja, löschen',
      rejectLabel: 'Abbrechen',
      accept: async () => {
        try {
          await this.membersService.deleteMember(member.id!);
          this.messageService.add({
            severity: 'success',
            summary: 'Gelöscht',
            detail: 'Mitglied entfernt',
          });
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

  deleteSelected() {
    if (!this.selectedMembers || !this.selectedMembers.length) return;
    this.confirmationService.confirm({
      message: `Möchtest du ${this.selectedMembers.length} Mitglieder wirklich löschen?`,
      header: 'Löschen bestätigen',
      icon: 'pi pi-exclamation-triangle',
      accept: async () => {
        try {
          for (const m of this.selectedMembers) {
            if (m.id) await this.membersService.deleteMember(m.id);
          }
          this.selectedMembers = [];
          this.messageService.add({ severity: 'success', summary: 'Gelöscht', detail: 'Mitglieder entfernt' });
        } catch (e) {
          this.messageService.add({ severity: 'error', summary: 'Fehler', detail: (e as Error).message });
        }
      }
    });
  }

  onGlobalFilter(event: Event) {
    const input = event.target as HTMLInputElement;
    this.currentSearchTerm.set(input.value);
  }

  getStatusLabel(status: string) {
    const labels: Record<string, string> = {
      'Active': 'Aktiv',
      'Inactive': 'Inaktiv',
      'Pending': 'Ausstehend'
    };
    return labels[status] || status;
  }

  getStatusSeverity(status: string) {
    switch (status) {
      case 'Active':
        return 'success';
      case 'Inactive':
        return 'danger';
      case 'Pending':
        return 'warn';
      default:
        return 'info';
    }
  }

  getRoleSeverity(role: string) {
    switch (role) {
      case 'admin': return 'danger';
      case 'committee': return 'contrast';
      case 'member': return 'info';
      default: return 'secondary';
    }
  }

  getInitials(name: string): string {
    if (!name) return '';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  getAvatarColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
  }

  getMemberSkills(memberId: string | undefined): Skill[] {
    if (!memberId) return [];
    const skillIds = this.memberSkillsMap()[memberId] || [];
    const allSkills = this.skillService.skills();
    return allSkills.filter(s => skillIds.includes(s.id));
  }

  getExcessSkillsTooltip(memberId: string | undefined): string {
    const skills = this.getMemberSkills(memberId);
    if (skills.length <= 3) return '';
    return skills.slice(3).map(s => s.name).join(', ');
  }

  buildRowMenuItems(member: Member): MenuItem[] {
    const items: MenuItem[] = [];
    if (member.email) {
      items.push({
        label: member.user_id ? 'Passwort-Reset senden' : 'Einladung senden',
        icon: member.user_id ? 'pi pi-key' : 'pi pi-envelope',
        command: () => this.inviteMember(member)
      });
      items.push({
        label: 'Login-Link kopieren',
        icon: 'pi pi-copy',
        command: () => this.copyMagicLink(member)
      });
      items.push({ separator: true });
    }
    
    items.push({
      label: 'Bearbeiten',
      icon: 'pi pi-pencil',
      command: () => this.editMember(member)
    });
    items.push({
      label: 'Löschen',
      icon: 'pi pi-trash',
      styleClass: 'text-red-400',
      command: () => this.confirmDelete(member)
    });
    
    return items;
  }

  async inviteMember(member: Member) {
    if (!member.id || !member.email) return;

    this.invitingMemberId = member.id;
    try {
      const result = await this.membersService.inviteMember(member.id, member.email);
      const isReset = result.type === 'reset';
      this.messageService.add({
        severity: 'success',
        summary: isReset ? 'Link gesendet' : 'Einladung gesendet',
        detail: result.message || (isReset
          ? `Passwort-Reset-Link an ${member.email} gesendet`
          : `Einladung an ${member.email} versendet`),
      });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Fehler',
        detail: (e as Error).message,
      });
    }
    this.invitingMemberId = null;
  }

  /**
   * Generate a magic link and copy to clipboard for sharing via WhatsApp etc.
   */
  async copyMagicLink(member: Member) {
    if (!member.id || !member.email) return;

    this.copyingMemberId = member.id;
    try {
      const result = await this.membersService.generateMagicLink(
        member.id,
        member.email
      );

      // Copy to clipboard
      await navigator.clipboard.writeText(result.link);

      this.messageService.add({
        severity: 'success',
        summary: 'Link kopiert!',
        detail: `${result.message} - Gültig für ${result.expiresIn}`,
        life: 5000,
      });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Fehler',
        detail: (e as Error).message,
      });
    }
    this.copyingMemberId = null;
  }

  // Import Methods
  openImport() {
    this.importStep.set('upload');
    this.importedData = [];
    this.detectedHeaders = [];
    this.mappingColumns.forEach(c => c.mappedHeader = undefined);
    this.importDialogVisible.set(true);
  }

  onFileSelect(event: any) {
    const file = event.files[0];
    const reader = new FileReader();
    reader.onload = (e: any) => {
      const data = e.target.result;
      const wb = XLSX.read(data, { type: 'array', cellDates: true });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      this.importedData = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (this.importedData.length > 0) {
        this.detectedHeaders = Object.keys(this.importedData[0]);
        this.autoMapFields();
        this.importStep.set('mapping');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  autoMapFields() {
    this.mappingColumns.forEach(col => {
      const match = this.detectedHeaders.find(h =>
        h.toLowerCase().includes(col.label.toLowerCase()) ||
        h.toLowerCase().includes(col.key.toLowerCase())
      );
      if (match) col.mappedHeader = match;
    });
  }

  async executeImport() {
    this.importStep.set('processing');
    const membersToImport = this.importedData.map(row => {
      // Create empty object to only include mapped fields (prevents overwriting with defaults on update)
      const member: any = {};
      this.mappingColumns.forEach(col => {
        if (col.mappedHeader && row[col.mappedHeader] !== undefined) {
          const val = row[col.mappedHeader];
          if (val !== null && val !== undefined && val !== '') {
            member[col.key] = String(val).trim();
          }
        }
      });

      return member;
    }).filter(m => m.name && m.email); // Name & Email required for merge/insert

    try {
      if (membersToImport.length === 0) throw new Error('Keine gültigen Datensätze gefunden (Name & Email erforderlich).');
      // Use importMembers for smart upsert logic
      await this.membersService.importMembers(membersToImport);
      this.messageService.add({ severity: 'success', summary: 'Import erfolgreich', detail: `${membersToImport.length} Mitglieder verarbeitet` });
      this.importDialogVisible.set(false);
      this.membersService.fetchMembers();
    } catch (e) {
      this.messageService.add({ severity: 'error', summary: 'Import Fehler', detail: (e as Error).message });
      this.importStep.set('mapping');
    }
  }
}
