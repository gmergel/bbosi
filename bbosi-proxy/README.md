# BBOSI Proxy

Proxy de produção para usar o GerBOSI no GitHub Pages sem depender de proxies CORS públicos.

O GitHub Pages entrega apenas arquivos estáticos, então não consegue executar o `proxy.conf.json` do Angular. Este Worker recria as mesmas rotas usadas localmente:

- `/api/yahoo` -> `https://query1.finance.yahoo.com`
- `/api/opcoes` -> `https://opcoes.net.br`
- `/api/vendacoberta` -> `https://api.vendacoberta.com.br`
- `/api/positions` -> banco D1 privado com as opções vendidas

## Deploy com Cloudflare Worker

1. Crie uma conta na Cloudflare, se ainda não tiver.
2. Entre na pasta do proxy:

```bash
cd bbosi-proxy
```

3. Instale as dependencias:

```bash
npm install
```

4. Crie o arquivo de configuração local:

```bash
copy wrangler.toml.example wrangler.toml
```

5. Faça login e publique:

```bash
npx wrangler login
npm run deploy
```

Se o deploy mostrar o aviso `You need to register a workers.dev subdomain`, abra a página indicada pelo Wrangler e registre o subdomínio da conta. Enquanto isso não for feito, a URL do Worker pode abrir com erro de SSL/TLS mesmo com o deploy concluído.

6. Pegue a URL gerada, por exemplo:

```text
https://bbosi-proxy.seu-usuario.workers.dev
```

## Banco de posições

Crie o banco D1 e copie o ID retornado para `wrangler.toml`:

```bash
npx wrangler d1 create bbosi
npx wrangler d1 migrations apply bbosi --remote
npx wrangler secret put POSITIONS_TOKEN
```

O comando `secret put` pede um token privado. Use o mesmo token no computador e
no celular pelo botão de chave na tela inicial. O token fica somente no
`localStorage` de cada dispositivo e não deve ser colocado no código Angular.

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

Depois disso, o frontend continua publicado no GitHub Pages, mas os dados passam por um proxy próprio.

## Alertas no Telegram

O Worker verifica as posições ativas sincronizadas no D1 a cada 5 minutos, mesmo
com a página fechada. Envia somente stop dinâmico e alvo de 50% de lucro para
um chat privado vinculado. Não executa ordens.

1. No Telegram, abra o bot oficial **@BotFather**, use `/newbot` e anote o token
  e o nome de usuário do bot. Não coloque o token no frontend ou no repositório.
2. No `wrangler.toml` do Worker, mantenha `[triggers]` com
  `crons = ["*/5 * * * *"]` e configure o nome público do bot:

  ```toml
  [vars]
  TELEGRAM_BOT_USERNAME = "nome_do_seu_bot"
  ```

3. Aplique a migração e cadastre os segredos com o Wrangler (ele solicitará os
  valores no terminal, sem passar pelo chat):

  ```bash
  npx wrangler d1 migrations apply bbosi --remote
  npx wrangler secret put TELEGRAM_BOT_TOKEN
  npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
  npm run deploy
  ```

  Escolha para `TELEGRAM_WEBHOOK_SECRET` uma cadeia aleatória de 32 a 256
  caracteres contendo apenas letras, números, `_` ou `-`. O Worker registra
  automaticamente o webhook ao gerar o link de vínculo; nenhum token precisa
  ser enviado manualmente à API do Telegram. Para desenvolvimento local, use
  `.dev.vars` ignorado pelo Git com esses segredos.
4. Publique também o frontend atualizado. Abra a página com o token de
  sincronização configurado, toque no sino de alertas, gere o link e abra-o no
  Telegram. Na conversa privada, toque em **Iniciar**; o app mostrará
  "Vinculado" em até cinco segundos. Use **Enviar teste**. Para parar os
  alertas, use **Desvincular**. Apenas um chat pode estar vinculado por vez.

O app precisa do Telegram instalado e com notificações permitidas no celular.
As posições precisam estar sincronizadas no D1; editar apenas dados locais sem
token não alimenta o monitor. Só cotações da opção e da ação com horário válido
e até 15 minutos de idade durante o pregão (dias úteis, 10h-18h de Brasília)
geram alertas. Em feriados, atrasos ou indisponibilidade das fontes, não há
alerta até chegarem dados novos. A verificação de cinco minutos não equivale
a preço negociável nem garante entrega instantânea. O primeiro vínculo pode
notificar posições já além dos limites se houver cotação recente.