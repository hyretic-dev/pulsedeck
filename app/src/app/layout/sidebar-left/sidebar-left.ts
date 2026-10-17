import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService, UserMembership } from '../../shared/services/auth.service';
import { ThemeService } from '../../shared/services/theme.service';
import { OrganizationService } from '../../shared/services/organization.service';

@Component({
  selector: 'app-sidebar-left',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './sidebar-left.html',
  styleUrl: './sidebar-left.css',
})
export class SidebarLeft {
  public auth = inject(AuthService);
  public theme = inject(ThemeService);
  public orgService = inject(OrganizationService);
  private router = inject(Router);

  showOrgSwitcher = signal(false);

  toggleOrgSwitcher(): void {
    this.showOrgSwitcher.update(v => !v);
  }

  async switchOrganization(membership: UserMembership): Promise<void> {
    this.showOrgSwitcher.set(false);
    await this.auth.setActiveOrganization(membership.organizationId);
    this.router.navigate(['/', membership.organizationSlug, 'dashboard']);
  }

  getRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      'admin': 'Admin',
      'committee': 'Vorstand',
      'member': 'Mitglied',
      'public': 'Gast'
    };
    return labels[role] || role;
  }

  get isJulien(): boolean {
    return this.auth.user()?.id === '2d8af6a7-507c-4834-aff9-3b00d1ad9c7c';
  }
}
