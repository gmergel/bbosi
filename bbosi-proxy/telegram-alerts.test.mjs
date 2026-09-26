import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.mjs';
import { alertFor, checkPositionAlerts, stopPercent } from './telegram-alerts.mjs';

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE telegram_chat (id INTEGER PRIMARY KEY, chat_id TEXT);
    CREATE TABLE telegram_link (id INTEGER PRIMARY KEY, code_hash TEXT, expires_at TEXT);
    CREATE TABLE telegram_alert_state (position_id TEXT PRIMARY KEY, sell_price REAL, level TEXT, quote_time TEXT, claimed_until TEXT);
    CREATE TABLE sold_options (id TEXT PRIMARY KEY, option_ticker TEXT, stock_ticker TEXT, sell_price REAL, buyback_date TEXT);
  `);
  const prepare = sql => {
    const statement = sqlite.prepare(sql);
    let params = [];
    const item = {
      bind(...values) { params = values; return item; },
      first() { return statement.get(...params) ?? null; },
      all() { return { results: statement.all(...params) }; },
      run() { return statement.run(...params); },
    };
    return item;
  };
  return { sqlite, DB: { prepare, batch: statements => Promise.all(statements.map(item => item.run())) } };
}

test('stop and profit follow the UI thresholds', () => {
  const position = { sell_price: 1 };
  const quote = { price: 1.4, strike: 35, delta: 0.2, gamma: 0.35, tradingDays: 3 };
  assert.equal(stopPercent(10, 3, 0.35, -0.1, 0), 18);
  assert.equal(alertFor(position, quote, 30).level, 'stop');
  assert.equal(alertFor(position, { ...quote, price: 0.5 }, 30).level, 'profit');
  assert.equal(alertFor(position, { ...quote, price: 0.8 }, 30).level, 'normal');
  assert.equal(alertFor(position, { ...quote, gamma: NaN }, 30), null);
  assert.equal(alertFor(position, { ...quote, strike: NaN }, 30), null);
});

test('webhook requires secret, private chat and one-time code', async () => {
  const { DB, sqlite } = database();
  const webhookSecret = 'a'.repeat(32);
  const env = { DB, POSITIONS_TOKEN: 'secret', TELEGRAM_WEBHOOK_SECRET: webhookSecret, TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_BOT_USERNAME: 'bbosi_test_bot' };
  const sent = [];
  const registrations = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/setWebhook')) registrations.push(JSON.parse(options.body));
    else sent.push(JSON.parse(options.body));
    return Response.json({ ok: true });
  };
  const link = await worker.fetch(new Request('https://example.com/api/telegram/link', { method: 'POST', headers: { 'X-BBOSI-Token': 'secret' } }), env);
  assert.equal(link.status, 200);
  assert.deepEqual(registrations, [{ url: 'https://example.com/api/telegram/webhook', secret_token: webhookSecret, allowed_updates: ['message'] }]);
  const code = new URL((await link.json()).url).searchParams.get('start');
  const webhook = (chatType, secret = webhookSecret) => worker.fetch(new Request('https://example.com/api/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { chat: { id: 123, type: chatType }, text: `/start ${code}` } }),
  }), env);
  assert.equal((await webhook('private', 'wrong')).status, 401);
  await webhook('group');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM telegram_chat').get().n, 0);
  await webhook('private');
  await webhook('private');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM telegram_chat').get().n, 1);
  assert.equal(sent.length, 1);
  sqlite.close();
});

test('cron sends on transitions, ignores stale quotes and closed positions', async () => {
  const { DB, sqlite } = database();
  sqlite.exec("INSERT INTO telegram_chat VALUES (1, '123'); INSERT INTO sold_options VALUES ('p1', 'PETRA1', 'PETR4', 1, NULL)");
  const env = { DB, TELEGRAM_BOT_TOKEN: 'bot' };
  const now = new Date('2026-09-25T15:00:00Z');
  let price = 1.4;
  let time = now.toISOString();
  const sent = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('telegram.org')) { sent.push(JSON.parse(options.body).text); return Response.json({ ok: true }); }
    if (String(url).includes('yahoo.com')) return Response.json({ chart: { result: [{ meta: { regularMarketPrice: 30, regularMarketTime: now.getTime() / 1000 } }] } });
    if (String(url).includes('vendacoberta')) return Response.json({ options: [] });
    const row = Array(23).fill(0);
    row[0] = 'A1'; row[3] = 35; row[6] = price; row[8] = time; row[18] = 0.2; row[19] = 0.1;
    return Response.json({ success: true, requests: [{ results: { expirations: [{ du: 12, calls: [row] }] } }] });
  };
  await checkPositionAlerts(env, now);
  await checkPositionAlerts(env, now);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /STOP/);
  time = new Date(now.getTime() + 60_000).toISOString();
  price = 0.8;
  await checkPositionAlerts(env, new Date(now.getTime() + 60_000));
  price = 0.45;
  time = new Date(now.getTime() + 120_000).toISOString();
  await checkPositionAlerts(env, new Date(now.getTime() + 120_000));
  assert.equal(sent.length, 2);
  assert.match(sent[1], /ALVO DE LUCRO/);
  time = new Date(now.getTime() - 60 * 60_000).toISOString();
  await checkPositionAlerts(env, new Date(now.getTime() + 180_000));
  assert.equal(sent.length, 2);
  sqlite.exec("UPDATE sold_options SET buyback_date = '2026-09-25' WHERE id = 'p1'");
  await checkPositionAlerts(env, new Date(now.getTime() + 240_000));
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM telegram_alert_state').get().n, 0);
  sqlite.close();
});

test('failed delivery is retried and concurrent checks claim once', async () => {
  const { DB, sqlite } = database();
  sqlite.exec("INSERT INTO telegram_chat VALUES (1, '123'); INSERT INTO sold_options VALUES ('p1', 'PETRA1', 'PETR4', 1, NULL)");
  const env = { DB, TELEGRAM_BOT_TOKEN: 'bot' };
  const now = new Date('2026-09-25T15:00:00Z');
  let fail = true;
  let messages = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('telegram.org')) {
      messages++;
      return fail ? Response.json({ ok: false }, { status: 429 }) : Response.json({ ok: true });
    }
    if (String(url).includes('yahoo.com')) return Response.json({ chart: { result: [{ meta: { regularMarketPrice: 30, regularMarketTime: now.getTime() / 1000 } }] } });
    if (String(url).includes('vendacoberta')) return Response.json({ options: [] });
    const row = Array(23).fill(0);
    row[0] = 'A1'; row[3] = 35; row[6] = 1.4; row[8] = now.toISOString(); row[18] = 0.2; row[19] = 0.1;
    return Response.json({ success: true, requests: [{ results: { expirations: [{ du: 12, calls: [row] }] } }] });
  };
  await checkPositionAlerts(env, now);
  assert.equal(messages, 1);
  fail = false;
  await Promise.all([checkPositionAlerts(env, now), checkPositionAlerts(env, now)]);
  assert.equal(messages, 2);
  sqlite.close();
});