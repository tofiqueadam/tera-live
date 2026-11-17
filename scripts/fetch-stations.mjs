#!/usr/bin/env node
// Build web/data/stations.geojson from OpenStreetMap via the Overpass API.
//
// Reproducible: the raw Overpass response is cached in scripts/.cache/ and the
// output is sorted and rounded so re-running against the same snapshot yields
// a byte-identical file.
//
//   node scripts/fetch-stations.mjs            # fetch (or reuse today's cache) and build
//   node scripts/fetch-stations.mjs --refresh  # force a fresh Overpass query
//
// Data © OpenStreetMap contributors, available under the Open Database License
// (ODbL 1.0). The generated file carries that attribution in its metadata.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache', 'overpass-addis.json');
const OUT = join(ROOT, 'web', 'data', 'stations.geojson');
const CURATED = join(ROOT, 'data', 'destinations.json');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Addis Ababa is admin_level=4 (chartered city) in OSM.
export const QUERY = `
[out:json][timeout:120];
area["boundary"="administrative"]["admin_level"="4"]["name:en"="Addis Ababa"]->.city;
(
  nwr["amenity"="bus_station"](area.city);
  nwr["public_transport"="station"](area.city);
  nwr["highway"="bus_stop"](area.city);
  nwr["public_transport"="platform"](area.city);
  nwr["share_taxi"="yes"](area.city);
  nwr["amenity"="taxi"]["bus"!="yes"](area.city);
)->.stops;
.stops out center tags;
rel(bn.stops)["type"="route"]["route"~"^(share_taxi|minibus|bus)$"]->.routes;
.routes out body;
`;

async function fetchOverpass() {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      console.error(`→ querying ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'tera-live-station-pipeline/1.0 (open-source; +https://github.com/tofiqueadam/tera-live)',
        },
        body: new URLSearchParams({ data: QUERY }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(`  failed: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr;
}

const round = (n) => Math.round(n * 1e5) / 1e5;

/** Classify an OSM element into a Tera Live station kind. */
export function classify(tags) {
  if (tags.amenity === 'bus_station' || tags.public_transport === 'station') return 'terminal';
  if (tags.share_taxi === 'yes' || tags.amenity === 'taxi') return 'taxi';
  return 'stop';
}

/** Pick the best human name: English, then default, then Amharic. */
export function names(tags) {
  const en = tags['name:en'] || (isLatin(tags.name) ? tags.name : undefined);
  const am = tags['name:am'] || (isEthiopic(tags.name) ? tags.name : undefined);
  return { en, am };
}
const isEthiopic = (s) => !!s && /[ሀ-፿]/.test(s);
const isLatin = (s) => !!s && /[A-Za-z]/.test(s) && !isEthiopic(s);

/**
 * Turn route relations into destination labels keyed by member id.
 * Minibus (share_taxi) routes win; city-bus routes are only used for stops
 * that no minibus route touches.
 */
export function routeDirections(elements) {
  const taxi = new Map();
  const bus = new Map();
  for (const el of elements) {
    if (el.type !== 'relation') continue;
    const t = el.tags || {};
    const to = (t['to:en'] || t.to || '').trim();
    if (!to) continue;
    const target = t.route === 'bus' ? bus : taxi;
    for (const m of el.members || []) {
      if (m.type !== 'node' && m.type !== 'way') continue;
      const key = `${m.type[0]}${m.ref}`;
      if (!target.has(key)) target.set(key, new Set());
      target.get(key).add(to);
    }
  }
  for (const [k, v] of bus) if (!taxi.has(k)) taxi.set(k, v);
  return taxi;
}

const MAX_DIRS = 12;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\u1200-\u137f]+/g, '');

export function toGeoJSON(raw, curated) {
  const elements = raw.elements || [];
  const dirs = routeDirections(elements);
  const seen = new Map();
  for (const el of elements) {
    if (el.type === 'relation' && !el.center) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const tags = el.tags || {};
    const { en, am } = names(tags);
    if (!en && !am) continue; // unnamed stops are not useful to riders
    const kind = classify(tags);
    const id = `${el.type[0]}${el.id}`;
    const self = norm(en || am);
    const routeDirs = [...(dirs.get(id) || [])]
      .filter((d) => norm(d) !== self)
      .sort()
      .slice(0, MAX_DIRS);
    const feature = {
      type: 'Feature',
      id,
      geometry: { type: 'Point', coordinates: [round(lon), round(lat)] },
      properties: {
        id,
        name: en || am,
        ...(am && am !== (en || am) ? { name_am: am } : {}),
        kind,
        ...(routeDirs.length ? { dirs: routeDirs, dir_src: 'osm' } : {}),
      },
    };
    // De-duplicate stops that share a name within ~150 m (platform + stop_position pairs).
    const dupKey = `${(en || am).toLowerCase()}|${Math.round(lat * 150)}|${Math.round(lon * 150)}`;
    const prev = seen.get(dupKey);
    if (!prev || rank(kind) > rank(prev.properties.kind)) seen.set(dupKey, feature);
  }
  const features = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    type: 'FeatureCollection',
    metadata: {
      source: 'OpenStreetMap via Overpass API',
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
      osm_base: raw.osm3s?.timestamp_osm_base || null,
      default_directions: curated.destinations.map((d) => d.id),
      default_directions_status: curated.status,
      count: features.length,
    },
    features,
  };
}
const rank = (k) => ({ terminal: 3, taxi: 2, stop: 1 })[k] || 0;

async function main() {
  const refresh = process.argv.includes('--refresh');
  let raw;
  if (!refresh && existsSync(CACHE)) {
    console.error(`→ using cached Overpass response ${CACHE}`);
    raw = JSON.parse(await readFile(CACHE, 'utf8'));
  } else {
    raw = await fetchOverpass();
    await mkdir(dirname(CACHE), { recursive: true });
    await writeFile(CACHE, JSON.stringify(raw));
  }
  const curated = JSON.parse(await readFile(CURATED, 'utf8'));
  const fc = toGeoJSON(raw, curated);
  await mkdir(dirname(OUT), { recursive: true });
  // One feature per line: diffs stay readable, file stays small.
  const lines = fc.features.map((f) => JSON.stringify(f));
  const body = `{"type":"FeatureCollection","metadata":${JSON.stringify(fc.metadata)},"features":[\n${lines.join(',\n')}\n]}\n`;
  await writeFile(OUT, body);
  const kinds = fc.features.reduce((acc, f) => ((acc[f.properties.kind] = (acc[f.properties.kind] || 0) + 1), acc), {});
  const withDirs = fc.features.filter((f) => f.properties.dirs).length;
  console.error(`✓ wrote ${fc.features.length} stations to ${OUT}`);
  console.error(`  kinds: ${JSON.stringify(kinds)}; with OSM route directions: ${withDirs}`);
  console.error(`  OSM base: ${fc.metadata.osm_base}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
