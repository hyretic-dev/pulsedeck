import { Injectable, inject, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase';
import { AuthService } from './auth.service';
import { WorkingGroupsService } from './working-groups.service';
import { NotificationService } from './notification.service';

/**
 * Onboarding step definition
 */
export interface OnboardingStep {
    key: string;
    label: string;
    description: string;
    icon: string;
    completed: boolean;
    rewardLabel?: string;
    link: string;
}


/**
 * Service for managing member onboarding progress
 */
@Injectable({
    providedIn: 'root',
})
export class OnboardingService {
    private supabase = inject(SupabaseService);
    private auth = inject(AuthService);
    private workingGroupsService = inject(WorkingGroupsService);
    private notificationService = inject(NotificationService);


    private _completedSteps = signal<Set<string>>(new Set());
    private _loading = signal(false);

    readonly completedSteps = this._completedSteps.asReadonly();
    readonly loading = this._loading.asReadonly();

    /**
     * All available onboarding steps
     */
    readonly steps = computed<OnboardingStep[]>(() => {
        const completed = this._completedSteps();
        const member = this.auth.currentMember();
        const memberships = this.workingGroupsService.myMemberships();

        return [
            {
                key: 'profile_complete',
                label: 'Profil-Held',
                description: 'Vervollständige dein Profil',
                icon: 'pi-user-edit',
                completed: this.isProfileComplete(member),
                rewardLabel: 'Identität bestätigt',
                link: 'profile'
            },
            {
                key: 'joined_ag',
                label: 'Team-Player',
                description: 'Tritt einer Arbeitsgruppe bei',
                icon: 'pi-users',
                completed: memberships.size > 0,
                rewardLabel: 'Platz gefunden',
                link: 'ags'
            },
            {
                key: 'visited_wiki',
                label: 'Wissens-Sucher',
                description: 'Erkunden das Wiki',
                icon: 'pi-book',
                completed: completed.has('visited_wiki'),
                rewardLabel: 'Weisheit erlangt',
                link: 'wiki'
            },
            {
                key: 'enable_notifications',
                label: 'Wächter',
                description: 'Aktiviere Benachrichtigungen',
                icon: 'pi-bell',
                completed: this.notificationService.isSubscribed(),
                rewardLabel: 'Sinn geschärft',
                link: '#enable-notifications'
            },
            {
                key: 'added_task',
                label: 'Macher',
                description: 'Erstelle deine erste Aufgabe',
                icon: 'pi-check-circle',
                completed: completed.has('added_task'),
                rewardLabel: 'Tatkraft bewiesen',
                link: 'tasks'
            },
        ];
    });

    /**
     * Progress percentage (0-100)
     */
    readonly progress = computed(() => {
        const steps = this.steps();
        if (steps.length === 0) return 0;
        const completed = steps.filter((s: OnboardingStep) => s.completed).length;
        return Math.round((completed / steps.length) * 100);
    });


    /**
     * Number of completed steps
     */
    readonly completedCount = computed(() => {
        return this.steps().filter((s: OnboardingStep) => s.completed).length;
    });


    /**
     * Total number of steps
     */
    readonly totalSteps = computed(() => this.steps().length);

    /**
     * Whether onboarding is complete
     */
    readonly isComplete = computed(() => this.progress() === 100);

    /**
     * Check if member profile is complete
     */
    private isProfileComplete(member: any): boolean {
        if (!member) return false;
        // Check required fields for "complete" profile
        return !!(
            member.street &&
            member.city &&
            member.phone &&
            member.birthday
        );
    }

    /**
     * Fetch completed steps from database
     */
    async fetchProgress(): Promise<void> {
        const member = this.auth.currentMember();
        if (!member?.id) {
            this._completedSteps.set(new Set());
            return;
        }

        this._loading.set(true);

        const { data, error } = await this.supabase
            .from('onboarding_progress')
            .select('step_key')
            .eq('member_id', member.id);

        if (error) {
            console.error('Error fetching onboarding progress:', error);
        } else if (data) {
            this._completedSteps.set(
                new Set(data.map((d: any) => d.step_key))
            );
        }

        // Also check for tasks to auto-complete 'added_task'
        await this.checkTaskStep(member.id);

        this._loading.set(false);
    }

    /**
     * Check if user has any tasks
     */
    private async checkTaskStep(memberId: string): Promise<void> {
        const { count } = await this.supabase
            .from('user_tasks')
            .select('id', { count: 'exact', head: true })
            .eq('member_id', memberId);

        if (count && count > 0) {
            this._completedSteps.update((s: Set<string>) => {
                const newSet = new Set(s);
                newSet.add('added_task');
                return newSet;
            });
        }

    }

    /**
     * Mark a step as completed
     */
    async completeStep(stepKey: string): Promise<void> {
        const member = this.auth.currentMember();
        if (!member?.id) return;

        // Already completed?
        if (this._completedSteps().has(stepKey)) return;

        const { error } = await this.supabase
            .from('onboarding_progress')
            .upsert({
                member_id: member.id,
                step_key: stepKey,
            }, { onConflict: 'member_id,step_key', ignoreDuplicates: true });

        if (error) {
            // Ignore duplicate key error (23505), treat as success
            if (error.code !== '23505') {
                console.error('Error completing onboarding step:', error);
                return;
            }
        }

        this._completedSteps.update((s: Set<string>) => {
            const newSet = new Set(s);
            newSet.add(stepKey);
            return newSet;
        });

    }

    /**
     * Track wiki visit
     */
    async trackWikiVisit(): Promise<void> {
        await this.completeStep('visited_wiki');
    }

    /**
     * Track calendar visit
     */
    async trackCalendarVisit(): Promise<void> {
        await this.completeStep('visited_calendar');
    }
}
