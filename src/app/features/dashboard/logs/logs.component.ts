import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '../../../shared/services/supabase';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { MetricsComponent } from '../settings/metrics.component';
import { DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';

@Component({
    selector: 'app-logs',
    standalone: true,
    imports: [CommonModule, TableModule, TagModule, ButtonModule, DatePipe, JsonPipe, TabsModule, MetricsComponent, FormsModule, SelectModule],
    templateUrl: './logs.component.html'
})
export class LogsComponent {
    private supabase = inject(SupabaseService);
    private router = inject(Router);

    logs = signal<any[]>([]);
    loading = signal(true);
    activeTab = signal('online-users');

    // Online Users State
    organizations = signal<{id: string, name: string}[]>([]);
    selectedOrgId = signal<string | null>(null);
    onlineUsers = signal<any[]>([]);
    loadingOnline = signal(false);

    // Hardcoded Super Admin ID (Julien)
    private readonly SUPER_ADMIN_ID = '2d8af6a7-507c-4834-aff9-3b00d1ad9c7c';

    constructor() {
        this.checkAccess();
    }

    checkAccess() {
        const user = this.supabase.user() as any;
        if (user?.id !== this.SUPER_ADMIN_ID) {
            // Quietly redirect unauthorized users
            this.router.navigate(['/']);
            return;
        }
        this.fetchOrganizations();
        this.fetchLogs();
    }

    async fetchOrganizations() {
        const { data, error } = await this.supabase.client
            .from('organizations')
            .select('id, name')
            .order('name');
            
        if (!error && data) {
            this.organizations.set(data);
            if (data.length > 0) {
                this.selectedOrgId.set(data[0].id);
                this.fetchOnlineUsers(data[0].id);
            }
        }
    }

    async fetchOnlineUsers(orgId: string | null) {
        if (!orgId) return;
        this.selectedOrgId.set(orgId);
        this.loadingOnline.set(true);

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

        // Fetch all active sessions recently and filter in memory by org
        // (PostgREST JSONB key existence is tricky, and active sessions count is small)
        const { data, error } = await this.supabase.client
            .from('active_sessions')
            .select('*')
            .gte('last_seen_at', fiveMinutesAgo)
            .order('last_seen_at', { ascending: false });

        if (error) {
            console.error('Error fetching online users:', error);
            this.onlineUsers.set([]);
        } else if (data) {
            const filtered = data.filter(s => s.org_roles && s.org_roles[orgId] !== undefined);
            this.onlineUsers.set(filtered);
        }
        
        this.loadingOnline.set(false);
    }

    async fetchLogs() {
        this.loading.set(true);
        const { data, error } = await this.supabase.client
            .from('audit_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100) as any;

        if (error) {
            console.error('Error fetching logs:', error);
        } else {
            this.logs.set(data || []);
        }
        this.loading.set(false);
    }

    getSeverity(op: string): "success" | "info" | "danger" | "secondary" | "warn" | "contrast" | undefined {
        switch (op) {
            case 'INSERT': return 'success';
            case 'UPDATE': return 'info';
            case 'DELETE': return 'danger';
            default: return 'secondary';
        }
    }
}
