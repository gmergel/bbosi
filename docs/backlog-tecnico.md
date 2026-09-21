# Backlog Técnico BBOSI

## Objetivo

Estabilizar a operação, melhorar a confiabilidade dos dados e elevar a qualidade de engenharia antes de expandir as funcionalidades quantitativas.

## Status

- **Concluído**: comportamento implementado no frontend/proxy atual.
- **Parcial**: existe implementação, mas ainda falta cobertura, observabilidade ou endurecimento para produção.
- **Aberto**: ainda não implementado ou precisa de revisão.

## Backlog priorizado

| ID | Prioridade | Item | Status | Impacto | Esforco |
|----|------------|------|--------|---------|---------|
| BL-001 | P0 | Controlar concorrência e frequência do polling da home | Concluído | Alto | M |
| BL-002 | P0 | Corrigir e testar inferência de preço no fallback | Aberto | Alto | M |
| BL-003 | P0 | Separar estados de erro, vazio e mock na tela de opções | Concluído | Alto | P |
| BL-004 | P0 | Acessibilidade de interações principais | Concluído | Alto | M |
| BL-005 | P1 | Política de cache com TTL e staleness visível | Parcial | Médio | M |
| BL-006 | P1 | Ajustar históricos para dia local America/Sao_Paulo | Aberto | Médio | P |
| BL-007 | P1 | Quality gate no CI | Aberto | Alto | P |
| BL-008 | P1 | Suite de testes de dominio | Parcial | Alto | G |
| BL-009 | P2 | Gateway/BFF próprio para dados de mercado | Parcial | Alto | G |
| BL-010 | P2 | Componentização de blocos repetidos de UI | Aberto | Médio | M |

## Entregas já incorporadas

- Polling de posições a cada 10 segundos, com pausa quando a aba está oculta e bloqueio de refresh concorrente.
- Estados explícitos de loading, dados reais, mock, vazio e erro, com retry manual.
- Navegação por teclado em cards e linhas expansivas, com `role` e atributos ARIA.
- Ranking por VDXX, busca por série, destaque da melhor oportunidade e detalhes expansivos.
- Cadastro de venda, edição do preço executado, recompra e remoção/histórico.
- Cards de opções vendidas ordenados alfabeticamente pelo ticker da ação.
- Quadrinho de NV no cabeçalho do card, com cores indicativas e tooltip de ação: recompra, acompanhamento ou manutenção.
- Taxa mensal estimada exibida na lista de opções; a taxa anualizada permanece como critério interno de elegibilidade.
- Alvo diário composto exibido na lista de opções para indicar a taxa média necessária até o strike.
- Barra de lucro com alvo de 50%, ponto de equilíbrio e limite de recompra calculado em 125% do preço de venda.
- O limite de recompra é exibido na legenda apenas como valor monetário; a posição visual identifica a indicação.
- Histórico de IV e liquidez no `localStorage`, além de sincronização opcional de posições pelo Worker/D1.

## Próximos passos

1. Cobrir com testes a inferência de preço e os cenários de fallback.
2. Definir TTL, indicador de dado antigo e política de invalidação.
3. Padronizar timezone dos históricos para o calendário local da B3.
4. Configurar CI para executar build e testes antes do deploy.
5. Completar a cobertura dos serviços de indicadores, mercado, históricos e posições.
6. Separar componentes repetidos de venda, logo/avatar e linha expansiva.