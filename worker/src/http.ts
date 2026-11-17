import type { Env } from './env';

export function json(data: unknown, init: ResponseInit = {}, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders, ...(init.headers as Record<string, string>) },
  });
}

export const error = (status: number, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json({ error: message, ...extra }, { status }, headers);

/**
 * Reads are public and cacheable from any origin. Writes are only allowed
 * from configured origins (browsers enforce this; abuse from scripts is
 * handled by rate limits and heuristics, not CORS).
 */
export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h: Record<string, string> = { vary: 'origin' };
  if (req.method === 'GET') h['access-control-allow-origin'] = '*';
  else if (origin && allowed.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}

export function preflight(req: Request, env: Env): Response {
  const h = corsHeaders(req, env);
  if (!h['access-control-allow-origin']) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...h,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  });
}

export function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}
