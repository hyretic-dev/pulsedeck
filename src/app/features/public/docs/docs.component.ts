import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule, ViewportScroller } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { marked } from 'marked';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../../shared/services/auth.service';

interface TocItem {
    id: string;
    text: string;
    level: number;
}

@Component({
    selector: 'app-docs',
    standalone: true,
    imports: [CommonModule, RouterModule, ProgressSpinnerModule, ButtonModule, TagModule],
    template: `
    <div class="min-h-screen bg-[var(--color-bg)] pb-12 font-sans">
        <!-- Sticky Header with Back Button -->
        <div class="border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 sticky top-0 z-40 backdrop-blur-md">
            <div class="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between">
                <a [routerLink]="backLink()" class="flex items-center gap-3 text-[var(--color-text)] hover:opacity-80 transition-opacity no-underline cursor-pointer">
                    <div class="w-8 h-8 rounded-lg bg-linke/20 flex items-center justify-center">
                        <i class="pi pi-book text-linke text-sm"></i>
                    </div>
                    <span class="font-bold text-lg hidden sm:block">PulseDeck Docs</span>
                    <span class="font-bold text-lg sm:hidden">Docs</span>
                </a>
                
                <div class="flex items-center gap-4">
                     <a [routerLink]="backLink()" class="px-4 py-2 rounded-lg bg-[var(--color-surface-raised)] border border-[var(--color-border)] hover:bg-[var(--color-surface-overlay)] text-sm font-bold text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-2 transition-all no-underline cursor-pointer">
                        <i class="pi pi-arrow-left text-xs"></i>
                        <span class="hidden sm:inline">Zurück</span>
                    </a>
                </div>
            </div>
        </div>

        <div class="max-w-[1600px] mx-auto px-4 md:px-6 pt-6">
             <!-- Header (Page Title) -->
             <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-6 border-b border-[var(--color-border)]">
                 <div>
                     <h1 class="text-3xl md:text-4xl font-extrabold text-[var(--color-text)] mb-2 tracking-tight">
                         Handbuch
                     </h1>
                     <p class="text-[var(--color-text-muted)] text-lg">
                         Anleitungen, Workflows und Hilfe für PulseDeck.
                     </p>
                 </div>
                 <div>
                      <p-tag value="Wiki v0.1.2" severity="info" styleClass="!px-3 !py-1" />
                 </div>
             </div>
             
             <!-- Content Grid -->
             <div class="lg:flex lg:gap-12 relative">
                 
                 <!-- Sidebar (Desktop) -->
                 <aside class="hidden lg:block w-72 shrink-0 sticky top-24 self-start max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 custom-scrollbar">
                     <div class="mb-4">
                         <h3 class="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">Inhalt</h3>
                         <nav class="space-y-0.5 border-l border-[var(--color-border)]">
                             @for (item of toc(); track item.id) {
                                <a [href]="'#' + item.id" 
                                   (click)="scrollTo(item.id, $event)"
                                   class="block px-4 py-1.5 text-sm transition-colors duration-200 border-l -ml-px hover:border-linke hover:text-linke cursor-pointer"
                                   [class.pl-8]="item.level === 3"
                                   [class.text-[var(--color-text-muted)]]="activeId() !== item.id"
                                   [class.text-[var(--color-text)]]="activeId() !== item.id"
                                   [class.border-transparent]="activeId() !== item.id"
                                   [class.text-linke]="activeId() === item.id"
                                   [class.font-medium]="activeId() === item.id"
                                   [class.border-linke]="activeId() === item.id">
                                   {{ item.text }}
                                </a>
                             }
                         </nav>
                     </div>
                     
                     <div class="mt-8 p-4 bg-[var(--color-surface-raised)] rounded-lg text-sm border border-[var(--color-border)]">
                         <div class="font-medium mb-2 text-[var(--color-text)]">Hilfe benötigt?</div>
                         <a href="mailto:support@pulsedeck.de" class="text-linke hover:underline flex items-center gap-2">
                             <i class="pi pi-envelope"></i> Support
                         </a>
                     </div>
                 </aside>

                 <!-- Main Content -->
                 <main class="flex-1 min-w-0 pb-20">
                    <!-- Loading -->
                    @if (loading()) {
                    <div class="flex justify-center items-center py-16">
                        <p-progressSpinner strokeWidth="4" ariaLabel="Lade Handbuch..." />
                    </div>
                    }

                    <!-- Error -->
                    @if (error()) {
                    <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
                        <i class="pi pi-exclamation-triangle mr-2"></i>
                        {{ error() }}
                    </div>
                    }

                    <!-- Markdown Content -->
                    @if (!loading() && !error()) {
                    <div class="docs-content prose prose-invert prose-sm md:prose-base max-w-none
                        bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] p-8 md:p-12 shadow-sm
                        
                        [&_h1]:hidden
                        
                        [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-[var(--color-text)] [&_h2]:border-b [&_h2]:border-[var(--color-border)] [&_h2]:pb-4 [&_h2]:mb-6 [&_h2]:mt-12 [&_h2:first-of-type]:mt-0 [&_h2]:scroll-mt-24
                        
                        [&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-[var(--color-text)] [&_h3]:mt-8 [&_h3]:mb-4 [&_h3]:scroll-mt-24
                        
                        [&_p]:text-[var(--color-text-muted)] [&_p]:leading-7 [&_p]:mb-6
                        
                        [&_ul]:space-y-2 [&_ul]:mb-6 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:text-[var(--color-text-muted)]
                        
                        [&_ol]:space-y-2 [&_ol]:mb-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:text-[var(--color-text-muted)]
                        
                        [&_li]:pl-1
                        
                        [&_blockquote]:border-l-4 [&_blockquote]:border-linke [&_blockquote]:bg-[var(--color-surface-raised)] [&_blockquote]:pl-6 [&_blockquote]:py-4 [&_blockquote]:rounded-r-lg [&_blockquote]:not-italic [&_blockquote]:mb-8 [&_blockquote]:text-[var(--color-text-muted)]
                        
                        [&_strong]:text-[var(--color-text)] [&_strong]:font-bold
                        
                        [&_a]:text-linke [&_a]:font-medium [&_a]:underline [&_a]:decoration-linke/30 [&_a]:underline-offset-2 [&_a]:hover:decoration-linke
                        
                        [&_code]:bg-[var(--color-surface-raised)] [&_code]:text-linke [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono [&_code]:border [&_code]:border-[var(--color-border)]
                        
                        [&_img]:rounded-xl [&_img]:border [&_img]:border-[var(--color-border)] [&_img]:shadow-lg [&_img]:my-8
                        "
                        [innerHTML]="htmlContent()">
                    </div>
                    }
                 </main>
             </div>
        </div>
    </div>
    `,
    styles: [`
        :host { display: block; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--color-text-muted); }
    `]
})
export class DocsComponent implements OnInit {
    private http = inject(HttpClient);
    private sanitizer = inject(DomSanitizer);
    private auth = inject(AuthService);

    loading = signal(true);
    error = signal<string | null>(null);
    htmlContent = signal<SafeHtml>('');
    toc = signal<TocItem[]>([]);
    activeId = signal<string | null>(null);

    backLink = computed(() => {
        if (!this.auth.user()) return '/';
        const slug = localStorage.getItem('lastOrgSlug');
        return slug ? `/${slug}/dashboard` : '/organisationen';
    });

    ngOnInit(): void {
        this.loadDocs();
    }

    scrollTo(id: string, event: Event): void {
        event.preventDefault();
        this.activeId.set(id);
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    private async loadDocs(): Promise<void> {
        try {
            const markdown = await this.http
                .get('/DOCS.md', { responseType: 'text' })
                .toPromise();

            if (markdown) {
                // Parse markdown strictly first without altering raw structure
                const rawHtml = await marked.parse(markdown, { async: false }) as string;
                
                // Add IDs and extract TOC from the resulting HTML
                const { html, toc } = this.processHtml(rawHtml);
                
                this.toc.set(toc);
                this.htmlContent.set(
                    this.sanitizer.bypassSecurityTrustHtml(html)
                );

                if (toc.length > 0) this.activeId.set(toc[0].id);
            }
        } catch (err) {
            console.error('Failed to load docs:', err);
            this.error.set('Handbuch konnte nicht geladen werden.');
        } finally {
            this.loading.set(false);
        }
    }

    private processHtml(htmlContent: string): { html: string, toc: TocItem[] } {
        const toc: TocItem[] = [];
        const html = htmlContent.replace(/<h([23])[^>]*>(.*?)<\/h\1>/gi, (match, levelStr, content) => {
            const level = parseInt(levelStr, 10);
            const text = content.replace(/<[^>]+>/g, '').trim();
            const id = this.slugify(text);

            let uniqueId = id;
            let counter = 1;
            while (toc.find(t => t.id === uniqueId)) {
                uniqueId = `${id}-${counter++}`;
            }

            toc.push({ id: uniqueId, text, level });
            return `<h${level} id="${uniqueId}">${content}</h${level}>`;
        });
        return { html, toc };
    }

    private slugify(text: string): string {
        return text.toLowerCase()
            .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
            .replace(/[^\w]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
}
