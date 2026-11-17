import { describe, expect, it } from 'vitest';
import { usualAt, dayProfile, PRIOR, type Cell } from '../src/usual';

const cell = (weekday: number, hour: number, n: number, meanQueue: number, waiting = 0): Cell => ({
  weekday, hour, n, queue_sum: Math.round(n * meanQueue), taxis_waiting: waiting,
});

describe('usualAt (hierarchical Bayesian average)', () => {
  it('returns null with no history', () => {
    expect(usualAt([], 1, 8)).toBeNull();
  });

  it('a single report barely moves the estimate away from the prior', () => {
    const u = usualAt([cell(1, 8, 1, 3)], 1, 8)!;
    expect(u.queueScore).toBeGreaterThan(PRIOR.queue);
    expect(u.queueScore).toBeLessThan(2.2);
    expect(u.slotReports).toBe(1);
  });

  it('converges to the observed mean with lots of slot data', () => {
    const u = usualAt([cell(1, 8, 200, 3, 10)], 1, 8)!;
    expect(u.queueScore).toBeGreaterThan(2.85);
    expect(u.queue).toBe(3);
    expect(u.pWaiting).toBeLessThan(0.1);
  });

  it('borrows strength from the same hour on other weekdays', () => {
    // Plenty of Tuesday–Friday 8am data saying "very long", nothing for Monday.
    const cells = [2, 3, 4, 5].map((d) => cell(d, 8, 30, 3));
    const monday8 = usualAt(cells, 1, 8)!;
    expect(monday8.slotReports).toBe(0);
    expect(monday8.queueScore).toBeGreaterThan(2.7);
  });

  it('distinguishes rush hour from midday at the same station', () => {
    const cells = [cell(1, 8, 40, 3), cell(1, 13, 40, 0)];
    expect(usualAt(cells, 1, 8)!.queue).toBe(3);
    expect(usualAt(cells, 1, 13)!.queue).toBe(0);
  });

  it('builds a 24-hour profile', () => {
    const p = dayProfile([cell(1, 8, 40, 3)], 1);
    expect(p).toHaveLength(24);
    expect(p[8]!).toBeGreaterThan(p[12]!);
  });
});
