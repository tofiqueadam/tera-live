// Map view. MapLibre GL JS (~240 KB br) is loaded lazily, only when the map is
// first shown, so the list view stays usable on slow connections.
//
// Basemap: OpenFreeMap (free, no API key, commercial use allowed; attribution
// "© OpenMapTiles, Data from OpenStreetMap" is added by MapLibre from the style).

const MAPLIBRE = 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.16.0/dist';
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const ADDIS = { center: [38.7578, 9.0108], zoom: 12.2 };
const Q_INDEX = { none: 0, short: 1, long: 2, very_long: 3 };

let lib = null;

async function loadLib() {
  if (lib) return lib;
  if (!document.querySelector('link[data-maplibre]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${MAPLIBRE}/maplibre-gl.css`;
    css.dataset.maplibre = '';
    document.head.append(css);
  }
  lib = await import(`${MAPLIBRE}/maplibre-gl.mjs`);
  return lib;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Station features with the live overall status folded into properties. */
export function toFeatures(geojson, live) {
  return {
    type: 'FeatureCollection',
    features: geojson.features.map((f) => {
      const l = live?.[f.id];
      return {
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: { id: f.id, name: f.properties.name, kind: f.properties.kind, q: l ? Q_INDEX[l.q] : -1 },
      };
    }),
  };
}

export function createMap(container, { geojson, onOpen, theme, center }) {
  let map = null;
  let ready = false;
  let pending = null;
  let selected = null;

  function colours() {
    return {
      ink: cssVar('--ink'),
      bg: cssVar('--bg'),
      muted: cssVar('--muted'),
      q: [cssVar('--q-none'), cssVar('--q-short'), cssVar('--q-long'), cssVar('--q-very_long')],
    };
  }

  function addLayers() {
    const c = colours();
    if (!map.getSource('stations')) map.addSource('stations', { type: 'geojson', data: pending || toFeatures(geojson, null), promoteId: 'id' });
    const qColor = ['match', ['get', 'q'], 0, c.q[0], 1, c.q[1], 2, c.q[2], 3, c.q[3], c.muted];
    map.addLayer({
      id: 'st-idle',
      type: 'circle',
      source: 'stations',
      filter: ['<', ['get', 'q'], 0],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, ['match', ['get', 'kind'], 'terminal', 5, 3.5]],
        'circle-color': c.bg,
        'circle-stroke-color': c.muted,
        'circle-stroke-width': 1.2,
      },
    });
    map.addLayer({
      id: 'st-live',
      type: 'circle',
      source: 'stations',
      filter: ['>=', ['get', 'q'], 0],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 13, ['match', ['get', 'kind'], 'terminal', 10, 7.5], 16, 13],
        'circle-color': qColor,
        'circle-stroke-color': c.ink,
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3.5, 1.6],
      },
    });
    map.addLayer({
      id: 'st-label',
      type: 'symbol',
      source: 'stations',
      minzoom: 13.2,
      filter: ['any', ['>=', ['get', 'q'], 0], ['==', ['get', 'kind'], 'terminal']],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
        'text-offset': [0, 1.25],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: { 'text-color': c.ink, 'text-halo-color': c.bg, 'text-halo-width': 1.6 },
    });
    ready = true;
    if (selected) setSelected(selected);
  }

  async function mount() {
    if (map) return;
    let maplibregl;
    try {
      maplibregl = await loadLib();
    } catch {
      container.innerHTML = '<p class="map-fallback">Map could not load on this connection. The list still works.</p>';
      return;
    }
    map = new maplibregl.Map({
      container,
      style: STYLES[theme()] || STYLES.light,
      center: center || ADDIS.center,
      zoom: center ? 14.5 : ADDIS.zoom,
      attributionControl: { compact: true, customAttribution: 'Stations © OpenStreetMap contributors (ODbL)' },
      fadeDuration: 0,
    });
    new ResizeObserver(() => map.resize()).observe(container);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // Layer-scoped listeners survive style swaps (theme changes), so bind once.
    for (const layer of ['st-live', 'st-idle']) {
      map.on('click', layer, (e) => e.features?.[0] && onOpen(e.features[0].properties.id));
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
    map.on('style.load', () => {
      ready = false;
      addLayers();
    });
  }

  function setSelected(id) {
    if (ready && selected && selected !== id) map.setFeatureState({ source: 'stations', id: selected }, { selected: false });
    selected = id;
    if (ready && id) map.setFeatureState({ source: 'stations', id }, { selected: true });
  }

  return {
    mount,
    resize: () => map?.resize(),
    update(live) {
      pending = toFeatures(geojson, live);
      if (ready) map.getSource('stations').setData(pending);
    },
    setTheme(name) {
      if (map) map.setStyle(STYLES[name] || STYLES.light);
    },
    focus(station) {
      setSelected(station?.id ?? null);
      if (map && station) map.easeTo({ center: [station.lon, station.lat], zoom: Math.max(map.getZoom(), 14), duration: 500 });
    },
  };
}
