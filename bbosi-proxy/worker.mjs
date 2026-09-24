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
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-BBOSI-Token',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const requestUrl = new URL(request.url);

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
};

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