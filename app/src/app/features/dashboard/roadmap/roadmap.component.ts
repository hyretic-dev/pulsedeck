import { Component, OnInit, signal, inject, SecurityContext } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

// PrimeNG
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

@Component({
    selector: 'app-roadmap',
    standalone: true,
    imports: [CommonModule, ProgressSpinnerModule, ButtonModule, TagModule],
    template: `
    <div class="p-4 md:p-6 max-w-4xl mx-auto">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
            <div>
                <h1 class="text-2xl md:text-3xl font-bold text-[var(--color-text)] flex items-center gap-3">
                    <i class="pi pi-map text-amber-500"></i>
                    Roadmap
                </h1>
                <p class="text-[var(--color-text-muted)] text-sm mt-1">
                    Entwicklungsfortschritt und geplante Features
                </p>
            </div>
            <p-tag value="Alpha" severity="warn" styleClass="!text-xs" />
        </div>

        <!-- Loading -->
        @if (loading()) {
        <div class="flex justify-center items-center py-16">
            <p-progressSpinner strokeWidth="4" ariaLabel="Lade Roadmap..." />
        </div>
        }

        <!-- Error -->
        @if (error()) {
        <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
            <i class="pi pi-exclamation-triangle mr-2"></i>
            {{ error() }}
        </div>
        }

        <!-- Content -->
        @if (!loading() && !error()) {
        <div class="roadmap-content prose prose-invert prose-sm md:prose-base max-w-none
            bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-6 md:p-8
            [&_h1]:hidden
            [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-[var(--color-text)] [&_h2]:border-b 
            [&_h2]:border-[var(--color-border)] [&_h2]:pb-2 [&_h2]:mb-4 [&_h2]:mt-8 [&_h2:first-of-type]:mt-0
            [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-[var(--color-text)] [&_h3]:mt-6 [&_h3]:mb-3
            [&_h4]:text-base [&_h4]:font-medium [&_h4]:text-[var(--color-text)] [&_h4]:mt-4 [&_h4]:mb-2
            [&_p]:text-[var(--color-text-muted)] [&_p]:leading-relaxed
            [&_ul]:space-y-1 [&_ul]:text-[var(--color-text)]
            [&_li]:text-[var(--color-text)]
            [&_blockquote]:border-l-4 [&_blockquote]:border-amber-500 [&_blockquote]:bg-amber-500/10 
            [&_blockquote]:pl-4 [&_blockquote]:py-2 [&_blockquote]:rounded-r-lg [&_blockquote]:text-[var(--color-text-muted)]
            [&_table]:w-full [&_table]:border-collapse [&_table]:my-4
            [&_th]:bg-[var(--color-surface-raised)] [&_th]:text-[var(--color-text)] [&_th]:font-semibold 
            [&_th]:text-left [&_th]:p-3 [&_th]:border [&_th]:border-[var(--color-border)]
            [&_td]:p-3 [&_td]:border [&_td]:border-[var(--color-border)] [&_td]:text-[var(--color-text)]
            [&_code]:bg-[var(--color-surface-raised)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm
            [&_hr]:border-[var(--color-border)] [&_hr]:my-8
            [&_strong]:text-[var(--color-text)] [&_strong]:font-semibold
            [&_a]:text-linke [&_a]:hover:underline
            [&_input[type=checkbox]]:mr-2 [&_input[type=checkbox]]:accent-teal
            "
            [innerHTML]="htmlContent()">
        </div>
        }

        <!-- Footer -->
        <div class="mt-8 text-center text-sm text-[var(--color-text-muted)]">
            <p>Hast du Feedback oder Wünsche? Nutze den 
                <span class="text-amber-500 font-medium">Alpha-Badge</span> unten links!
            </p>
        </div>
    </div>
    `,
    styles: [`
        :host {
            display: block;
        }
    `]
})
export class RoadmapComponent implements OnInit {
    private http = inject(HttpClient);
    private sanitizer = inject(DomSanitizer);

    loading = signal(true);
    error = signal<string | null>(null);
    htmlContent = signal<SafeHtml>('');

    ngOnInit(): void {
        this.loadRoadmap();
    }

    private async loadRoadmap(): Promise<void> {
        try {
            // Load ROADMAP.md from public folder
            const markdown = await this.http
                .get('/ROADMAP.md', { responseType: 'text' })
                .toPromise();

            if (markdown) {
                // Parse markdown to HTML
                const rawHtml = await marked.parse(this.filterInternalContent(markdown));
                // Sanitize and set
                this.htmlContent.set(
                    this.sanitizer.bypassSecurityTrustHtml(rawHtml)
                );
            }
        } catch (err) {
            console.error('Failed to load roadmap:', err);
            this.error.set('Roadmap konnte nicht geladen werden.');
        } finally {
            this.loading.set(false);
        }
    }

    /**
     * Remove AI-internal sections from markdown before rendering
     */
    private filterInternalContent(markdown: string): string {
        // Remove everything between AI-INTERNAL comments
        return markdown.replace(
            /<!--\s*\n={10,}\nAI-INTERNAL[\s\S]*?-->/g,
            ''
        );
    }
}
