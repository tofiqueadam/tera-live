/**
 * Minimal Telegram bot webhook: lets riders report from Telegram, which many
 * Addis riders already use daily, without installing anything.
 *
 * Flow (all inline buttons, so it works one-handed):
 *   station name or shared location  →  pick station  →  destination
 *   →  line length  →  taxis  →  report recorded, live status shown
 *
 * Replies are returned in the webhook response body (Telegram's "reply with a
 * method" feature), so the happy path needs no outbound request. A shared
 * location is used once to find nearby stations and is never stored.
 */
import { QUEUE, TAXIS, aggregate } from '../../web/js/core/model.js';
import { translate } from '../../web/js/i18n/strings.js';
import type { Env } from './env';
import { error, json } from './http';
import { liveFor, submitReport } from './reports';
import { DESTINATIONS, directionsFor, getStation, nearestStations, searchStations, type Station } from './stations';

type Lang = 'en' | 'am';
const t = (lang: Lang, key: string, vars?: Record<string, unknown>) => translate(lang, key, vars);
/** Bilingual label for a button, e.g. "Long · ረጅም". */
const both = (key: string) => `${t('en', key)} · ${t('am', key)}`;

interface TgUser { id: number; language_code?: string }
interface TgMessage {
  message_id: number;
  chat: { id: number };
  from?: TgUser;
  text?: string;
  location?: { latitude: number; longitude: number };
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
}
type Button = { text: string; callback_data: string };

const MAX_DIR_BUTTONS = 10;

export async function handleTelegram(req: Request, env: Env, ctx: ExecutionContext, now: number): Promise<Response> {
  if (!env.TELEGRAM_WEBHOOK_SECRET) return error(503, 'telegram disabled');
  if (!secretMatches(req.headers.get('x-telegram-bot-api-secret-token'), env.TELEGRAM_WEBHOOK_SECRET)) return error(401, 'bad secret');

  let update: TgUpdate;
  try {
    update = await req.json();
  } catch {
    return error(400, 'invalid JSON');
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    // Stop the button spinner. Best effort, outside the response path.
    if (env.TELEGRAM_BOT_TOKEN) ctx.waitUntil(callApi(env, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {}));
    if (!cq.message || !cq.data) return json({});
    const reply = await onCallback(env, cq.data, cq.from, now);
    return json({ method: 'editMessageText', chat_id: cq.message.chat.id, message_id: cq.message.message_id, ...reply });
  }

  const msg = update.message;
  if (!msg) return json({});
  const lang = langOf(msg.from);
  const chat_id = msg.chat.id;

  if (msg.location) {
    const near = nearestStations(msg.location.longitude, msg.location.latitude, 6);
    return json({ method: 'sendMessage', chat_id, text: t(lang, 'tg_pick_station'), reply_markup: stationKeyboard(near, 's') });
  }

  const text = (msg.text || '').trim();
  if (!text || text === '/start' || text === '/help') return json({ method: 'sendMessage', chat_id, text: t(lang, 'tg_help') });

  const statusCmd = text.match(/^\/status(?:@\w+)?\s+(.+)$/);
  const query = statusCmd ? statusCmd[1] : text.replace(/^\/report(?:@\w+)?\s*/, '');
  const hits = searchStations(query);
  if (!hits.length) return json({ method: 'sendMessage', chat_id, text: t(lang, 'tg_no_match') });

  if (statusCmd && hits.length === 1) return json({ method: 'sendMessage', chat_id, text: await statusText(env, hits[0], now, lang) });
  return json({ method: 'sendMessage', chat_id, text: t(lang, 'tg_pick_station'), reply_markup: stationKeyboard(hits, statusCmd ? 'v' : 's') });
}

/**
 * Callback data is a tiny state machine encoded in ≤ 64 bytes:
 *   s:<station>                 → choose destination
 *   d:<station>:<dir>           → choose line length
 *   q:<station>:<dir>:<q>       → choose taxis
 *   t:<station>:<dir>:<q>:<t>   → submit
 *   v:<station>                 → view live status
 */
export async function onCallback(env: Env, data: string, from: TgUser, now: number) {
  const lang = langOf(from);
  const [op, sid, dirIdx, q, tx] = data.split(':');
  const station = getStation(sid || '');
  if (!station) return { text: t(lang, 'tg_no_match') };
  const dirs = directionsFor(station);
  const di = Number(dirIdx);
  const dir = Number.isInteger(di) && di >= 0 && di < dirs.length ? dirs[di] : null;
  const title = `${station.name}${station.nameAm ? ` · ${station.nameAm}` : ''}`;

  switch (op) {
    case 'v':
      return { text: await statusText(env, station, now, lang) };
    case 's':
      return {
        text: `${title}\n${both('report_where')}`,
        reply_markup: grid(
          dirs.slice(0, MAX_DIR_BUTTONS).map((d, i) => ({ text: dirLabel(d), callback_data: `d:${sid}:${i}` })),
          2,
        ),
      };
    case 'd':
      if (!dir) break;
      return {
        text: `${title} → ${dirLabel(dir)}\n${both('report_queue')}`,
        reply_markup: grid(QUEUE.map((k, i) => ({ text: both(`q_${k}`), callback_data: `q:${sid}:${di}:${i}` })), 2),
      };
    case 'q': {
      const qi = Number(q);
      if (!dir || !(Number.isInteger(qi) && qi >= 0 && qi < QUEUE.length)) break;
      return {
        text: `${title} → ${dirLabel(dir)}\n${both('report_taxis')}`,
        reply_markup: grid(TAXIS.map((k, i) => ({ text: both(`t_${k}`), callback_data: `t:${sid}:${di}:${qi}:${i}` })), 1),
      };
    }
    case 't': {
      const qi = Number(q), ti = Number(tx);
      const valid = (n: number, len: number) => Number.isInteger(n) && n >= 0 && n < len;
      if (!dir || !valid(qi, QUEUE.length) || !valid(ti, TAXIS.length)) break;
      const res = await submitReport(
        env,
        { station, direction: dir, queue: qi, taxis: ti, device: String(from.id) },
        { source: 'telegram', ip: null, now },
      );
      if (!res.ok) {
        const key = res.reason === 'duplicate' ? 'report_duplicate' : res.reason === 'rate_limited' ? 'report_rate' : 'report_too_far';
        return { text: `${title} → ${dirLabel(dir)}\n${t(lang, key)}` };
      }
      return { text: `✓ ${t(lang, 'report_thanks')}\n\n${await statusText(env, station, now, lang)}` };
    }
  }
  return { text: t(lang, 'tg_no_match') };
}

async function statusText(env: Env, station: Station, now: number, lang: Lang): Promise<string> {
  const live = await liveFor(env.DB, station.id, now);
  const lines = [`${station.name}${station.nameAm ? ` · ${station.nameAm}` : ''}`];
  const entries = [...live.entries()].filter((e): e is [string, NonNullable<ReturnType<typeof aggregate>>] => !!e[1]);
  if (!entries.length) lines.push(t(lang, 'tg_live_none'));
  for (const [dir, a] of entries.sort((x, y) => y[1].lastAt - x[1].lastAt)) {
    const mins = Math.round((now - a.lastAt) / 60_000);
    const ago = mins < 1 ? t(lang, 'just_now') : t(lang, 'min_ago', { n: mins });
    lines.push(`→ ${dirLabel(dir)}: ${t(lang, 'queue')} ${t(lang, `q_${QUEUE[a.queue]}`)} · ${t(lang, 'taxis')} ${t(lang, `t_${TAXIS[a.taxis]}`)} · ${ago}`);
  }
  return lines.join('\n');
}

function stationKeyboard(stations: Station[], op: 's' | 'v') {
  return grid(stations.map((s) => ({ text: s.nameAm ? `${s.name} · ${s.nameAm}` : s.name, callback_data: `${op}:${s.id}` })), 1);
}

function grid(buttons: Button[], cols: number) {
  const rows: Button[][] = [];
  for (let i = 0; i < buttons.length; i += cols) rows.push(buttons.slice(i, i + cols));
  return { inline_keyboard: rows };
}

/** Curated ids map to their bilingual names; OSM slugs are title-cased. */
export function dirLabel(dir: string): string {
  const d = DESTINATIONS.find((x) => x.id === dir);
  if (d) return `${d.en} · ${d.am}`;
  return dir.replace(/-/g, ' ').replace(/(^|\s)(\p{L})/gu, (_m, sp, c) => sp + c.toUpperCase());
}

function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

const langOf = (u?: TgUser): Lang => (u?.language_code === 'am' ? 'am' : 'en');

async function callApi(env: Env, method: string, body: unknown) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
