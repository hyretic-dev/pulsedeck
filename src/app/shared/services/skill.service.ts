import { Injectable, inject, signal } from '@angular/core';

import { ApiService } from '../../core/api.service';

/**
 * Skill categories
 */
export type SkillCategory = 'ability' | 'interest' | 'availability';

/**
 * Skill definition (organization-level)
 */
export interface Skill {
    id: string;
    organization_id: string;
    name: string;
    category: SkillCategory;
    icon?: string;
    description?: string;
    sort_order: number;
    created_at?: string;
}

/**
 * Service for managing skills and member skill assignments
 */
@Injectable({
    providedIn: 'root',
})
export class SkillService {
    private readonly api = inject(ApiService);

    /** All skills for current organization */
    skills = signal<Skill[]>([]);

    /** Loading state */
    loading = signal(false);

    /**
     * Load all skills for an organization
     */
    async loadSkills(organizationId: string): Promise<void> {
        this.loading.set(true);
        try {
            this.skills.set(await this.api.get<Skill[]>(`/orgs/${organizationId}/skills`));
        } catch (error) {
            console.error('Error loading skills:', error);
        }
        this.loading.set(false);
    }

    /**
     * Get skills grouped by category
     */
    getSkillsByCategory(category: SkillCategory): Skill[] {
        return this.skills().filter((s) => s.category === category);
    }

    private orgId(): string | undefined {
        return this.skills()[0]?.organization_id;
    }

    /**
     * Load skills assigned to a specific member
     */
    async getMemberSkillIds(memberId: string, organizationId = this.orgId()): Promise<string[]> {
        if (!organizationId) return [];
        try {
            return await this.api.get<string[]>(`/orgs/${organizationId}/members/${memberId}/skills`);
        } catch (error) {
            console.error('Error loading member skills:', error);
            return [];
        }
    }

    /**
     * Update skills for a member (replaces all existing)
     */
    async updateMemberSkills(memberId: string, skillIds: string[], organizationId = this.orgId()): Promise<boolean> {
        if (!organizationId) return false;
        try {
            await this.api.put(`/orgs/${organizationId}/members/${memberId}/skills`, { skill_ids: skillIds });
            return true;
        } catch (error) {
            console.error('Error updating member skills:', error);
            return false;
        }
    }

    /**
     * Add a single skill to a member
     */
    async addSkillToMember(memberId: string, skillId: string, organizationId = this.orgId()): Promise<boolean> {
        if (!organizationId) return false;
        try {
            await this.api.put(`/orgs/${organizationId}/members/${memberId}/skills/${skillId}`);
            return true;
        } catch (error) {
            console.error('Error adding skill:', error);
            return false;
        }
    }

    /**
     * Remove a skill from a member
     */
    async removeSkillFromMember(memberId: string, skillId: string, organizationId = this.orgId()): Promise<boolean> {
        if (!organizationId) return false;
        try {
            await this.api.delete(`/orgs/${organizationId}/members/${memberId}/skills/${skillId}`);
            return true;
        } catch (error) {
            console.error('Error removing skill:', error);
            return false;
        }
    }

    /**
     * Load all member skills for an organization (bulk load for filtering)
     */
    async getAllMemberSkills(organizationId: string): Promise<Record<string, string[]>> {
        try {
            return await this.api.get<Record<string, string[]>>(`/orgs/${organizationId}/member-skills`);
        } catch (error) {
            console.error('Error loading all member skills:', error);
            return {};
        }
    }

    // =========================================================================
    // ADMIN: Skill Management
    // =========================================================================

    /**
     * Create a new skill (admin only)
     */
    async createSkill(organizationId: string, skill: Partial<Skill>): Promise<Skill | null> {
        try {
            const neu = await this.api.post<Skill>(`/orgs/${organizationId}/skills`, {
                name: skill.name,
                category: skill.category || 'ability',
                icon: skill.icon,
                description: skill.description,
                sort_order: skill.sort_order || 0,
            });
            await this.loadSkills(organizationId);
            return neu;
        } catch (error) {
            console.error('Error creating skill:', error);
            return null;
        }
    }

    /**
     * Update a skill (admin only)
     */
    async updateSkill(skillId: string, updates: Partial<Skill>, organizationId = this.orgId()): Promise<boolean> {
        if (!organizationId) return false;
        try {
            await this.api.patch(`/orgs/${organizationId}/skills/${skillId}`, {
                name: updates.name,
                category: updates.category,
                icon: updates.icon,
                description: updates.description,
                sort_order: updates.sort_order,
            });
            return true;
        } catch (error) {
            console.error('Error updating skill:', error);
            return false;
        }
    }

    /**
     * Delete a skill (admin only)
     */
    async deleteSkill(skillId: string, organizationId = this.orgId()): Promise<boolean> {
        if (!organizationId) return false;
        try {
            await this.api.delete(`/orgs/${organizationId}/skills/${skillId}`);
            return true;
        } catch (error) {
            console.error('Error deleting skill:', error);
            return false;
        }
    }

    // =========================================================================
    // ADMIN: Member Filtering
    // =========================================================================

    /**
     * Find members with specific skills (Vorstand und Administratoren)
     */
    async findMembersBySkills(
        organizationId: string,
        skillIds: string[]
    ): Promise<
        Array<{
            member_id: string;
            member_name: string;
            member_email: string;
            matching_skills: number;
        }>
    > {
        try {
            return await this.api.post(`/orgs/${organizationId}/skills/match`, { skill_ids: skillIds });
        } catch (error) {
            console.error('Error finding members by skills:', error);
            return [];
        }
    }

    /**
     * Get category label in German
     */
    getCategoryLabel(category: SkillCategory): string {
        const labels: Record<SkillCategory, string> = {
            ability: 'Fähigkeiten',
            interest: 'Interessen',
            availability: 'Verfügbarkeit',
        };
        return labels[category] || category;
    }

    /**
     * Get category icon
     */
    getCategoryIcon(category: SkillCategory): string {
        const icons: Record<SkillCategory, string> = {
            ability: 'pi-wrench',
            interest: 'pi-heart',
            availability: 'pi-clock',
        };
        return icons[category] || 'pi-tag';
    }
}
