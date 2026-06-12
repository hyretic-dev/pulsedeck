import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

// PrimeNG
import { TabsModule } from 'primeng/tabs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { MessageService, ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { ChipModule } from 'primeng/chip';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { TextareaModule } from 'primeng/textarea';
import { FieldsetModule } from 'primeng/fieldset';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import { MultiSelectModule } from 'primeng/multiselect';

// Services
import { AuthService } from '../../../shared/services/auth.service';
import { OrganizationService, Organization } from '../../../shared/services/organization.service';
import { SkillService, Skill, SkillCategory } from '../../../shared/services/skill.service';
import { FeedService, NewsletterConfig } from '../../../shared/services/feed.service';
import { SupabaseService } from '../../../shared/services/supabase';
import { RolesService } from '../../../shared/services/roles.service';
import { PermissionsService, PERMISSION_LABELS, ALL_PERMISSIONS } from '../../../shared/services/permissions.service';
import { OrganizationRole, Permission } from '../../../shared/models/member.model';

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterModule,
        TabsModule,
        ButtonModule,
        InputTextModule,
        ToastModule,
        ConfirmDialogModule,
        DialogModule,
        SelectModule,
        ChipModule,
        TableModule,
        TagModule,
        DividerModule,
        TextareaModule,
        FieldsetModule,
        CheckboxModule,
        TooltipModule,
        MultiSelectModule,
    ],
    providers: [MessageService, ConfirmationService],
    templateUrl: './settings.html',
})
export class SettingsComponent implements OnInit {
    readonly auth = inject(AuthService);
    readonly org = inject(OrganizationService);
    readonly skillService = inject(SkillService);
    readonly feedService = inject(FeedService);
    private readonly supabase = inject(SupabaseService);
    private readonly messageService = inject(MessageService);
    private readonly confirmationService = inject(ConfirmationService);
    readonly rolesService = inject(RolesService);

    loading = signal(false);
    activeTab = signal<string>('skills');

    // =========================================================================
    // SKILLS
    // =========================================================================
    skills = this.skillService.skills;
    skillDialogVisible = signal(false);
    editingSkill = signal<Partial<Skill> | null>(null);

    categories: { label: string; value: SkillCategory }[] = [
        { label: 'Fähigkeit', value: 'ability' },
        { label: 'Interesse', value: 'interest' },
        { label: 'Verfügbarkeit', value: 'availability' },
    ];

    iconOptions = [
        { label: 'Auto', value: 'pi-car' },
        { label: 'Stift', value: 'pi-pencil' },
        { label: 'Teilen', value: 'pi-share-alt' },
        { label: 'Kamera', value: 'pi-camera' },
        { label: 'Herz', value: 'pi-heart' },
        { label: 'Mikrofon', value: 'pi-microphone' },
        { label: 'Werkzeug', value: 'pi-wrench' },
        { label: 'Kalender', value: 'pi-calendar' },
        { label: 'Uhr', value: 'pi-clock' },
        { label: 'Blitz', value: 'pi-bolt' },
        { label: 'Benutzer', value: 'pi-users' },
        { label: 'Globus', value: 'pi-globe' },
        { label: 'Buch', value: 'pi-book' },
        { label: 'Gebäude', value: 'pi-building' },
        { label: 'Megafon', value: 'pi-megaphone' },
        { label: 'Palette', value: 'pi-palette' },
        { label: 'Mond', value: 'pi-moon' },
    ];

    // =========================================================================
    // ROLES
    // =========================================================================
    roles = this.rolesService.roles;
    roleDialogVisible = signal(false);
    editingRole = signal<Partial<OrganizationRole> | null>(null);

    permissionOptions = ALL_PERMISSIONS.map(p => ({
        label: PERMISSION_LABELS[p],
        value: p
    }));

    // =========================================================================
    // NEWSLETTER CONFIG
    // =========================================================================
    newsletterConfig = signal<NewsletterConfig | null>(null);
    days = [
        { label: 'Montag', value: 1 },
        { label: 'Dienstag', value: 2 },
        { label: 'Mittwoch', value: 3 },
        { label: 'Donnerstag', value: 4 },
        { label: 'Freitag', value: 5 },
        { label: 'Samstag', value: 6 },
        { label: 'Sonntag', value: 7 },
    ];
    frequencies = [
        { label: 'Wöchentlich', value: 'weekly' },
        { label: 'Monatlich', value: 'monthly' },
        { label: 'Manuell', value: 'manual' },
    ];

    // =========================================================================
    // ORGANIZATION
    // =========================================================================
    orgForm = signal<Partial<Organization>>({});

    async ngOnInit(): Promise<void> {
        this.loading.set(true);

        const orgId = this.org.currentOrganization()?.id;
        if (orgId) {
            await Promise.all([
                this.skillService.loadSkills(orgId),
                this.loadNewsletterConfig(),
                this.loadOrgSettings(),
                this.rolesService.loadRoles(orgId),
            ]);
        }

        this.loading.set(false);
    }

    // =========================================================================
    // SKILLS METHODS
    // =========================================================================

    openNewSkill(): void {
        this.editingSkill.set({
            name: '',
            category: 'ability',
            icon: 'pi-tag',
            description: '',
        });
        this.skillDialogVisible.set(true);
    }

    openEditSkill(skill: Skill): void {
        this.editingSkill.set({ ...skill });
        this.skillDialogVisible.set(true);
    }

    async saveSkill(): Promise<void> {
        const skill = this.editingSkill();
        if (!skill?.name) {
            this.messageService.add({
                severity: 'error',
                summary: 'Fehler',
                detail: 'Name wird benötigt',
            });
            return;
        }

        const orgId = this.org.currentOrganization()?.id;
        if (!orgId) return;

        this.loading.set(true);

        if (skill.id) {
            // Update existing
            const success = await this.skillService.updateSkill(skill.id, skill);
            if (success) {
                await this.skillService.loadSkills(orgId);
                this.messageService.add({
                    severity: 'success',
                    summary: 'Gespeichert',
                });
            }
        } else {
            // Create new
            const created = await this.skillService.createSkill(orgId, skill);
            if (created) {
                this.messageService.add({
                    severity: 'success',
                    summary: 'Erstellt',
                });
            }
        }

        this.skillDialogVisible.set(false);
        this.loading.set(false);
    }

    confirmDeleteSkill(skill: Skill): void {
        this.confirmationService.confirm({
            message: `"${skill.name}" wirklich löschen?`,
            header: 'Skill löschen',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Löschen',
            rejectLabel: 'Abbrechen',
            acceptButtonStyleClass: 'p-button-danger',
            accept: async () => {
                await this.deleteSkill(skill);
            },
        });
    }

    async deleteSkill(skill: Skill): Promise<void> {
        const orgId = this.org.currentOrganization()?.id;
        if (!orgId) return;

        const success = await this.skillService.deleteSkill(skill.id);
        if (success) {
            await this.skillService.loadSkills(orgId);
            this.messageService.add({
                severity: 'success',
                summary: 'Gelöscht',
            });
        }
    }

    getCategoryLabel(category: string): string {
        return this.skillService.getCategoryLabel(category as SkillCategory);
    }

    getCategorySeverity(
        category: string
    ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
        switch (category) {
            case 'ability':
                return 'success';
            case 'interest':
                return 'info';
            case 'availability':
                return 'warn';
            default:
                return 'secondary';
        }
    }

    // =========================================================================
    // NEWSLETTER METHODS
    // =========================================================================

    async loadNewsletterConfig(): Promise<void> {
        try {
            const cfg = await this.feedService.getNewsletterConfig();
            this.newsletterConfig.set(cfg);
        } catch (e) {
            console.error('Error loading newsletter config:', e);
        }
    }

    async saveNewsletterConfig(): Promise<void> {
        if (!this.newsletterConfig()) return;

        try {
            await this.feedService.updateNewsletterConfig(this.newsletterConfig()!);
            this.messageService.add({
                severity: 'success',
                summary: 'Newsletter-Einstellungen gespeichert',
            });
        } catch (e: any) {
            this.messageService.add({
                severity: 'error',
                summary: 'Fehler',
                detail: e.message,
            });
        }
    }

    // =========================================================================
    // ORGANIZATION METHODS
    // =========================================================================

    async loadOrgSettings(): Promise<void> {
        const org = this.org.currentOrganization();
        if (org) {
            this.orgForm.set({
                name: org.name,
                slug: org.slug,
                description: org.description,
                primary_color: org.primary_color,
                logo_url: org.logo_url,
            });
        }
    }

    async saveOrgSettings(): Promise<void> {
        const orgId = this.org.currentOrganization()?.id;
        if (!orgId) return;

        const form = this.orgForm();

        const { error } = await this.supabase.client
            .from('organizations')
            .update({
                name: form.name,
                description: form.description,
                primary_color: form.primary_color,
                logo_url: form.logo_url,
            })
            .eq('id', orgId);

        if (error) {
            this.messageService.add({
                severity: 'error',
                summary: 'Fehler',
                detail: error.message,
            });
        } else {
            this.messageService.add({
                severity: 'success',
                summary: 'Organisations-Einstellungen gespeichert',
            });
            // Refresh org data
            const slug = this.org.currentSlug();
            if (slug) {
                await this.org.loadBySlug(slug);
            }
        }
    }

    // =========================================================================
    // NEWSLETTER ACTIONS
    // =========================================================================

    testEmailDialogVisible = signal(false);
    testEmail = '';

    openTestEmailDialog(): void {
        this.testEmail = this.auth.user()?.email || '';
        this.testEmailDialogVisible.set(true);
    }

    async sendTestEmail(): Promise<void> {
        if (!this.testEmail) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Bitte E-Mail angeben',
            });
            return;
        }
        try {
            await this.feedService.sendTestEmail(this.testEmail);
            this.messageService.add({
                severity: 'success',
                summary: 'Test gesendet',
                detail: `Vorschau an ${this.testEmail} gesendet.`,
            });
            this.testEmailDialogVisible.set(false);
        } catch (e: any) {
            if (e.message?.includes('not found') || e.message?.includes('Function ')) {
                this.messageService.add({
                    severity: 'info',
                    summary: 'Simulation',
                    detail: `Hätte an ${this.testEmail} gesendet.`,
                });
                this.testEmailDialogVisible.set(false);
            } else {
                this.messageService.add({
                    severity: 'error',
                    detail: e.message,
                });
            }
        }
    }

    async triggerNewsletter(): Promise<void> {
        try {
            await this.feedService.triggerNewsletter();
            this.messageService.add({
                severity: 'success',
                summary: 'Newsletter Versand ausgelöst',
            });
            await this.loadNewsletterConfig();
        } catch (e: any) {
            if (e.message?.includes('not found') || e.message?.includes('Function ')) {
                this.messageService.add({
                    severity: 'info',
                    summary: 'Simulation',
                    detail: 'Edge Function nicht deployed.',
                });
            } else {
                this.messageService.add({
                    severity: 'error',
                    detail: e.message,
                });
            }
        }
    }

    // =========================================================================
    // ROLES METHODS
    // =========================================================================

    openNewRole(): void {
        this.editingRole.set({
            name: '',
            description: '',
            permissions: [],
            is_system_admin: false,
            is_default: false,
        });
        this.roleDialogVisible.set(true);
    }

    openEditRole(role: OrganizationRole): void {
        this.editingRole.set({ ...role });
        this.roleDialogVisible.set(true);
    }

    async saveRole(): Promise<void> {
        const role = this.editingRole();
        if (!role?.name) {
            this.messageService.add({ severity: 'error', summary: 'Name wird benötigt' });
            return;
        }

        const orgId = this.org.currentOrganization()?.id;
        if (!orgId) return;

        this.loading.set(true);
        role.organization_id = orgId;

        const { success, error } = await this.rolesService.saveRole(role);
        if (success) {
            await this.rolesService.loadRoles(orgId);
            this.messageService.add({ severity: 'success', summary: 'Rolle gespeichert' });
            this.roleDialogVisible.set(false);
        } else {
            this.messageService.add({ severity: 'error', summary: 'Fehler', detail: error });
        }
        this.loading.set(false);
    }

    confirmDeleteRole(role: OrganizationRole): void {
        if (role.is_system_admin) {
            this.messageService.add({ severity: 'warn', summary: 'System-Rolle kann nicht gelöscht werden' });
            return;
        }

        this.confirmationService.confirm({
            message: `Rolle "${role.name}" wirklich löschen? Alle zugewiesenen Mitglieder verlieren diese Rechte!`,
            header: 'Rolle löschen',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Löschen',
            rejectLabel: 'Abbrechen',
            acceptButtonStyleClass: 'p-button-danger',
            accept: async () => {
                const { success, error } = await this.rolesService.deleteRole(role.id!);
                if (success) {
                    await this.rolesService.loadRoles(role.organization_id);
                    this.messageService.add({ severity: 'success', summary: 'Rolle gelöscht' });
                } else {
                    this.messageService.add({ severity: 'error', summary: 'Fehler', detail: error });
                }
            }
        });
    }

    getPermissionLabel(key: string): string {
        return PERMISSION_LABELS[key as Permission] || key;
    }
}
