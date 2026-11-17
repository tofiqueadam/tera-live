import { SELF, createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker, { clock } from '../src/index';
import { CMC, DEVICE, FAR_SOUTH, TZNA, report } from './fixtures';

const BASE = 'https://api.tera.test';
// Monday 2026-11-16 08:30 Addis time.
const T0 = Date.UTC(2026, 10, 16, 5, 30);
let t = T0;

const post = (body: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(`${BASE}/api/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '196.188.0.1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const device = (i: number) => `device_${String(i).padStart(12, '0')}`;

beforeEach(async () => {
  t = T0;
  clock.now = () => t;
  await env.DB.batch(['reports', 'hourly_stats', 'rate_limits'].map((tbl) => env.DB.prepare(`DELETE FROM ${tbl}`)));
});
afterEach(() => {
  clock.now = () => Date.now();
});

describe('GET /api/health', () => {
  it('responds ok', async () => {
    const res = await SELF.fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe('POST /api/reports', () => {
  it('accepts a report and returns the live status for that direction', async () => {
    const res = await post(report());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, live: { q: 'long', t: 'arriving', at: T0, c: 'medium', n: 1 } });
  });

  it('stores a hashed device id, never the raw one, and no IP', async () => {
    await post(report());
    const row = await env.DB.prepare('SELECT * FROM reports').first<Record<string, unknown>>();
    expect(row!.device_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain(DEVICE);
    expect(JSON.stringify(row)).not.toContain('196.188');
    expect(Object.keys(row!).sort()).toEqual(['created_at', 'device_hash', 'direction', 'id', 'queue', 'source', 'station_id', 'taxis']);
  });

  it('updates the hourly rollup in Addis local time', async () => {
    await post(report({ queue: 'very_long', taxis: 'waiting' }));
    const row = await env.DB.prepare('SELECT * FROM hourly_stats').first();
    expect(row).toMatchObject({ station_id: CMC, direction: 'megenagna', weekday: 1, hour: 8, n: 1, queue_sum: 3, taxis_waiting: 1 });
  });

  it('rejects invalid input with 400 and the offending field', async () => {
    const res = await post(report({ queue: 'enormous' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'queue' });
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post({ ...report(), pad: 'x'.repeat(5000) })).status).toBe(413);
  });

  it('rejects a duplicate report from the same device within 3 minutes', async () => {
    expect((await post(report())).status).toBe(201);
    t += 60_000;
    const res = await post(report());
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'duplicate' });
  });

  it('rejects impossible travel between distant stations', async () => {
    expect((await post(report({ station: FAR_SOUTH, direction: 'dukem' }))).status).toBe(201);
    t += 4 * 60_000;
    const res = await post(report());
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'impossible_travel' });
  });

  it('rate limits a single device with Retry-After', async () => {
    const dirs = ['megenagna', 'piassa', 'mexico', 'bole', 'ayat', 'cmc', 'kality'];
    const statuses = [];
    for (const direction of dirs) statuses.push((await post(report({ direction }))).status);
    expect(statuses.slice(0, 6)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(statuses[6]).toBe(429);
    const res = await post(report({ direction: 'merkato' }));
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
  });

  it('rate limits floods from one IP even with rotating device ids', async () => {
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await post(report({ device: device(i) }))).status;
    expect(last).toBe(429);
  });
});

describe('GET /api/live', () => {
  it('returns a compact per-station snapshot with decay applied', async () => {
    await post(report({ queue: 'very_long', taxis: 'none' }));
    t += 2 * 60_000;
    await post(report({ device: device(2), queue: 'very_long', taxis: 'none' }));
    await post(report({ station: TZNA, direction: 'ayer-tena', device: device(3), queue: 'none', taxis: 'waiting' }));

    const res = await SELF.fetch(`${BASE}/api/live`);
    expect(res.headers.get('cache-control')).toContain('max-age=15');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json<any>();
    expect(Object.keys(body.stations).sort()).toEqual([TZNA, CMC].sort());
    expect(body.stations[CMC]).toMatchObject({ q: 'very_long', t: 'none', c: 'high', n: 2 });
    expect(body.stations[CMC].d.megenagna.q).toBe('very_long');
    expect(body.stations[TZNA].d['ayer-tena']).toMatchObject({ q: 'none', t: 'waiting' });
  });

  it('forgets reports older than 90 minutes', async () => {
    await post(report());
    t += 91 * 60_000;
    const body = await (await SELF.fetch(`${BASE}/api/live`)).json<any>();
    expect(body.stations).toEqual({});
  });
});

describe('GET /api/stations/:id', () => {
  it('returns live status, usual-at-this-hour and the day profile per direction', async () => {
    // Build history: four previous Mondays at 08:xx with very long queues.
    for (let w = 1; w <= 4; w++) {
      t = T0 - w * 7 * 86_400_000;
      await post(report({ device: device(100 + w), queue: 'very_long' }));
    }
    t = T0;
    await post(report({ device: device(200), queue: 'short', taxis: 'waiting' }));

    const res = await SELF.fetch(`${BASE}/api/stations/${CMC}`);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.station).toEqual({ id: CMC, name: 'C.M.C' });
    expect(body.slot).toEqual({ weekday: 1, hour: 8 });
    const dir = body.directions[0];
    expect(dir.id).toBe('megenagna');
    expect(dir.live).toMatchObject({ q: 'short', t: 'waiting' });
    expect(dir.usual.n).toBe(5);
    expect(dir.usual.score).toBeGreaterThan(1.8);
    expect(dir.profile).toHaveLength(24);
    expect(body.available).toContain('megenagna');
  });

  it('404s for unknown stations', async () => {
    expect((await SELF.fetch(`${BASE}/api/stations/n1`)).status).toBe(404);
  });
});

describe('CORS', () => {
  it('allows preflight from configured origins only', async () => {
    const ok = await SELF.fetch(`${BASE}/api/reports`, { method: 'OPTIONS', headers: { origin: 'https://tera.example' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://tera.example');
    const bad = await SELF.fetch(`${BASE}/api/reports`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
  });
});

describe('scheduled prune', () => {
  it('deletes raw reports older than 30 days but keeps the hourly rollup', async () => {
    t = T0 - 31 * 86_400_000;
    await post(report());
    t = T0;
    await worker.scheduled(createScheduledController(), env as any);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM reports').first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM hourly_stats').first<{ n: number }>())!.n).toBe(1);
  });
});

describe('unknown routes', () => {
  it('404s', async () => {
    expect((await SELF.fetch(`${BASE}/nope`)).status).toBe(404);
  });
});
