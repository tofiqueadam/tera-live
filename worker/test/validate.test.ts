import { describe, expect, it } from 'vitest';
import { validateReport } from '../src/validate';
import { CMC, TZNA, report } from './fixtures';

describe('validateReport', () => {
  it('accepts a well-formed report using enum names', () => {
    const r = validateReport(report());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ direction: 'megenagna', queue: 2, taxis: 1 });
  });

  it('accepts enum indexes', () => {
    const r = validateReport(report({ queue: 0, taxis: 2 }));
    expect(r.ok && r.value.queue === 0 && r.value.taxis === 2).toBe(true);
  });

  it('accepts OSM-derived directions for a station', () => {
    expect(validateReport(report({ station: TZNA, direction: 'ayer-tena' })).ok).toBe(true);
  });

  it.each([
    ['non-object body', null, undefined],
    ['array body', [], undefined],
    ['unknown station', report({ station: 'n1' }), 'station'],
    ['prototype key as station', report({ station: '__proto__' }), 'station'],
    ['numeric station', report({ station: 42 }), 'station'],
    ['direction not served by station', report({ station: CMC, direction: 'ayer-tena' }), 'direction'],
    ['empty direction', report({ direction: '' }), 'direction'],
    ['queue out of range', report({ queue: 4 }), 'queue'],
    ['fractional queue', report({ queue: 1.5 }), 'queue'],
    ['unknown taxis value', report({ taxis: 'lots' }), 'taxis'],
    ['short device id', report({ device: 'abc' }), 'device'],
    ['device id with spaces', report({ device: 'a'.repeat(10) + ' ' + 'b'.repeat(10) }), 'device'],
  ])('rejects %s', (_label, body, field) => {
    const r = validateReport(body);
    expect(r.ok).toBe(false);
    if (!r.ok && field) expect(r.field).toBe(field);
  });

  it('rejects bodies with excessive fields', () => {
    const body: Record<string, unknown> = report();
    for (let i = 0; i < 10; i++) body[`x${i}`] = i;
    expect(validateReport(body).ok).toBe(false);
  });
});
