import index from './generated/stations.json';
import { haversine } from '../../web/js/core/model.js';

/** [lon, lat, name, directionSlugs, nameAm] */
type Entry = [number, number, string, string[], string];

const STATIONS = index.stations as unknown as Record<string, Entry>;
export const DESTINATIONS: { id: string; en: string; am: string }[] = index.destinations;
const DEFAULT_IDS = new Set(DESTINATIONS.map((d) => d.id));

export interface Station {
  id: string;
  lon: number;
  lat: number;
  name: string;
  nameAm: string;
  /** Direction slugs from OSM route relations (may be empty). */
  osmDirections: string[];
}

export function getStation(id: string): Station | null {
  if (!Object.prototype.hasOwnProperty.call(STATIONS, id)) return null;
  const [lon, lat, name, dirs, nameAm] = STATIONS[id];
  return { id, lon, lat, name, nameAm, osmDirections: dirs };
}

/** A direction is valid if OSM routes list it for this station or it is a curated major destination. */
export function isValidDirection(station: Station, direction: string): boolean {
  return station.osmDirections.includes(direction) || DEFAULT_IDS.has(direction);
}

/** All directions a rider can choose at a station, OSM-derived first. */
export function directionsFor(station: Station): string[] {
  const out = [...station.osmDirections];
  for (const d of DESTINATIONS) if (!out.includes(d.id)) out.push(d.id);
  return out;
}

export function distanceMeters(a: Station, b: Station): number {
  return haversine(a.lon, a.lat, b.lon, b.lat);
}

/** Case-insensitive name search for the Telegram bot. Prefix matches rank first. */
export function searchStations(query: string, limit = 6): Station[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: { s: Station; score: number }[] = [];
  for (const id in STATIONS) {
    const [, , name, , nameAm] = STATIONS[id];
    const n = name.toLowerCase();
    let score = -1;
    if (n === q || nameAm === query.trim()) score = 0;
    else if (n.startsWith(q)) score = 1;
    else if (n.includes(q) || (nameAm && nameAm.includes(query.trim()))) score = 2;
    if (score >= 0) hits.push({ s: getStation(id)!, score });
  }
  hits.sort((a, b) => a.score - b.score || a.s.name.length - b.s.name.length || a.s.id.localeCompare(b.s.id));
  return hits.slice(0, limit).map((h) => h.s);
}

export function nearestStations(lon: number, lat: number, limit = 5): Station[] {
  const all: { s: Station; d: number }[] = [];
  for (const id in STATIONS) {
    const s = getStation(id)!;
    all.push({ s, d: haversine(lon, lat, s.lon, s.lat) });
  }
  all.sort((a, b) => a.d - b.d);
  return all.slice(0, limit).map((x) => x.s);
}
