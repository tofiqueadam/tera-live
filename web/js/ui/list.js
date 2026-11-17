import { haversine } from '../core/model.js';
import { getLang, t } from '../i18n/i18n.js';
import { h } from './dom.js';
import { ago, distance, queueChip, taxiTag } from './status.js';

const MAX_ROWS = 80;

/**
 * Sort: by distance when we know where the rider is, otherwise by live
 * activity (freshest first), then terminals, then name.
 */
export function sortStations(stations, live, here) {
  const rows = stations.map((s) => ({
    s,
    live: live?.[s.id] || null,
    dist: here ? haversine(here.lon, here.lat, s.lon, s.lat) : null,
  }));
  if (here) rows.sort((a, b) => a.dist - b.dist);
  else
    rows.sort(
      (a, b) =>
        (b.live?.at ?? 0) - (a.live?.at ?? 0) ||
        (a.s.kind === 'terminal' ? -1 : 0) - (b.s.kind === 'terminal' ? -1 : 0) ||
        a.s.name.localeCompare(b.s.name),
    );
  return rows;
}

export function matches(s, q) {
  if (!q) return true;
  const n = q.trim().toLowerCase();
  return s.name.toLowerCase().includes(n) || (s.nameAm && s.nameAm.includes(q.trim()));
}

export function renderList(el, metaEl, { stations, live, now, here, query, locState, onOpen }) {
  const rows = sortStations(stations.filter((s) => matches(s, query)), live, here);
  const liveCount = Object.keys(live || {}).length;
  const sortNote = here ? t('located') : locState === 'denied' ? t('locate_denied') : t('sorted_activity');
  metaEl.textContent = [t('stations_n', { n: stations.length.toLocaleString() }), t('live_n', { n: liveCount }), sortNote].join(' · ');

  const lang = getLang();
  el.replaceChildren(
    ...rows.slice(0, MAX_ROWS).map(({ s, live: l, dist }) => {
      const metaBits = [t(`kind_${s.kind}`)];
      if (dist != null) metaBits.push(distance(dist));
      if (l) metaBits.push(ago(l.at, now));
      return h(
        'li',
        null,
        h(
          'button',
          { class: 'st', type: 'button', onclick: () => onOpen(s.id), 'aria-label': `${s.name}${l ? `, ${t(`q_${l.q}`)}` : ''}` },
          h('span', { class: `st-rail${l ? ` q-${l.q}` : ''}`, 'aria-hidden': 'true' }),
          h(
            'span',
            { class: 'st-main' },
            h('span', { class: 'st-name' }, lang === 'am' && s.nameAm ? s.nameAm : s.name, s.nameAm && lang !== 'am' ? h('span', { class: 'st-am', lang: 'am' }, s.nameAm) : null),
            h('span', { class: 'st-meta' }, metaBits.join(' · ')),
          ),
          h(
            'span',
            { class: 'st-side' },
            l ? queueChip(l.q) : h('span', { class: 'chip q-unknown' }, '—'),
            l ? taxiTag(l.t) : null,
          ),
        ),
      );
    }),
  );
  if (!rows.length) el.append(h('li', { class: 'empty' }, t('tg_no_match')));
}

