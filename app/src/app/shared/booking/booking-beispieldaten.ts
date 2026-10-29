import { Injectable, computed, signal } from '@angular/core';

import type { BookingEntry, BookingPlan } from './booking.models';
import { berlinUhr, berlinZeitpunkt, tageImMonat, wochentag } from './zeitraum';

/**
 * PROTOTYP: Beispieldaten ohne Backend. Entfällt, sobald die API angebunden ist; Feature und Termin-Dialog
 * lesen bis dahin dieselben Daten, damit beide Seiten zusammenpassen.
 */
@Injectable({ providedIn: 'root' })
export class BeispielBelegungStore {
    readonly plaene = signal<BookingPlan[]>(erzeugePlaene());
    readonly eintraege = signal<BookingEntry[]>(erzeugeEintraege());

    /** Offene Anfragen in Plänen, in denen die Person entscheiden darf (Badge am Menüpunkt). */
    readonly offeneFuerMich = computed(() => {
        const entscheidend = new Set(this.plaene().filter((p) => p.my_role === 'lead' || p.my_role === 'manager').map((p) => p.id));
        return this.eintraege().filter((e) => e.status === 'requested' && entscheidend.has(e.plan_id)).length;
    });

    eintraegeVon(planId: string): BookingEntry[] {
        return this.eintraege().filter((e) => e.plan_id === planId);
    }
}

function erzeugePlaene(): BookingPlan[] {
    const basis = { state: 'NW' as const, window_start: 8, window_end: 22, all_members_can_request: false, public_view: 'none' as const, open_requests: 0 };
    return [
        { ...basis, id: 'saal', name: 'Bürgerhaus Saal', kind: 'place', address: 'Marktstraße 12, 50667 Köln', public_view: 'year', my_role: 'lead' },
        { ...basis, id: 'halle', name: 'Sporthalle Nord', kind: 'place', address: 'Am Sportpark 3, 50679 Köln', window_end: 21, my_role: 'requester' },
        { ...basis, id: 'rad', name: 'Lastenrad', kind: 'item', address: null, window_end: 20, my_role: null },
    ];
}

let zaehler = 0;

function eintrag(planId: string, tag: [number, number, number], von: number, bis: number, zusatz: Partial<BookingEntry>): BookingEntry {
    const [j, m, t] = tag;
    // Ende über Mitternacht (bis > 24) → Folgetag
    const ende = bis > 24 ? berlinZeitpunkt(j, m, t + 1, bis - 24) : berlinZeitpunkt(j, m, t, bis);
    return {
        id: `bsp-${++zaehler}`,
        plan_id: planId,
        title: 'Belegt',
        note: null,
        start_at: berlinZeitpunkt(j, m, t, von).toISOString(),
        end_at: ende.toISOString(),
        status: 'approved',
        is_public: false,
        requester_name: null,
        is_mine: false,
        series_id: null,
        event_id: null,
        decision_reason: null,
        ...zusatz,
    };
}

function erzeugeEintraege(): BookingEntry[] {
    const heute = berlinUhr(new Date());
    const jahr = heute.jahr;
    const alle: BookingEntry[] = [];
    const tagImMonat = (monat: number, tag: number): [number, number, number] => [jahr, monat, Math.min(tag, tageImMonat(jahr, monat))];

    // Saal: Serien über das ganze Jahr (Dienstag Frauencafé, Donnerstag Chor), dazu Einzeltermine
    for (let monat = 1; monat <= 12; monat++) {
        for (let tag = 1; tag <= tageImMonat(jahr, monat); tag++) {
            const wt = wochentag(jahr, monat, tag);
            if (wt === 1) alle.push(eintrag('saal', [jahr, monat, tag], 15, 17, { title: 'Frauencafé', series_id: 'serie-cafe', is_public: true, requester_name: 'Mira Hoffmann' }));
            if (wt === 3 && (monat + tag) % 2 === 0) alle.push(eintrag('saal', [jahr, monat, tag], 19, 21, { title: 'Chorprobe', series_id: 'serie-chor', requester_name: 'Jonas Becker' }));
        }
        if (monat % 2 === 1) alle.push(eintrag('saal', tagImMonat(monat, 14), 10, 16, { title: 'Kreismitgliederversammlung', is_public: true, requester_name: 'Sabine Keller' }));
        if (monat % 3 === 0) alle.push(eintrag('saal', tagImMonat(monat, 22), 9, 22, { title: 'Wahlkampf-Wochenende', requester_name: 'Sabine Keller' }));
    }
    // Mehrtägig und Anfragen rund um heute
    const m = heute.monat;
    alle.push(eintrag('saal', tagImMonat(m, 5), 18, 24 + 14, { title: 'Aufbau Herbstmarkt', requester_name: 'Jonas Becker' }));
    alle.push(eintrag('saal', tagImMonat(m, 27), 16, 20, { title: 'Vorstandssitzung', status: 'approved', is_mine: true, requester_name: 'Du', is_public: false }));
    alle.push(eintrag('saal', tagImMonat(m, 28), 18, 21, { title: 'Infoabend Mietenpolitik', status: 'requested', requester_name: 'Mira Hoffmann' }));
    alle.push(eintrag('saal', tagImMonat(m, 28), 19, 22, { title: 'Bündnistreffen Verkehrswende', status: 'requested', requester_name: 'Tim Aydın' }));
    alle.push(eintrag('saal', tagImMonat(m, 18), 10, 13, { title: 'Workshop Social Media', status: 'requested', requester_name: 'Leonie Krämer' }));
    alle.push(eintrag('saal', tagImMonat(m, 18), 11, 14, { title: 'Nachbarschaftsfrühstück', status: 'requested', requester_name: 'Tim Aydın' }));
    alle.push(eintrag('saal', tagImMonat(m, 9), 14, 16, { title: 'Sprechstunde', status: 'declined', is_mine: true, requester_name: 'Du', decision_reason: 'Zeitraum anderweitig vergeben' }));

    // Sporthalle: Training, eine Anfrage
    for (let monat = 1; monat <= 12; monat++) {
        for (let tag = 1; tag <= tageImMonat(jahr, monat); tag++) {
            const wt = wochentag(jahr, monat, tag);
            if (wt === 0) alle.push(eintrag('halle', [jahr, monat, tag], 17, 19, { title: 'Jugendtraining', series_id: 'serie-jugend', requester_name: 'Ahmet Yılmaz' }));
            if (wt === 2) alle.push(eintrag('halle', [jahr, monat, tag], 18, 20, { title: 'Volleyball', series_id: 'serie-volley', requester_name: 'Lena Schulz' }));
        }
    }
    alle.push(eintrag('halle', tagImMonat(m, 14), 9, 13, { title: 'Turnier Kreisliga', requester_name: 'Ahmet Yılmaz', is_public: true }));
    alle.push(eintrag('halle', tagImMonat(m, 21), 13, 17, { title: 'Spielenachmittag', status: 'requested', requester_name: 'Lena Schulz' }));
    alle.push(eintrag('halle', tagImMonat(m, 26), 17, 19, { title: 'Elternabend Jugendabteilung', status: 'requested', is_mine: true, requester_name: 'Du' }));

    // Gegenstände
    alle.push(eintrag('rad', tagImMonat(m, 24), 9, 18, { title: 'Wochenendeinkauf', requester_name: 'Mira Hoffmann' }));
    alle.push(eintrag('rad', tagImMonat(m, 30), 10, 14, { title: 'Flyer verteilen', requester_name: 'Tim Aydın' }));

    return alle;
}
