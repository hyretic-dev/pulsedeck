import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryRateLimiter } from '../../test/in-memory.rate-limiter';

/**
 * Schritt A: RateLimiter-Port (Auftrag §5, Missbrauchsschutz).
 * Festes Fenster, konfigurierbare Werte; Schlüssel bilden die Kombination
 * aus Fachkontext, E-Mail und IP (z. B. `login:mail@example.org:1.2.3.4`).
 */
describe('InMemoryRateLimiter (Festfenster)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('erlaubt Anfragen bis zum Limit und lehnt danach ab', async () => {
    const limiter = new InMemoryRateLimiter({ max: 3, windowMs: 15 * 60 * 1000 });

    expect((await limiter.consume('login:a@example.org:1.2.3.4')).allowed).toBe(true);
    expect((await limiter.consume('login:a@example.org:1.2.3.4')).allowed).toBe(true);
    expect((await limiter.consume('login:a@example.org:1.2.3.4')).allowed).toBe(true);
    expect((await limiter.consume('login:a@example.org:1.2.3.4')).allowed).toBe(false);
  });

  it('zählt Schlüssel getrennt (andere E-Mail oder IP trifft eigenes Limit)', async () => {
    const limiter = new InMemoryRateLimiter({ max: 1, windowMs: 60 * 1000 });

    expect((await limiter.consume('login:a@example.org:1.2.3.4')).allowed).toBe(true);
    expect((await limiter.consume('login:a@example.org:1.2.3.4')).allowed).toBe(false);
    expect((await limiter.consume('login:b@example.org:1.2.3.4')).allowed).toBe(true);
    expect((await limiter.consume('login:a@example.org:5.6.7.8')).allowed).toBe(true);
  });

  it('öffnet nach Fensterablauf ein neues Fenster', async () => {
    const limiter = new InMemoryRateLimiter({ max: 1, windowMs: 15 * 60 * 1000 });

    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(false);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect((await limiter.consume('k')).allowed).toBe(true);
  });

  it('lehnt innerhalb desselben Fensters nach dem Limit konsequent ab', async () => {
    const limiter = new InMemoryRateLimiter({ max: 2, windowMs: 60 * 1000 });

    await limiter.consume('k');
    await limiter.consume('k');
    vi.advanceTimersByTime(30 * 1000);
    expect((await limiter.consume('k')).allowed).toBe(false);
    vi.advanceTimersByTime(30 * 1000 + 1);
    expect((await limiter.consume('k')).allowed).toBe(true);
  });
});
