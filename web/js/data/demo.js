// Demo data source — SIMULATED reports so the static front-end can be explored
// without the Worker. Every consumer must show the SIMULATED DATA badge when
// `source.simulated` is true; nothing here is ever sent to the real API.
//
// The simulation is deterministic per 10-minute bucket (seeded PRNG), follows
// a plausible Addis commute curve (morning and evening peaks, quieter
// weekends) and uses the same decay and Bayesian estimators as the backend.

import { QUEUE, TAXIS, aggregate, addisSlot } from '../core/model.js';
import { usualAt, dayProfile } from '../core/usual.js';
import { directionsFor } from './stations.js';

const HUBS = /megenagna|meganagna|piassa|piazza|mexico|stadium|bole|ayat|kality|kaliti|merkato|mercato|4 kilo|arat kilo|torhailoch|tor hailoch|jemo|c\.?m\.?c|saris|kazanchis|lam bert|lebu|gerji|summit|shiro meda|lideta|sar bet/i;

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Expected line length (0..3 scale) for an Addis weekday/hour. */
export function demand(weekday, hour) {
  const g = (mu, sigma, amp) => amp * Math.exp(-((hour + 0.5 - mu) ** 2) / (2 * sigma * sigma));
  let d = 0.35 + g(7.6, 1.1, 2.0) + g(12.8, 1.4, 0.5) + g(17.9, 1.3, 2.2);
  if (hour < 5 || hour >= 22) d = 0.1;
  if (weekday === 0) d *= 0.55;
  if (weekday === 6) d *= 0.75;
  return d;
}

const clamp = (x) => Math.max(0, Math.min(3, Math.round(x)));
const BUCKET_MS = 10 * 60_000;

export function createDemoSource(data, clock = () => Date.now()) {
  const { stations, byId, destinations } = data;
  const bias = new Map(stations.map((s) => [s.id, (rng(hashStr(s.id))() - 0.5) * 1.1 + (s.kind === 'terminal' ? 0.35 : 0)]));
  const userReports = [];
  let cache = { bucket: -1, reports: [] };

  function simulatedReports(now) {
    const bucket = Math.floor(now / BUCKET_MS);
    if (cache.bucket === bucket) return cache.reports;
    const reports = [];
    const hourSeed = Math.floor(now / 3_600_000);
    for (const s of stations) {
      const r = rng(hashStr(s.id) ^ hourSeed);
      const hub = HUBS.test(s.name);
      const pActive = hub ? 0.8 : s.kind === 'terminal' ? 0.45 : s.osmDirs.length ? 0.1 : 0.03;
      if (r() > pActive) continue;
      const dirs = directionsFor(s, destinations);
      const nDirs = Math.min(dirs.length, 1 + Math.floor(r() * (hub ? 4 : 2)));
      for (let i = 0; i < nDirs; i++) {
        const dir = dirs[Math.floor(r() * Math.min(dirs.length, 6))];
        const rb = rng(hashStr(`${s.id}|${dir.id}`) ^ bucket);
        const n = 1 + Math.floor(rb() * (hub ? 4 : 2));
        // Report ages: the freshest one can be anywhere in the last ~25 min.
        let age = rb() * 25 * 60_000;
        for (let k = 0; k < n; k++) {
          const at = now - age;
          const { weekday, hour } = addisSlot(at);
          const level = clamp(demand(weekday, hour) + bias.get(s.id) + (rb() - 0.5) * 1.2);
          const tx = level >= 2 ? (rb() < 0.55 ? 2 : 1) : rb() < 0.6 ? 0 : 1;
          reports.push({ station: s.id, direction: dir.id, queue: level, taxis: tx, at });
          age += (4 + rb() * 18) * 60_000;
        }
      }
    }
    cache = { bucket, reports };
    return reports;
  }

  function allReports(now) {
    return simulatedReports(now).concat(userReports);
  }

  /** Four weeks of synthetic hourly history for one station × direction. */
  function historyCells(stationId, dirId) {
    const r = rng(hashStr(`hist|${stationId}|${dirId}`));
    const b = bias.get(stationId) ?? 0;
    const cells = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      for (let hour = 5; hour < 22; hour++) {
        const n = Math.floor(r() * 7);
        if (!n) continue;
        let qs = 0, w = 0;
        for (let i = 0; i < n; i++) {
          const q = clamp(demand(weekday, hour) + b + (r() - 0.5) * 1.4);
          qs += q;
          if (q < 2 && r() < 0.6) w++;
        }
        cells.push({ weekday, hour, n, queue_sum: qs, taxis_waiting: w });
      }
    }
    return cells;
  }

  const compact = (a) => ({ q: QUEUE[a.queue], t: TAXIS[a.taxis], at: a.lastAt, c: a.confidence, n: a.count });

  return {
    simulated: true,

    async live() {
      const now = clock();
      const byStation = new Map();
      for (const r of allReports(now)) {
        if (!byStation.has(r.station)) byStation.set(r.station, []);
        byStation.get(r.station).push(r);
      }
      const out = {};
      for (const [sid, rows] of byStation) {
        const overall = aggregate(rows, now);
        if (!overall) continue;
        const d = {};
        const byDir = new Map();
        for (const r of rows) (byDir.get(r.direction) || byDir.set(r.direction, []).get(r.direction)).push(r);
        for (const [dir, dr] of byDir) {
          const a = aggregate(dr, now);
          if (a) d[dir] = compact(a);
        }
        out[sid] = { ...compact(overall), d };
      }
      return { now, stations: out, simulated: true };
    },

    async station(id) {
      const s = byId.get(id);
      if (!s) throw new Error('unknown station');
      const now = clock();
      const { weekday, hour } = addisSlot(now);
      const rows = allReports(now).filter((r) => r.station === id);
      const dirIds = new Set(rows.map((r) => r.direction));
      // Busy stations also have history for their first couple of destinations.
      for (const d of directionsFor(s, destinations).slice(0, 2)) dirIds.add(d.id);
      const directions = [...dirIds].map((dir) => {
        const live = aggregate(rows.filter((r) => r.direction === dir), now);
        const cells = historyCells(id, dir);
        const u = usualAt(cells, weekday, hour);
        return {
          id: dir,
          live: live && compact(live),
          usual: u && { q: QUEUE[u.queue], score: u.queueScore, pWaiting: u.pWaiting, n: u.slotReports, total: u.totalReports },
          profile: u ? dayProfile(cells, weekday) : null,
        };
      });
      directions.sort((a, b) => (b.live?.at ?? 0) - (a.live?.at ?? 0));
      return { station: { id, name: s.name }, now, slot: { weekday, hour }, directions, simulated: true };
    },

    async report({ station, direction, queue, taxis }) {
      const now = clock();
      userReports.push({ station, direction, queue: QUEUE.indexOf(queue), taxis: TAXIS.indexOf(taxis), at: now });
      const a = aggregate(allReports(now).filter((r) => r.station === station && r.direction === direction), now);
      return { ok: true, live: a && compact(a), simulated: true };
    },
  };
}
