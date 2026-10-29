import { Injectable, inject } from '@angular/core';

import { BeispielBelegungStore } from '../../../../shared/booking/booking-beispieldaten';
import type { BookingEntry, BookingPlan } from '../../../../shared/booking/booking.models';
import { datumsSchluessel, feiertageImJahr } from '../../../../shared/booking/feiertage';
import {
    berlinZeitpunkt, ueberschneiden, wochentag,
} from '../../../../shared/booking/zeitraum';
import type { BookingRepository, BuchungEingabe, SerieEingabe, SerienVorschau } from '../domain/booking.repository';

/** PROTOTYP: hält die Beispieldaten im Speicher. Entfällt mit der API-Anbindung (`ApiBookingRepository`). */
@Injectable()
export class InMemoryBookingRepository implements BookingRepository {
    private readonly daten = inject(BeispielBelegungStore);
    private zaehler = 0;

    async plaene(): Promise<BookingPlan[]> {
        return this.daten.plaene().map((p) => ({
            ...p,
            open_requests: this.daten.eintraegeVon(p.id).filter((e) => e.status === 'requested').length,
        }));
    }

    async eintraege(planId: string, von: Date, bis: Date): Promise<BookingEntry[]> {
        const zeitraum = { start_at: von.toISOString(), end_at: bis.toISOString() };
        return this.daten.eintraegeVon(planId).filter((e) => ueberschneiden(e, zeitraum));
    }

    async anfragen(planId: string, eingabe: BuchungEingabe): Promise<BookingEntry> {
        return this.lege(planId, eingabe, 'requested');
    }

    async eintragen(planId: string, eingabe: BuchungEingabe): Promise<BookingEntry> {
        return this.lege(planId, eingabe, 'approved');
    }

    private lege(planId: string, eingabe: BuchungEingabe, status: BookingEntry['status']): BookingEntry {
        const neu: BookingEntry = {
            ...eingabe, id: `neu-${++this.zaehler}`, plan_id: planId, status, requester_name: 'Du', is_mine: true,
            series_id: null, event_id: null, decision_reason: null,
        };
        this.daten.eintraege.update((alle) => [...alle, neu]);
        return neu;
    }

    async annehmen(eintragId: string): Promise<void> {
        const ziel = this.daten.eintraege().find((e) => e.id === eintragId);
        if (!ziel) return;
        this.daten.eintraege.update((alle) =>
            alle.map((e) => {
                if (e.id === eintragId) return { ...e, status: 'approved' };
                const ueberschneidet = e.plan_id === ziel.plan_id && e.status === 'requested' && ueberschneiden(e, ziel);
                return ueberschneidet ? { ...e, status: 'declined', decision_reason: 'Zeitraum anderweitig vergeben' } : e;
            }),
        );
    }

    async ablehnen(eintragId: string, grund: string | null): Promise<void> {
        this.daten.eintraege.update((alle) =>
            alle.map((e) => (e.id === eintragId ? { ...e, status: 'declined', decision_reason: grund } : e)),
        );
    }

    async zurueckziehen(eintragId: string): Promise<void> {
        this.daten.eintraege.update((alle) => alle.map((e) => (e.id === eintragId ? { ...e, status: 'cancelled' } : e)));
    }

    async loeschen(eintragId: string): Promise<void> {
        this.daten.eintraege.update((alle) => alle.filter((e) => e.id !== eintragId));
    }

    async serieVorschau(planId: string, serie: SerieEingabe): Promise<SerienVorschau> {
        const plan = this.daten.plaene().find((p) => p.id === planId);
        const vorhanden = this.daten.eintraegeVon(planId);
        const vorschau: SerienVorschau = { dates: [], skipped_booked: [], skipped_holidays: [], declined_requests: [] };
        if (!plan || serie.hour_to <= serie.hour_from || !serie.weekdays.length) return vorschau;
        for (const datum of tageDerSerie(serie)) {
            const [j, m, t] = datum.split('-').map(Number);
            if (serie.skip_holidays && feiertageImJahr(j, plan.state).has(datum)) {
                vorschau.skipped_holidays.push(datum);
                continue;
            }
            const zeitraum = {
                start_at: berlinZeitpunkt(j, m, t, serie.hour_from).toISOString(),
                end_at: berlinZeitpunkt(j, m, t, serie.hour_to).toISOString(),
            };
            const treffer = vorhanden.filter((e) => ueberschneiden(e, zeitraum));
            if (treffer.some((e) => e.status === 'approved')) {
                vorschau.skipped_booked.push(datum);
                continue;
            }
            vorschau.dates.push(datum);
            for (const offen of treffer) if (!vorschau.declined_requests.includes(offen)) vorschau.declined_requests.push(offen);
        }
        return vorschau;
    }

    async serieAnlegen(planId: string, serie: SerieEingabe): Promise<number> {
        const vorschau = await this.serieVorschau(planId, serie);
        const serienId = `serie-neu-${++this.zaehler}`;
        const abgelehnt = new Set(vorschau.declined_requests.map((e) => e.id));
        const neue = vorschau.dates.map((datum): BookingEntry => {
            const [j, m, t] = datum.split('-').map(Number);
            return {
                id: `neu-${++this.zaehler}`, plan_id: planId, title: serie.title, note: serie.note,
                start_at: berlinZeitpunkt(j, m, t, serie.hour_from).toISOString(),
                end_at: berlinZeitpunkt(j, m, t, serie.hour_to).toISOString(),
                status: 'approved', is_public: serie.is_public, requester_name: 'Du', is_mine: true,
                series_id: serienId, event_id: null, decision_reason: null,
            };
        });
        this.daten.eintraege.update((alle) => [
            ...alle.map((e) => (abgelehnt.has(e.id) ? { ...e, status: 'declined' as const, decision_reason: 'Zeitraum anderweitig vergeben' } : e)),
            ...neue,
        ]);
        return neue.length;
    }
}

const TAG = 86400000;

/** Montag-basierte Wochennummer seit 1970 (der 1.1.1970 war ein Donnerstag). */
function wochenIndex(ms: number): number {
    return Math.floor((ms / TAG + 3) / 7);
}

/** Alle Berliner Daten (`JJJJ-MM-TT`) der Serie im Gültigkeitszeitraum, nach Wochentag und Rhythmus. */
export function tageDerSerie(serie: SerieEingabe): string[] {
    const [vj, vm, vt] = serie.valid_from.split('-').map(Number);
    const [bj, bm, bt] = serie.valid_to.split('-').map(Number);
    const start = Date.UTC(vj, vm - 1, vt);
    const ende = Date.UTC(bj, bm - 1, bt);
    const tage: string[] = [];
    // Der Rhythmus zählt ab der Woche des ersten passenden Tages
    let anker: number | null = null;
    for (let ms = start; ms <= ende; ms += TAG) {
        const d = new Date(ms);
        const j = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        const t = d.getUTCDate();
        if (!serie.weekdays.includes(wochentag(j, m, t))) continue;
        anker ??= wochenIndex(ms);
        if ((wochenIndex(ms) - anker) % serie.every_n_weeks !== 0) continue;
        tage.push(datumsSchluessel(j, m, t));
    }
    return tage;
}
