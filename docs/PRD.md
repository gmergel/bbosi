# PRD - BBOSI App

## Visão Geral

Aplicação web simples em **Angular** para análise de opções de venda coberta, calculando os indicadores BBOSI (VDX, VDXX, BOSI, BBOSI, NV) para auxiliar o investidor na escolha da melhor opção para vender.

---

## Stack Tecnológica

- **Frontend:** Angular (última versão estável)
- **Linguagem:** TypeScript
- **Estilo:** CSS/SCSS simples
- **API de dados:** A definir (cotações de ações e opções da B3)

---

## Funcionalidades - MVP

### Tela 1: Seleção de Ação

A tela inicial apresenta **4 cards** para escolha da ação-objeto:

| Ticker | Empresa |
|--------|---------|
| BBAS3 | Banco do Brasil |
| BBDC4 | Bradesco |
| PETR4 | Petrobras |
| VALE3 | Vale |

**Comportamento:**
- Exibir os 4 cards com ticker e nome da empresa
- Ao clicar em um card, navegar para a Tela 2 com a ação selecionada

---

### Tela 2: Lista de Opções (Calls)

Exibe as opções de compra (calls) disponíveis para a ação selecionada.

**Filtros aplicados automaticamente:**
- Tipo: somente **CALL** (opções de compra)
- Vencimento: entre o **próximo vencimento** e no máximo **80 dias úteis** à frente
- Séries: pode incluir até 2 vencimentos (o mais próximo e o seguinte, se dentro dos 80 dias)

**Dados exibidos por opção:**

| Coluna | Descrição |
|--------|-----------|
| Ticker | Código da opção (ex: BBASA250) |
| Strike | Preço de exercício |
| Vencimento | Data de vencimento |
| Pregões | Dias úteis até o vencimento |
| Cotação | Último preço negociado |
| VE | Valor Extrínseco |
| Lastro% | Distância percentual do strike ao preço atual |
| Delta | Grega Delta |
| Gama | Grega Gama |
| NV | Indicador NV (VE - Delta - Gama) |
| VDX | Índice de eficiência da venda |
| VDXX | VDX Estendido |
| BOSI | Bastter Options Strength Index |
| Neg% | Percentual de negócios da série |

**Cabeçalho da tela:**
- Nome e ticker da ação selecionada
- Preço atual da ação
- **BBOSI** da série (calculado e exibido em destaque)
- Botão para voltar à tela de seleção

**Comportamento:**
- Opções com NV negativo devem ser exibidas com destaque visual (cinza/riscadas) indicando "Não Venda"
- Ordenação padrão: por Strike crescente
- Permitir reordenação por qualquer coluna

---

## Regras de Negócio

### Cálculo dos Indicadores

Todos os indicadores devem ser calculados no frontend com base nos dados brutos recebidos da API.

**NV:**
```
NV = VE - (Delta + Gama)
Se NV < 0 → marcar como "Não Venda"
```

**BOSI:**
```
BOSI = VE × %NumNeg
```

**BBOSI:**
```
BBOSI = Σ(Strike_i × BOSI_i) / Σ(BOSI_i)
```

**VDXX:**
```
VDXX = Lastro% × (NV / Cotação_opção) × 50 × (1,3 - num_pregões / 100)
```

**Lastro%:**
```
Lastro% = (Strike - Preço_ação) / Preço_ação × 100
```

**VE (Valor Extrínseco):**
```
Se Strike > Preço_ação (OTM): VE = Cotação da opção
Se Strike ≤ Preço_ação (ITM): VE = Cotação - (Preço_ação - Strike)
```

### Gregas (Black-Scholes)

As gregas (Delta, Gama, Theta) devem ser calculadas usando o modelo Black-Scholes com:
- Volatilidade Histórica de 21 dias (ou recebida da API)
- Taxa Selic vigente (ou recebida da API)
- Dias úteis até o vencimento

---

## Requisitos Não-Funcionais

- Responsivo (mobile-friendly)
- Carregamento rápido (< 2s)
- Sem autenticação no MVP
- Dados podem ser mockados inicialmente para desenvolvimento

---

## Fora do Escopo (MVP)

- Cálculo de THEX e LIMITEX
- Histórico de operações
- Simulação de vendas
- Opções de PUT
- Mais de 4 ações
- Alertas/notificações
- Persistência de dados
- Backend próprio

---

## Estrutura de Navegação

```
[Tela 1: Seleção de Ação]
    |
    ├── BBAS3 ──→ [Tela 2: Lista de Calls BBAS3]
    ├── BBDC4 ──→ [Tela 2: Lista de Calls BBDC4]
    ├── PETR4 ──→ [Tela 2: Lista de Calls PETR4]
    └── VALE3 ──→ [Tela 2: Lista de Calls VALE3]
```
