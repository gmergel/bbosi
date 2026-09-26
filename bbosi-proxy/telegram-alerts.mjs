const MAX_QUOTE_AGE_MS = 15 * 60_000;

export function stopPercent(sellPrice, tradingDays, gamma, nv, realized) {
  if (sellPrice <= 0) return 25;
  const gammaAdj = Math.max(0, Math.min(8, Math.abs(gamma ?? 0) * 24));
  const dteAdj = tradingDays <= 5 ? 8 : tradingDays <= 10 ? 6 : tradingDays <= 20 ? 3 : 0;
  const nvAdj = nv < 0 ? 6 : nv < 0.2 ? 3 : 0;
  const timeAdj = tradingDays >= 25 ? 4 : tradingDays >= 15 ? 2 : 0;
  const profitAdj = realized >= 50 ? 2 : realized <= -10 ? -2 : 0;
  return Number(Math.min(32, Math.max(18, 25 - gammaAdj - dteAdj - nvAdj + timeAdj + profitAdj)).toFixed(1));
}

export function alertFor(position, quote, stockPrice) {
    if (!(position.sell_price > 0) || !(quote.price > 0) || !(stockPrice > 0) ||
      !(quote.strike > 0) || !Number.isFinite(quote.gamma) ||
      !Number.isFinite(quote.delta) || !Number.isFinite(quote.tradingDays)) return null;
  const captured = (position.sell_price - quote.price) / position.sell_price * 100;
  const ve = quote.strike >= stockPrice ? quote.price : Math.max(0, quote.price - (stockPrice - quote.strike));
  const nv = Math.round((ve - Math.abs(quote.delta) - Math.abs(quote.gamma)) * 100) / 100;
  const stop = stopPercent(position.sell_price, quote.tradingDays, Number(quote.gamma.toFixed(4)), nv, captured);
  const level = captured <= -stop ? 'stop' : captured >= 50 ? 'profit' : 'normal';
  return { level, captured, limit: position.sell_price * (level === 'profit' ? 0.5 : 1 + stop / 100) };
}

function marketOpen(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find(part => part.type === 'weekday').value;
  const hour = Number(parts.find(part => part.type === 'hour').value);
  const minute = Number(parts.find(part => part.type === 'minute').value);
  return weekday !== 'Sat' && weekday !== 'Sun' && hour * 60 + minute >= 10 * 60 && hour * 60 + minute < 18 * 60;
}

function fresh(time, now) {
  const age = now.getTime() - Date.parse(time);
  return Number.isFinite(age) && age >= -120_000 && age <= MAX_QUOTE_AGE_MS;
}

async function getJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Market data HTTP ${response.status}`);
  return response.json();
}

function sourceTime(value) {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const text = String(value);
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return NaN;
  return Number(typeof value === 'string' ? value.replace(',', '.') : value);
}

async function marketFor(ticker) {
  const chainUrl = `https://opcoes.net.br/api/v1?z=${Math.floor(Date.now() / 10000)}&r0t=OptionsChain&r0p.underlying_asset_id=${encodeURIComponent(ticker)}`;
  const body = { size: '100000', page: '0', stockSelection: ticker, optionType: 'call_put', strikeDistance: 20 };
  const sources = await Promise.allSettled([
    getJson(chainUrl),
    getJson('https://api.vendacoberta.com.br/api/v1/options', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://vendacoberta.com.br', Referer: 'https://vendacoberta.com.br/' },
      body: JSON.stringify(body),
    }),
    getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.SA?interval=1d&range=1d`),
  ]);
  const yahoo = sources[2].status === 'fulfilled' ? sources[2].value?.chart?.result?.[0]?.meta : null;
  const stockPrice = numeric(yahoo?.regularMarketPrice);
  const stockTime = yahoo?.regularMarketTime ? new Date(yahoo.regularMarketTime * 1000).toISOString() : null;
  const quotes = new Map();

  if (sources[0].status === 'fulfilled' && sources[0].value?.success) {
    for (const expiry of sources[0].value.requests?.[0]?.results?.expirations ?? []) {
      for (const row of expiry.calls ?? []) {
        const quote = {
          ticker: ticker.slice(0, 4) + row[0], strike: numeric(row[3]), price: numeric(row[6]),
          delta: numeric(row[18]), gamma: numeric(row[19]), tradingDays: numeric(expiry.du), time: sourceTime(row[8]),
        };
        if (quote.time && quote.price > 0 && (!quotes.has(quote.ticker) || quote.time > quotes.get(quote.ticker).time)) {
          quotes.set(quote.ticker, quote);
        }
      }
    }
  }
  if (sources[1].status === 'fulfilled') {
    for (const option of sources[1].value?.options ?? []) {
      if (option.type !== 'CALL') continue;
      const quote = {
        ticker: option.ticker, strike: numeric(option.strike), price: numeric(option.optionPremium),
        delta: numeric(option.delta), gamma: numeric(option.gamma),
        tradingDays: tradingDays(option.dueDate), time: sourceTime(option.externalReferenceDate || option.createdAt),
      };
      if (quote.time && quote.price > 0 && (!quotes.has(quote.ticker) || quote.time > quotes.get(quote.ticker).time)) {
        quotes.set(quote.ticker, quote);
      }
    }
  }
  return { quotes, stockPrice, stockTime };
}

function tradingDays(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? '');
  if (!match) return NaN;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const datePart = type => parts.find(part => part.type === type).value;
  const today = new Date(`${datePart('year')}-${datePart('month')}-${datePart('day')}T00:00:00Z`);
  const target = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(target.getTime())) return NaN;
  let days = 0;
  for (const day = new Date(today); day < target; day.setUTCDate(day.getUTCDate() + 1)) {
    const next = new Date(day);
    next.setUTCDate(next.getUTCDate() + 1);
    if (next.getUTCDay() !== 0 && next.getUTCDay() !== 6) days++;
  }
  return days;
}

export async function sendTelegram(env, chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || !(await response.json()).ok) throw new Error('Telegram delivery failed');
}

export async function checkPositionAlerts(env, now = new Date()) {
  if (!env.TELEGRAM_BOT_TOKEN || !marketOpen(now)) return;
  const chat = await env.DB.prepare('SELECT chat_id FROM telegram_chat WHERE id = 1').first();
  if (!chat) return;
  const { results: positions } = await env.DB.prepare('SELECT id, option_ticker, stock_ticker, sell_price FROM sold_options WHERE buyback_date IS NULL').all();
  await env.DB.prepare('DELETE FROM telegram_alert_state WHERE position_id NOT IN (SELECT id FROM sold_options WHERE buyback_date IS NULL)').run();
  const groups = Map.groupBy(positions, position => position.stock_ticker);
  for (const [ticker, group] of groups) {
    let market;
    try { market = await marketFor(ticker); } catch { continue; }
    if (!fresh(market.stockTime, now) || !(market.stockPrice > 0)) continue;
    for (const position of group) {
      const quote = market.quotes.get(position.option_ticker);
      if (!quote || !fresh(quote.time, now)) continue;
      const alert = alertFor(position, quote, market.stockPrice);
      if (!alert) continue;
      if (alert.level === 'normal') {
        await env.DB.prepare(`INSERT INTO telegram_alert_state (position_id, sell_price, level, quote_time)
          VALUES (?, ?, 'normal', ?) ON CONFLICT(position_id) DO UPDATE SET
          sell_price = excluded.sell_price, level = 'normal', quote_time = excluded.quote_time
          WHERE (claimed_until IS NULL OR claimed_until < ?) AND (quote_time < excluded.quote_time OR sell_price != excluded.sell_price)`)
          .bind(position.id, position.sell_price, quote.time, now.toISOString()).run();
        continue;
      }
      const claimedUntil = new Date(now.getTime() + 2 * 60_000).toISOString();
      const claim = await env.DB.prepare(`INSERT INTO telegram_alert_state (position_id, sell_price, level, quote_time, claimed_until)
        VALUES (?, ?, 'normal', '', ?) ON CONFLICT(position_id) DO UPDATE SET claimed_until = excluded.claimed_until
        WHERE (claimed_until IS NULL OR claimed_until < ?) AND (sell_price != excluded.sell_price OR level != ?)
        AND (sell_price != excluded.sell_price OR quote_time < ?) RETURNING position_id`)
        .bind(position.id, position.sell_price, claimedUntil, now.toISOString(), alert.level, quote.time).first();
      if (!claim) continue;
      const stillActive = await env.DB.prepare('SELECT id FROM sold_options WHERE id = ? AND buyback_date IS NULL AND sell_price = ?')
        .bind(position.id, position.sell_price).first();
      const stillLinked = await env.DB.prepare('SELECT chat_id FROM telegram_chat WHERE id = 1').first();
      if (!stillActive || stillLinked?.chat_id !== chat.chat_id) {
        await env.DB.prepare('UPDATE telegram_alert_state SET claimed_until = NULL WHERE position_id = ? AND claimed_until = ?')
          .bind(position.id, claimedUntil).run();
        continue;
      }
      const label = alert.level === 'stop' ? 'STOP' : 'ALVO DE LUCRO';
      const text = `BBOSI ${label}: ${position.option_ticker}\nOpcao R$ ${quote.price.toFixed(2)} | limite R$ ${alert.limit.toFixed(2)}\nLucro capturado: ${alert.captured.toFixed(1)}%\nCotacao: ${new Date(quote.time).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasilia)`;
      try {
        await sendTelegram(env, chat.chat_id, text);
        await env.DB.prepare('UPDATE telegram_alert_state SET level = ?, quote_time = ?, sell_price = ?, claimed_until = NULL WHERE position_id = ? AND claimed_until = ?')
          .bind(alert.level, quote.time, position.sell_price, position.id, claimedUntil).run();
      } catch {
        await env.DB.prepare('UPDATE telegram_alert_state SET claimed_until = NULL WHERE position_id = ? AND claimed_until = ?')
          .bind(position.id, claimedUntil).run();
      }
    }
  }
}