import { QUEUE, TAXIS } from '../../web/js/core/model.js';
import { getStation, isValidDirection, type Station } from './stations';

export interface ReportInput {
  station: Station;
  direction: string;
  queue: number;
  taxis: number;
  device: string;
}

export type Validation = { ok: true; value: ReportInput } | { ok: false; error: string; field?: string };

/** Anonymous device ids are 16–64 url-safe characters generated client-side. */
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_BODY_KEYS = 8;

/**
 * Validate a report payload. Accepts enum names ("long") or indexes (2) for
 * queue/taxis so the Telegram handler and the web client share one path.
 */
export function validateReport(body: unknown): Validation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;
  if (Object.keys(b).length > MAX_BODY_KEYS) return { ok: false, error: 'too many fields' };

  if (typeof b.station !== 'string' || b.station.length > 24) return { ok: false, error: 'invalid station', field: 'station' };
  const station = getStation(b.station);
  if (!station) return { ok: false, error: 'unknown station', field: 'station' };

  if (typeof b.direction !== 'string' || b.direction.length === 0 || b.direction.length > 48)
    return { ok: false, error: 'invalid direction', field: 'direction' };
  if (!isValidDirection(station, b.direction)) return { ok: false, error: 'unknown direction for station', field: 'direction' };

  const queue = enumIndex(b.queue, QUEUE);
  if (queue < 0) return { ok: false, error: `queue must be one of ${QUEUE.join(', ')}`, field: 'queue' };
  const taxis = enumIndex(b.taxis, TAXIS);
  if (taxis < 0) return { ok: false, error: `taxis must be one of ${TAXIS.join(', ')}`, field: 'taxis' };

  if (typeof b.device !== 'string' || !DEVICE_RE.test(b.device)) return { ok: false, error: 'invalid device id', field: 'device' };

  return { ok: true, value: { station, direction: b.direction, queue, taxis, device: b.device } };
}

function enumIndex(v: unknown, values: readonly string[]): number {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < values.length) return v;
  if (typeof v === 'string') return values.indexOf(v);
  return -1;
}

/** Read a JSON body with a hard size cap (reports are ~150 bytes). */
export async function readJson(req: Request, maxBytes = 2048): Promise<unknown> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'payload too large');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
