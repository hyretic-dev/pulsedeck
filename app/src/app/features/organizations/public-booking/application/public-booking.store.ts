import { Injectable, computed, inject, signal } from '@angular/core';

import { TagRef, berlinUhr, heuteBerlin, isoKalenderwoche, montagDerWoche, plusTage, wochenTage } from '../../../../shared/booking/zeitraum';
import type { BookingEntry } from '../../../../shared/booking/booking.models';
import { PUBLIC_BOOKING_REPOSITORY, type PublicBookingPlan } from '../domain/public-booking.repository';

export type Ansicht = 'jahr' | 'monat' | 'woche';

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
    /** Montag der angezeigten Woche; die Wochenansicht startet immer mit der laufenden Kalenderwoche. */
    readonly woche = signal<TagRef>(montagDerWoche(heuteBerlin()));
    readonly wochenTage = computed(() => wochenTage(this.woche()));
    readonly kalenderwoche = computed(() => isoKalenderwoche(this.woche()));

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
        if (plan) {
            this.ansicht.set(plan.public_view === 'week' ? 'woche' : plan.public_view === 'month' ? 'monat' : 'jahr');
            // Die Wochenansicht zeigt immer die laufende Kalenderwoche
            if (plan.public_view === 'week') await this.zeigeWoche(montagDerWoche(heuteBerlin()));
        }
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

    async ansichtWaehlen(ansicht: Ansicht): Promise<void> {
        this.ansicht.set(ansicht);
        if (ansicht === 'woche') await this.zeigeWoche(montagDerWoche(heuteBerlin()));
    }

    private async zeigeWoche(montag: TagRef): Promise<void> {
        this.woche.set(montag);
        const jahr = isoKalenderwoche(montag).jahr;
        if (jahr !== this.jahr()) {
            this.jahr.set(jahr);
            await this.laden();
        }
    }

    oeffneMonat(monat: number, jahr = this.jahr()): void {
        this.jahr.set(jahr);
        this.monat.set(monat);
        this.ansicht.set('monat');
    }

    async weiter(schritt: 1 | -1): Promise<void> {
        if (this.ansicht() === 'woche') {
            await this.zeigeWoche(plusTage(this.woche(), 7 * schritt));
            return;
        }
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
        this.monat.set(h.monat);
        if (this.ansicht() === 'woche') {
            await this.zeigeWoche(montagDerWoche(heuteBerlin()));
            return;
        }
        const altesJahr = this.jahr();
        this.jahr.set(h.jahr);
        if (altesJahr !== h.jahr) await this.laden();
    }
}
