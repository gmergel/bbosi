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
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const requestUrl = new URL(request.url);
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