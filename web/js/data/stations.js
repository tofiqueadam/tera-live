import { slug } from '../core/model.js';

/**
 * Load the static OSM station list. Directions from OSM route relations come
 * first; the curated major destinations are always offered after them.
 */
export async function loadStations(url = 'data/stations.geojson') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`stations: HTTP ${res.status}`);
  const fc = await res.json();
  const destinations = fc.metadata.destinations || [];
  const stations = fc.features.map((f) => {
    const p = f.properties;
    return {
      id: p.id,
      name: p.name,
      nameAm: p.name_am || '',
      kind: p.kind,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      osmDirs: (p.dirs || []).map((n) => ({ id: slug(n), en: n, am: '', src: 'osm' })),
    };
  });
  const byId = new Map(stations.map((s) => [s.id, s]));
  return { stations, byId, destinations, meta: fc.metadata, geojson: fc };
}

/** All destinations selectable at a station, mirroring the Worker's directionsFor(). */
export function directionsFor(station, destinations) {
  const out = [...station.osmDirs];
  const seen = new Set(out.map((d) => d.id));
  for (const d of destinations) if (!seen.has(d.id)) out.push({ ...d, src: 'curated' });
  return out;
}

export function dirLabel(dir, lang) {
  return (lang === 'am' && dir.am) || dir.en;
}
