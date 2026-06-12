import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AnalyticsService } from './shared/services/analytics.service';
import { PresenceTrackerService } from './shared/services/presence-tracker.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly title = signal('dashboard');
  private router = inject(Router);
  private analytics = inject(AnalyticsService);
  private presence = inject(PresenceTrackerService);

  ngOnInit() {
    // Check for Supabase auth redirects on the root path
    // Supabase often redirects with hash fragments like #access_token=... or #error=...
    if (window.location.hash && (
      window.location.hash.includes('access_token') ||
      window.location.hash.includes('type=invite') ||
      window.location.hash.includes('type=recovery') ||
      window.location.hash.includes('error_description') ||
      window.location.hash.includes('error_code')
    )) {
      // If we are at the root path, forward to auth/callback
      if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        console.log('Detected Supabase auth redirect on root, forwarding to /auth/callback');
        const fragment = window.location.hash.substring(1);
        this.router.navigate(['/auth/callback'], { fragment });
      }
    }
  }
}
