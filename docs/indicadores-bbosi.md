# GerBOSI — Documentação Completa

## Visão Geral

O **GerBOSI** é um aplicativo Angular para análise de **venda coberta de opções** (Covered Call Writing) no mercado brasileiro. Combina indicadores clássicos de venda coberta com melhorias quantitativas baseadas em literatura acadêmica, oferecendo:

- Cálculo automático de indicadores (NV, VDX, VDXX, BOSI, GerBOSI)
- Filtros inteligentes com 10 regras de elegibilidade
- Monitoramento em tempo real de opções vendidas
- Sinais de saída quantitativos (Roll Signals)
- Análise de regime de volatilidade (IV Rank/Percentile)
- Delta Score para seleção otimizada de strikes

---

## Arquitetura

```
src/app/
├── services/
│   ├── market-data.service.ts    → Busca dados (Yahoo Finance + opcoes.net.br)
│   ├── indicator.service.ts      → Cálculo de todos os indicadores
│   ├── sold-options.service.ts   → Gestão de posições vendidas + roll signals
│   ├── iv-history.service.ts     → Histórico de IV ATM (90 pregões)
│   ├── liquidity-history.service.ts → Média de liquidez (5 pregões)
│   └── mock-data.service.ts      → Dados simulados (fora do pregão)
├── pages/
│   ├── stock-selection/          → Tela inicial: ações + vendas ativas
│   └── options-list/             → Tela de opções: ranking + indicadores
├── models/
│   └── stock.model.ts            → Interfaces (Stock, OptionData, OptionIndicators)
└── pipes/
    └── relative-time.pipe.ts     → Timestamps relativos ("há 5min", "hoje 14:30")
```

### Fontes de Dados

| Dado | API | Endpoint |
|------|-----|----------|
| Cotação da ação | Yahoo Finance | `/v8/finance/chart/{TICKER}.SA` |
| Opções + Gregas | opcoes.net.br | `/api/v1?r0t=OptionsChain&r0p.underlying_asset_id={TICKER}` |

Em produção (GitHub Pages), ambas passam por `corsproxy.io` para contornar CORS.

---

## Indicadores Clássicos

### 1. NV (Não Venda)

Marca opções que **não devem ser vendidas**.

```
NV = VE - (Delta + Gama)
```

- `NV < 0` → "Não Venda" — o risco supera o ganho potencial
- **Significado:** se o mercado subir R$1, a opção ganha mais valor (Delta + Gama) do que o VE que você vendeu

**Implementação:** `indicator.service.ts` → `calcIndicators()`

---

### 2. VDX (Índice de Eficiência da Venda)

Eficiência relativa da venda:

```
VDX = (NV / Cotação_opção) × 100
```

Quanto maior, melhor a relação risco/retorno.

---

### 3. VDXX (VDX Estendido + Delta Score)

Versão aprimorada que incorpora lastro, tempo e **proximidade ao delta ideal**:

```
VDXX = Lastro% × (NV / Cotação) × 50 × FatorTempo × DeltaScore
```

**Onde:**
- `Lastro%` = `(Strike - Preço_ação) / Preço_ação × 100`
- `FatorTempo` = `1,3 - pregões/100` (premia vencimentos mais próximos)
- `DeltaScore` = `exp(-(delta - 0.20)² / 0.12²)` — **gaussiana centrada em delta 0.20**

**Delta Score (melhoria acadêmica):**

| Delta | Score | Interpretação |
|-------|-------|---------------|
| 0.20 | 1.00 | Sweet spot ideal |
| 0.15 | 0.86 | Muito bom |
| 0.25 | 0.86 | Muito bom |
| 0.10 | 0.54 | Aceitável |
| 0.30 | 0.54 | Aceitável |
| 0.05 | 0.19 | Penalizado |
| 0.40 | 0.07 | Fortemente penalizado |

**Fundamento:** Estudos empíricos (Mugwagwa et al., 2012; tastytrade research) mostram que calls vendidas com delta 0.15-0.25 oferecem o melhor equilíbrio entre probabilidade de lucro, prêmio recebido e risco de exercício.

---

### 4. BOSI (Germano Options Strength Index)

Indica onde está a **força do mercado de opções**:

```
BOSI = VE × %NumNeg
```

- `%NumNeg` = negócios da opção / total de negócios da série × 100
- Uso: marcador de STOP — quando BOSI da vendida sobe, considerar fechar

---

### 5. GerBOSI (Germano BOSI consolidado)

**Média ponderada dos strikes**, usando BOSI como peso:

```
GerBOSI = Σ(Strike_i × BOSI_i) / Σ(BOSI_i)
```

Representa o **“centro de massa”** do mercado de opções. Usado como referência de stop: quando o GerBOSI se aproxima do preço da ação, a pressão compradora está perto — hora de agir.

---

## Regras de Elegibilidade (Filtros)

O app aplica **10 regras** sequenciais para determinar se uma opção pode ser vendida:

| # | Regra | Critério | Motivo |
|---|-------|----------|--------|
| 1 | Sem pozinhos | Preço > R$0,05 | Opções baratas demais têm spread enorme |
| 2 | Liquidez mínima | Média 5 pregões ≥ 50 negócios | Garante saída viável |
| 3 | Lastro mínimo | Lastro ≥ -2% | Evita ITM profundo (risco de exercício) |
| 4 | Prazo mínimo | ≥ 10 dias úteis | Pouco tempo = gamma risk |
| 5 | Prazo máximo | ≤ 45 dias úteis | Theta decai pouco longe do vencimento |
| 6 | VE positivo | VE > 0 | Sem VE não há o que vender |
| 7 | NV positivo | VE - Delta - Gama > 0 | Regra principal |
| 8 | Delta na faixa | 0.05 ≤ Delta ≤ 0.40 | Zona do lançador coberto |
| 9 | Taxa mínima | ≥ 6% a.a. anualizada | Retorno mínimo que justifica o risco |
| 10 | IV não extrema | IV ≤ 150% | IV absurda indica evento extremo |

**Liquidez (média 5 pregões):** O filtro usa a média de negócios dos últimos 5 dias (armazenados no localStorage) para evitar falsos positivos de dias atípicos. O BOSI continua usando os trades do dia.

---

## Melhorias Quantitativas

### 6. IV Rank e IV Percentile

Mede se a volatilidade implícita atual está **cara ou barata** historicamente.

**Serviço:** `iv-history.service.ts`
- Armazena IV ATM diária por ação (últimos 90 pregões) no localStorage
- Atualizado automaticamente a cada consulta de opções

**Fórmulas:**

```
IV Rank = (IV_atual - IV_mínima) / (IV_máxima - IV_mínima) × 100

IV Percentile = (dias com IV < IV_atual) / total_dias × 100
```

**Interpretação:**

| IV Rank | Significado | Ação |
|---------|-------------|------|
| 0-30% | IV barata | Prêmios baixos — vender menos |
| 30-70% | IV normal | Operação regular |
| 70-100% | IV cara | Prêmios altos — bom para vender |

**Requisito:** Mínimo 5 pregões de histórico para ativar. Melhora com o tempo (ideal: 60+ dias).

---

### 7. Regime de Volatilidade (Vol Regime)

Classificação do ambiente de mercado em 4 níveis:

| Regime | Critério | Banner | Ação recomendada |
|--------|----------|--------|------------------|
| **Extreme** | IV ATM > 80% | 🔴 Vermelho | Evitar novas vendas |
| **High** | IV ATM > 50% OU IV Rank > 85% | 🟡 Amarelo | Reduzir tamanho |
| **Normal** | Dentro dos limiares | Sem banner | Operar normalmente |
| **Low** | IV ATM < 15% OU IV Rank < 15% | 🔵 Azul | Prêmios reduzidos |

**Fundamento acadêmico:** Ilmanen (2012) e Fallon, Park & Yu (2015) demonstram que vendedores de volatilidade sofrem drawdowns severos em regimes de expansão de vol. O banner alerta visualmente para evitar over-exposure nesses momentos.

---

### 8. Barra de Lucro Capturado (Profit Bar)

Monitora em tempo real quanto do prêmio vendido já foi "ganho":

```
% Capturado = (Preço_venda - Preço_atual) / Preço_venda × 100
```

**Visualização:** Barra de progresso com marcador no alvo de 50%.

| Faixa | Cor | Significado |
|-------|-----|-------------|
| 0-25% | Cinza | Início da operação |
| 25-50% | Amarelo | Em progresso |
| 50-75% | Verde | Alvo atingido — considerar fechar |
| 75-100% | Teal | Excelente — fechar ou deixar expirar |

**Por que alvo em 50%?**

Evidência empírica (tastytrade, milhões de trades backtestados):
- Os primeiros 50% são capturados em ~40% do tempo da operação
- Os últimos 50% levam ~60% do tempo restante
- Fechar a 50% e reabrir nova posição gera melhor retorno por unidade de tempo
- Win rate sobe de ~60% (expiração) para ~80% (alvo 50%)
- Reduz exposição a reversões e eventos inesperados

---

### 9. Roll Signals (Sinais de Saída Quantitativos)

Sistema de 5 regras que determinam automaticamente quando agir sobre uma posição:

| Prioridade | Regra | Condição | Severidade | Ação |
|------------|-------|----------|------------|------|
| 1 | Alvo atingido | % Capturado ≥ 50% E DTE > 5 | 🟢 Info | Fechar com lucro |
| 2 | Prêmio esgotado | DTE ≤ 7 E % Capturado ≥ 75% | 🟢 Info | Rolar para próximo vencimento |
| 3 | Gamma Risk | DTE ≤ 5 E % Capturado < 50% | 🔴 Danger | Fechar imediatamente |
| 4 | GerBOSI pressão | (Strike - GerBOSI)/Strike < 3% | 🟡 Warn | Rolar ou fechar |
| 5 | NV negativo | NV < 0 | 🔴 Danger | Recomprar |

**Gamma Risk explicado:** Nas últimas 5 sessões antes do vencimento, o gamma é máximo. Se a opção ainda tem prêmio significativo (< 50% capturado), qualquer movimento do ativo contra a posição pode transformar lucro em prejuízo rapidamente. É a zona mais perigosa para o vendedor.

---

## Interface do Usuário

### Tela Inicial (Stock Selection)

**Cards de vendas ativas:**
- Logo + ticker da opção
- Meta: ação · dias restantes · preço atual · timestamp
- NV badge (colorido por status)
- Alert banner (roll signal com severidade)
- Barra visual GerBOSI/Preço/Strike com marcadores
- Barra de progresso de lucro (com alvo 50%)

**Cards de ações:**
- Logo + nome + preço (Yahoo Finance)
- Timestamp relativo do último update
- Click → abre lista de opções

### Tela de Opções (Options List)

**Header:**
- Preço da ação + GerBOSI da série

**Banners informativos:**
- Vol Regime (se ≠ normal)
- IV Info: IV ATM, IV Rank, IV Percentile, dias de histórico

**Ranking de opções:**
- Ordenadas por VDXX decrescente
- Badge com rank visual (cores por faixa de VDXX)
- Destaque da "Melhor Oportunidade" (card especial)
- Toggle para mostrar/ocultar "Não Venda"
- Detalhes expandidos ao clicar (todas as gregas + indicadores)
- Botão de venda → adiciona ao monitoramento

---

## Ciclo de Vida de uma Operação

```
┌─────────────────────────────────────────────────────────┐
│ 1. SELEÇÃO                                              │
│    • Escolher ação → ver ranking VDXX                   │
│    • Verificar Vol Regime (banner)                       │
│    • Verificar IV Rank (≥ 30% ideal)                    │
│    • Escolher opção com maior VDXX (passa nos filtros)  │
│    • Clicar VENDA → registra posição                    │
├─────────────────────────────────────────────────────────┤
│ 2. MONITORAMENTO (auto-refresh 2s)                      │
│    • Preço da opção atualiza live                       │
│    • Barra de lucro % avança                            │
│    • NV recalcula continuamente                         │
│    • GerBOSI monitora pressão compradora                  │
│    • Roll Signals avaliam 5 regras a cada refresh       │
├─────────────────────────────────────────────────────────┤
│ 3. SAÍDA (disparada por Roll Signal)                    │
│    • 🟢 Alvo 50% → fechar, reabrir nova se VDXX bom   │
│    • 🟢 Prêmio esgotado → rolar para próximo vcto     │
│    • 🟡 GerBOSI próximo → rolar ou reduzir               │
│    • 🔴 Gamma Risk → fechar imediatamente              │
│    • 🔴 NV negativo → recomprar                        │
│    • Remover card → operação encerrada                  │
└─────────────────────────────────────────────────────────┘
```

---

## Armazenamento Local (localStorage)

| Chave | Conteúdo | Retenção |
|-------|----------|----------|
| `bbosi-sold-options` | Opções vendidas ativas | Até remoção manual |
| `bbosi-iv-history` | IV ATM diária por ação | 90 pregões |
| `bbosi-liquidity-history` | Negócios diários por opção | 5 pregões |
| `bbosi-options-{TICKER}` | Cache de opções (último fetch) | Até próximo fetch |
| `bbosi-price-{TICKER}` | Cache de preço da ação | Até próximo fetch |

---

## Ações Monitoradas

| Ticker | Empresa |
|--------|---------|
| BBAS3 | Banco do Brasil |
| BBDC4 | Bradesco |
| BBSE3 | BB Seguridade |
| ITUB4 | Itaú Unibanco |
| PETR4 | Petrobras |
| VALE3 | Vale |

---

## Limitações Conhecidas

1. **Dados da opcoes.net.br podem estar defasados** — o campo "último" reflete o último negócio registrado, que pode ser do dia anterior se a opção ainda não negociou hoje.

2. **IV Rank precisa de histórico** — Nos primeiros 5 dias de uso, IV Rank/Percentile não aparece. Após 20+ dias, torna-se confiável.

3. **Mercado fechado** — Fora do horário de pregão (10h-17h), a API retorna dados em cache ou mock.

4. **CORS em produção** — Usa corsproxy.io como intermediário. Se o proxy ficar indisponível, o app perde acesso aos dados.

5. **Delta Score é opinativo** — O centro em 0.20 e spread de 0.12 são baseados em literatura mas podem não ser ótimos para todos os ativos/regimes.

---

## Referências

### Referências Bibliográficas (Base)
- Livro “Introdução às Opções” — Maurício Hissa
- Livro “Operando Opções” — Maurício Hissa
- Apostila “Venda Coberta para Remuneração”
- Manual “Nunca Foi Tão Fácil Fazer Venda Coberta”
- Fóruns e discussões sobre VDXX, BOSI

### Literatura Acadêmica (Melhorias)
- Israelov & Nielsen (2015) — "Covered Calls Uncovered"
- Ilmanen (2012) — "Do Financial Markets Reward Buying or Selling Insurance?"
- Constantinides, Jackwerth & Savov (2013) — Variance Risk Premium
- Fallon, Park & Yu (2015) — Vol selling drawdowns em crises
- Simon (2013) — "The VIX Futures Basis" (timing de venda de vol)
- Mugwagwa et al. (2012) — Delta-based strike selection

### Evidência Empírica
- tastytrade research — Alvos de saída ótimos (50% profit target)
- CBOE studies — Covered call systematic strategies (BXM index)
