import { describe, expect, it } from 'vitest';

import { serienTermine } from './events.service';

describe('serienTermine', () => {
  it('erzeugt zweiwöchentliche Termine bis unter sechs Monate nach dem Start', () => {
    const termine = serienTermine('2026-11-01', 'biweekly');
    expect(termine[0]).toBe('2026-11-15');
    expect(termine.at(-1)).toBe('2027-04-18');
    expect(termine).toHaveLength(12);
    expect(termine.every((t) => t < '2027-05-01')).toBe(true);
  });

  it('driftet monatlich nicht am Monatsende (31.01. -> 28.02. -> 31.03.)', () => {
    expect(serienTermine('2026-01-31', 'monthly')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  });

  it('erzeugt vierteljährliche Termine (nur einer innerhalb von sechs Monaten)', () => {
    expect(serienTermine('2026-11-15', 'quarterly')).toEqual(['2027-02-15']);
  });

  it('liefert für ein unbekanntes Intervall keine Termine statt einer Endlosschleife', () => {
    expect(serienTermine('2026-11-01', 'taeglich')).toEqual([]);
  });
});
