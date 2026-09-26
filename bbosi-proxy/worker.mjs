import { checkPositionAlerts, sendTelegram } from './telegram-alerts.mjs';

const TARGETS = {
  '/api/vendacoberta': {
    origin: 'https://api.vendacoberta.com.br',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Origin: 'https://vendacoberta.com.br',
      Referer: 'https://vendacoberta.com.br/',
    },
  },
  '/api/opcoes': {
    origin: 'https://opcoes.net.br',
    headers: {},
  },
  '/api/yahoo': {
    origin: 'https://query1.finance.yahoo.com',
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
  },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-BBOSI-Token',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const requestUrl = new URL(request.url);

    if (requestUrl.pathname.startsWith('/api/telegram/')) {
      return handleTelegram(request, env, requestUrl);
    }

    if (requestUrl.pathname === '/api/positions' || requestUrl.pathname.startsWith('/api/positions/')) {
      return handlePositions(request, env, requestUrl);
    }

    const match = Object.entries(TARGETS).find(([prefix]) => requestUrl.pathname.startsWith(prefix));

    if (!match) {
      return json({ error: 'Rota de proxy nao encontrada' }, 404);
    }

    const [prefix, target] = match;
    const targetPath = requestUrl.pathname.slice(prefix.length) || '/';
    const targetUrl = new URL(targetPath + requestUrl.search, target.origin);

    const headers = new Headers(request.headers);
    headers.delete('host');

    for (const [name, value] of Object.entries(target.headers)) {
      headers.set(name, value);
    }

    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody(request.method) ? request.body : undefined,
      redirect: 'follow',
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      responseHeaders.set(name, value);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
  async scheduled(_controller, env) {
    await checkPositionAlerts(env);
  },
};

async function handleTelegram(request, env, url) {
  if (url.pathname === '/api/telegram/webhook') {
    if (request.method !== 'POST') return json({ error: 'Metodo nao permitido' }, 405);
    if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
      return json({ error: 'Nao autorizado' }, 401);
    }
    const body = await request.text();
    if (body.length > 8192) return json({ error: 'Corpo muito grande' }, 413);
    let update;
    try { update = JSON.parse(body); } catch { return json({ error: 'JSON invalido' }, 400); }
    const chat = update?.message?.chat;
    const match = /^\/start ([A-Za-z0-9_-]{32,64})$/.exec(update?.message?.text ?? '');
    if (chat?.type !== 'private' || !match) return json({ ok: true }, 200);
    const hash = await hashCode(match[1]);
    const consumed = await env.DB.prepare(
      'DELETE FROM telegram_link WHERE id = 1 AND code_hash = ? AND expires_at > ? RETURNING id'
    ).bind(hash, new Date().toISOString()).first();
    if (consumed) {
      await env.DB.prepare('INSERT OR IGNORE INTO telegram_chat (id, chat_id) VALUES (1, ?)')
        .bind(String(chat.id)).run();
      await sendTelegram(env, String(chat.id), 'BBOSI: alertas de stop e lucro ativados.').catch(() => {});
    }
    return json({ ok: true }, 200);
  }

  if (!envTokenMatches(request, env, url)) return json({ error: 'Nao autorizado' }, 401);
  if (url.pathname === '/api/telegram/status' && request.method === 'GET') {
    const chat = await env.DB.prepare('SELECT id FROM telegram_chat WHERE id = 1').first();
    return json({ linked: Boolean(chat) }, 200);
  }
  if (url.pathname === '/api/telegram/link' && request.method === 'POST') {
    if (!env.TELEGRAM_BOT_TOKEN || !/^[A-Za-z0-9_]+$/.test(env.TELEGRAM_BOT_USERNAME ?? '') ||
        !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET ?? '') || url.protocol !== 'https:') {
      return json({ error: 'Bot nao configurado' }, 503);
    }
    if (await env.DB.prepare('SELECT id FROM telegram_chat WHERE id = 1').first()) {
      return json({ error: 'Telegram ja vinculado' }, 409);
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: new URL('/api/telegram/webhook', url).toString(),
          secret_token: env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ['message'],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok || !(await response.json()).ok) return json({ error: 'Falha ao registrar webhook do Telegram' }, 502);
    } catch {
      return json({ error: 'Falha ao registrar webhook do Telegram' }, 502);
    }
    const code = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await env.DB.prepare('INSERT INTO telegram_link (id, code_hash, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at')
      .bind(await hashCode(code), expiresAt).run();
    return json({ url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${code}`, expiresAt }, 200);
  }
  if (url.pathname === '/api/telegram/link' && request.method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM telegram_chat WHERE id = 1'),
      env.DB.prepare('DELETE FROM telegram_link WHERE id = 1'),
      env.DB.prepare('DELETE FROM telegram_alert_state'),
    ]);
    return json({ ok: true }, 200);
  }
  if (url.pathname === '/api/telegram/test' && request.method === 'POST') {
    const chat = await env.DB.prepare('SELECT chat_id FROM telegram_chat WHERE id = 1').first();
    if (!chat) return json({ error: 'Telegram nao vinculado' }, 409);
    try {
      await sendTelegram(env, chat.chat_id, 'BBOSI: notificacoes funcionando.');
      return json({ ok: true }, 200);
    } catch {
      return json({ error: 'Nao foi possivel enviar mensagem. Confira o bot no Telegram.' }, 502);
    }
  }
  return json({ error: 'Rota nao encontrada' }, 404);
}

async function hashCode(code) {
  const bytes = new TextEncoder().encode(code);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function handlePositions(request, env, requestUrl) {
  if (!envTokenMatches(request, env, requestUrl)) {
    return json({ error: 'Nao autorizado' }, 401);
  }

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM sold_options ORDER BY sell_date DESC'
    ).all();
    return json(results.map(fromRow), 200);
  }

  if (request.method === 'PUT') {
    const options = await request.json();
    if (!Array.isArray(options)) return json({ error: 'Formato invalido' }, 400);

    const statements = [env.DB.prepare('DELETE FROM sold_options')];
    for (const option of options) {
      statements.push(env.DB.prepare(`
        INSERT INTO sold_options (
          id, option_ticker, stock_ticker, strike, sell_price, sell_date,
          expiration, trading_days, nv, ve, vdxx, lastro_percent, bbosi,
          stock_price, option_price, last_refresh, market_data_time, buyback_price, buyback_date, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        option.id,
        option.optionTicker,
        option.stockTicker,
        option.strike,
        option.sellPrice,
        option.sellDate,
        option.expiration,
        option.tradingDays,
        option.nv,
        option.ve,
        option.vdxx,
        option.lastroPercent,
        option.bbosi,
        option.stockPrice,
        option.optionPrice,
        option.lastRefresh ?? null,
        option.marketDataTime ?? null,
        option.buybackPrice ?? null,
        option.buybackDate ?? null,
        new Date().toISOString(),
      ));
    }

    await env.DB.batch(statements);
    return json({ ok: true }, 200);
  }

  return json({ error: 'Metodo nao permitido' }, 405);
}

function envTokenMatches(request, env, requestUrl) {
  const configuredToken = env.POSITIONS_TOKEN;
  const receivedToken = request.headers.get('X-BBOSI-Token');
  return Boolean(configuredToken && receivedToken && configuredToken === receivedToken);
}

function fromRow(row) {
  return {
    id: row.id,
    optionTicker: row.option_ticker,
    stockTicker: row.stock_ticker,
    strike: row.strike,
    sellPrice: row.sell_price,
    sellDate: row.sell_date,
    expiration: row.expiration,
    tradingDays: row.trading_days,
    nv: row.nv,
    ve: row.ve,
    vdxx: row.vdxx,
    lastroPercent: row.lastro_percent,
    bbosi: row.bbosi,
    stockPrice: row.stock_price,
    optionPrice: row.option_price,
    lastRefresh: row.last_refresh,
    marketDataTime: row.market_data_time,
    buybackPrice: row.buyback_price,
    buybackDate: row.buyback_date,
  };
}

function hasBody(method) {
  return !['GET', 'HEAD'].includes(method.toUpperCase());
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}