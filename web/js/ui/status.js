import { QUEUE } from '../core/model.js';
import { t } from '../i18n/i18n.js';
import { h } from './dom.js';

/** Four-bar glyph so status never relies on colour alone. */
export function bars(q, cls = 'bars') {
  const level = QUEUE.indexOf(q);
  return h('span', { class: cls, 'aria-hidden': 'true' }, [0, 1, 2, 3].map((i) => h('i', { class: i <= level ? 'on' : null })));
}

export function queueChip(q, { ghost = false } = {}) {
  if (!q) return h('span', { class: 'chip q-unknown' }, t('no_data'));
  return h('span', { class: `chip q-${q}${ghost ? ' ghost' : ''}` }, bars(q), t(`q_${q}`));
}

export function taxiTag(tx) {
  return h('span', { class: `taxi t-${tx}` }, t(`t_${tx}`));
}

export function ago(at, now) {
  const mins = Math.round((now - at) / 60_000);
  return mins < 1 ? t('just_now') : t('min_ago', { n: mins });
}

export function distance(m) {
  if (m == null) return '';
  return m < 1000 ? t('away_m', { n: Math.round(m / 10) * 10 }) : t('away_km', { n: (m / 1000).toFixed(m < 10_000 ? 1 : 0) });
}
