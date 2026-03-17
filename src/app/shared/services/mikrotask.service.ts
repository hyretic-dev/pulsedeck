import { Injectable, inject, signal, computed } from '@angular/core';
import { FeedService, FeedItem } from './feed.service';

import { SmartMatchingService } from './smart-matching.service';
import { NotificationService } from './notification.service';
import { AuthService } from './auth.service';

export interface Mikrotask {
  id: string;
  type: 'onboarding' | 'poll' | 'helper_slot' | 'notification' | 'profile';
  title: string;
  description: string;
  icon: string;
  link: string;
  priority: number;
}

@Injectable({
  providedIn: 'root',
})
export class MikrotaskService {
  private feedService = inject(FeedService);

  private smartMatchingService = inject(SmartMatchingService);
  private notificationService = inject(NotificationService);
  private auth = inject(AuthService);

  private _polls = signal<FeedItem[]>([]);
  
  readonly tasks = computed<Mikrotask[]>(() => {
    const tasks: Mikrotask[] = [];
    
    // 1. Unvoted Polls
    const unvotedPolls = this._polls().filter((p: FeedItem) => !this.hasVoted(p));
    unvotedPolls.forEach((poll: FeedItem) => {
      tasks.push({
        id: `poll-${poll.id}`,
        type: 'poll',
        title: 'Umfrage: ' + poll.title,
        description: 'Deine Meinung zählt! Nimm an der Umfrage teil.',
        icon: 'pi-chart-bar',
        link: 'feed',
        priority: 80
      });
    });

    // 2. Helper Slots (Smart Matching)
    const opportunities = this.smartMatchingService.opportunities();
    if (opportunities.length > 0) {
      tasks.push({
        id: 'helper-slots',
        type: 'helper_slot',
        title: 'Helfer gesucht!',
        description: `Es gibt ${opportunities.length} offene Schichten, die zu deinen Skills passen.`,
        icon: 'pi-star',
        link: 'calendar',
        priority: 90
      });
    }


    return tasks.sort((a, b) => b.priority - a.priority);
  });

  constructor() {
    this.refresh();
  }

  async refresh() {
    try {
      const polls = await this.feedService.getFeedItems();
      this._polls.set(polls.filter((p: FeedItem) => p.type === 'poll'));
    } catch (e) {
      console.error('Error refreshing mikrotasks:', e);
    }
  }

  private hasVoted(poll: FeedItem): boolean {
    const memberId = this.auth.currentMember()?.id;
    if (!memberId || !poll.poll_options) return false;
    return poll.poll_options.some(o => o.poll_votes?.some(v => v.member_id === memberId));
  }
}


