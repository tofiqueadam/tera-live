import { addisSlot, QUEUE, TAXIS } from '../../web/js/core/model.js';
import type { Env } from './env';
import { corsHeaders, error, json, preflight, withHeaders } from './http';
import { compact, liveFor, liveSnapshot, prune, submitReport } from './reports';
import { directionsFor, getStation } from './stations';
import { handleTelegram } from './telegram';
import { cellsFor, dayProfile, usualAt } from './usual';
import { HttpError, readJson, validateReport } from './validate';

export type { Env };

/** Injectable clock so tests can travel in time. */
export const clock = { now: () => Date.now() };

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const now = clock.now();

  if (req.method === 'OPTIONS') return preflight(req, env);

  if (path === '/api/health' && req.method === 'GET') return json({ ok: true, now });

  if (path === '/api/live' && req.method === 'GET') {
    return json(await liveSnapshot(env.DB, now), {}, { 'cache-control': 'public, max-age=15' });
  }

  const stationMatch = path.match(/^\/api\/stations\/([a-z][0-9]{1,20})$/);
  if (stationMatch && req.method === 'GET') {
    const station = getStation(stationMatch[1]);
    if (!station) return error(404, 'unknown station');
    const [live, cells] = await Promise.all([liveFor(env.DB, station.id, now), cellsFor(env.DB, station.id)]);
    const { weekday, hour } = addisSlot(now);
    const withData = new Set([...live.keys(), ...cells.map((c) => c.direction)]);
    const directions = [...withData].map((dir) => {
      const dc = cells.filter((c) => c.direction === dir);
      const l = live.get(dir);
      const u = usualAt(dc, weekday, hour);
      return {
        id: dir,
        live: l ? compact(l) : null,
        usual: u && { q: QUEUE[u.queue], score: u.queueScore, pWaiting: u.pWaiting, n: u.slotReports, total: u.totalReports },
        profile: u ? dayProfile(dc, weekday) : null,
      };
    });
    directions.sort((a, b) => (b.live?.at ?? 0) - (a.live?.at ?? 0) || (b.usual?.total ?? 0) - (a.usual?.total ?? 0));
    return json(
      { station: { id: station.id, name: station.name }, now, slot: { weekday, hour }, directions, available: directionsFor(station) },
      {},
      { 'cache-control': 'public, max-age=10' },
    );
  }

  if (path === '/api/reports' && req.method === 'POST') {
    const body = await readJson(req);
    const v = validateReport(body);
    if (!v.ok) return error(400, v.error, { field: v.field });
    const res = await submitReport(env, v.value, { source: 'web', ip: req.headers.get('cf-connecting-ip'), now });
    if (!res.ok) {
      const headers: Record<string, string> = res.retryAfterSec ? { 'retry-after': String(res.retryAfterSec) } : {};
      return error(res.status, res.reason, {}, headers);
    }
    return json({ ok: true, live: res.live && compact(res.live) }, { status: 201 });
  }

  if (path === '/telegram/webhook' && req.method === 'POST') return handleTelegram(req, env, ctx, now);

  if (path === '/api/meta' && req.method === 'GET') return json({ queue: QUEUE, taxis: TAXIS });

  return error(404, 'not found');
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let res: Response;
    try {
      res = await route(req, env, ctx);
    } catch (err) {
      if (err instanceof HttpError) res = error(err.status, err.message, err.extra);
      else {
        console.error('unhandled', err);
        res = error(500, 'internal error');
      }
    }
    return req.method === 'OPTIONS' ? res : withHeaders(res, corsHeaders(req, env));
  },

  async scheduled(_ctrl: ScheduledController, env: Env): Promise<void> {
    await prune(env.DB, clock.now());
  },
} satisfies ExportedHandler<Env>;
