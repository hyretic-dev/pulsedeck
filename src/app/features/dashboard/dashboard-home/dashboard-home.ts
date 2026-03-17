import { Component, inject, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { AuthService } from '../../../shared/services/auth.service';
import { WorkingGroupsService } from '../../../shared/services/working-groups.service';
import { EventsService } from '../../../shared/services/events.service';
import { OnboardingService } from '../../../shared/services/onboarding.service';
import { StatisticsService } from '../../../shared/services/statistics.service';
import { OrganizationService } from '../../../shared/services/organization.service';
import { SmartMatchingService } from '../../../shared/services/smart-matching.service';
import { CalendarEvent, getEventType } from '../../../shared/models/calendar-event.model';
import { WorkingGroup } from '../../../shared/models/working-group.model';
import { MikrotaskService } from '../../../shared/services/mikrotask.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { 
  GuestInvitationsCardComponent 
} from '../../../shared/components/guest-invitations-card.component';

@Component({
  selector: 'app-dashboard-home',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ProgressBarModule,
    TooltipModule,
    GuestInvitationsCardComponent,
  ],
  templateUrl: './dashboard-home.html',
  styleUrl: './dashboard-home.css',
})
export class DashboardHome implements OnInit {
  auth = inject(AuthService);
  workingGroupsService = inject(WorkingGroupsService);
  eventsService = inject(EventsService);
  onboardingService = inject(OnboardingService);
  statsService = inject(StatisticsService);
  orgService = inject(OrganizationService);
  smartMatchingService = inject(SmartMatchingService);
  mikrotaskService = inject(MikrotaskService);
  notificationService = inject(NotificationService);

  myWorkingGroups: WorkingGroup[] = [];
  myUpcomingEvents: CalendarEvent[] = [];
  isNewMember = false;

  private lastOrgId: string | null = null;

  constructor() {
    // React to organization changes - reload all data
    effect(() => {
      const currentOrgId = this.orgService.currentOrgId();
      if (currentOrgId && currentOrgId !== this.lastOrgId) {
        this.lastOrgId = currentOrgId;
        this.loadAllData();
      }
    });

    // React to membership changes
    effect(() => {
      const memberships = this.workingGroupsService.myMemberships();
      const groups = this.workingGroupsService.workingGroups();
      this.updateMyWorkingGroups(memberships, groups);
    });

    // React to events changes
    effect(() => {
      const events = this.eventsService.events();
      const memberships = this.workingGroupsService.myMemberships();
      this.updateMyUpcomingEvents(events, memberships);
    });

    // Check if new member (less than 30 days)
    effect(() => {
      const member = this.auth.currentMember();
      if (member?.join_date) {
        const joinDate = this.parseGermanDate(member.join_date);
        const daysSinceJoin = this.getDaysSince(joinDate);
        this.isNewMember = daysSinceJoin < 30;
      }
    });
  }

  async ngOnInit(): Promise<void> {
    await this.loadAllData();
  }

  private async loadAllData(): Promise<void> {
    await Promise.all([
      this.workingGroupsService.fetchWorkingGroups(),
      this.eventsService.fetchEvents(),
      this.statsService.fetchStats(),
    ]);

    const member = this.auth.currentMember();
    if (member?.id) {
      await this.workingGroupsService.fetchMyMemberships(member.id);
      await this.onboardingService.fetchProgress();
      await this.smartMatchingService.findMatchingOpportunities();
    }
  }

  private updateMyWorkingGroups(
    memberships: Set<string>,
    groups: WorkingGroup[]
  ): void {
    this.myWorkingGroups = groups.filter(g => g.id && memberships.has(g.id));
  }

  private updateMyUpcomingEvents(
    events: CalendarEvent[],
    memberships: Set<string>
  ): void {
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const localTodayStr = now.toISOString().split('T')[0];

    this.myUpcomingEvents = events
      .filter(e => {
        if (e.date < localTodayStr) return false;
        if (e.date === localTodayStr) {
          const timeStr = e.end_time || e.start_time;
          if (timeStr) {
            const [h, m] = timeStr.split(':').map((x: any) => parseInt(x, 10));
            if (h < currentHours || (h === currentHours && m < currentMinutes)) {
              return false;
            }
          }
        }
        if (!e.working_group_id) return true;
        return memberships.has(e.working_group_id);
      })
      .slice(0, 3);
  }

  private parseGermanDate(dateStr: string): Date {
    const parts = dateStr.split('.');
    if (parts.length === 3) {
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      return new Date(year, parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
    return new Date(dateStr);
  }

  private getDaysSince(date: Date): number {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  formatEventDate(dateStr: string): string {
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDate = new Date(date);
    eventDate.setHours(0, 0, 0, 0);

    if (eventDate.getTime() === today.getTime()) return 'Heute';
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (eventDate.getTime() === tomorrow.getTime()) return 'Morgen';

    return date.toLocaleDateString('de-DE', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    });
  }

  getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Guten Morgen';
    if (hour < 18) return 'Guten Tag';
    return 'Guten Abend';
  }

  getMemberSinceText(): string {
    const member = this.auth.currentMember();
    if (!member?.join_date) return '';
    const joinDate = this.parseGermanDate(member.join_date);
    const days = this.getDaysSince(joinDate);

    if (days < 7) return `Seit ${days} Tag${days === 1 ? '' : 'en'} dabei`;
    if (days < 30) {
      const weeks = Math.floor(days / 7);
      return `Seit ${weeks} Woche${weeks === 1 ? '' : 'n'} dabei`;
    }
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `Seit ${months} Monat${months === 1 ? '' : 'en'} dabei`;
    }
    const years = Math.floor(days / 365);
    return `Seit ${years} Jahr${years === 1 ? '' : 'en'} dabei`;
  }

  getEventIcon(event: CalendarEvent): string {
    const type = getEventType(event);
    return type === 'ag' ? 'pi-users' : 'pi-calendar';
  }

  getEventColor(event: CalendarEvent): string {
    const type = getEventType(event);
    return type === 'ag' ? 'teal' : 'linke';
  }

  getStepLink(stepKey: string): string {
    switch (stepKey) {
      case 'profile_complete': return 'profile';
      case 'joined_ag': return 'ags';
      case 'visited_wiki': return 'wiki';
      case 'enable_notifications': return '#enable-notifications';
      case 'added_task': return 'tasks';

      default: return '/dashboard';
    }
  }

  async handleMikrotask(task: any) {
    if (task.id === 'enable-notifications' || task.id === 'enable_notifications') {
      await this.notificationService.requestPermission();
    }
  }
}
