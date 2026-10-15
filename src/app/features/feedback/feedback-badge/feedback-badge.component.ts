import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../shared/services/auth.service';
import { ThemeService } from '../../../shared/services/theme.service';
import { OrganizationService } from '../../../shared/services/organization.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

@Component({
  selector: 'app-feedback-badge',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    ButtonModule,
    TextareaModule,
    ToastModule
  ],
  providers: [MessageService],
  templateUrl: './feedback-badge.component.html',
  styles: [`
    :host {
      z-index: 9999;
    }
    
    :host ::ng-deep .p-dialog {
      background: var(--color-surface-raised) !important;
      border: 1px solid var(--color-border) !important;
      border-radius: 1rem !important;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important;
    }
    
    :host ::ng-deep .p-dialog-header {
      background: transparent !important;
      border-bottom: 1px solid var(--color-border) !important;
      padding: 1.25rem 1.5rem !important;
    }
    
    :host ::ng-deep .p-dialog-title {
      color: var(--color-text) !important;
      font-weight: 700 !important;
      font-size: 1.25rem !important;
    }
    
    :host ::ng-deep .p-dialog-header-close {
      color: var(--color-text-muted) !important;
    }
    
    :host ::ng-deep .p-dialog-header-close:hover {
      color: var(--color-text) !important;
      background: var(--color-surface-overlay) !important;
    }
    
    :host ::ng-deep .p-dialog-content {
      background: transparent !important;
      padding: 1.5rem !important;
      color: var(--color-text) !important;
    }
  `]
})
export class FeedbackBadgeComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private messageService = inject(MessageService);
  private themeService = inject(ThemeService);
  private router = inject(Router);
  private org = inject(OrganizationService);

  /** Only show feedback badge to logged-in users */
  isLoggedIn = computed(() => this.auth.isLoggedIn());
  isDarkMode = this.themeService.isDark;

  visible = signal(false);
  loading = signal(false);

  // Form Data
  type = signal('suggestion');
  description = signal('');

  typeOptions = [
    { label: 'Vorschlag', value: 'suggestion' },
    { label: 'Fehlermeldung', value: 'bug' }
  ];

  isHovered = signal(false);

  toggleDialog() {
    this.visible.update(v => !v);
  }

  async submitFeedback() {
    if (!this.description().trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Pflichtfeld', detail: 'Bitte gib eine Beschreibung ein.' });
      return;
    }

    this.loading.set(true);

    try {
      // Die Organisation wird nur übernommen, wenn der Absender dort Mitglied ist (der Server prüft das)
      await this.api.post('/feedback', {
        type: this.type(),
        description: this.description(),
        ...(this.org.currentOrgId() ? { organization_id: this.org.currentOrgId() } : {}),
      });
      this.messageService.add({ key: 'feedback-toast', severity: 'success', summary: 'Gesendet', detail: 'Vielen Dank für dein Feedback!' });
      this.visible.set(false);
      this.description.set('');
      this.type.set('suggestion');
    } catch (error) {
      console.error('Feedback error:', error);
      this.messageService.add({ key: 'feedback-toast', severity: 'error', summary: 'Fehler', detail: 'Feedback konnte nicht gesendet werden.' });
    }
    this.loading.set(false);
  }

  onMouseEnter() {
    this.isHovered.set(true);
  }

  onMouseLeave() {
    this.isHovered.set(false);
  }

  navigateToRoadmap() {
    const slug = this.org.currentSlug();
    if (slug) {
      this.router.navigate(['/', slug, 'dashboard', 'roadmap']);
    } else {
      // Fallback: navigate to current URL + /roadmap (relative)
      this.router.navigate(['roadmap'], { relativeTo: null });
    }
  }
}
