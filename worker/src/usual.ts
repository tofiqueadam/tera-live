/**
 * "Usually at this hour": hierarchical Bayesian shrinkage over hourly_stats.
 *
 * Each level is a Bayesian average that falls back to the level above it when
 * data is thin:
 *
 *   city prior  →  station × direction (all hours)
 *              →  station × direction × hour (all weekdays)
 *              →  station × direction × weekday × hour
 *
 *   μ_level = (m · μ_parent + Σ queue) / (m + n)
 *
 * With m = 4 pseudo-reports, a slot needs a handful of real reports before it
 * moves far from its parent, so one prankster cannot redefine "usual".
 * Taxi availability uses the same scheme on P(taxis waiting).
 */
export interface Cell {
  weekday: number;
  hour: number;
  n: number;
  queue_sum: number;
  taxis_waiting: number;
}

export const PRIOR = {
  /** City-wide prior: between "short" (1) and "long" (2), leaning short. */
  queue: 1.2,
  pWaiting: 0.4,
  /** Pseudo-count strength at every level. */
  m: 4,
};

export interface Usual {
  queueScore: number;
  queue: number;
  pWaiting: number;
  /** Reports in this exact weekday × hour slot. */
  slotReports: number;
  /** Reports in this hour across all weekdays. */
  hourReports: number;
  /** All historical reports for this station × direction. */
  totalReports: number;
}

const shrink = (parent: number, sum: number, n: number, m: number) => (m * parent + sum) / (m + n);
const r2 = (x: number) => Math.round(x * 100) / 100;

export function usualAt(cells: Cell[], weekday: number, hour: number, prior = PRIOR): Usual | null {
  let N = 0, S = 0, W = 0;
  let nh = 0, sh = 0, wh = 0;
  let nc = 0, sc = 0, wc = 0;
  for (const c of cells) {
    N += c.n; S += c.queue_sum; W += c.taxis_waiting;
    if (c.hour === hour) {
      nh += c.n; sh += c.queue_sum; wh += c.taxis_waiting;
      if (c.weekday === weekday) { nc += c.n; sc += c.queue_sum; wc += c.taxis_waiting; }
    }
  }
  if (N === 0) return null;
  const { m } = prior;
  const q1 = shrink(prior.queue, S, N, m), p1 = shrink(prior.pWaiting, W, N, m);
  const q2 = shrink(q1, sh, nh, m), p2 = shrink(p1, wh, nh, m);
  const q3 = shrink(q2, sc, nc, m), p3 = shrink(p2, wc, nc, m);
  return {
    queueScore: r2(q3),
    queue: Math.min(3, Math.max(0, Math.round(q3))),
    pWaiting: r2(p3),
    slotReports: nc,
    hourReports: nh,
    totalReports: N,
  };
}

/** 24 hourly queue estimates for one weekday, for the "typical day" strip. */
export function dayProfile(cells: Cell[], weekday: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let h = 0; h < 24; h++) out.push(usualAt(cells, weekday, h)?.queueScore ?? null);
  return out;
}

export async function cellsFor(db: D1Database, stationId: string, direction?: string): Promise<(Cell & { direction: string })[]> {
  const stmt = direction
    ? db.prepare('SELECT direction, weekday, hour, n, queue_sum, taxis_waiting FROM hourly_stats WHERE station_id = ?1 AND direction = ?2').bind(stationId, direction)
    : db.prepare('SELECT direction, weekday, hour, n, queue_sum, taxis_waiting FROM hourly_stats WHERE station_id = ?1').bind(stationId);
  const { results } = await stmt.all<Cell & { direction: string }>();
  return results;
}
