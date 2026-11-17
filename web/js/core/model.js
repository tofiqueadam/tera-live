// Shared domain model for Tera Live.
// Imported by the browser app *and* bundled into the Cloudflare Worker, so the
// decay maths and enums can never drift between client and server.
// Plain ES module, no dependencies.

/** Queue length at a station, ordered from best to worst. */
export const QUEUE = /** @type {const} */ (['none', 'short', 'long', 'very_long']);
/** Minibus availability at a station. */
export const TAXIS = /** @type {const} */ (['waiting', 'arriving', 'none']);

/** Reports lose half their weight every 20 minutes. */
export const HALF_LIFE_MS = 20 * 60 * 1000;
/** After 90 minutes a report weighs < 5 % and is ignored entirely. */
export const MAX_AGE_MS = 90 * 60 * 1000;

/** Addis Ababa is UTC+3 all year (no DST). */
export const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Stable URL-safe key for a destination name. Keeps Ethiopic letters so that
 * Amharic-only destinations still get a usable key.
 * @param {string} name
 */
export function slug(name) {
  return String(name)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9ሀ-፿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Exponential decay weight for a report of the given age. */
export function decayWeight(ageMs) {
  if (ageMs < 0) ageMs = 0;
  if (ageMs > MAX_AGE_MS) return 0;
  return Math.pow(0.5, ageMs / HALF_LIFE_MS);
}

/**
 * Collapse a set of reports for one station × direction into a live status.
 * Queue is a decay-weighted mean on the 0..3 scale; taxis is a weighted vote.
 *
 * @param {{queue:number, taxis:number, at:number}[]} reports  queue/taxis as enum indexes, at = epoch ms
 * @param {number} now epoch ms
 * @returns {null | {queue:number, queueScore:number, taxis:number, weight:number, confidence:'low'|'medium'|'high', lastAt:number, count:number}}
 */
export function aggregate(reports, now) {
  let w = 0;
  let q = 0;
  const taxiVotes = [0, 0, 0];
  let lastAt = 0;
  let count = 0;
  for (const r of reports) {
    const wi = decayWeight(now - r.at);
    if (wi === 0) continue;
    w += wi;
    q += wi * r.queue;
    taxiVotes[r.taxis] += wi;
    if (r.at > lastAt) lastAt = r.at;
    count++;
  }
  if (w === 0) return null;
  const queueScore = q / w;
  let taxis = 0;
  for (let i = 1; i < 3; i++) if (taxiVotes[i] > taxiVotes[taxis]) taxis = i;
  // One fresh report ≈ weight 1. Two agreeing fresh reports ≈ high.
  const confidence = w >= 1.8 ? 'high' : w >= 0.7 ? 'medium' : 'low';
  return {
    queue: Math.round(queueScore),
    queueScore: Math.round(queueScore * 100) / 100,
    taxis,
    weight: Math.round(w * 100) / 100,
    confidence,
    lastAt,
    count,
  };
}

/** Weekday (0 = Sunday) and hour in Addis Ababa local time. */
export function addisSlot(epochMs) {
  const d = new Date(epochMs + ADDIS_OFFSET_MS);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
}

/** Great-circle distance in metres. */
export function haversine(lon1, lat1, lon2, lat2) {
  const R = 6371e3;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
