import { Injectable, inject, signal } from '@angular/core';

import { ApiService } from '../../core/api.service';
import { OrganizationRole } from '../models/member.model';

@Injectable({ providedIn: 'root' })
export class RolesService {
    private api = inject(ApiService);

    roles = signal<OrganizationRole[]>([]);

    async loadRoles(orgId: string): Promise<void> {
        try {
            const rollen = await this.api.get<OrganizationRole[]>(`/orgs/${orgId}/roles`);
            this.roles.set([...rollen].sort((a, b) => Number(b.is_system_admin) - Number(a.is_system_admin) || a.name.localeCompare(b.name)));
        } catch (error) {
            console.error('Error loading roles:', error);
        }
    }

    async saveRole(role: Partial<OrganizationRole>): Promise<{ success: boolean; error?: string }> {
        if (!role.organization_id) return { success: false, error: 'No org id' };
        const { name, description, permissions, is_default, is_system_admin } = role;
        const body = { name, description, permissions, is_default, is_system_admin };
        try {
            if (role.id) await this.api.patch(`/orgs/${role.organization_id}/roles/${role.id}`, body);
            else await this.api.post(`/orgs/${role.organization_id}/roles`, body);
            return { success: true };
        } catch (e) {
            return { success: false, error: (e as Error).message };
        }
    }

    async deleteRole(id: string, orgId: string): Promise<{ success: boolean; error?: string }> {
        try {
            await this.api.delete(`/orgs/${orgId}/roles/${id}`);
            return { success: true };
        } catch (e) {
            return { success: false, error: (e as Error).message };
        }
    }
}
