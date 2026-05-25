# Indicadores BBOSI - Bastter.com

## Contexto: Venda Coberta de Opções

A **Venda Coberta** (Covered Call Writing) no método Bastter é uma estratégia de **remuneração de carteira de ações** de longo prazo. O investidor que já possui ações de empresas sólidas (Blue Chips) vende opções de compra (calls) sobre essas ações para gerar renda adicional (VE - Valor Extrínseco), com o lucro sendo usado para comprar mais ações.

### Princípios Fundamentais

- Objetivo: acumular mais ações, não especular
- Vender VE (Valor Extrínseco) = lucrar com a passagem do tempo (theta positivo)
- Quanto mais longe e menor a quantidade vendida → menos risco na alta, mas menos receita
- Quanto mais perto e maior a quantidade → mais receita, mas mais risco se subir forte
- VE eficiente para vendas: longe do preço da ação, muito VE, pouco gama, pouco tempo

### Conceitos Base

- **VE (Valor Extrínseco):** Parte do prêmio da opção que corresponde à expectativa/tempo. `VE = Prêmio - Valor Intrínseco`. Opções OTM só possuem VE.
- **Lastro:** Distância percentual entre o preço da ação e o strike da opção. Representa a margem de segurança.
- **Gregas relevantes:**
  - **Delta:** centavos que a opção varia por R$1 de variação da ação
  - **Gama:** taxa de variação do Delta (aceleração)
  - **Theta:** centavos de VE que a opção perde por dia

---

## Os Indicadores

### 1. NV (Não Venda)

Marca opções que **não devem ser vendidas** na venda coberta.

**Critério:**

```
NV = VE - (Delta + Gama)
```

- Se `NV < 0`, a opção é marcada como "Não Venda"
- **Significado:** o VE é menor que Delta + Gama, ou seja, se o mercado subir R$1, a opção ganha mais valor do que o VE que você vendeu. O risco supera o ganho potencial.
- Também são NV opções muito ITM (dentro do dinheiro)

**Uso prático:** Eliminar da análise qualquer opção com NV negativo antes de considerar vendas.

---

### 2. VDX (Índice de Eficiência da Venda)

Mede a **eficiência** de uma venda de opção. Quanto maior o VDX, melhor a opção para vender.

**Fatores considerados:**
- **Gama** (risco de aceleração — quanto menor, melhor para venda)
- **Tempo** (dias para vencimento)
- **Tamanho** (valor financeiro do VE)
- **Distância** (lastro percentual até o strike)

O VDX varia conforme a volatilidade do mercado (mercados mais voláteis produzem VDXs maiores) e com o preço das ações. O site Bastter.com fornecia um **VDX mínimo** para cada ação.

**Uso prático:**
- Vender somente opções com VDX acima do mínimo
- Aumentar vendas quando VDX > 10
- Diminuir vendas quando VDX < 6
- Escolher entre opções elegíveis a de maior VDX

---

### 3. VDXX (VDX Estendido)

Versão mais completa/avançada do VDX. Fórmula reconstruída a partir do fórum do Bastter:

```
VDXX = Lastro% × (NV / Cotação_opção) × (100 / 2) × (1,3 - num_pregões / 100)
```

**Onde:**
- **Lastro%** = distância percentual do preço da ação até o strike
  - Ex: ação a R$8,67, strike R$11,87 → lastro = (11,87 - 8,67) / 8,67 = 36,79%
- **NV** = valor do indicador NV da opção (VE - Delta - Gama, quando positivo)
- **Cotação da opção** = prêmio atual da opção
- **num_pregões** = número de pregões (dias úteis de bolsa) até o vencimento

**Interpretação dos fatores:**
- `Lastro%`: premia opções mais distantes (mais seguras)
- `NV / Cotação`: relação entre o "valor líquido" e o custo — eficiência relativa
- `(100/2)`: fator de escala/normalização
- `(1,3 - pregões/100)`: fator tempo — opções mais próximas do vencimento têm VDXX maior (decaimento temporal mais acelerado = mais eficiente para venda de curto prazo)

---

### 4. BOSI (Bastter Options Strength Index)

Indica **onde está a força do mercado de opções** — em qual strike a concentração de atividade e valor está localizada.

**Fórmula (versão simplificada):**

```
BOSI = VE × %NumNeg
```

**Fórmula (versão completa do curso):**

```
BOSI = Gama × %NumNeg × VE
```

**Onde:**
- **VE** = Valor Extrínseco da opção
- **%NumNeg** = percentual do número de negócios da série que está naquela opção
  - Ex: série com 10.000 negócios totais, opção com 1.000 negócios → %NumNeg = 10%
- **Gama** = grega gama da opção (aceleração)

**Uso:** Marcador de **STOP** para a venda coberta — quando o BOSI da opção vendida sobe significativamente, é sinal para recomprar (stopar) ou rolar a posição.

---

### 5. BBOSI (Bastter BOSI)

O indicador **consolidado da série**. É uma **média ponderada dos strikes**, usando o BOSI como peso.

**Fórmula:**

```
BBOSI = Σ(Strike_i × BOSI_i) / Σ(BOSI_i)
```

**Cálculo passo a passo:**
1. Para cada opção `i` da série, calcular `Strike_i × BOSI_i`
2. Somar todos esses produtos
3. Somar todos os BOSIs
4. Dividir a soma dos produtos pela soma dos BOSIs

**Interpretação:**

O BBOSI representa o **"centro de massa"** do mercado de opções — o strike ponderado onde a força está concentrada.

**Uso como STOP:**
- Se o BBOSI sobe e se aproxima do preço atual da ação → a pressão compradora nas opções está perto do preço, hora de recomprar/rolar
- Vantagem sobre usar apenas o preço da opção: o BBOSI considera o mercado como um todo, não apenas a opção isolada
- Exemplo real do fórum: "Apesar de subir 0,10 no preço, o lastro ficou praticamente inalterado. Uma das vantagens de se usar o BBOSI para stopar!"

---

## Marcadores de Risco Complementares

| Marcador | Fórmula | Limite | Uso |
|----------|---------|--------|-----|
| **LIMITEX (LX)** | Valor vendido em opções / Valor da carteira × 100 | 5-6% (máx) | Não ultrapassar X% da carteira vendido em opções |
| **THEX** | Theta da operação / Valor da carteira | 5 (máx 7) | Controlar o risco gama nas altas |

**Regras do LX:**
- Comece com 2-3%
- Nunca passe de 5-6% mesmo com experiência
- Limite absoluto de dívida: R$20.000
- Se ultrapassar, comprar opções onde está vendido até voltar ao limite

**Regras do THEX:**
- Theta positivo é diretamente proporcional ao Gama negativo
- Antes de corrigir o THEX, verifique e corrija primeiro o LX

---

## Fluxo de Decisão para Venda Coberta

```
1. Filtrar opções com NV positivo (eliminar "Não Venda")
2. Verificar VDX/VDXX mínimo para a ação
3. Entre as elegíveis, escolher a de maior VDX/VDXX
4. Verificar se a venda respeita LIMITEX (LX)
5. Verificar se a venda respeita THEX
6. Executar a venda → definir:
   - Alvo (preço para recompra com lucro)
   - Stop (BBOSI ou BOSI como referência)
   - Prazo máximo
7. Monitorar:
   - Se mercado cai/fica: aguardar atingir alvo
   - Se mercado sobe: usar BBOSI como stop para rolar/recomprar
```

---

## Dados Necessários para Cálculo

Para implementar estes indicadores em um aplicativo, são necessários:

| Dado | Fonte | Uso |
|------|-------|-----|
| Preço da ação (spot) | API de cotações | Lastro, VE |
| Strike da opção | Cadastro B3 | BBOSI, Lastro |
| Prêmio da opção (cotação) | API de cotações | VE, VDXX |
| Delta | Black-Scholes (calculado) | NV |
| Gama | Black-Scholes (calculado) | NV, BOSI, VDX |
| Theta | Black-Scholes (calculado) | THEX |
| Volatilidade Histórica (VH) | Calculada (fechamentos) | B&S |
| Taxa de juros (Selic) | Banco Central | B&S |
| Dias úteis até vencimento | Calendário B3 | VDXX, VDX |
| Número de negócios por opção | API de cotações/B3 | BOSI, %NumNeg |
| Número total de negócios da série | API de cotações/B3 | %NumNeg |

---

## Referências

- Livro "Introdução às Opções" - Maurício Hissa (Bastter)
- Livro "Operando Opções" - Maurício Hissa (Bastter)
- Apostila "Venda Coberta para Remuneração" - Bastter.com
- Curso Bastter Blue - Introdução às Opções
- Manual "Nunca Foi Tão Fácil Fazer Venda Coberta" - Bastter Blue
- Fóruns Bastter.com (discussões sobre VDXX, BBOSI)
- Planilha Bastter Blue / Painel Bastter Blue
