import { describe, expect, it } from 'vitest';
import { checkAbuse, ABUSE } from '../src/abuse';
import { getStation } from '../src/stations';
import { CMC, ST_MICHAEL, FAR_SOUTH, MGMT_INSTITUTE, LAM_BERET, GURD_SHOLLA } from './fixtures';

const now = 1_800_000_000_000;
const min = 60_000;
const cmc = getStation(CMC)!;

describe('checkAbuse', () => {
  it('allows a first report', () => {
    expect(checkAbuse([], cmc, 'megenagna', now)).toEqual({ ok: true });
  });

  it('rejects the same station and direction within 3 minutes', () => {
    const recent = [{ station_id: CMC, direction: 'megenagna', created_at: now - 2 * min }];
    expect(checkAbuse(recent, cmc, 'megenagna', now)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('allows a different direction at the same station', () => {
    const recent = [{ station_id: CMC, direction: 'megenagna', created_at: now - 1 * min }];
    expect(checkAbuse(recent, cmc, 'ayat', now).ok).toBe(true);
  });

  it('allows the same direction again after the duplicate window', () => {
    const recent = [{ station_id: CMC, direction: 'megenagna', created_at: now - ABUSE.duplicateMs - 1 }];
    expect(checkAbuse(recent, cmc, 'megenagna', now).ok).toBe(true);
  });

  it('allows walking to a neighbouring station', () => {
    const recent = [{ station_id: ST_MICHAEL, direction: 'megenagna', created_at: now - 30_000 }];
    expect(checkAbuse(recent, cmc, 'megenagna', now).ok).toBe(true);
  });

  it('rejects physically impossible travel (~20 km in 5 minutes)', () => {
    const recent = [{ station_id: FAR_SOUTH, direction: 'dukem', created_at: now - 5 * min }];
    expect(checkAbuse(recent, cmc, 'megenagna', now)).toEqual({ ok: false, reason: 'impossible_travel' });
  });

  it('allows the same trip given plausible time (~20 km in 29 minutes)', () => {
    const recent = [{ station_id: FAR_SOUTH, direction: 'dukem', created_at: now - 29 * min }];
    expect(checkAbuse(recent, cmc, 'megenagna', now).ok).toBe(true);
  });

  it('rejects reporting from too many distinct stations', () => {
    // Five neighbouring teras on the CMC–Megenagna corridor, 6 minutes apart:
    // each hop is plausible on its own, but nobody waits at five teras in 30 minutes.
    const corridor = [CMC, ST_MICHAEL, MGMT_INSTITUTE, LAM_BERET];
    const recent = corridor.map((id, i) => ({ station_id: id, direction: 'megenagna', created_at: now - (24 - i * 6) * min }));
    expect(checkAbuse(recent.slice(1), getStation(GURD_SHOLLA)!, 'megenagna', now).ok).toBe(true);
    expect(checkAbuse(recent, getStation(GURD_SHOLLA)!, 'megenagna', now)).toEqual({ ok: false, reason: 'too_many_stations' });
  });
});
