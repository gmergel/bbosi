# Backlog Tecnico BBOSI

## Objetivo

Estabilizar a operacao, melhorar a confiabilidade dos dados e elevar a qualidade de engenharia antes de expandir as funcionalidades quantitativas.

## Status

- **Concluido**: comportamento implementado no frontend/proxy atual.
- **Parcial**: existe implementacao, mas ainda falta cobertura, observabilidade ou endurecimento para producao.
- **Aberto**: ainda nao implementado ou precisa de revisao.

## Backlog priorizado

| ID | Prioridade | Item | Status | Impacto | Esforco |
|----|------------|------|--------|---------|---------|
| BL-001 | P0 | Controlar concorrencia e frequencia do polling da home | Concluido | Alto | M |
| BL-002 | P0 | Corrigir e testar inferencia de preco no fallback | Aberto | Alto | M |
| BL-003 | P0 | Separar estados de erro, vazio e mock na tela de opcoes | Concluido | Alto | P |
| BL-004 | P0 | Acessibilidade de interacoes principais | Concluido | Alto | M |
| BL-005 | P1 | Politica de cache com TTL e staleness visivel | Parcial | Medio | M |
| BL-006 | P1 | Ajustar historicos para dia local America/Sao_Paulo | Aberto | Medio | P |
| BL-007 | P1 | Quality gate no CI | Aberto | Alto | P |
| BL-008 | P1 | Suite de testes de dominio | Parcial | Alto | G |
| BL-009 | P2 | Gateway/BFF proprio para dados de mercado | Parcial | Alto | G |
| BL-010 | P2 | Componentizacao de blocos repetidos de UI | Aberto | Medio | M |

## Entregas ja incorporadas

- Polling de posicoes a cada 10 segundos, com pausa quando a aba esta oculta e bloqueio de refresh concorrente.
- Estados explicitos de loading, dados reais, mock, vazio e erro, com retry manual.
- Navegacao por teclado em cards e linhas expansivas, com `role` e atributos ARIA.
- Ranking por VDXX, busca por serie, destaque da melhor oportunidade e detalhes expansivos.
- Cadastro de venda, edicao do preco executado, recompra e remocao/historico.
- Barra de lucro com alvo de 50%, ponto de equilibrio e limite de recompra calculado em 125% do preco de venda.
- O limite de recompra e exibido na legenda apenas como valor monetario; a posicao visual identifica a indicacao.
- Historico de IV e liquidez no `localStorage`, alem de sincronizacao opcional de posicoes pelo Worker/D1.

## Proximos passos

1. Cobrir com testes a inferencia de preco e os cenarios de fallback.
2. Definir TTL, indicador de dado antigo e politica de invalidacao.
3. Padronizar timezone dos historicos para o calendario local da B3.
4. Configurar CI para executar build e testes antes do deploy.
5. Completar a cobertura dos servicos de indicadores, mercado, historicos e posicoes.
6. Separar componentes repetidos de venda, logo/avatar e linha expansiva.