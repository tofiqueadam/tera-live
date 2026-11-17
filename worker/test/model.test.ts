import { describe, expect, it } from 'vitest';
import { aggregate, decayWeight, addisSlot, slug, HALF_LIFE_MS, MAX_AGE_MS } from '../../web/js/core/model.js';

const now = 1_800_000_000_000;
const min = 60_000;

describe('decayWeight', () => {
  it('halves every 20 minutes', () => {
    expect(decayWeight(0)).toBe(1);
    expect(decayWeight(HALF_LIFE_MS)).toBeCloseTo(0.5);
    expect(decayWeight(2 * HALF_LIFE_MS)).toBeCloseTo(0.25);
  });
  it('drops reports older than 90 minutes', () => {
    expect(decayWeight(MAX_AGE_MS + 1)).toBe(0);
  });
  it('treats clock skew from the future as fresh', () => {
    expect(decayWeight(-5000)).toBe(1);
  });
});

describe('aggregate', () => {
  it('returns null with no live reports', () => {
    expect(aggregate([], now)).toBeNull();
    expect(aggregate([{ queue: 3, taxis: 0, at: now - 2 * 3_600_000 }], now)).toBeNull();
  });

  it('lets a fresh report outweigh an old contradicting one', () => {
    const s = aggregate([
      { queue: 3, taxis: 2, at: now - 60 * min },
      { queue: 0, taxis: 0, at: now - 1 * min },
    ], now)!;
    expect(s.queue).toBe(0);
    expect(s.taxis).toBe(0);
    expect(s.lastAt).toBe(now - min);
    expect(s.count).toBe(2);
  });

  it('grades confidence by total decayed weight', () => {
    expect(aggregate([{ queue: 1, taxis: 1, at: now - 30 * min }], now)!.confidence).toBe('low');
    expect(aggregate([{ queue: 1, taxis: 1, at: now }], now)!.confidence).toBe('medium');
    expect(aggregate([{ queue: 1, taxis: 1, at: now }, { queue: 2, taxis: 1, at: now }], now)!.confidence).toBe('high');
  });
});

describe('addisSlot', () => {
  it('uses UTC+3', () => {
    // 2026-11-16 05:30 UTC is Monday 08:30 in Addis Ababa.
    expect(addisSlot(Date.UTC(2026, 10, 16, 5, 30))).toEqual({ weekday: 1, hour: 8 });
    // Sunday 22:00 UTC is already Monday 01:00 in Addis.
    expect(addisSlot(Date.UTC(2026, 10, 15, 22, 0))).toEqual({ weekday: 1, hour: 1 });
  });
});

describe('slug', () => {
  it('normalises names and keeps Ethiopic', () => {
    expect(slug('Ayer Tena')).toBe('ayer-tena');
    expect(slug('  4 Kilo!! ')).toBe('4-kilo');
    expect(slug('መገናኛ')).toBe('መገናኛ');
  });
});
