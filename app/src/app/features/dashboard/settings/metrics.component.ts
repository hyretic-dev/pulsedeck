import { Component, inject, OnInit, signal, effect, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AnalyticsService } from '../../../shared/services/analytics.service';
import { OrganizationService } from '../../../shared/services/organization.service';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

@Component({
    selector: 'app-metrics',
    standalone: true,
    imports: [CommonModule, TableModule, TagModule, TooltipModule],
    template: `
    <div class="space-y-8 animate-fade-in-up">
       <!-- Top KPIs -->
       <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="p-6 rounded-2xl bg-[var(--color-surface-card)] border border-[var(--color-border)] shadow-sm hover:shadow-md transition-shadow">
              <div class="text-[var(--color-text-muted)] text-xs mb-2 uppercase tracking-wider font-bold">WhatsApp Shares</div>
              <div class="text-4xl font-extrabold text-green-500 flex items-center gap-2">
                <i class="pi pi-whatsapp text-2xl opacity-50"></i>
                {{ getCount('whatsapp_copy') }}
              </div>
          </div>
          <div class="p-6 rounded-2xl bg-[var(--color-surface-card)] border border-[var(--color-border)] shadow-sm hover:shadow-md transition-shadow">
              <div class="text-[var(--color-text-muted)] text-xs mb-2 uppercase tracking-wider font-bold">Link Shares</div>
              <div class="text-4xl font-extrabold text-blue-500 flex items-center gap-2">
                <i class="pi pi-link text-2xl opacity-50"></i>
                {{ getCount('event_link_copy') }}
              </div>
          </div>
          <!-- Placeholder for future metrics -->
           <div class="p-6 rounded-2xl bg-[var(--color-surface-card)] border border-[var(--color-border)] opacity-50">
              <div class="text-[var(--color-text-muted)] text-xs mb-2 uppercase tracking-wider font-bold">Page Views</div>
              <div class="text-4xl font-extrabold text-[var(--color-text-muted)] flex items-center gap-2">
                <i class="pi pi-eye text-2xl opacity-50"></i>
                {{ getCount('page_view') }}
              </div>
          </div>
       </div>

       <!-- Table -->
       <div class="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface-card)] shadow-sm">
          <p-table [value]="stats()" [loading]="loading()" styleClass="p-datatable-sm">
             <ng-template pTemplate="header">
                 <tr>
                     <th class="bg-[var(--color-surface-raised)]">Event Name</th>
                     <th class="bg-[var(--color-surface-raised)] text-right">Anzahl</th>
                     <th class="bg-[var(--color-surface-raised)] w-1/3">Verteilung</th>
                 </tr>
             </ng-template>
             <ng-template pTemplate="body" let-stat>
                 <tr class="hover:bg-[var(--color-surface-raised)] transition-colors">
                     <td>
                        <div class="font-bold flex items-center gap-2">
                            <i class="pi" [class.pi-whatsapp]="stat.name === 'whatsapp_copy'" 
                                         [class.pi-link]="stat.name === 'event_link_copy'"
                                         [class.pi-eye]="stat.name === 'page_view'"
                                         [class.pi-bolt]="stat.name !== 'whatsapp_copy' && stat.name !== 'event_link_copy' && stat.name !== 'page_view'"></i>
                            {{ getLabel(stat.name) }}
                        </div>
                        <div class="text-xs text-[var(--color-text-muted)] ml-6 font-mono opacity-70">{{ stat.name }}</div>
                     </td>
                     <td class="text-right font-mono font-bold">{{ stat.count }}</td>
                     <td>
                        <div class="h-2 rounded-full bg-[var(--color-surface-ground)] overflow-hidden w-full max-w-xs flex items-center" [pTooltip]="Math.round((stat.count / totalCount()) * 100) + '%'">
                           <div class="h-full bg-primary transition-all duration-1000 ease-out" [style.width.%]="(stat.count / maxCount()) * 100"></div>
                        </div>
                     </td>
                 </tr>
             </ng-template>
             <ng-template pTemplate="emptymessage">
                 <tr>
                    <td colspan="3" class="text-center p-12 text-[var(--color-text-muted)]">
                       <i class="pi pi-chart-bar text-4xl mb-4 opacity-20 block"></i>
                       Noch keine Daten vorhanden. <br>
                       <span class="text-sm">Teile Events, um Metriken zu generieren.</span>
                    </td>
                 </tr>
             </ng-template>
          </p-table>
       </div>
    </div>
  `,
    styles: [`
    :host { display: block; }
  `]
})
export class MetricsComponent implements OnInit {
    analytics = inject(AnalyticsService);
    orgService = inject(OrganizationService);
    Math = Math;

    @Input() global = false;

    stats = signal<{ name: string, count: number }[]>([]);
    loading = signal(true);

    constructor() {
        effect(() => {
            // Reload when org changes (only if not global)
            if (!this.global && this.orgService.currentOrganization()) {
                this.load();
            }
        });
    }

    ngOnInit() {
        this.load();
    }

    async load() {
        if (this.global) {
            this.loading.set(true);
            try {
                const data = await this.analytics.getGlobalStats();
                this.stats.set(data);
            } finally {
                this.loading.set(false);
            }
            return;
        }

        const orgId = this.orgService.currentOrgId();
        if (!orgId) return;

        this.loading.set(true);
        try {
            const data = await this.analytics.getStats(orgId);
            this.stats.set(data);
        } finally {
            this.loading.set(false);
        }
    }

    getCount(name: string): number {
        return this.stats().find(s => s.name === name)?.count || 0;
    }

    maxCount(): number {
        const max = Math.max(...this.stats().map(s => s.count), 0);
        return max === 0 ? 1 : max;
    }

    totalCount(): number {
        return this.stats().reduce((acc, curr) => acc + curr.count, 0);
    }

    getLabel(name: string): string {
        switch (name) {
            case 'whatsapp_copy': return 'WhatsApp Text kopiert';
            case 'event_link_copy': return 'Event Link kopiert';
            case 'page_view': return 'Landing Page Aufrufe';
            case 'hero_signup': return 'Klick: Alpha Tester werden';
            default: return name;
        }
    }
}
