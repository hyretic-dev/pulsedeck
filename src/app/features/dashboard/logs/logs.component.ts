import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../shared/services/auth.service';
import { OrganizationService } from '../../../shared/services/organization.service';
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
    private api = inject(ApiService);
    private auth = inject(AuthService);
    private org = inject(OrganizationService);
    private router = inject(Router);

    logs = signal<any[]>([]);
    loading = signal(true);
    activeTab = signal('online-users');

    // Online Users State
    organizations = signal<{id: string, name: string}[]>([]);
    selectedOrgId = signal<string | null>(null);
    onlineUsers = signal<any[]>([]);
    loadingOnline = signal(false);

    /** Plattformadministratoren sehen alle Organisationen; Organisationsadministratoren nur die eigene. */
    platformModus = signal(false);

    constructor() {
        void this.checkAccess();
    }

    async checkAccess() {
        await this.auth.whenReady();
        const platform = this.auth.account()?.isPlatformAdmin === true;
        if (!platform && !this.auth.isAdmin()) {
            // Quietly redirect unauthorized users
            this.router.navigate(['/']);
            return;
        }
        this.platformModus.set(platform);
        await this.fetchOrganizations();
        this.fetchLogs();
    }

    async fetchOrganizations() {
        try {
            const orgs = this.platformModus()
                ? await this.api.get<{ id: string; name: string }[]>('/platform/organizations')
                : [{ id: this.org.currentOrgId() as string, name: this.org.currentOrganization()?.name ?? '' }];
            this.organizations.set(orgs);
            if (orgs.length > 0) {
                this.selectedOrgId.set(orgs[0].id);
                this.fetchOnlineUsers(orgs[0].id);
            }
        } catch (error) {
            console.error('Error fetching organizations:', error);
        }
    }

    async fetchOnlineUsers(orgId: string | null) {
        if (!orgId) return;
        this.selectedOrgId.set(orgId);
        this.loadingOnline.set(true);
        try {
            // Online = in den letzten fünf Minuten gesehen; der Server liefert je Nutzer nur die Rolle in dieser Organisation
            this.onlineUsers.set(
                this.platformModus()
                    ? await this.api.get<any[]>('/platform/online-users', { org_id: orgId })
                    : await this.api.get<any[]>(`/orgs/${orgId}/presence`)
            );
        } catch (error) {
            console.error('Error fetching online users:', error);
            this.onlineUsers.set([]);
        }
        this.loadingOnline.set(false);
    }

    async fetchLogs() {
        this.loading.set(true);
        try {
            this.logs.set(
                this.platformModus()
                    ? await this.api.get<any[]>('/platform/audit-logs', { limit: 100 })
                    : await this.api.get<any[]>(`/orgs/${this.org.currentOrgId()}/audit-logs`, { limit: 100 })
            );
        } catch (error) {
            console.error('Error fetching logs:', error);
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
