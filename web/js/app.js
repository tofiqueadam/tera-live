// Tera Live — app bootstrap and state.
//
// Vanilla ES modules, no build step and no framework: the whole app shell is
// ~15 KB gzipped, which matters on congested Addis mobile networks. MapLibre
// is the only heavy dependency and is loaded lazily on first map view.
//
// URL parameters (shareable, and used for screenshots):
//   demo=1            simulated data (always badged SIMULATED DATA)
//   station=<id>      open a station sheet      dir=<slug>  pick destination
//   report=1          open the report flow      step=taxis&q=long  jump to step 2
//   view=list|map     lang=en|am                theme=light|dark
//   at=<lon>,<lat>    pretend location (dev/screenshots)
//   api=<url>         API base override (localhost only)
//   hour=<0-23>       demo only: simulate a given Addis hour      sw=1  register SW on localhost

import { CONFIG } from '../config.js';
import { createApiSource } from './data/api.js';
import { createDemoSource } from './data/demo.js';
import { loadStations } from './data/stations.js';
import { apply, getLang, initLang, safeGet, safeSet, setLang, t } from './i18n/i18n.js';
import { $, $$ } from './ui/dom.js';
import { renderList } from './ui/list.js';
import { createMap } from './ui/map.js';
import { createSheet } from './ui/sheet.js';

const params = new URLSearchParams(location.search);
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const LIVE_REFRESH_MS = 30_000;

const state = {
  data: null,
  source: null,
  live: null,
  here: null,
  locState: 'idle',
  query: '',
  view: params.get('view') === 'map' ? 'map' : 'list',
};

// ---------- theme ----------
const THEME_KEY = 'tera.theme';
function resolvedTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function setTheme(next, persist = true) {
  document.documentElement.dataset.theme = next;
  if (persist) safeSet(THEME_KEY, next);
  const meta = $$('meta[name="theme-color"]');
  for (const m of meta) m.content = resolvedTheme() === 'dark' ? '#0E1217' : '#F4F1EA';
  map?.setTheme(resolvedTheme());
}

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

function notice(msg) {
  const el = $('#notice');
  el.textContent = msg || '';
  el.hidden = !msg;
}

// ---------- views ----------
let map = null;
let sheet = null;

function renderAll() {
  if (!state.data) return;
  renderList($('#station-list'), $('#list-meta'), {
    stations: state.data.stations,
    live: state.live?.stations,
    now: state.live?.now ?? Date.now(),
    here: state.here,
    query: state.query,
    locState: state.locState,
    onOpen: openStation,
  });
  map?.update(state.live?.stations);
  sheet?.rerender();
}

const desktop = matchMedia('(min-width: 960px)');
function setView(view) {
  state.view = view;
  $('#main').dataset.view = view;
  for (const b of $$('.tab')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  if (view === 'map' || desktop.matches) ensureMap();
  requestAnimationFrame(() => map?.resize());
}

function ensureMap() {
  if (map) return;
  const s = params.get('station') && state.data.byId.get(params.get('station'));
  map = createMap($('#map'), {
    geojson: state.data.geojson,
    onOpen: openStation,
    theme: resolvedTheme,
    center: s ? [s.lon, s.lat] : state.here ? [state.here.lon, state.here.lat] : null,
  });
  map.mount().then(() => map.update(state.live?.stations));
}

function openStation(id, opts) {
  sheet.open(id, opts);
  map?.focus(state.data.byId.get(id));
  const url = new URL(location.href);
  url.searchParams.set('station', id);
  for (const k of ['dir', 'report', 'step', 'q']) url.searchParams.delete(k);
  history.replaceState(null, '', url);
}

// ---------- data ----------
async function refreshLive() {
  try {
    state.live = await state.source.live();
    notice(null);
  } catch {
    if (!state.source.simulated) notice(t('offline'));
  }
  renderAll();
}

function locate(silent = false) {
  if (!('geolocation' in navigator)) return;
  const btn = $('#locate-btn');
  btn.setAttribute('aria-busy', 'true');
  if (!silent) $('#list-meta').textContent = t('locating');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // Used only in this browser to sort the list. Never sent to the server.
      state.here = { lon: pos.coords.longitude, lat: pos.coords.latitude };
      state.locState = 'on';
      btn.removeAttribute('aria-busy');
      btn.classList.add('on');
      renderAll();
    },
    () => {
      state.locState = 'denied';
      btn.removeAttribute('aria-busy');
      renderAll();
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
  );
}

// ---------- boot ----------
async function boot() {
  initLang(params.get('lang'));
  const theme = params.get('theme') || safeGet(THEME_KEY);
  if (theme === 'light' || theme === 'dark') setTheme(theme, false);

  const demo = params.get('demo') === '1';
  const apiBase = (isLocal && params.get('api')) || CONFIG.apiBase;

  state.data = await loadStations();
  if (demo) {
    // Demo only: ?hour=8 replays the simulation at 08:xx Addis time (e.g. rush hour).
    const hour = Number(params.get('hour'));
    let offset = 0;
    if (params.has('hour') && hour >= 0 && hour < 24) {
      const addisHour = new Date(Date.now() + 3 * 3_600_000).getUTCHours();
      offset = (hour - addisHour) * 3_600_000;
    }
    state.source = createDemoSource(state.data, () => Date.now() + offset);
  }
  else if (apiBase) state.source = createApiSource(apiBase);
  else {
    // No backend configured: do NOT fake it. Fall back to an empty live layer
    // and point to demo mode.
    state.source = { simulated: false, live: async () => ({ now: Date.now(), stations: {} }), station: async () => null, report: async () => ({ ok: false, reason: 'no_backend' }) };
    notice('No live backend configured — open ?demo=1 for a simulated preview.');
  }

  if (state.source.simulated) {
    $('#sim-badge').hidden = false;
    document.body.classList.add('has-sim');
  }

  sheet = createSheet($('#sheet'), $('#scrim'), {
    data: state.data,
    source: state.source,
    getLive: () => state.live?.stations,
    getHere: () => state.here,
    onClose: () => {
      map?.focus(null);
      const url = new URL(location.href);
      for (const k of ['station', 'dir', 'report', 'step', 'q']) url.searchParams.delete(k);
      history.replaceState(null, '', url);
    },
    onReported: refreshLive,
    toast,
  });

  // wiring
  $('#lang-btn').addEventListener('click', () => {
    setLang(getLang() === 'en' ? 'am' : 'en');
    renderAll();
  });
  $('#theme-btn').addEventListener('click', () => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark'));
  for (const b of $$('.tab')) b.addEventListener('click', () => setView(b.dataset.view));
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderAll();
  });
  $('#locate-btn').addEventListener('click', () => locate());
  desktop.addEventListener('change', () => setView(state.view));

  const at = params.get('at')?.split(',').map(Number);
  if (at?.length === 2 && at.every(Number.isFinite)) {
    state.here = { lon: at[0], lat: at[1] };
    state.locState = 'on';
    $('#locate-btn').classList.add('on');
  } else if (navigator.permissions) {
    // Only auto-locate if the rider already granted permission earlier.
    navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state === 'granted' && locate(true), () => {});
  }

  apply();
  setView(state.view);
  await refreshLive();

  const sid = params.get('station');
  if (sid && state.data.byId.has(sid)) {
    sheet.open(sid, { dir: params.get('dir'), report: params.get('report') === '1', step: params.get('step'), q: params.get('q') });
    map?.focus(state.data.byId.get(sid));
  }

  setInterval(() => document.visibilityState === 'visible' && refreshLive(), LIVE_REFRESH_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshLive());

  if ('serviceWorker' in navigator && (!isLocal || params.has('sw'))) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot().catch((err) => {
  console.error(err);
  notice('Could not start Tera Live. Check your connection and reload.');
});
