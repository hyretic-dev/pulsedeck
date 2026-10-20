import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../../../core/api.service';
import { RealtimeService } from '../../../core/realtime.service';
import { OrganizationService } from '../../../shared/services/organization.service';
import { DatePipe } from '@angular/common';

@Component({
    selector: 'app-issue-tracker',
    standalone: true,
    imports: [CommonModule, TableModule, TagModule, DatePipe],
    templateUrl: './issue-tracker.component.html',
})
export class IssueTrackerComponent implements OnInit, OnDestroy {
    private api = inject(ApiService);
    private realtime = inject(RealtimeService);
    private org = inject(OrganizationService);
    private abmelden: (() => void) | null = null;

    feedbackList = signal<any[]>([]);
    loading = signal<boolean>(true);

    async ngOnInit() {
        await this.loadFeedback();
        const orgId = this.org.currentOrgId();
        if (orgId) this.abmelden = this.realtime.abonnieren(orgId, ['feedback_submissions'], () => void this.loadFeedback());
    }

    ngOnDestroy() {
        this.abmelden?.();
    }

    /** Feedback der eigenen Organisation (Recht „Issue-Tracker anzeigen“) */
    private async loadFeedback() {
        const orgId = this.org.currentOrgId();
        if (!orgId) return;
        try {
            this.feedbackList.set(await this.api.get<any[]>(`/orgs/${orgId}/feedback`));
        } catch (error) {
            console.error('Error fetching feedback:', error);
        }
        this.loading.set(false);
    }

    getSeverity(status: string) {
        switch (status) {
            case 'new':
                return 'info';
            case 'in_progress':
                return 'warn';
            case 'done':
            case 'live':
                return 'success';
            default:
                return 'secondary';
        }
    }

    getStatusLabel(status: string) {
        switch (status) {
            case 'new':
                return 'Neu';
            case 'in_progress':
                return 'In Bearbeitung';
            case 'done':
                return 'Erledigt';
            case 'live':
                return 'Live';
            default:
                return status;
        }
    }

    getSuggestionCount(): number {
        return this.feedbackList().filter(f => f.type === 'suggestion').length;
    }

    getBugCount(): number {
        return this.feedbackList().filter(f => f.type === 'bug').length;
    }
}
