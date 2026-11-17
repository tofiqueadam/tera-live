/**
 * "Usually at this hour" — the estimator itself lives in the shared module
 * web/js/core/usual.js so the browser demo uses exactly the same maths.
 */
import { usualAt as usualAtJs, dayProfile as dayProfileJs, PRIOR } from '../../web/js/core/usual.js';

export interface Cell {
  weekday: number;
  hour: number;
  n: number;
  queue_sum: number;
  taxis_waiting: number;
}

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

export { PRIOR };
export const usualAt = usualAtJs as (cells: Cell[], weekday: number, hour: number, prior?: typeof PRIOR) => Usual | null;
export const dayProfile = dayProfileJs as (cells: Cell[], weekday: number) => (number | null)[];

export async function cellsFor(db: D1Database, stationId: string, direction?: string): Promise<(Cell & { direction: string })[]> {
  const stmt = direction
    ? db.prepare('SELECT direction, weekday, hour, n, queue_sum, taxis_waiting FROM hourly_stats WHERE station_id = ?1 AND direction = ?2').bind(stationId, direction)
    : db.prepare('SELECT direction, weekday, hour, n, queue_sum, taxis_waiting FROM hourly_stats WHERE station_id = ?1').bind(stationId);
  const { results } = await stmt.all<Cell & { direction: string }>();
  return results;
}
