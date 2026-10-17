import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';
import { EventsService } from '../../../shared/services/events.service';
import { AuthService } from '../../../shared/services/auth.service';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { CardModule } from 'primeng/card';

@Component({
    selector: 'app-event-details',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        ButtonModule,
        ProgressSpinnerModule,
        CardModule,
        DatePipe
    ],
    templateUrl: './event-details.component.html'
})
export class EventDetailsComponent implements OnInit {
    /** Produktseite; liegt auf der Website. */
    readonly websiteUrl = environment.websiteUrl;
    private route = inject(ActivatedRoute);
    private eventsService = inject(EventsService);
    private auth = inject(AuthService);
    private titleService = inject(Title);
    private metaService = inject(Meta);

    event = signal<any>(null);
    loading = signal(true);
    error = signal<string | null>(null);

    /** Check if user is authenticated */
    isLoggedIn = this.auth.isLoggedIn;

    ngOnInit() {
        const id = this.route.snapshot.paramMap.get('id');
        if (id) {
            this.loadEvent(id);
        } else {
            this.error.set('Ungültiger Link');
            this.loading.set(false);
        }
    }

    async loadEvent(id: string) {
        try {
            console.log('[EventDetails] Loading event with ID:', id);
            const data = await this.eventsService.getEventById(id);
            console.log('[EventDetails] Event data loaded:', data);
            this.event.set(data);

            // Set Meta Tags for Social Sharing
            this.titleService.setTitle(
                `${data.title} - ${data.organization?.name || 'PulseDeck'}`
            );
            this.metaService.updateTag({
                name: 'description',
                content: data.description || 'Event Details'
            });
            this.metaService.updateTag({
                property: 'og:title',
                content: data.title
            });
            this.metaService.updateTag({
                property: 'og:description',
                content: data.description ||
                    `Event am ${data.date} in ${data.location}`
            });
        } catch (e: any) {
            console.error('[EventDetails] Error loading event:', e);
            console.error('[EventDetails] Error message:', e.message);
            this.error.set(`Event nicht gefunden oder kein Zugriff. (${e.message})`);
        } finally {
            this.loading.set(false);
        }
    }
}
