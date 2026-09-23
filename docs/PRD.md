# PRD - GerBOSI App

## Visão geral

O GerBOSI é uma aplicação Angular para análise de venda coberta de calls da B3. A aplicação combina dados de mercado, indicadores quantitativos e acompanhamento de posições vendidas para apoiar a seleção, o registro e a saída de operações.

## Estado atual do produto

O MVP funcional possui duas telas:

1. **Seleção de ações**: lista ativos monitorados, cotação, horário da última atualização e posições vendidas.
2. **Lista de opções**: apresenta calls elegíveis, ranking por VDXX, indicadores detalhados e ação para registrar uma venda.

### Ações monitoradas

| Ticker | Empresa |
|--------|---------|
| BBAS3 | Banco do Brasil |
| BBDC4 | Bradesco |
| BBSE3 | BB Seguridade |
| ITUB4 | Itaú Unibanco |
| KLBN4 | Klabin |
| PETR4 | Petrobras |
| VALE3 | Vale |

## Tela de seleção

- Exibe cotação e horário de mercado de cada ação.
- Permite abrir a lista de opções por clique, Enter ou Espaço.
- Exibe vendas ativas com ticker, dias, preço, NV, GerBOSI, preço da ação e strike.
- Ordena os cards de opções vendidas alfabeticamente pelo ticker da ação.
- Atualiza posições automaticamente a cada 10 segundos quando a aba está visível.
- Permite editar o preço de venda, registrar recompra, remover uma venda e remover registros do histórico.
- Exibe o NV em um quadrinho no canto superior direito do card, ao lado dos botões de recompra e fechamento. As cores indicam o estado do indicador, e o tooltip sugere manter, acompanhar ou considerar recompra.
- A barra de lucro mostra lucro capturado, alvo de 50%, ponto de equilíbrio e o limite de recompra. O NV não é misturado à barra porque não representa valor monetário.
- Permite configurar um token de sincronização para persistir posições no proxy/Cloudflare D1.

## Tela de opções

- Busca dados de calls da ação selecionada.
- Ordena por VDXX decrescente e permite filtrar por série.
- Oculta opções classificadas como **Não Venda** por padrão, com controle para exibi-las.
- Expande cada linha para mostrar gregas e indicadores.
- Destaca a melhor oportunidade com maior VDXX positivo e elegível.
- Informa estado de carregamento, dados reais, ausência de dados e erro de rede separadamente; nunca substitui dados indisponíveis por simulações.
- Exibe IV ATM, IV Rank, percentil e regime de volatilidade quando há histórico suficiente.
- Exibe o alvo diário composto necessário para a ação atingir o strike no número de pregões restante.
- Permite registrar a venda e informar o preço efetivamente executado.

## Indicadores e regras

Os indicadores são calculados no frontend a partir dos dados brutos recebidos:

```
VE = preço da opção, se OTM/ATM
VE = preço da opção - valor intrínseco, se ITM
NV = VE - (Delta + Gama)
VDX = (NV / preço da opção) * 100
VDXX = Lastro% * (NV / preço) * 50 * FatorTempo * DeltaScore
BOSI = VE * percentual de negócios da opção
GerBOSI = soma(Strike * BOSI) / soma(BOSI)
Taxa anualizada = (VE / preço da ação) * (252 / dias úteis) * 100
```

Embora a elegibilidade use a taxa anualizada mínima de 6% a.a., a interface exibe a taxa mensal estimada, calculada com 21 pregões por mês:

```
Taxa mensal = (VE / preço da ação) * (21 / dias úteis) * 100
```

O alvo diário é uma taxa média composta, não uma variação simples:

```
Alvo diário = ((Strike / preço da ação) ^ (1 / pregões)) - 1
```

Aplicando essa taxa a cada pregão, o preço final seria aproximadamente o strike. O cálculo é uma referência matemática e não uma previsão de alta diária; não considera dividendos, gaps, volatilidade ou a trajetória real do preço.

Uma opção é marcada como **Não Venda** quando falha em uma regra de elegibilidade: preço mínimo, liquidez média, lastro, prazo, VE, NV, faixa de delta, taxa anualizada ou IV máxima.

O filtro usa média de negócios dos últimos cinco pregões; o BOSI usa os negócios do dia. O DeltaScore favorece delta próximo de 0,20.

## Monitoramento e saída

O serviço de posições atualiza preço da ação, preço da opção, NV, VE, VDXX, GerBOSI e timestamp. Os sinais de saída consideram alvo de 50% do prêmio capturado, proximidade do vencimento, risco de gamma, pressão do GerBOSI, NV negativo e stop dinâmico ajustado à sensibilidade da opção.

O alvo de recompra é 50% do prêmio vendido. O stop de recompra é dinâmico: parte de uma base de 25% do prêmio vendido e é ajustado para cima ou para baixo conforme gamma, DTE, NV e nível de lucro já capturado. Em termos práticos, o limite pode variar entre 15% e 40% sobre o preço de venda, sendo mais apertado em opções de alta sensibilidade e mais tolerante em posições mais calmas. O texto da interface mostra o valor monetário e o percentual do stop atual; a regra é mantida no serviço de posições. Quando o NV fica negativo, o sistema apresenta um sinal de perigo e sugere considerar a recompra.

## Dados e persistencia

- Desenvolvimento: Angular servido localmente com `npm run start`, usando rotas do proxy em `/api`.
- Produção: frontend estático no GitHub Pages e Cloudflare Worker como proxy próprio.
- Fontes: Yahoo Finance, opcoes.net.br e API VendaCoberta.
- Posições, histórico de IV e histórico de liquidez são armazenados no `localStorage`.
- Posições podem ser sincronizadas remotamente em D1 mediante token configurado pelo usuário.
- Quando o mercado está fechado ou as fontes não respondem, a aplicação informa que os dados reais não estão disponíveis e oferece nova tentativa.

## Requisitos não funcionais

- Layout responsivo para desktop e mobile.
- Interações principais acessíveis por teclado e com nomes ARIA.
- Atualização sem sobrepor consultas de posições em andamento.
- Separação explícita entre loading, pronto, vazio e erro.
- Nenhum segredo embutido no frontend; o token de sincronização fica no dispositivo do usuário.

## Fora do escopo atual

- Opções PUT.
- Simulacao completa de carteira.
- Alertas push ou notificações externas.
- Autenticação de usuários.
- Histórico analítico avançado e backtesting.