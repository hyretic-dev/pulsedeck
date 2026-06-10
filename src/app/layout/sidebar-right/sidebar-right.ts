import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  ViewChild,
  AfterViewChecked,
  DestroyRef,
  PLATFORM_ID
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { SupabaseService } from '../../shared/services/supabase';
import { AuthService } from '../../shared/services/auth.service';
import { OrganizationService } from '../../shared/services/organization.service';
import { ChatbotService } from '../../shared/services/chatbot.service';
import { marked } from 'marked';
import { Member } from '../../shared/models/member.model';

interface Task {
  id: string;
  title: string;
  done: boolean;
}

interface BirthdayMember {
  id: string;
  name: string;
  avatar_url?: string;
  birthday: string;
  isToday: boolean;
  daysUntil: number;
  formattedDate: string;
}

@Component({
  selector: 'app-sidebar-right',
  imports: [RouterLink, FormsModule, InputTextModule, ButtonModule],
  templateUrl: './sidebar-right.html',
  styleUrl: './sidebar-right.css',
  standalone: true,
  host: { class: 'flex-1 flex flex-col min-h-0' }
})
export class SidebarRight implements OnInit, AfterViewChecked {
  @ViewChild('newTaskInput') newTaskInput!: ElementRef<HTMLInputElement>;
  @ViewChild('chatScrollContainer') chatScrollContainer!: ElementRef;

  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);
  private orgService = inject(OrganizationService);
  chatbotService = inject(ChatbotService);

  upcomingEvents = signal<any[]>([]);
  upcomingBirthdays = signal<BirthdayMember[]>([]);
  tasks = signal<Task[]>([]);
  isLoggedIn = computed(() => !!this.supabase.user());
  private memberId = signal<string | null>(null);

  // Dynamic suggestions for the latest assistant message
  latestSuggestions = computed(() => {
    const msgs = this.chatbotService.messages();
    if (msgs.length === 0) return [];
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.role !== 'assistant' || this.chatbotService.isLoading()) return [];
    
    return this.extractSuggestions(lastMsg.content);
  });

  // Inline add task
  showAddInput = signal(false);
  newTaskTitle = signal('');
  addingTask = signal(false);

  chatNewMessage = '';
  quickReplies = [
    'Wie trage ich mich in eine AG ein?',
    'Zeige mir anstehende Termine',
    'Wie geht mein Onboarding weiter?'
  ];

  constructor() {
    const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
    if (isBrowser) {
      const mediaQuery = window.matchMedia('(min-width: 1280px)');
      const update = () => {
        this.chatbotService.isDesktopSidebarVisible.set(mediaQuery.matches);
      };
      update();
      mediaQuery.addEventListener('change', update);
      
      inject(DestroyRef).onDestroy(() => {
        this.chatbotService.isDesktopSidebarVisible.set(false);
      });
    }

    // Re-fetch tasks when current member changes
    effect(() => {
      const member = this.auth.currentMember();
      if (member?.id) {
        this.memberId.set(member.id);
        this.fetchTasks();
      } else {
        this.tasks.set([]);
        this.memberId.set(null);
      }
    });

    // Re-fetch org data when organization changes
    effect(() => {
      const orgId = this.orgService.currentOrgId();
      if (orgId) {
        this.fetchUpcoming();
        this.fetchBirthdays();
      } else {
        this.upcomingEvents.set([]);
        this.upcomingBirthdays.set([]);
      }
    });
  }

  ngOnInit() {
    // Initial fetch handled by effect
  }

  async fetchUpcoming() {
    const orgId = this.orgService.currentOrgId();
    if (!orgId) return;

    const today = new Date().toISOString().split('T')[0];
    const { data } = await this.supabase
      .from('events')
      .select('*')
      .eq('organization_id', orgId)
      .gte('date', today)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(20);

    if (data) {
      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();

      const events = data
        .filter(evt => {
          if (evt.date !== today) return true;

          // Check time for today's events
          const timeStr = evt.end_time || evt.start_time;
          if (!timeStr) return true;

          const [h, m] = timeStr.split(':').map((x: string) => parseInt(x, 10));
          // Filter out if end time (or start time) is in the past
          if (h < currentHours || (h === currentHours && m < currentMinutes)) {
            return false;
          }
          return true;
        })
        .map(evt => {
          const isToday = evt.date === today;
          const dateObj = new Date(evt.date);
          const formattedDate = dateObj.toLocaleDateString('de-DE', {
            day: '2-digit',
            month: 'short',
          });

          // Derive type from working_group_id
          const isAgEvent = !!evt.working_group_id;
          const color = isAgEvent ? 'teal' : 'linke';
          const icon = isAgEvent ? 'pi-users' : 'pi-flag';

          return {
            title: evt.title,
            date: isToday ? 'Heute' : formattedDate,
            time: evt.start_time,
            icon: icon,
            color: color,
          };
        });
      this.upcomingEvents.set(events.slice(0, 5));
    }
  }

  async fetchBirthdays() {
    const orgId = this.orgService.currentOrgId();
    if (!orgId) return;

    const { data } = await this.supabase
      .from('members')
      .select('id, name, avatar_url, birthday')
      .eq('organization_id', orgId)
      .not('birthday', 'is', null)
      .eq('status', 'Active');

    if (!data) {
      this.upcomingBirthdays.set([]);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const birthdays = data
      .map((member: any) => {
        const birthdayInfo = this.parseBirthdayInfo(
          member.birthday,
          today
        );
        if (!birthdayInfo) return null;

        return {
          id: member.id,
          name: member.name,
          avatar_url: member.avatar_url,
          birthday: member.birthday,
          isToday: birthdayInfo.isToday,
          daysUntil: birthdayInfo.daysUntil,
          formattedDate: birthdayInfo.formattedDate,
        } as BirthdayMember;
      })
      .filter((b): b is BirthdayMember => b !== null)
      .filter(b => b.daysUntil <= 7)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    this.upcomingBirthdays.set(birthdays.slice(0, 5));
  }

  private parseBirthdayInfo(
    birthdayStr: string,
    today: Date
  ): { isToday: boolean; daysUntil: number; formattedDate: string } | null {
    if (!birthdayStr) return null;

    // Parse German date format (dd.mm.yyyy or dd.mm.yy)
    const parts = birthdayStr.split('.');
    if (parts.length < 2) return null;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;

    if (isNaN(day) || isNaN(month)) return null;

    // Create this year's birthday
    const thisYearBirthday = new Date(
      today.getFullYear(),
      month,
      day
    );
    thisYearBirthday.setHours(0, 0, 0, 0);

    // If birthday already passed this year, use next year
    let targetBirthday = thisYearBirthday;
    if (thisYearBirthday < today) {
      targetBirthday = new Date(
        today.getFullYear() + 1,
        month,
        day
      );
    }

    const diffTime = targetBirthday.getTime() - today.getTime();
    const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const isToday = daysUntil === 0;

    const formattedDate = targetBirthday.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: 'short',
    });

    return { isToday, daysUntil, formattedDate };
  }

  getBirthdayLabel(birthday: BirthdayMember): string {
    if (birthday.isToday) return 'Heute';
    if (birthday.daysUntil === 1) return 'Morgen';
    return birthday.formattedDate;
  }

  private async fetchTasks() {
    const memId = this.memberId();
    if (!memId) return;

    const { data } = await this.supabase
      .from('user_tasks')
      .select('id, title, done')
      .eq('member_id', memId)
      .order('created_at', { ascending: false });

    if (data) {
      this.tasks.set(data as Task[]);
    }
  }

  async toggleTask(task: Task) {
    const newDone = !task.done;

    this.tasks.update(tasks =>
      tasks.map(t => (t.id === task.id ? { ...t, done: newDone } : t))
    );

    await this.supabase
      .from('user_tasks')
      .update({ done: newDone, updated_at: new Date().toISOString() })
      .eq('id', task.id);
  }

  openAddInput() {
    this.showAddInput.set(true);
    this.newTaskTitle.set('');
    setTimeout(() => this.newTaskInput?.nativeElement?.focus(), 0);
  }

  cancelAdd() {
    this.showAddInput.set(false);
    this.newTaskTitle.set('');
  }

  async submitTask() {
    const memId = this.memberId();
    const title = this.newTaskTitle().trim();
    if (!memId || !title) return;

    this.addingTask.set(true);

    const { data } = await this.supabase
      .from('user_tasks')
      .insert({ member_id: memId, title, done: false })
      .select('id, title, done')
      .single();

    if (data) {
      this.tasks.update(tasks => [data as Task, ...tasks]);
    }

    this.addingTask.set(false);
    this.showAddInput.set(false);
    this.newTaskTitle.set('');
  }

  onInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.submitTask();
    } else if (event.key === 'Escape') {
      this.cancelAdd();
    }
  }

  async deleteTask(task: Task) {
    this.tasks.update(tasks => tasks.filter(t => t.id !== task.id));
    await this.supabase.from('user_tasks').delete().eq('id', task.id);
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  scrollToBottom(): void {
    if (!this.chatScrollContainer) return;
    try {
      const el = this.chatScrollContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    } catch (err) { }
  }

  sendChatMessage() {
    const text = this.chatNewMessage.trim();
    if (!text) return;
    this.chatbotService.sendMessage(text);
    this.chatNewMessage = '';
  }

  sendQuickReply(reply: string) {
    this.chatbotService.sendMessage(reply);
  }

  clearChat() {
    this.chatbotService.sessionId.set(null);
    this.chatbotService.messages.set([
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          'Hallo! Ich bin dein PulseDeck Onboarding-Assistent. ' +
          'Wie kann ich dir helfen?'
      }
    ]);
  }

  parseMarkdown(content: string): string {
    if (!content) return '';
    try {
      // Remove SUGGESTIONS block from display
      const displayContent = content.split('SUGGESTIONS:')[0].trim();
      return marked.parse(displayContent, { async: false }) as string;
    } catch {
      return content;
    }
  }

  extractSuggestions(content: string): string[] {
    if (!content.includes('SUGGESTIONS:')) return [];
    const suggestionsPart = content.split('SUGGESTIONS:')[1];
    if (!suggestionsPart) return [];
    
    return suggestionsPart
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('-'))
      .map(line => line.substring(1).trim())
      .filter(line => line.length > 0)
      .slice(0, 4); // max 4 suggestions
  }
}
