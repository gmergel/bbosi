# PRD - GerBOSI App

## Visao geral

O GerBOSI e uma aplicacao Angular para analise de venda coberta de calls da B3. A aplicacao combina dados de mercado, indicadores quantitativos e acompanhamento de posicoes vendidas para apoiar a selecao, o registro e a saida de operacoes.

## Estado atual do produto

O MVP funcional possui duas telas:

1. **Selecao de acoes**: lista ativos monitorados, cotacao, horario da ultima atualizacao e posicoes vendidas.
2. **Lista de opcoes**: apresenta calls elegiveis, ranking por VDXX, indicadores detalhados e acao para registrar uma venda.

### Acoes monitoradas

| Ticker | Empresa |
|--------|---------|
| BBAS3 | Banco do Brasil |
| BBDC4 | Bradesco |
| BBSE3 | BB Seguridade |
| ITUB4 | Itau Unibanco |
| KLBN4 | Klabin |
| PETR4 | Petrobras |
| VALE3 | Vale |

## Tela de selecao

- Exibe cotacao e horario de mercado de cada acao.
- Permite abrir a lista de opcoes por clique, Enter ou Espaco.
- Exibe vendas ativas com ticker, dias, preco, NV, GerBOSI, preco da acao e strike.
- Atualiza posicoes automaticamente a cada 10 segundos quando a aba esta visivel.
- Permite editar o preco de venda, registrar recompra, remover uma venda e remover registros do historico.
- A barra de lucro mostra lucro capturado, alvo de 50%, ponto de equilibrio e o limite de recompra. Na legenda inferior, o limite aparece apenas como valor monetario, sem texto, pois sua posicao identifica a indicacao.
- Permite configurar um token de sincronizacao para persistir posicoes no proxy/Cloudflare D1.

## Tela de opcoes

- Busca dados de calls da acao selecionada.
- Ordena por VDXX decrescente e permite filtrar por serie.
- Oculta opcoes classificadas como **Nao Venda** por padrao, com controle para exibi-las.
- Expande cada linha para mostrar gregas e indicadores.
- Destaca a melhor oportunidade com maior VDXX positivo e elegivel.
- Informa estado de carregamento, dados reais, dados simulados, ausencia de dados e erro de rede separadamente.
- Exibe IV ATM, IV Rank, percentil e regime de volatilidade quando ha historico suficiente.
- Permite registrar a venda e informar o preco efetivamente executado.

## Indicadores e regras

Os indicadores sao calculados no frontend a partir dos dados brutos recebidos:

```
VE = preco da opcao, se OTM/ATM
VE = preco da opcao - valor intrinseco, se ITM
NV = VE - (Delta + Gama)
VDX = (NV / preco da opcao) * 100
VDXX = Lastro% * (NV / preco) * 50 * FatorTempo * DeltaScore
BOSI = VE * percentual de negocios da opcao
GerBOSI = soma(Strike * BOSI) / soma(BOSI)
Taxa anualizada = (VE / preco da acao) * (252 / dias uteis) * 100
```

Uma opcao e marcada como **Nao Venda** quando falha em uma regra de elegibilidade: preco minimo, liquidez media, lastro, prazo, VE, NV, faixa de delta, taxa anualizada ou IV maxima.

O filtro usa media de negocios dos ultimos cinco pregoes; o BOSI usa os negocios do dia. O DeltaScore favorece delta proximo de 0,20.

## Monitoramento e saida

O servico de posicoes atualiza preco da acao, preco da opcao, NV, VE, VDXX, GerBOSI e timestamp. Os sinais de saida consideram alvo de 50% do premio capturado, proximidade do vencimento, risco de gamma, pressao do GerBOSI e NV negativo.

O alvo de recompra e 50% do premio vendido. O limite de recompra visual e calculado como 125% do preco de venda. O texto da interface usa apenas o valor desse limite; a regra e mantida no servico de posicoes.

## Dados e persistencia

- Desenvolvimento: Angular servido localmente com `npm run start`, usando rotas do proxy em `/api`.
- Producao: frontend estatico no GitHub Pages e Cloudflare Worker como proxy proprio.
- Fontes: Yahoo Finance, opcoes.net.br e API VendaCoberta.
- Posicoes, historico de IV e historico de liquidez sao armazenados no `localStorage`.
- Posicoes podem ser sincronizadas remotamente em D1 mediante token configurado pelo usuario.
- Quando o mercado esta fechado ou as fontes nao respondem, a aplicacao pode usar cache ou dados simulados e informa o estado na tela.

## Requisitos nao funcionais

- Layout responsivo para desktop e mobile.
- Interacoes principais acessiveis por teclado e com nomes ARIA.
- Atualizacao sem sobrepor consultas de posicoes em andamento.
- Separacao explicita entre loading, pronto, mock, vazio e erro.
- Nenhum segredo embutido no frontend; o token de sincronizacao fica no dispositivo do usuario.

## Fora do escopo atual

- Opcoes PUT.
- Simulacao completa de carteira.
- Alertas push ou notificacoes externas.
- Autenticacao de usuarios.
- Historico analitico avancado e backtesting.