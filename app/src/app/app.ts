import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AnalyticsService } from './shared/services/analytics.service';
import { OrgThemeService } from './shared/services/org-theme.service';
import { PresenceTrackerService } from './shared/services/presence-tracker.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('dashboard');
  private analytics = inject(AnalyticsService);
  private presence = inject(PresenceTrackerService);
  private orgTheme = inject(OrgThemeService);
}
