import { describe, expect, it } from 'vitest';

import type { SerieEingabe } from '../domain/booking.repository';
import { tageDerSerie } from './in-memory-booking.repository';

const serie = (zusatz: Partial<SerieEingabe>): SerieEingabe => ({
    title: 'Chor', note: null, is_public: false, weekdays: [1], every_n_weeks: 1, hour_from: 18, hour_to: 20,
    valid_from: '2026-11-01', valid_to: '2026-11-30', skip_holidays: true, ...zusatz,
});

describe('tageDerSerie', () => {
    it('liefert jeden Dienstag im November 2026', () => {
        expect(tageDerSerie(serie({}))).toEqual(['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);
    });

    it('nimmt bei Rhythmus 2 jede zweite Woche, beginnend mit dem ersten passenden Tag', () => {
        expect(tageDerSerie(serie({ every_n_weeks: 2 }))).toEqual(['2026-11-03', '2026-11-17']);
        expect(tageDerSerie(serie({ every_n_weeks: 2, valid_from: '2026-11-10' }))).toEqual(['2026-11-10', '2026-11-24']);
    });

    it('unterstützt mehrere Wochentage und lässt Tage außerhalb des Zeitraums aus', () => {
        expect(tageDerSerie(serie({ weekdays: [0, 4], valid_from: '2026-11-04', valid_to: '2026-11-14' })))
            .toEqual(['2026-11-06', '2026-11-09', '2026-11-13']);
    });
});
