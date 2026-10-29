import { Injectable, computed, inject, signal } from '@angular/core';

import { berlinUhr } from '../../../../shared/booking/zeitraum';
import type { BookingEntry } from '../../../../shared/booking/booking.models';
import { PUBLIC_BOOKING_REPOSITORY, type PublicBookingPlan } from '../domain/public-booking.repository';

export type Ansicht = 'jahr' | 'monat';

/** Zustand der öffentlichen Belegungsansicht: Pläne, Zeitraum und Einträge. Ohne öffentliche Pläne bleibt alles leer. */
@Injectable()
export class PublicBookingStore {
    private readonly repo = inject(PUBLIC_BOOKING_REPOSITORY);
    private slug = '';

    readonly plaene = signal<PublicBookingPlan[]>([]);
    readonly planId = signal<string | null>(null);
    readonly eintraege = signal<BookingEntry[]>([]);
    readonly ansicht = signal<Ansicht>('jahr');
    readonly jahr = signal(berlinUhr(new Date()).jahr);
    readonly monat = signal(berlinUhr(new Date()).monat);
    readonly fehler = signal(false);

    readonly plan = computed(() => this.plaene().find((p) => p.id === this.planId()) ?? null);

    async start(slug: string): Promise<void> {
        this.slug = slug;
        try {
            const plaene = await this.repo.plaene(slug);
            this.plaene.set(plaene);
            await this.waehle(plaene[0]?.id ?? null);
        } catch {
            // Keine Anzeige statt einer Fehlermeldung auf der öffentlichen Seite
            this.plaene.set([]);
            this.fehler.set(true);
        }
    }

    /** Wählt einen Plan; dessen Einstellung „Jahr“ oder „Monat“ ist die Startansicht. */
    async waehle(planId: string | null): Promise<void> {
        this.planId.set(planId);
        const plan = this.plan();
        if (plan) this.ansicht.set(plan.public_view === 'month' ? 'monat' : 'jahr');
        await this.laden();
    }

    private async laden(): Promise<void> {
        const id = this.planId();
        if (!id) {
            this.eintraege.set([]);
            return;
        }
        const j = this.jahr();
        try {
            // Jahr samt Rand, aber höchstens die 400 Tage, die der öffentliche Endpunkt erlaubt (Dezember davor bis Januar danach)
            const eintraege = await this.repo.eintraege(this.slug, id, `${j - 1}-12-15`, `${j + 1}-01-15`);
            if (this.planId() === id) this.eintraege.set(eintraege);
        } catch {
            this.eintraege.set([]);
        }
    }

    ansichtWaehlen(ansicht: Ansicht): void {
        this.ansicht.set(ansicht);
    }

    oeffneMonat(monat: number, jahr = this.jahr()): void {
        this.jahr.set(jahr);
        this.monat.set(monat);
        this.ansicht.set('monat');
    }

    async weiter(schritt: 1 | -1): Promise<void> {
        const altesJahr = this.jahr();
        if (this.ansicht() === 'jahr') {
            this.jahr.update((j) => j + schritt);
        } else {
            const m = this.monat() + schritt;
            this.monat.set(m < 1 ? 12 : m > 12 ? 1 : m);
            if (m < 1 || m > 12) this.jahr.update((j) => j + schritt);
        }
        if (this.jahr() !== altesJahr) await this.laden();
    }

    async heute(): Promise<void> {
        const h = berlinUhr(new Date());
        const altesJahr = this.jahr();
        this.jahr.set(h.jahr);
        this.monat.set(h.monat);
        if (altesJahr !== h.jahr) await this.laden();
    }
}
