import { getStation, distanceMeters, type Station } from './stations';

/** A previous report by the same (hashed) device. */
export interface RecentReport {
  station_id: string;
  direction: string;
  created_at: number;
}

export const ABUSE = {
  /** Look-back window for the heuristics below. */
  lookbackMs: 30 * 60_000,
  /** Same station + direction from one device: one report per 3 minutes. */
  duplicateMs: 3 * 60_000,
  /** Faster than a minibus on an open Addis road is not plausible. */
  maxSpeedMps: 60_000 / 3600, // 60 km/h
  /** Walking between neighbouring teras is always allowed. */
  walkSlackM: 800,
  /** Nobody stands at more than 4 different stations in 30 minutes. */
  maxDistinctStations: 4,
};

export type AbuseVerdict = { ok: true } | { ok: false; reason: 'duplicate' | 'impossible_travel' | 'too_many_stations' };

/**
 * Pure heuristics over a device's recent reports. Kept free of I/O so it is
 * easy to test and reason about.
 */
export function checkAbuse(recent: RecentReport[], station: Station, direction: string, now: number): AbuseVerdict {
  const window = recent.filter((r) => now - r.created_at <= ABUSE.lookbackMs);

  if (window.some((r) => r.station_id === station.id && r.direction === direction && now - r.created_at < ABUSE.duplicateMs))
    return { ok: false, reason: 'duplicate' };

  for (const r of window) {
    if (r.station_id === station.id) continue;
    const prev = getStation(r.station_id);
    if (!prev) continue;
    const meters = distanceMeters(prev, station) - ABUSE.walkSlackM;
    if (meters <= 0) continue;
    const seconds = Math.max(1, (now - r.created_at) / 1000);
    if (meters / seconds > ABUSE.maxSpeedMps) return { ok: false, reason: 'impossible_travel' };
  }

  const distinct = new Set(window.map((r) => r.station_id));
  distinct.add(station.id);
  if (distinct.size > ABUSE.maxDistinctStations) return { ok: false, reason: 'too_many_stations' };

  return { ok: true };
}

export async function recentByDevice(db: D1Database, deviceHash: string, now: number): Promise<RecentReport[]> {
  const { results } = await db
    .prepare(
      `SELECT station_id, direction, created_at FROM reports
       WHERE device_hash = ?1 AND created_at > ?2
       ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(deviceHash, now - ABUSE.lookbackMs)
    .all<RecentReport>();
  return results;
}
