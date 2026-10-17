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
import { ApiService } from '../../core/api.service';
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

  private api = inject(ApiService);
  private auth = inject(AuthService);
  private orgService = inject(OrganizationService);
  chatbotService = inject(ChatbotService);

  upcomingEvents = signal<any[]>([]);
  upcomingBirthdays = signal<BirthdayMember[]>([]);
  tasks = signal<Task[]>([]);
  isLoggedIn = computed(() => this.auth.isLoggedIn());
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
    let data: any[] | null = null;
    try {
      // Der Server liefert nur Termine, die der Nutzer sehen darf (nach Datum und Uhrzeit sortiert)
      data = (await this.api.get<any[]>(`/orgs/${orgId}/events`)).filter((e) => e.date >= today).slice(0, 20);
    } catch {
      data = null;
    }

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

    try {
      // Der Server liefert nur Geburtstage der nächsten sieben Tage, ohne Geburtsjahr
      const liste = await this.api.get<Array<{ id: string; name: string; avatar_url?: string; birthday: string; days_until: number }>>(`/orgs/${orgId}/birthdays`);
      const heute = new Date();
      this.upcomingBirthdays.set(
        liste.map((b) => {
          const [tag, monat] = b.birthday.split('.').map((x) => parseInt(x, 10));
          const ziel = new Date(heute.getFullYear(), monat - 1, tag);
          return {
            id: b.id,
            name: b.name,
            avatar_url: b.avatar_url,
            birthday: b.birthday,
            isToday: b.days_until === 0,
            daysUntil: b.days_until,
            formattedDate: ziel.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }),
          } as BirthdayMember;
        })
      );
    } catch {
      this.upcomingBirthdays.set([]);
    }
  }

  getBirthdayLabel(birthday: BirthdayMember): string {
    if (birthday.isToday) return 'Heute';
    if (birthday.daysUntil === 1) return 'Morgen';
    return birthday.formattedDate;
  }

  private async fetchTasks() {
    const orgId = this.orgService.currentOrgId();
    if (!orgId || !this.memberId()) return;
    try {
      this.tasks.set(await this.api.get<Task[]>(`/orgs/${orgId}/tasks`));
    } catch (error) {
      console.error('Error fetching tasks:', error);
    }
  }

  async toggleTask(task: Task) {
    const orgId = this.orgService.currentOrgId();
    const newDone = !task.done;

    this.tasks.update(tasks =>
      tasks.map(t => (t.id === task.id ? { ...t, done: newDone } : t))
    );

    try {
      await this.api.patch(`/orgs/${orgId}/tasks/${task.id}`, { done: newDone });
    } catch {
      this.tasks.update(tasks => tasks.map(t => (t.id === task.id ? { ...t, done: task.done } : t)));
    }
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
    const orgId = this.orgService.currentOrgId();
    const title = this.newTaskTitle().trim();
    if (!orgId || !this.memberId() || !title) return;

    this.addingTask.set(true);

    try {
      const neu = await this.api.post<Task>(`/orgs/${orgId}/tasks`, { title });
      this.tasks.update(tasks => [neu, ...tasks]);
    } catch (error) {
      console.error('Error creating task:', error);
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
    const orgId = this.orgService.currentOrgId();
    this.tasks.update(tasks => tasks.filter(t => t.id !== task.id));
    try {
      await this.api.delete(`/orgs/${orgId}/tasks/${task.id}`);
    } catch {
      this.tasks.update(tasks => [task, ...tasks]);
    }
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

  async clearChat() {
    if (!confirm('Den gespeicherten Chat-Verlauf in dieser Organisation endgültig löschen?')) return;
    try {
      await this.chatbotService.clearHistory();
    } catch (error) {
      console.error('Chat-Verlauf konnte nicht gelöscht werden:', error);
    }
  }

  parseMarkdown(content: string): string {
    if (!content) return '';
    try {
      // Remove <suggestions> block from display
      const displayContent = content.replace(/<suggestions>[\s\S]*?<\/suggestions>/i, '').trim();
      return marked.parse(displayContent, { async: false }) as string;
    } catch {
      return content;
    }
  }

  parseMarkdownInline(content: string): string {
    if (!content) return '';
    try {
      return marked.parseInline(content, { async: false }) as string;
    } catch {
      return content;
    }
  }

  extractSuggestions(content: string): string[] {
    const match = content.match(/<suggestions>([\s\S]*?)<\/suggestions>/i);
    if (!match) return [];
    
    return match[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('-'))
      .map(line => line.substring(1).trim())
      .filter(line => line.length > 0)
      .slice(0, 4); // max 4 suggestions
  }
}
