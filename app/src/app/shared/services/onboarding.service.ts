import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { OrganizationService } from './organization.service';
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
    private api = inject(ApiService);
    private org = inject(OrganizationService);
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
                link: 'gruppen'
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
     * Fetch completed steps from the server (und ob schon Aufgaben angelegt wurden)
     */
    async fetchProgress(): Promise<void> {
        const member = this.auth.currentMember();
        const orgId = this.org.currentOrgId();
        if (!member?.id || !orgId) {
            this._completedSteps.set(new Set());
            return;
        }

        this._loading.set(true);
        try {
            const antwort = await this.api.get<{ completed_steps: string[]; has_tasks: boolean }>(`/orgs/${orgId}/onboarding`);
            const schritte = new Set(antwort.completed_steps);
            if (antwort.has_tasks) schritte.add('added_task');
            this._completedSteps.set(schritte);
        } catch (error) {
            console.error('Error fetching onboarding progress:', error);
        }
        this._loading.set(false);
    }

    /**
     * Mark a step as completed
     */
    async completeStep(stepKey: string): Promise<void> {
        const member = this.auth.currentMember();
        const orgId = this.org.currentOrgId();
        if (!member?.id || !orgId) return;

        // Already completed?
        if (this._completedSteps().has(stepKey)) return;

        try {
            await this.api.put(`/orgs/${orgId}/onboarding/steps/${stepKey}`);
        } catch (error) {
            console.error('Error completing onboarding step:', error);
            return;
        }

        this._completedSteps.update((s: Set<string>) => new Set(s).add(stepKey));
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
