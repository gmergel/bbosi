# BBOSI Proxy

Proxy de producao para usar o GerBOSI no GitHub Pages sem depender de proxies CORS publicos.

O GitHub Pages entrega apenas arquivos estaticos, entao ele nao consegue executar o `proxy.conf.json` do Angular. Este Worker recria as mesmas rotas usadas localmente:

- `/api/yahoo` -> `https://query1.finance.yahoo.com`
- `/api/opcoes` -> `https://opcoes.net.br`
- `/api/vendacoberta` -> `https://api.vendacoberta.com.br`
- `/api/positions` -> banco D1 privado com as opcoes vendidas

## Deploy com Cloudflare Worker

1. Crie uma conta na Cloudflare, se ainda nao tiver.
2. Entre na pasta do proxy:

```bash
cd bbosi-proxy
```

3. Instale as dependencias:

```bash
npm install
```

4. Crie o arquivo de configuracao local:

```bash
copy wrangler.toml.example wrangler.toml
```

5. Faca login e publique:

```bash
npx wrangler login
npm run deploy
```

Se o deploy mostrar o aviso `You need to register a workers.dev subdomain`, abra a pagina indicada pelo Wrangler e registre o subdominio da conta. Enquanto isso nao for feito, a URL do Worker pode abrir com erro de SSL/TLS mesmo com o deploy concluido.

6. Pegue a URL gerada, por exemplo:

```text
https://bbosi-proxy.seu-usuario.workers.dev
```

## Banco de posicoes

Crie o banco D1 e copie o ID retornado para `wrangler.toml`:

```bash
npx wrangler d1 create bbosi
npx wrangler d1 migrations apply bbosi --remote
npx wrangler secret put POSITIONS_TOKEN
```

O comando `secret put` pede um token privado. Use o mesmo token no computador e
no celular pelo botao de chave na tela inicial. O token fica somente no
`localStorage` de cada dispositivo e nao deve ser colocado no codigo Angular.

Para desenvolvimento local, execute o Worker em `localhost:8787` e o Angular
em outro terminal. A rota `/api/positions` do proxy local encaminha para esse
Worker.

7. Atualize `bbosi-app/src/environments/environment.prod.ts` para usar essa base:

```ts
const proxyBaseUrl = 'https://bbosi-proxy.seu-usuario.workers.dev';

export const environment = {
  production: true,
  yahooBaseUrl: `${proxyBaseUrl}/api/yahoo`,
  opcoesBaseUrl: `${proxyBaseUrl}/api/opcoes`,
  vendacobertaBaseUrl: `${proxyBaseUrl}/api/vendacoberta`,
  yahooBaseUrls: [`${proxyBaseUrl}/api/yahoo`],
  opcoesBaseUrls: [`${proxyBaseUrl}/api/opcoes`],
  vendacobertaBaseUrls: [`${proxyBaseUrl}/api/vendacoberta`],
};
```

Depois disso, o frontend continua publicado no GitHub Pages, mas os dados passam por um proxy proprio.