// Station sheet: live board, "usually at this hour", and the 2-tap report flow.
import { QUEUE, TAXIS, haversine } from '../core/model.js';
import { directionsFor, dirLabel } from '../data/stations.js';
import { getLang, t } from '../i18n/i18n.js';
import { h } from './dom.js';
import { ago, bars, distance, queueChip } from './status.js';

const CLOSE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

export function createSheet(el, scrim, ctx) {
  // ctx: { data, source, getLive, getHere, onClose, onReported, toast }
  let state = null;
  let opener = null;

  function close() {
    if (!state) return;
    state = null;
    el.hidden = true;
    scrim.hidden = true;
    el.replaceChildren();
    ctx.onClose();
    opener?.focus?.();
  }

  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state) close();
  });

  async function open(id, opts = {}) {
    const station = ctx.data.byId.get(id);
    if (!station) return;
    if (!state || state.station.id !== id) opener = document.activeElement;
    state = {
      station,
      detail: null,
      dir: opts.dir || null,
      mode: opts.report ? 'report' : 'view',
      step: opts.step === 'taxis' && opts.q ? 'taxis' : 'queue',
      q: opts.q || null,
      sending: false,
      result: null,
    };
    el.hidden = false;
    scrim.hidden = false;
    render();
    el.querySelector('.sh-close')?.focus({ preventScroll: true });
    try {
      const detail = await ctx.source.station(id);
      if (state?.station.id !== id) return;
      state.detail = detail;
      render();
    } catch {
      /* offline: the live snapshot already gives us something to show */
    }
  }

  function dirs() {
    const all = directionsFor(state.station, ctx.data.destinations);
    const liveDirs = state.detail?.directions?.map((d) => d.id) ?? Object.keys(ctx.getLive()?.[state.station.id]?.d ?? {});
    const rank = (d) => {
      const i = liveDirs.indexOf(d.id);
      return i === -1 ? 1000 + all.indexOf(d) : i;
    };
    return all.slice().sort((a, b) => rank(a) - rank(b));
  }

  function liveFor(dirId) {
    const fromDetail = state.detail?.directions?.find((d) => d.id === dirId);
    if (fromDetail) return fromDetail;
    const l = ctx.getLive()?.[state.station.id]?.d?.[dirId];
    return l ? { id: dirId, live: l, usual: null, profile: null } : { id: dirId, live: null, usual: null, profile: null };
  }

  function render() {
    if (!state) return;
    const { station } = state;
    const lang = getLang();
    const list = dirs();
    if (!state.dir || !list.some((d) => d.id === state.dir)) state.dir = list[0]?.id;
    const dir = list.find((d) => d.id === state.dir);
    const here = ctx.getHere();
    const dist = here ? haversine(here.lon, here.lat, station.lon, station.lat) : null;
    const snapshot = ctx.getLive()?.[station.id];

    const head = h(
      'header',
      { class: 'sh-head' },
      h(
        'div',
        { class: 'sh-kicker' },
        h('span', { class: 'label' }, t(`kind_${station.kind}`)),
        h('span', { class: 'label code' }, station.id.toUpperCase()),
        dist != null ? h('span', { class: 'label' }, distance(dist)) : null,
      ),
      h(
        'h2',
        { class: 'sh-title', id: 'sheet-title' },
        lang === 'am' && station.nameAm ? station.nameAm : station.name,
        station.nameAm ? h('span', { class: 'am', lang: lang === 'am' ? 'en' : 'am' }, lang === 'am' ? station.name : station.nameAm) : null,
      ),
      h('button', { class: 'icon-btn sh-close', type: 'button', 'aria-label': t('close'), onclick: close, html: CLOSE_ICON }),
    );

    const dirChips = h(
      'section',
      { class: 'sec', 'aria-label': t('directions') },
      h('div', { class: 'sec-head' }, h('span', { class: 'label' }, t('report_where'))),
      h(
        'div',
        { class: 'dirs', role: 'group' },
        list.map((d) => {
          const l = state.detail?.directions?.find((x) => x.id === d.id)?.live ?? snapshot?.d?.[d.id];
          return h(
            'button',
            {
              class: 'dir',
              type: 'button',
              'aria-pressed': String(d.id === state.dir),
              onclick: () => {
                state.dir = d.id;
                if (state.mode === 'report' && state.step === 'done') state.mode = 'view';
                render();
                el.querySelector('.dir[aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
              },
            },
            h('i', { class: l ? `q-${l.q}` : null, 'aria-hidden': 'true' }),
            h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
            dirLabel(d, lang),
          );
        }),
      ),
      dir?.src === 'curated' ? h('p', { class: 'review-note' }, t('dir_review')) : null,
    );

    const body = h('div', { class: 'sh-body' }, dirChips);
    if (state.mode === 'view') body.append(...viewSections(dir, lang));
    else body.append(reportPanel(dir, lang));

    const parts = [h('span', { class: 'grab', 'aria-hidden': 'true' }), head, body];
    if (state.mode === 'view') {
      parts.push(
        h(
          'div',
          { class: 'report-bar' },
          h(
            'button',
            {
              class: 'cta',
              type: 'button',
              onclick: () => {
                state.mode = 'report';
                state.step = 'queue';
                state.q = null;
                render();
                el.querySelector('.opt')?.focus({ preventScroll: true });
              },
            },
            h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'),
            t('report_cta'),
          ),
        ),
      );
    }
    el.replaceChildren(...parts);
  }

  function viewSections(dir, lang) {
    const now = state.detail?.now ?? ctx.getLive()?.now ?? Date.now();
    const info = liveFor(dir.id);
    const l = info.live;

    const board = h(
      'section',
      { class: 'sec' },
      h('div', { class: 'sec-head' }, h('span', { class: 'label' }, t('live_now')), h('span', { class: 'label' }, `→ ${dirLabel(dir, lang)}`)),
      h(
        'div',
        { class: 'board' },
        h(
          'div',
          { class: 'cell' },
          h('span', { class: 'label' }, t('queue')),
          l ? h('span', { class: `big q-${l.q}` }, bars(l.q), t(`q_${l.q}`)) : h('span', { class: 'big q-unknown' }, t('no_data')),
        ),
        h(
          'div',
          { class: 'cell' },
          h('span', { class: 'label' }, t('taxis')),
          l ? h('span', { class: `big t-plain taxi t-${l.t}` }, t(`t_${l.t}`)) : h('span', { class: 'big q-unknown' }, '—'),
        ),
        l
          ? h(
              'div',
              { class: 'board-foot' },
              h('span', null, `${ago(l.at, now)} · ${t('reports_n', { n: l.n })}`),
              h('span', { class: `conf ${l.c}` }, h('i', { 'aria-hidden': 'true' }), t(`conf_${l.c}`)),
            )
          : null,
      ),
    );

    const u = info.usual;
    const slot = state.detail?.slot;
    const usual = h(
      'section',
      { class: 'sec' },
      h('div', { class: 'sec-head' }, h('span', { class: 'label' }, t('usual_now')), slot ? h('span', { class: 'label' }, `${t(`day_${slot.weekday}`)} ${String(slot.hour).padStart(2, '0')}:00`) : null),
      u
        ? h('div', { class: 'usual' }, queueChip(u.q, { ghost: true }), h('span', { class: 'usual-note' }, `${t('usual_taxi', { p: Math.round(u.pWaiting * 100) })} · ${t('usual_based', { n: u.total })}`))
        : h('p', { class: 'usual-note' }, state.detail ? t('usual_none') : '…'),
      info.profile && slot ? profile(info.profile, slot) : null,
    );

    const others = (state.detail?.directions ?? [])
      .filter((d) => d.id !== dir.id && d.live)
      .map((d) => {
        const meta = directionsFor(state.station, ctx.data.destinations).find((x) => x.id === d.id) || { en: d.id };
        return h('li', null, h('span', { class: 'nm' }, `→ ${dirLabel(meta, lang)}`), queueChip(d.live.q));
      });
    const otherSec = others.length
      ? h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('span', { class: 'label' }, t('directions'))), h('ul', { class: 'others' }, others))
      : null;

    return [board, usual, otherSec].filter(Boolean);
  }

  function profile(values, slot) {
    const level = (v) => (v == null ? null : QUEUE[Math.max(0, Math.min(3, Math.round(v)))]);
    return h(
      'div',
      { class: 'profile', role: 'img', 'aria-label': t('typical_day', { day: t(`day_${slot.weekday}`) }) },
      h('div', { class: 'sec-head' }, h('span', { class: 'label' }, t('typical_day', { day: t(`day_${slot.weekday}`) }))),
      h(
        'div',
        { class: 'profile-bars' },
        values.map((v, hr) =>
          h('i', {
            class: [v == null ? null : `q-${level(v)}`, hr === slot.hour ? 'now' : null].filter(Boolean).join(' ') || null,
            style: `height:${v == null ? 2 : Math.max(6, (v / 3) * 100)}%`,
            title: `${String(hr).padStart(2, '0')}:00`,
          }),
        ),
      ),
      h('div', { class: 'profile-axis', 'aria-hidden': 'true' }, ['00', '06', '12', '18', '24'].map((x) => h('span', null, x))),
    );
  }

  function reportPanel(dir, lang) {
    const steps = h('div', { class: 'steps', 'aria-hidden': 'true' }, h('i', { class: 'on' }), h('i', { class: state.step !== 'queue' ? 'on' : null }));
    const panel = h('section', { class: 'sec report', 'aria-live': 'polite' }, steps);

    if (state.step === 'queue') {
      panel.append(
        h('h3', { class: 'q-title' }, t('report_queue')),
        h('p', { class: 'q-sub' }, `→ ${dirLabel(dir, lang)}`),
        h(
          'div',
          { class: 'opts' },
          QUEUE.map((q) =>
            h(
              'button',
              {
                class: `opt q-${q}`,
                type: 'button',
                'aria-pressed': String(state.q === q),
                onclick: () => {
                  state.q = q;
                  state.step = 'taxis';
                  render();
                  el.querySelector('.opt')?.focus({ preventScroll: true });
                },
              },
              bars(q, 'glyph'),
              h('span', { class: 'opt-name' }, t(`q_${q}`)),
            ),
          ),
        ),
        h('button', { class: 'linkish', type: 'button', onclick: () => ((state.mode = 'view'), render()) }, t('back')),
      );
    } else if (state.step === 'taxis') {
      panel.append(
        h('h3', { class: 'q-title' }, t('report_taxis')),
        h('div', { class: 'chosen' }, h('span', { class: 'q-sub', style: 'margin:0' }, `→ ${dirLabel(dir, lang)}`), queueChip(state.q)),
        h(
          'div',
          { class: 'opts three' },
          TAXIS.map((tx) =>
            h(
              'button',
              { class: `opt t-${tx}`, type: 'button', disabled: state.sending || null, onclick: () => submit(dir, tx) },
              h('span', { class: 'tdot', 'aria-hidden': 'true' }),
              h('span', { class: 'opt-name' }, t(`t_${tx}`)),
            ),
          ),
        ),
        h('button', { class: 'linkish', type: 'button', onclick: () => ((state.step = 'queue'), render()) }, t('back')),
      );
    } else {
      const r = state.result;
      panel.append(
        h(
          'div',
          { class: 'done' },
          h('div', { class: 'tick', 'aria-hidden': 'true' }, '✓'),
          h('h3', { class: 'q-title' }, r?.queued ? t('report_offline') : t('report_thanks')),
          r?.live ? h('p', { class: 'q-sub' }, `→ ${dirLabel(dir, lang)} `, queueChip(r.live.q)) : null,
          ctx.source.simulated ? h('p', { class: 'review-note', style: 'justify-content:center' }, t('simulated_note')) : null,
          h('button', { class: 'cta', type: 'button', onclick: close }, t('close')),
        ),
      );
    }
    return panel;
  }

  async function submit(dir, tx) {
    if (state.sending) return;
    state.sending = true;
    render();
    const id = state.station.id;
    try {
      const res = await ctx.source.report({ station: id, direction: dir.id, queue: state.q, taxis: tx });
      if (state?.station.id !== id) return;
      state.sending = false;
      if (!res.ok) {
        const key = res.reason === 'duplicate' ? 'report_duplicate' : res.reason === 'rate_limited' ? 'report_rate' : res.status === 422 ? 'report_too_far' : 'report_error';
        ctx.toast(t(key));
        render();
        return;
      }
      state.result = res;
      state.step = 'done';
      render();
      ctx.onReported();
      const fresh = await ctx.source.station(id).catch(() => null);
      if (fresh && state?.station.id === id) state.detail = fresh;
    } catch {
      state.sending = false;
      ctx.toast(t('report_error'));
      render();
    }
  }

  return { open, close, isOpen: () => !!state, current: () => state?.station.id ?? null, rerender: render };
}
