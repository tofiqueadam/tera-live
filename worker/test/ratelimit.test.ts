import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkAll, hit, LIMITS } from '../src/ratelimit';

const now = 1_800_000_000_000;

describe('rate limits', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM rate_limits');
  });

  it('counts within a fixed window and blocks past the limit', async () => {
    const l = { scope: 't', windowMs: 60_000, limit: 3 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hit(env.DB, l, 'abc', now + i));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].count).toBe(4);
    expect(results[3].retryAfterSec).toBeGreaterThan(0);
  });

  it('starts a fresh count in the next window', async () => {
    const l = { scope: 't', windowMs: 60_000, limit: 1 };
    const start = now - (now % 60_000);
    expect((await hit(env.DB, l, 'abc', start)).allowed).toBe(true);
    expect((await hit(env.DB, l, 'abc', start + 59_999)).allowed).toBe(false);
    expect((await hit(env.DB, l, 'abc', start + 60_000)).allowed).toBe(true);
  });

  it('keeps separate counters per key', async () => {
    const l = { scope: 't', windowMs: 60_000, limit: 1 };
    expect((await hit(env.DB, l, 'a', now)).allowed).toBe(true);
    expect((await hit(env.DB, l, 'b', now)).allowed).toBe(true);
  });

  it('checkAll reports which scope tripped', async () => {
    for (let i = 0; i < LIMITS.deviceBurst.limit; i++) await hit(env.DB, LIMITS.deviceBurst, 'dev', now);
    const tripped = await checkAll(env.DB, [[LIMITS.ipBurst, 'ip'], [LIMITS.deviceBurst, 'dev']], now);
    expect(tripped?.scope).toBe(LIMITS.deviceBurst.scope);
  });

  it('stores only hashed keys', async () => {
    await hit(env.DB, LIMITS.ipBurst, 'deadbeef', now);
    const row = await env.DB.prepare('SELECT key FROM rate_limits').first<{ key: string }>();
    expect(row?.key).toBe('ip10m:deadbeef');
  });
});
