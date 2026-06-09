import { Component, inject, ViewChild, ElementRef, AfterViewChecked, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DrawerModule } from 'primeng/drawer';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ChatbotService } from '../../services/chatbot.service';
import { marked } from 'marked';

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DrawerModule,
    ButtonModule,
    InputTextModule
  ],
  templateUrl: './chatbot.component.html',
  styleUrl: './chatbot.component.css'
})
export class ChatbotComponent implements AfterViewChecked {
  chatbotService = inject(ChatbotService);
  
  @ViewChild('scrollMe') private myScrollContainer!: ElementRef;
  
  newMessage = signal('');
  quickReplies = [
    'Wie trage ich mich in eine AG ein?',
    'Zeige mir anstehende Termine',
    'Wie geht mein Onboarding weiter?'
  ];

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  scrollToBottom(): void {
    try {
      this.myScrollContainer.nativeElement.scrollTop = this.myScrollContainer.nativeElement.scrollHeight;
    } catch(err) { }
  }

  sendMessage() {
    const text = this.newMessage().trim();
    if (!text) return;
    
    this.chatbotService.sendMessage(text);
    this.newMessage.set('');
  }

  sendQuickReply(reply: string) {
    this.chatbotService.sendMessage(reply);
  }

  parseMarkdown(content: string): string {
    if (!content) return '';
    try {
      return marked.parse(content, { async: false }) as string;
    } catch {
      return content;
    }
  }
}
