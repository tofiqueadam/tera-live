// Live data source backed by the Cloudflare Worker.

const DEVICE_KEY = 'tera.device';
const QUEUE_KEY = 'tera.outbox';
/** Reports older than this are stale by the time we're back online; drop them. */
const OUTBOX_MAX_AGE_MS = 10 * 60_000;

/** Anonymous random id: 128 bits, base64url. Never linked to a person. */
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return (window.__teraDevice ||= crypto.randomUUID().replace(/-/g, ''));
  }
}

export function createApiSource(base) {
  const url = (p) => `${base.replace(/\/$/, '')}${p}`;
  const getJson = async (p) => {
    const res = await fetch(url(p), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  async function post(body) {
    const res = await fetch(url('/api/reports'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, live: data.live };
    return { ok: false, status: res.status, reason: data.error || 'error' };
  }

  async function flushOutbox() {
    let box = readOutbox();
    if (!box.length || !navigator.onLine) return;
    const now = Date.now();
    box = box.filter((r) => now - r.queuedAt < OUTBOX_MAX_AGE_MS);
    const keep = [];
    for (const r of box) {
      try {
        await post(r.body);
      } catch {
        keep.push(r);
      }
    }
    writeOutbox(keep);
  }
  window.addEventListener('online', flushOutbox);
  flushOutbox();

  return {
    simulated: false,
    live: () => getJson('/api/live'),
    station: (id) => getJson(`/api/stations/${encodeURIComponent(id)}`),
    async report({ station, direction, queue, taxis }) {
      const body = { station, direction, queue, taxis, device: deviceId() };
      try {
        return await post(body);
      } catch {
        writeOutbox([...readOutbox(), { body, queuedAt: Date.now() }]);
        return { ok: true, queued: true };
      }
    },
  };
}

function readOutbox() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
function writeOutbox(v) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}
