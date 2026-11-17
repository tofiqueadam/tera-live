import { aggregate, addisSlot, MAX_AGE_MS, QUEUE, TAXIS } from '../../web/js/core/model.js';
import { checkAbuse, recentByDevice } from './abuse';
import type { Env } from './env';
import { saltedHash } from './hash';
import { checkAll, LIMITS } from './ratelimit';
import type { ReportInput } from './validate';

export type Source = 'web' | 'telegram';

export type SubmitResult =
  | { ok: true; live: ReturnType<typeof aggregate> }
  | { ok: false; status: 422 | 429; reason: string; retryAfterSec?: number };

export function salt(env: Env): string {
  // Tests and `wrangler dev` without .dev.vars still work, but say so loudly.
  if (!env.HASH_SALT) console.warn('HASH_SALT is not set; using an insecure development salt');
  return env.HASH_SALT || 'dev-only-insecure-salt';
}

/**
 * Accept a validated report: rate limit, run abuse heuristics, then insert
 * the raw report and bump the hourly rollup in a single D1 batch.
 */
export async function submitReport(
  env: Env,
  input: ReportInput,
  opts: { source: Source; ip: string | null; now: number },
): Promise<SubmitResult> {
  const s = salt(env);
  const deviceHash = await saltedHash(s, `${opts.source}:${input.device}`);
  const checks: Parameters<typeof checkAll>[1] = [
    [LIMITS.deviceBurst, deviceHash],
    [LIMITS.deviceDay, deviceHash],
  ];
  if (opts.ip) checks.push([LIMITS.ipBurst, await saltedHash(s, `ip:${opts.ip}`)]);

  const limited = await checkAll(env.DB, checks, opts.now);
  if (limited) return { ok: false, status: 429, reason: 'rate_limited', retryAfterSec: limited.retryAfterSec };

  const recent = await recentByDevice(env.DB, deviceHash, opts.now);
  const verdict = checkAbuse(recent, input.station, input.direction, opts.now);
  if (!verdict.ok) return { ok: false, status: verdict.reason === 'duplicate' ? 429 : 422, reason: verdict.reason };

  const { weekday, hour } = addisSlot(opts.now);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO reports (station_id, direction, queue, taxis, created_at, device_hash, source)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(input.station.id, input.direction, input.queue, input.taxis, opts.now, deviceHash, opts.source),
    env.DB.prepare(
      `INSERT INTO hourly_stats (station_id, direction, weekday, hour, n, queue_sum, taxis_waiting)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)
       ON CONFLICT (station_id, direction, weekday, hour) DO UPDATE SET
         n = n + 1, queue_sum = queue_sum + excluded.queue_sum, taxis_waiting = taxis_waiting + excluded.taxis_waiting`,
    ).bind(input.station.id, input.direction, weekday, hour, input.queue, input.taxis === 0 ? 1 : 0),
  ]);

  const live = await liveFor(env.DB, input.station.id, opts.now);
  return { ok: true, live: live.get(input.direction) ?? null };
}

interface Row {
  station_id: string;
  direction: string;
  queue: number;
  taxis: number;
  created_at: number;
}

/** Live status per direction for one station. */
export async function liveFor(db: D1Database, stationId: string, now: number) {
  const { results } = await db
    .prepare('SELECT station_id, direction, queue, taxis, created_at FROM reports WHERE station_id = ?1 AND created_at > ?2')
    .bind(stationId, now - MAX_AGE_MS)
    .all<Row>();
  const byDir = group(results, (r) => r.direction);
  const out = new Map<string, ReturnType<typeof aggregate>>();
  for (const [dir, rows] of byDir) out.set(dir, aggregate(toInputs(rows), now));
  return out;
}

/**
 * Compact city-wide live snapshot: one entry per station with any live
 * report, with an overall status and per-direction detail. Typically a few
 * KB even at rush hour.
 */
export async function liveSnapshot(db: D1Database, now: number) {
  const { results } = await db
    .prepare('SELECT station_id, direction, queue, taxis, created_at FROM reports WHERE created_at > ?1')
    .bind(now - MAX_AGE_MS)
    .all<Row>();
  const stations: Record<string, unknown> = {};
  for (const [sid, rows] of group(results, (r) => r.station_id)) {
    const overall = aggregate(toInputs(rows), now);
    if (!overall) continue;
    const dirs: Record<string, unknown> = {};
    for (const [dir, dr] of group(rows, (r) => r.direction)) {
      const a = aggregate(toInputs(dr), now);
      if (a) dirs[dir] = compact(a);
    }
    stations[sid] = { ...compact(overall), d: dirs };
  }
  return { now, stations };
}

/** Short keys keep the snapshot small on 3G: q=queue t=taxis at=last report c=confidence n=reports. */
export const compact = (a: NonNullable<ReturnType<typeof aggregate>>) => ({
  q: QUEUE[a.queue],
  t: TAXIS[a.taxis],
  at: a.lastAt,
  c: a.confidence,
  n: a.count,
});

const toInputs = (rows: Row[]) => rows.map((r) => ({ queue: r.queue, taxis: r.taxis, at: r.created_at }));

function group<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    let arr = m.get(k);
    if (!arr) m.set(k, (arr = []));
    arr.push(it);
  }
  return m;
}

/** Retention: raw reports for 30 days, rate-limit windows for 2 days. */
export async function prune(db: D1Database, now: number) {
  await db.batch([
    db.prepare('DELETE FROM reports WHERE created_at < ?1').bind(now - 30 * 86_400_000),
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(now - 2 * 86_400_000),
  ]);
}
