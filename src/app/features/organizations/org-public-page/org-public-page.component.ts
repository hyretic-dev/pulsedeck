import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';
import { DialogModule } from 'primeng/dialog';

// Services
import { SupabaseService } from '../../../shared/services/supabase';
import { Organization } from '../../../shared/services/organization.service';
import { AuthService, LoginCheckResult } from '../../../shared/services/auth.service';


interface PublicEvent {
    id: string;
    title: string;
    date: string;
    start_time?: string;
    end_time?: string;
    location?: string;
    description?: string;
}

interface PublicWikiArticle {
    id: string;
    title: string;
    category?: string;
    content?: string;
}

interface PublicFeedItem {
    id: string;
    title: string;
    content: string;
    created_at: string;
}

interface WorkingGroup {
    id: string;
    name: string;
    description?: string;
}

interface ContactPerson {
    id: string;
    name: string;
    role: string;
    email: string;
    phone?: string;
    image_url?: string;
}

type LoginStep = 'email' | 'password' | 'invitation-sent' | 'not-found';

import { RichTextRendererComponent } from '../../../shared/components/rich-text-renderer/rich-text-renderer.component';

@Component({
    selector: 'app-org-public-page',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterModule,
        ButtonModule,
        CardModule,
        ProgressSpinnerModule,
        InputTextModule,
        PasswordModule,
        MessageModule,
        DialogModule,
        RichTextRendererComponent
    ],
    styleUrl: './org-public-page.component.css',
    template: `
        <div class="min-h-screen bg-[var(--color-bg)] font-sans flex flex-col">
            <!-- Loading State -->
            @if (loading()) {
            <div class="fixed inset-0 flex items-center justify-center bg-[var(--color-bg)] z-50">
                <p-progressSpinner ariaLabel="loading" styleClass="w-12 h-12" strokeWidth="4" />
            </div>
            }

            @if (org()) {
            
            <!-- 1. Modern Hero Section -->
            <div class="relative bg-[var(--color-surface-card)] border-b border-[var(--color-border)]">
                
                <div class="max-w-7xl mx-auto px-4 md:px-8 py-10 relative z-10">
                    <div class="flex flex-col md:flex-row items-center md:items-start gap-6 md:gap-8">
                        <!-- Logo Wrapper (Simplified) -->
                        <div class="shrink-0">
                            <div class="w-24 h-24 md:w-32 md:h-32 rounded-xl bg-[var(--color-surface-ground)] flex items-center justify-center p-2 border border-[var(--color-border)] shadow-sm">
                                @if (org()!.logo_url) {
                                    <img [src]="org()!.logo_url" class="w-full h-full object-contain" />
                                } @else {
                                    <i class="pi pi-building text-4xl opacity-20" [style.color]="primaryColor"></i>
                                }
                            </div>
                        </div>

                        <!-- Org Info -->
                        <div class="flex-1 text-center md:text-left pt-1">
                             <div class="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-md bg-[var(--color-surface-ground)] border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide mb-3">
                                <i class="pi pi-verified text-[var(--color-primary)] text-xs"></i> Offizielle Seite
                            </div>
                            <h1 class="text-3xl md:text-4xl font-bold text-[var(--color-text)] mb-3 leading-tight">
                                {{ org()!.name }}
                            </h1>
                            @if (org()!.description) {
                                <p class="text-base text-[var(--color-text-muted)] max-w-2xl leading-relaxed">
                                    {{ org()!.description }}
                                </p>
                            }
                            
                            <!-- Stats/Meta (Quick Overview) -->
                            <div class="flex flex-wrap justify-center md:justify-start gap-6 mt-5 text-sm font-medium text-[var(--color-text-muted)]">
                                <div class="flex items-center gap-2">
                                    <i class="pi pi-users text-[var(--color-text)]"></i> {{ memberCount() }} Mitglieder
                                </div>
                                @if(contacts().length > 0) {
                                <div class="flex items-center gap-2">
                                    <i class="pi pi-id-card text-[var(--color-text)]"></i> {{ contacts().length }} Ansprechpartner
                                </div>
                                }
                            </div>
                        </div>

                        <!-- Header Actions (Desktop) -->
                        <div class="hidden md:flex flex-col gap-3 shrink-0">
                            <button (click)="navigateToLogin()" 
                                class="px-5 py-2.5 rounded-lg font-bold text-white shadow hover:brightness-110 transition-all flex items-center gap-2"
                                [style.background]="primaryColor">
                                <i class="pi pi-sign-in"></i>
                                Mitglieder-Login
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 2. Main Dashboard Content -->
            <main class="max-w-7xl mx-auto px-4 md:px-8 py-12">
                <div class="grid lg:grid-cols-12 gap-10">
                    
                    <!-- LEFT COLUMN (Main Feed: Events & News) - 8 Cols -->
                    <div class="lg:col-span-8 space-y-12">
                        
                        <!-- Events Section (Priority #1) -->
                        <section>
                            <div class="flex items-center justify-between mb-6">
                                <h2 class="text-2xl font-bold text-[var(--color-text)] flex items-center gap-3">
                                    <span class="w-8 h-8 rounded-lg bg-[var(--color-surface-ground)] flex items-center justify-center text-[var(--color-primary)] text-lg">
                                        <i class="pi pi-calendar"></i>
                                    </span>
                                    Nächste Termine
                                </h2>
                            </div>

                            @if (upcomingEvents().length > 0) {
                                <div class="grid md:grid-cols-2 gap-4">
                                    @for (e of upcomingEvents(); track e.id) {
                                        <div (click)="openEvent(e)" class="group bg-[var(--color-surface-card)] rounded-2xl p-5 border border-[var(--color-border)] hover:border-[var(--color-primary)] transition-all shadow-sm hover:shadow-md cursor-pointer">
                                            <div class="flex gap-4">
                                                <!-- Date Box -->
                                                <div class="shrink-0 w-14 h-14 rounded-xl bg-[var(--color-surface-ground)] border border-[var(--color-border)] flex flex-col items-center justify-center text-[var(--color-primary)]">
                                                    <span class="text-xs font-bold uppercase">{{ formatMonth(e.date) }}</span>
                                                    <span class="text-xl font-black leading-none">{{ formatDayShort(e.date) }}</span>
                                                </div>
                                                
                                                <!-- Content -->
                                                <div class="min-w-0 flex-1">
                                                    <h3 class="font-bold text-[var(--color-text)] truncate group-hover:text-[var(--color-primary)] transition-colors">{{ e.title }}</h3>
                                                    <div class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mt-1">
                                                        <i class="pi pi-clock text-xs opacity-70"></i> {{ e.start_time }} Uhr
                                                    </div>
                                                    @if(e.location) {
                                                    <div class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mt-0.5">
                                                        <i class="pi pi-map-marker text-xs opacity-70"></i> {{ e.location }}
                                                    </div>
                                                    }
                                                </div>
                                            </div>
                                        </div>
                                    }
                                </div>
                            } @else {
                                <div class="text-center py-10 bg-[var(--color-surface-ground)] rounded-2xl border border-dashed border-[var(--color-border)] opacity-60">
                                    <p class="text-[var(--color-text-muted)]">Keine öffentlichen Termine geplant.</p>
                                </div>
                            }
                        </section>

                        <!-- News Section (Priority #2) -->
                        <section>
                            <div class="flex items-center justify-between mb-6">
                                <h2 class="text-2xl font-bold text-[var(--color-text)] flex items-center gap-3">
                                    <span class="w-8 h-8 rounded-lg bg-[var(--color-surface-ground)] flex items-center justify-center text-[var(--color-primary)] text-lg">
                                        <i class="pi pi-megaphone"></i>
                                    </span>
                                    Neuigkeiten
                                </h2>
                            </div>

                            @if (feedItems().length > 0) {
                                <div class="space-y-6">
                                    @for (item of feedItems(); track item.id) {
                                        <article class="bg-[var(--color-surface-card)] rounded-2xl p-6 border border-[var(--color-border)] shadow-sm hover:shadow-md transition-shadow">
                                            <div class="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
                                                <i class="pi pi-clock"></i> {{ formatDate(item.created_at) }}
                                            </div>
                                            <h3 class="text-xl font-bold text-[var(--color-text)] mb-3">{{ item.title }}</h3>
                                            <app-rich-text-renderer [content]="item.content"></app-rich-text-renderer>
                                        </article>
                                    }
                                </div>
                            } @else {
                                <div class="text-center py-8 opacity-50">
                                    <p class="text-sm text-[var(--color-text-muted)]">Keine Neuigkeiten verfügbar.</p>
                                </div>
                            }
                        </section>



                    </div>

                    <!-- RIGHT COLUMN (Sidebar: Contacts, Groups, CTA) - 4 Cols -->
                    <div class="lg:col-span-4 space-y-8">
                        
                        <!-- Mobile CTA (Visible only on small screens) -->
                        <div class="md:hidden">
                            <button (click)="navigateToLogin()" 
                                class="w-full px-6 py-4 rounded-xl font-bold text-white shadow-lg flex items-center justify-center gap-2 text-lg"
                                [style.background]="primaryColor">
                                Mitmachen / Login
                            </button>
                        </div>

                        <!-- Wiki Teaser (Moved to Sidebar) -->
                        @if (wikiArticles().length > 0) {
                        <div class="bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
                            <div class="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface-ground)]">
                                <h3 class="font-bold text-[var(--color-text)] flex items-center gap-2">
                                    <i class="pi pi-book text-[var(--color-primary)]"></i> Öffentliches Wissen
                                </h3>
                            </div>
                            <div class="divide-y divide-[var(--color-border)]">
                                @for (doc of wikiArticles(); track doc.id) {
                                    <div (click)="openArticle(doc)" class="p-4 flex items-center gap-3 hover:bg-[var(--color-surface-ground)] cursor-pointer transition-colors group">
                                        <div class="w-8 h-8 rounded bg-[var(--color-surface-ground)] flex items-center justify-center shrink-0 border border-[var(--color-border)] text-[var(--color-primary)]">
                                            <i class="pi pi-file-o"></i>
                                        </div>
                                        <div class="min-w-0 flex-1">
                                            <div class="font-bold text-sm text-[var(--color-text)] group-hover:text-[var(--color-primary)] truncate">{{ doc.title }}</div>
                                            <div class="text-xs text-[var(--color-text-muted)] uppercase mt-0.5">{{ doc.category || 'Info' }}</div>
                                        </div>
                                        <i class="pi pi-chevron-right text-[var(--color-text-muted)] text-xs opacity-50 group-hover:opacity-100"></i>
                                    </div>
                                }
                            </div>
                        </div>
                        }

                        <!-- Contacts Card -->
                        @if (contacts().length > 0) {
                        <div class="bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
                            <div class="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface-ground)]">
                                <h3 class="font-bold text-[var(--color-text)] flex items-center gap-2">
                                    <i class="pi pi-id-card text-[var(--color-primary)]"></i> Ansprechpartner
                                </h3>
                            </div>
                            <div class="divide-y divide-[var(--color-border)]">
                                @for (c of contacts(); track c.id) {
                                    <div class="p-4 flex items-center gap-4 hover:bg-[var(--color-surface-ground)] transition-colors">
                                        <img [src]="c.image_url || 'https://www.gravatar.com/avatar?d=mp'" 
                                             class="w-12 h-12 rounded-full object-cover border border-[var(--color-border)] bg-gray-100" />
                                        <div class="min-w-0 flex-1">
                                            <div class="font-bold text-sm text-[var(--color-text)] truncate">{{ c.name }}</div>
                                            <div class="text-xs text-[var(--color-text-muted)] truncate mb-1">{{ c.role }}</div>
                                            @if(c.email) {
                                                <a [href]="'mailto:' + c.email" class="inline-flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline">
                                                    <i class="pi pi-envelope"></i> Kontaktieren
                                                </a>
                                            }
                                        </div>
                                    </div>
                                }
                            </div>
                        </div>
                        }

                        <!-- Groups Card -->
                        @if (workingGroups().length > 0) {
                        <div class="bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
                            <div class="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface-ground)]">
                                <h3 class="font-bold text-[var(--color-text)] flex items-center gap-2">
                                    <i class="pi pi-briefcase text-[var(--color-primary)]"></i> Arbeitsgruppen
                                </h3>
                            </div>
                            <div class="p-2 space-y-1">
                                @for (wg of workingGroups(); track wg.id) {
                                    <div (click)="navigateToLogin()" class="p-3 rounded-lg hover:bg-[var(--color-surface-ground)] cursor-pointer transition-colors group">
                                        <div class="flex items-center justify-between">
                                            <span class="text-sm font-bold text-[var(--color-text)]">{{ wg.name }}</span>
                                            <i class="pi pi-lock text-[10px] text-[var(--color-text-muted)] opacity-50"></i>
                                        </div>
                                        @if(wg.description) {
                                            <p class="text-xs text-[var(--color-text-muted)] line-clamp-1 mt-0.5">{{ wg.description }}</p>
                                        }
                                    </div>
                                }
                            </div>
                        </div>
                        }

                        <!-- Location / Info Placeholder -->
                        <div class="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 text-white text-center shadow-lg relative overflow-hidden">
                            <div class="absolute top-0 right-0 p-4 opacity-10">
                                <i class="pi pi-map text-6xl"></i>
                            </div>
                            <h3 class="font-bold text-lg mb-2 relative z-10">Wo du uns findest</h3>
                             <p class="text-sm text-gray-300 mb-4 relative z-10">
                                Wir treffen uns regelmäßig in unserem Vereinsheim oder online. Melde dich im internen Bereich an für Details.
                            </p>
                        </div>
                        
                        <!-- Legal Footer Links -->


                    </div>
                </div>
            </main>

            <!-- Footer with Theme Toggle -->
            <footer class="mt-auto border-t border-[var(--color-border)] py-6 bg-[var(--color-surface-card)] relative z-10 transition-colors">
                <div class="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
                    
                    <!-- Powered By -->
                    <a routerLink="/" class="group flex items-center gap-2 opacity-60 hover:opacity-100 transition-opacity">
                        <span class="text-xs font-medium text-[var(--color-text-muted)]">Powered by</span>
                        <span class="font-bold text-sm text-[var(--color-text)] group-hover:text-[var(--color-primary)] transition-colors">PulseDeck</span>
                    </a>

                    <!-- Legal & Theme -->
                    <div class="flex flex-wrap justify-center items-center gap-6 text-xs text-[var(--color-text-muted)]">
                        <a routerLink="/impressum" class="hover:underline">Impressum</a>
                        <a routerLink="/datenschutz" class="hover:underline">Datenschutz</a>
                        
                        <!-- Theme Toggle -->
                        <button (click)="toggleTheme()" class="flex items-center gap-2 hover:text-[var(--color-text)] transition-colors ml-4 pl-4 border-l border-[var(--color-border)] cursor-pointer">
                            @if(isDarkMode()) {
                                <i class="pi pi-sun text-yellow-500"></i> <span>Light Mode</span>
                            } @else {
                                <i class="pi pi-moon text-[var(--color-primary)]"></i> <span>Dark Mode</span>
                            }
                        </button>
                    </div>
                </div>
            </footer>

            <!-- Dialog for Wiki -->
            <p-dialog 
                [header]="selectedArticle()?.title || ''" 
                [(visible)]="articleDialogVisible" 
                [modal]="true" 
                [style]="{width: '90vw', maxWidth: '800px', maxHeight: '90vh'}" 
                [dismissableMask]="true"
                [draggable]="false"
                [resizable]="false"
                styleClass="glass-dialog">
                
                @if (selectedArticle()) {
                    <div class="p-4">
                        <app-rich-text-renderer [content]="selectedArticle()!.content || ''"></app-rich-text-renderer>
                    </div>
                }
            </p-dialog>
            
            <!-- Dialog for Events -->
            <p-dialog 
                [header]="selectedEvent()?.title || ''" 
                [(visible)]="eventDialogVisible" 
                [modal]="true" 
                [style]="{width: '90vw', maxWidth: '600px', maxHeight: '90vh'}" 
                [dismissableMask]="true"
                [draggable]="false"
                [resizable]="false"
                styleClass="glass-dialog">
                
                @if (selectedEvent()) {
                    <div class="p-4 space-y-6">
                        <div class="flex flex-wrap gap-4 text-sm text-[var(--color-text-muted)] bg-[var(--color-surface-ground)] p-4 rounded-xl border border-[var(--color-border)]">
                            <div class="flex items-center gap-2">
                                <i class="pi pi-calendar text-[var(--color-primary)]"></i>
                                <span>{{ formatDate(selectedEvent()!.date) }}</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <i class="pi pi-clock text-[var(--color-primary)]"></i>
                                <span>{{ selectedEvent()!.start_time }} Uhr @if(selectedEvent()!.end_time){ bis {{ selectedEvent()!.end_time }} Uhr }</span>
                            </div>
                            @if(selectedEvent()!.location) {
                            <div class="flex items-center gap-2">
                                <i class="pi pi-map-marker text-[var(--color-primary)]"></i>
                                <span>{{ selectedEvent()!.location }}</span>
                            </div>
                            }
                        </div>

                        @if (selectedEvent()!.description) {
                            <div class="space-y-2">
                                <h4 class="font-bold text-[var(--color-text)]">Beschreibung</h4>
                                <app-rich-text-renderer [content]="selectedEvent()!.description || ''"></app-rich-text-renderer>
                            </div>
                        } @else {
                            <p class="text-[var(--color-text-muted)] italic">Keine weitere Beschreibung vorhanden.</p>
                        }

                        <div class="pt-4 border-t border-[var(--color-border)]">
                            <p-button (click)="navigateToLogin()" label="Anmelden / Mitmachen" icon="pi pi-sign-in" [raised]="true" styleClass="w-full" />
                        </div>
                    </div>
                }
            </p-dialog>
            
            }
        </div>
    `,
})
export class OrgPublicPageComponent implements OnInit {
    private supabase = inject(SupabaseService);
    private auth = inject(AuthService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);

    slug = signal<string>('');
    org = signal<Organization | null>(null);
    loading = signal(true);

    memberCount = signal(0);
    upcomingEvents = signal<PublicEvent[]>([]);
    wikiArticles = signal<PublicWikiArticle[]>([]);
    feedItems = signal<PublicFeedItem[]>([]);
    workingGroups = signal<WorkingGroup[]>([]);
    contacts = signal<ContactPerson[]>([]);

    // Theme
    isDarkMode = signal(true);
    private document = inject(DOCUMENT);

    // Event Dialog
    selectedEvent = signal<PublicEvent | null>(null);
    eventDialogVisible = false;

    // Article Dialog
    selectedArticle = signal<PublicWikiArticle | null>(null);
    articleDialogVisible = false;

    currentYear = new Date().getFullYear();

    get primaryColor(): string {
        return this.org()?.primary_color || '#e3000f';
    }

    async ngOnInit(): Promise<void> {
        // Initialize Theme (Default Dark)
        const savedTheme = localStorage.getItem('pulsedeck-theme');
        const prefersDark = savedTheme === 'dark' || (!savedTheme && true); // Default to true (Dark) if not set
        this.isDarkMode.set(prefersDark);
        this.updateTheme();

        const slug = this.route.snapshot.paramMap.get('slug');
        if (!slug) {
            this.loading.set(false);
            return;
        }

        this.slug.set(slug);

        // Wait for auth to be ready before checking login status
        await this.waitForAuthReady();

        // If user is logged in, redirect directly to dashboard
        if (this.auth.isLoggedIn()) {
            this.router.navigate(['/', slug, 'dashboard']);
            return;
        }

        await this.loadOrganization(slug);
    }

    private waitForAuthReady(): Promise<void> {
        return new Promise((resolve) => {
            if (this.supabase.authReady()) {
                resolve();
                return;
            }
            // Poll until ready (max 2 seconds)
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                if (this.supabase.authReady() || attempts > 20) {
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
        });
    }

    async loadOrganization(slug: string): Promise<void> {
        this.loading.set(true);

        const { data: org } = await this.supabase.client
            .from('organizations')
            .select('*')
            .eq('slug', slug)
            .single();

        if (!org) {
            this.loading.set(false);
            return;
        }

        this.org.set(org as Organization);

        // Load all public data in parallel
        await Promise.all([
            this.loadMemberCount(org.id),
            this.loadUpcomingEvents(org.id),
            this.loadWikiArticles(org.id),
            this.loadFeedItems(org.id),
            this.loadWorkingGroups(org.id),
            this.loadContacts(org.id),
        ]);

        this.loading.set(false);
    }

    private async loadMemberCount(orgId: string): Promise<void> {
        const { count } = await this.supabase.client
            .from('members')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId);

        this.memberCount.set(count ?? 0);
    }

    private async loadUpcomingEvents(orgId: string): Promise<void> {
        const today = new Date().toISOString().split('T')[0];

        const { data } = await this.supabase.client
            .from('events')
            .select('id, title, date, start_time, end_time, location, description')
            .eq('organization_id', orgId)
            .gte('date', today)
            .order('date', { ascending: true })
            .limit(6);

        this.upcomingEvents.set((data as PublicEvent[]) || []);
    }

    private async loadWikiArticles(orgId: string): Promise<void> {
        const { data } = await this.supabase.client
            .from('wiki_docs')
            .select('id, title, content, wiki_categories!inner(name)')
            .eq('organization_id', orgId)
            .eq('status', 'Published')
            .eq('allowed_roles', '{public}')
            .is('working_group_id', null)
            .order('title', { ascending: true })
            .limit(6);

        const articles = (data || []).map((d: any) => ({
            id: d.id,
            title: d.title,
            content: d.content,
            category: d.wiki_categories?.name || 'Allgemein'
        }));
        this.wikiArticles.set(articles);
    }

    private async loadFeedItems(orgId: string): Promise<void> {
        const { data } = await this.supabase.client
            .from('feed_items')
            .select('id, title, content, created_at')
            .eq('organization_id', orgId)
            .eq('is_public', true)
            .in('status', ['approved', 'sent'])
            .order('created_at', { ascending: false })
            .limit(50);

        this.feedItems.set((data as PublicFeedItem[]) || []);
    }

    private async loadWorkingGroups(orgId: string): Promise<void> {
        const { data } = await this.supabase.client
            .from('working_groups')
            .select('id, name, description')
            .eq('organization_id', orgId)
            .order('name', { ascending: true });

        this.workingGroups.set((data as WorkingGroup[]) || []);
    }

    private async loadContacts(orgId: string): Promise<void> {
        const { data } = await this.supabase.client
            .from('contacts')
            .select('id, name, role, email, phone, image_url')
            .eq('organization_id', orgId)
            .order('name', { ascending: true })
            .limit(5);

        this.contacts.set((data as ContactPerson[]) || []);
    }

    navigateToLogin() {
        this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
    }

    formatMonth(dateStr: string): string {
        const date = new Date(dateStr);
        return date.toLocaleDateString('de-DE', { month: 'short' }).toUpperCase();
    }

    formatDayShort(dateStr: string): string {
        const date = new Date(dateStr);
        return date.getDate().toString();
    }

    formatDay(dateStr: string): string {
        const date = new Date(dateStr);
        return date.getDate().toString();
    }

    formatDate(dateStr: string): string {
        const date = new Date(dateStr);
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
    }

    stripHtml(html: string): string {
        const tmp = document.createElement("DIV");
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || "";
    }

    openEvent(event: PublicEvent) {
        this.selectedEvent.set(event);
        this.eventDialogVisible = true;
    }

    openArticle(doc: PublicWikiArticle) {
        this.selectedArticle.set(doc);
        this.articleDialogVisible = true;
    }

    toggleTheme() {
        this.isDarkMode.update(d => !d);
        localStorage.setItem('pulsedeck-theme', this.isDarkMode() ? 'dark' : 'light');
        this.updateTheme();
    }

    private updateTheme() {
        if (this.isDarkMode()) {
            this.document.documentElement.classList.add('dark');
            this.document.documentElement.classList.remove('light');
        } else {
            this.document.documentElement.classList.add('light');
            this.document.documentElement.classList.remove('dark');
        }
    }
}
