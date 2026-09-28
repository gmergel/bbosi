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
    CREATE TABLE sold_options (
      id TEXT PRIMARY KEY, option_ticker TEXT NOT NULL, stock_ticker TEXT NOT NULL,
      strike REAL NOT NULL, sell_price REAL NOT NULL, sell_date TEXT NOT NULL,
      expiration TEXT NOT NULL, trading_days INTEGER NOT NULL, nv REAL NOT NULL,
      ve REAL NOT NULL, vdxx REAL NOT NULL, lastro_percent REAL NOT NULL,
      bbosi REAL NOT NULL, stock_price REAL NOT NULL, option_price REAL NOT NULL,
      last_refresh TEXT, updated_at TEXT NOT NULL, buyback_price REAL,
      buyback_date TEXT, market_data_time TEXT
    );
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
  assert.equal(alertFor(position, { price: 0.5 }, NaN).level, 'profit');
  assert.equal(alertFor(position, { ...quote, price: 0.8 }, 30).level, 'normal');
  assert.equal(alertFor(position, { ...quote, gamma: NaN }, 30), null);
  assert.equal(alertFor(position, { ...quote, strike: NaN }, 30), null);
});

test('cron sends profit alert with an option quote from the current session when the stock quote is stale', async () => {
  const { DB, sqlite } = database();
  sqlite.exec("INSERT INTO telegram_chat VALUES (1, '123'); INSERT INTO sold_options (id, option_ticker, stock_ticker, strike, sell_price, sell_date, expiration, trading_days, nv, ve, vdxx, lastro_percent, bbosi, stock_price, option_price, updated_at) VALUES ('p1', 'PETRJ563', 'PETR4', 56.36, 0.46, '', '', 14, 0, 0, 0, 0, 0, 48.93, 0.21, '')");
  const env = { DB, TELEGRAM_BOT_TOKEN: 'bot' };
  const now = new Date('2026-09-25T15:00:00Z');
  const sent = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('telegram.org')) { sent.push(JSON.parse(options.body).text); return Response.json({ ok: true }); }
    if (String(url).includes('yahoo.com')) return Response.json({ chart: { result: [{ meta: { regularMarketPrice: 48.93, regularMarketTime: (now.getTime() - 60 * 60_000) / 1000 } }] } });
    if (String(url).includes('vendacoberta')) return Response.json({ options: [] });
    const row = Array(23).fill(0);
    row[0] = 'J563'; row[3] = 56.36; row[6] = 0.21; row[8] = new Date(now.getTime() - 2 * 60 * 60_000).toISOString();
    return Response.json({ success: true, requests: [{ results: { expirations: [{ du: 14, calls: [row] }] } }] });
  };

  await checkPositionAlerts(env, now);

  assert.equal(sent.length, 1);
  assert.match(sent[0], /ALVO DE LUCRO: PETRJ563/);
  assert.match(sent[0], /Opcao R\$ 0\.21 \| limite R\$ 0\.23/);
  sqlite.close();
});

test('cron ignores an option quote from the previous session', async () => {
  const { DB, sqlite } = database();
  sqlite.exec("INSERT INTO telegram_chat VALUES (1, '123'); INSERT INTO sold_options (id, option_ticker, stock_ticker, strike, sell_price, sell_date, expiration, trading_days, nv, ve, vdxx, lastro_percent, bbosi, stock_price, option_price, updated_at) VALUES ('p1', 'PETRJ563', 'PETR4', 56.36, 0.46, '', '', 14, 0, 0, 0, 0, 0, 48.93, 0.21, '')");
  const env = { DB, TELEGRAM_BOT_TOKEN: 'bot' };
  const now = new Date('2026-09-25T15:00:00Z');
  let messages = 0;
  globalThis.fetch = async url => {
    if (String(url).includes('telegram.org')) { messages++; return Response.json({ ok: true }); }
    if (String(url).includes('yahoo.com')) return Response.json({ chart: { result: [{ meta: { regularMarketPrice: 48.93, regularMarketTime: now.getTime() / 1000 } }] } });
    if (String(url).includes('vendacoberta')) return Response.json({ options: [] });
    const row = Array(23).fill(0);
    row[0] = 'J563'; row[3] = 56.36; row[6] = 0.21; row[8] = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    return Response.json({ success: true, requests: [{ results: { expirations: [{ du: 14, calls: [row] }] } }] });
  };

  await checkPositionAlerts(env, now);

  assert.equal(messages, 0);
  sqlite.close();
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

test('positions PUT persists the complete payload', async () => {
  const { DB, sqlite } = database();
  const env = { DB, POSITIONS_TOKEN: 'secret' };
  const position = {
    id: 'p1', optionTicker: 'PETRJ563', stockTicker: 'PETR4', strike: 56.36,
    sellPrice: 0.46, sellDate: '2026-09-01T12:00:00.000Z', expiration: '2026-10-16T00:00:00.000Z',
    tradingDays: 14, nv: 0.09, ve: 0.18, vdxx: 1.5, lastroPercent: 15.18,
    bbosi: 47.3, stockPrice: 48.93, optionPrice: 0.21,
    lastRefresh: '2026-09-28T19:48:00.000Z', marketDataTime: '2026-09-28T19:21:00.000Z',
  };
  const response = await worker.fetch(new Request('https://example.com/api/positions', {
    method: 'PUT', headers: { 'X-BBOSI-Token': 'secret', 'Content-Type': 'application/json' },
    body: JSON.stringify([position]),
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const stored = sqlite.prepare('SELECT option_ticker, sell_price, option_price, market_data_time FROM sold_options WHERE id = ?').get('p1');
  assert.deepEqual({ ...stored }, {
    option_ticker: 'PETRJ563', sell_price: 0.46, option_price: 0.21,
    market_data_time: '2026-09-28T19:21:00.000Z',
  });
  sqlite.close();
});

test('cron sends on transitions, ignores stale quotes and closed positions', async () => {
  const { DB, sqlite } = database();
  sqlite.exec("INSERT INTO telegram_chat VALUES (1, '123'); INSERT INTO sold_options (id, option_ticker, stock_ticker, strike, sell_price, sell_date, expiration, trading_days, nv, ve, vdxx, lastro_percent, bbosi, stock_price, option_price, updated_at) VALUES ('p1', 'PETRA1', 'PETR4', 35, 1, '', '', 12, 0, 0, 0, 0, 0, 30, 1, '')");
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
  sqlite.exec("INSERT INTO telegram_chat VALUES (1, '123'); INSERT INTO sold_options (id, option_ticker, stock_ticker, strike, sell_price, sell_date, expiration, trading_days, nv, ve, vdxx, lastro_percent, bbosi, stock_price, option_price, updated_at) VALUES ('p1', 'PETRA1', 'PETR4', 35, 1, '', '', 12, 0, 0, 0, 0, 0, 30, 1, '')");
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