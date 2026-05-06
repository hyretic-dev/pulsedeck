import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { ChipModule } from 'primeng/chip';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DividerModule } from 'primeng/divider';
import { DatePickerModule } from 'primeng/datepicker';
import { TabsModule } from 'primeng/tabs';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';

// Services
import { AuthService } from '../../../shared/services/auth.service';
import { MembersService } from '../../../shared/services/members.service';
import { OrganizationService } from '../../../shared/services/organization.service';
import { SkillService, Skill, SkillCategory } from '../../../shared/services/skill.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { SupabaseService } from '../../../shared/services/supabase';
import { TagModule } from 'primeng/tag';

@Component({
    selector: 'app-profile',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterModule,
        ButtonModule,
        ChipModule,
        InputTextModule,
        ToastModule,
        DividerModule,
        DatePickerModule,
        DatePickerModule,
        TabsModule,
        TagModule,
        PasswordModule,
        MessageModule,
    ],
    providers: [MessageService],
    templateUrl: './profile.html',
    styleUrls: ['./profile.css'],
})
export class ProfileComponent implements OnInit {
    readonly auth = inject(AuthService);
    private readonly members = inject(MembersService);
    private readonly org = inject(OrganizationService);
    readonly skillService = inject(SkillService);
    private readonly messageService = inject(MessageService);
    readonly notificationService = inject(NotificationService);
    private readonly supabase = inject(SupabaseService);

    saving = signal(false);
    birthdayDate: Date | null = null;

    // Form data for profile editing
    formData = {
        phone: '',
        street: '',
        zip_code: '',
        city: '',
    };

    // Contact channels for group communication
    contactChannels = {
        Discord: '',
        WhatsApp: '',
        Signal: '',
        Email: '',
    };

    // Skills
    selectedSkillIds = signal<string[]>([]);
    originalSkillIds = signal<string[]>([]);
    categories: SkillCategory[] = ['ability', 'interest', 'availability'];

    hasSkillChanges = computed(() => {
        const current = [...this.selectedSkillIds()].sort();
        const original = [...this.originalSkillIds()].sort();
        return JSON.stringify(current) !== JSON.stringify(original);
    });

    // Password Management
    showPasswordFields = signal(false);
    newPassword = '';
    confirmNewPassword = '';
    passwordError = signal<string | null>(null);
    passwordSuccess = signal<string | null>(null);
    savingPassword = signal(false);
    hasPassword = signal(false);

    async ngOnInit(): Promise<void> {
        const member = this.auth.currentMember();
        if (member) {
            // Load profile data
            this.formData = {
                phone: member.phone || '',
                street: member.street || '',
                zip_code: member.zip_code || '',
                city: member.city || '',
            };

            if (member.birthday) {
                this.birthdayDate =
                    new Date(member.birthday);
            }

            // Load contact channels
            if (member.contact_channels) {
                this.contactChannels = {
                    Discord: '',
                    WhatsApp: '',
                    Signal: '',
                    Email: '',
                    ...member.contact_channels,
                };
            }

            // Load skills for organization
            const orgId =
                this.org.currentOrganization()?.id;
            if (orgId) {
                await this.skillService
                    .loadSkills(orgId);
            }

            // Load member's selected skills
            if (member.id) {
                const memberSkills =
                    await this.skillService
                        .getMemberSkillIds(member.id);
                this.selectedSkillIds
                    .set(memberSkills);
                this.originalSkillIds
                    .set([...memberSkills]);
            }
        }

        // Check if user has a password set
        await this.checkHasPassword();
    }

    getInitials(): string {
        const name = this.auth.currentMember()?.name || '';
        return name
            .split(' ')
            .map((n: string) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    }

    isProfileComplete(): boolean {
        const m = this.auth.currentMember();
        return !!(m?.phone && m?.street && m?.city && m?.birthday);
    }

    async saveProfile(): Promise<void> {
        const member = this.auth.currentMember();
        if (!member?.id) return;

        this.saving.set(true);

        const updates = {
            ...this.formData,
            birthday: this.birthdayDate
                ? this.birthdayDate
                    .toISOString().split('T')[0]
                : undefined,
            contact_channels: this.filterEmptyChannels(
                this.contactChannels
            ),
        };

        const success = await this.members.updateMember(member.id, updates);

        if (success) {
            // Refresh auth state to update UI (e.g. isProfileComplete)
            const orgId = this.org.currentOrganization()?.id;
            if (orgId) {
                await this.auth.setActiveOrganization(orgId);
            }

            this.messageService.add({
                severity: 'success',
                summary: 'Gespeichert',
                detail: 'Dein Profil wurde aktualisiert',
            });
        } else {
            this.messageService.add({
                severity: 'error',
                summary: 'Fehler',
                detail: 'Speichern fehlgeschlagen',
            });
        }

        this.saving.set(false);
    }

    /**
     * Filter out empty contact channel values.
     */
    private filterEmptyChannels(
        channels: Record<string, string>
    ): Record<string, string> {
        const result: Record<string, string> = {};
        for (const [key, value] of
            Object.entries(channels)) {
            if (value?.trim()) {
                result[key] = value.trim();
            }
        }
        return result;
    }

    // =========================================================================
    // SKILLS
    // =========================================================================

    getSkillsByCategory(category: SkillCategory): Skill[] {
        return this.skillService.getSkillsByCategory(category);
    }

    getCategoryDescription(category: SkillCategory): string {
        const descriptions: Record<SkillCategory, string> = {
            ability:
                'Welche Fähigkeiten bringst du mit?',
            interest:
                'Für welche Themen interessierst du dich?',
            availability:
                'Wann und wie bist du verfügbar?',
        };
        return descriptions[category];
    }

    isSkillSelected(skillId: string): boolean {
        return this.selectedSkillIds().includes(skillId);
    }

    toggleSkill(skillId: string): void {
        const current = this.selectedSkillIds();
        if (current.includes(skillId)) {
            this.selectedSkillIds.set(current.filter((id) => id !== skillId));
        } else {
            this.selectedSkillIds.set([...current, skillId]);
        }
    }

    getSkillName(skillId: string): string {
        const skill = this.skillService.skills().find((s) => s.id === skillId);
        return skill?.name || '';
    }

    async saveSkills(): Promise<void> {
        const memberId = this.auth.currentMember()?.id;
        if (!memberId) return;

        this.saving.set(true);

        const success = await this.skillService.updateMemberSkills(
            memberId,
            this.selectedSkillIds()
        );

        this.saving.set(false);

        if (success) {
            this.originalSkillIds.set([...this.selectedSkillIds()]);
            this.messageService.add({
                severity: 'success',
                summary: 'Gespeichert',
                detail: 'Deine Fähigkeiten wurden aktualisiert',
            });
        } else {
            this.messageService.add({
                severity: 'error',
                summary: 'Fehler',
                detail: 'Speichern fehlgeschlagen',
            });
        }
    }

    // =========================================================================
    // PASSWORD MANAGEMENT
    // =========================================================================

    /**
     * Check if the current user has a password set.
     * Users who only used magic links won't have a password.
     */
    async checkHasPassword(): Promise<void> {
        // Get current user's identities
        const { data } = await this.supabase.client.auth.getUser();
        const user = data?.user;
        
        if (!user) return;

        // Check app_metadata for password indicator or check identities
        // Supabase doesn't directly expose "has password", but we can check
        // if the user has the 'email' provider with confirmed email
        // A user with password will have encrypted_password in auth.users
        // We'll assume if they logged in with email provider, they might have one
        // For simplicity, we'll just show the option regardless
        this.hasPassword.set(false); // Default to false, let users set one
    }

    /**
     * Save a new password for the user
     */
    async savePassword(): Promise<void> {
        this.passwordError.set(null);
        this.passwordSuccess.set(null);

        // Validate passwords
        if (this.newPassword.length < 8) {
            this.passwordError.set(
                'Das Passwort muss mindestens 8 Zeichen lang sein.'
            );
            return;
        }

        if (this.newPassword !== this.confirmNewPassword) {
            this.passwordError.set('Die Passwörter stimmen nicht überein.');
            return;
        }

        this.savingPassword.set(true);

        try {
            const { error } = await this.supabase.client.auth.updateUser({
                password: this.newPassword
            });

            if (error) {
                this.passwordError.set(error.message);
                this.savingPassword.set(false);
                return;
            }

            this.passwordSuccess.set('Passwort erfolgreich gesetzt!');
            this.hasPassword.set(true);
            this.newPassword = '';
            this.confirmNewPassword = '';

            // Hide form after short delay
            setTimeout(() => {
                this.showPasswordFields.set(false);
                this.passwordSuccess.set(null);
            }, 2000);

            this.messageService.add({
                severity: 'success',
                summary: 'Passwort gesetzt',
                detail: 'Du kannst dich jetzt auch mit Passwort anmelden.',
            });

        } catch (e) {
            this.passwordError.set((e as Error).message);
        }

        this.savingPassword.set(false);
    }

    /**
     * Cancel password change and reset form
     */
    cancelPasswordChange(): void {
        this.showPasswordFields.set(false);
        this.newPassword = '';
        this.confirmNewPassword = '';
        this.passwordError.set(null);
        this.passwordSuccess.set(null);
    }
}
