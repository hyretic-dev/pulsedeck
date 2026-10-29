import { Injectable, computed, inject, signal } from '@angular/core';

import { darfAnfragen, type BookingEntry, type BookingPlan } from '../../../../shared/booking/booking.models';
import { PLACE_RESERVATION_REPOSITORY } from '../domain/place-reservation.repository';

/** Zustand der Ortsreservierung im Termin-Dialog: Orte, gewählter Plan und die Belegung des Tages. */
@Injectable()
export class PlaceReservationService {
    private readonly repo = inject(PLACE_RESERVATION_REPOSITORY);

    private readonly allePlaetze = signal<BookingPlan[]>([]);
    readonly planId = signal<string | null>(null);
    readonly eintraege = signal<BookingEntry[]>([]);
    readonly fehler = signal<string | null>(null);

    /** Orte, in denen die Person anfragen darf (Rolle im Plan oder „alle Mitglieder“). */
    readonly orte = computed(() => this.allePlaetze().filter(darfAnfragen));
    readonly plan = computed(() => this.allePlaetze().find((p) => p.id === this.planId()) ?? null);

    /** Plan des Termins, auch wenn man dort nicht anfragen darf (für den Hinweis bei gesperrter Zeit). */
    planMitId(id: string | null): BookingPlan | null {
        return this.allePlaetze().find((p) => p.id === id) ?? null;
    }

    async ladeOrte(): Promise<void> {
        try {
            this.allePlaetze.set(await this.repo.orte());
            this.fehler.set(null);
        } catch (fehler) {
            this.allePlaetze.set([]);
            this.fehler.set((fehler as Error).message);
        }
    }

    /** Wählt den Plan (oder null) und lädt die Belegung des Tages. */
    async waehle(planId: string | null, tag: string | null): Promise<void> {
        this.planId.set(planId);
        await this.ladeTag(tag);
    }

    async ladeTag(tag: string | null): Promise<void> {
        const planId = this.planId();
        if (!planId || !tag) {
            this.eintraege.set([]);
            return;
        }
        try {
            const eintraege = await this.repo.eintraegeAmTag(planId, tag);
            // eine inzwischen gewählte andere Auswahl nicht überschreiben
            if (this.planId() === planId) this.eintraege.set(eintraege);
        } catch (fehler) {
            this.eintraege.set([]);
            this.fehler.set((fehler as Error).message);
        }
    }
}
