import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
import { OrganizationRole } from '../models/member.model';

@Injectable({ providedIn: 'root' })
export class RolesService {
    private supabase = inject(SupabaseService).client;

    roles = signal<OrganizationRole[]>([]);

    async loadRoles(orgId: string): Promise<void> {
        const { data, error } = await this.supabase
            .from('organization_roles')
            .select('*')
            .eq('organization_id', orgId)
            .order('is_system_admin', { ascending: false })
            .order('name');
        
        if (!error && data) {
            this.roles.set(data as OrganizationRole[]);
        } else if (error) {
            console.error('Error loading roles:', error);
        }
    }

    async saveRole(role: Partial<OrganizationRole>): Promise<{ success: boolean; error?: string }> {
        if (!role.organization_id) return { success: false, error: 'No org id' };

        if (role.id) {
            const { error } = await this.supabase
                .from('organization_roles')
                .update(role)
                .eq('id', role.id);
            return { success: !error, error: error?.message };
        } else {
            const { error } = await this.supabase
                .from('organization_roles')
                .insert(role);
            return { success: !error, error: error?.message };
        }
    }

    async deleteRole(id: string): Promise<{ success: boolean; error?: string }> {
        const { error } = await this.supabase
            .from('organization_roles')
            .delete()
            .eq('id', id);
        return { success: !error, error: error?.message };
    }
}
