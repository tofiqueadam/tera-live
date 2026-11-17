/**
 * Fixed-window counters in D1. One upsert per check; old windows are pruned
 * by the scheduled handler. Keys are '<scope>:<salted hash>' so no raw device
 * id or IP address is ever written.
 */
export interface Limit {
  scope: string;
  windowMs: number;
  limit: number;
}

export const LIMITS = {
  /** A rider at a tera rarely needs more than a few reports in 10 minutes. */
  deviceBurst: { scope: 'dev10m', windowMs: 10 * 60_000, limit: 6 },
  deviceDay: { scope: 'dev1d', windowMs: 24 * 3_600_000, limit: 60 },
  /**
   * Ethiopian mobile networks put many subscribers behind carrier-grade NAT,
   * so the per-IP limit is deliberately generous: it only stops floods.
   */
  ipBurst: { scope: 'ip10m', windowMs: 10 * 60_000, limit: 120 },
} satisfies Record<string, Limit>;

export interface LimitResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

export async function hit(db: D1Database, limit: Limit, hash: string, now: number): Promise<LimitResult> {
  const windowStart = now - (now % limit.windowMs);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(`${limit.scope}:${hash}`, windowStart)
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  return {
    allowed: count <= limit.limit,
    count,
    retryAfterSec: Math.ceil((windowStart + limit.windowMs - now) / 1000),
  };
}

/** Check several limits; returns the first one exceeded, or null. */
export async function checkAll(
  db: D1Database,
  checks: [Limit, string][],
  now: number,
): Promise<(LimitResult & { scope: string }) | null> {
  const results = await Promise.all(checks.map(([l, h]) => hit(db, l, h, now)));
  const i = results.findIndex((r) => !r.allowed);
  return i === -1 ? null : { ...results[i], scope: checks[i][0].scope };
}
