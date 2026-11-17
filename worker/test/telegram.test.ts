import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clock } from '../src/index';
import { dirLabel } from '../src/telegram';
import { CMC, TZNA } from './fixtures';

const T0 = Date.UTC(2026, 10, 16, 5, 30);
const URL_ = 'https://api.tera.test/telegram/webhook';
const SECRET = 'tg-test-secret';
const user = { id: 424242, language_code: 'en' };

const send = (update: unknown, secret: string | null = SECRET) =>
  SELF.fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
    body: JSON.stringify(update),
  });
const text = (t: string, from = user) => ({ update_id: 1, message: { message_id: 10, chat: { id: 99 }, from, text: t } });
const tap = (data: string, from = user) => ({
  update_id: 2,
  callback_query: { id: 'cb1', from, data, message: { message_id: 11, chat: { id: 99 } } },
});
const buttons = (body: any): { text: string; callback_data: string }[] => body.reply_markup.inline_keyboard.flat();

beforeEach(async () => {
  clock.now = () => T0;
  await env.DB.batch(['reports', 'hourly_stats', 'rate_limits'].map((tbl) => env.DB.prepare(`DELETE FROM ${tbl}`)));
});
afterEach(() => {
  clock.now = () => Date.now();
});

describe('Telegram webhook', () => {
  it('rejects calls without the webhook secret', async () => {
    expect((await send(text('/start'), null)).status).toBe(401);
    expect((await send(text('/start'), 'wrong')).status).toBe(401);
  });

  it('answers /start with help in the reply body', async () => {
    const body = await (await send(text('/start'))).json<any>();
    expect(body).toMatchObject({ method: 'sendMessage', chat_id: 99 });
    expect(body.text).toContain('Tera Live');
  });

  it('replies in Amharic for Amharic Telegram clients', async () => {
    const body = await (await send(text('/start', { id: 1, language_code: 'am' }))).json<any>();
    expect(body.text).toContain('ተራ ላይቭ');
  });

  it('searches stations by name and offers buttons', async () => {
    const body = await (await send(text('C.M.C'))).json<any>();
    expect(body.method).toBe('sendMessage');
    expect(buttons(body)[0]).toEqual({ text: 'C.M.C · ሲ.ኤም.ሲ', callback_data: `s:${CMC}` });
  });

  it('finds stations by Amharic name', async () => {
    const body = await (await send(text('ሲ.ኤም.ሲ'))).json<any>();
    expect(buttons(body)[0].callback_data).toBe(`s:${CMC}`);
  });

  it('says so when nothing matches', async () => {
    const body = await (await send(text('zzzzqqq'))).json<any>();
    expect(body.text).toMatch(/No station found/);
  });

  it('suggests nearby stations for a shared location without storing it', async () => {
    const loc = { update_id: 3, message: { message_id: 12, chat: { id: 99 }, from: user, location: { latitude: 9.0211, longitude: 38.8504 } } };
    const body = await (await send(loc)).json<any>();
    expect(buttons(body)[0].callback_data).toBe(`s:${CMC}`);
    const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM reports').first<{ n: number }>())!;
    expect(n).toBe(0);
  });

  it('walks station → destination → line → taxis and records a report', async () => {
    let body = await (await send(tap(`s:${TZNA}`))).json<any>();
    expect(body).toMatchObject({ method: 'editMessageText', chat_id: 99, message_id: 11 });
    const dir = buttons(body).find((b) => b.text === 'Ayer Tena')!;
    expect(dir.callback_data).toBe(`d:${TZNA}:0`);

    body = await (await send(tap(dir.callback_data))).json<any>();
    const long = buttons(body).find((b) => b.text.startsWith('Long'))!;
    body = await (await send(tap(long.callback_data))).json<any>();
    const arriving = buttons(body).find((b) => b.text.startsWith('Arriving'))!;
    expect(arriving.callback_data).toBe(`t:${TZNA}:0:2:1`);

    body = await (await send(tap(arriving.callback_data))).json<any>();
    expect(body.text).toContain('Thanks');
    expect(body.text).toMatch(/Ayer Tena: Line Long · Taxis Arriving · just now/);

    const row = await env.DB.prepare('SELECT station_id, direction, queue, taxis, source, device_hash FROM reports').first<any>();
    expect(row).toMatchObject({ station_id: TZNA, direction: 'ayer-tena', queue: 2, taxis: 1, source: 'telegram' });
    expect(row.device_hash).not.toContain('424242');
  });

  it('tells the user about duplicates instead of double counting', async () => {
    await send(tap(`t:${CMC}:0:1:0`));
    const body = await (await send(tap(`t:${CMC}:0:1:0`))).json<any>();
    expect(body.text).toContain('already reported');
  });

  it('ignores tampered callback data', async () => {
    for (const data of [`t:${CMC}:99:1:0`, `t:${CMC}:0:9:0`, 't:n1:0:1:0', `q:${CMC}:0:x`, 'garbage']) {
      const body = await (await send(tap(data))).json<any>();
      expect(body.text).toMatch(/No station found/);
    }
    const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM reports').first<{ n: number }>())!;
    expect(n).toBe(0);
  });

  it('/status shows live reports for a station', async () => {
    await send(tap(`t:${CMC}:0:3:2`));
    const body = await (await send(text('/status C.M.C'))).json<any>();
    expect(body.text).toContain('Megenagna · መገናኛ: Line Very long · Taxis None');
  });

  it('keeps callback data within Telegram’s 64-byte limit', async () => {
    const body = await (await send(tap(`q:${TZNA}:1:3`))).json<any>();
    for (const b of buttons(body)) expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
  });
});

describe('dirLabel', () => {
  it('labels curated and OSM destinations', () => {
    expect(dirLabel('4kilo')).toBe('4 Kilo · 4 ኪሎ');
    expect(dirLabel('ayer-tena')).toBe('Ayer Tena');
  });
});
