# Backlog Tecnico BBOSI

## Objetivo
Estabilizar operacao, melhorar confiabilidade de dados e elevar qualidade de engenharia antes de expandir novas funcionalidades quantitativas.

## Escala usada
- Impacto: Alto | Medio | Baixo
- Esforco: P (ate 1 dia) | M (2-4 dias) | G (5+ dias)
- Prioridade: P0 (imediato) | P1 (curto prazo) | P2 (medio prazo)

## Backlog Priorizado

| ID | Prioridade | Item | Impacto | Esforco | Dependencias |
|----|------------|------|---------|---------|--------------|
| BL-001 | P0 | Controlar concorrencia do polling da home | Alto | M | Nenhuma |
| BL-002 | P0 | Corrigir inferencia de preco no fallback | Alto | M | Nenhuma |
| BL-003 | P0 | Separar estados de erro/vazio/mock na tela de opcoes | Alto | P | BL-001 |
| BL-004 | P0 | Acessibilidade de interacoes principais (teclado + ARIA) | Alto | M | Nenhuma |
| BL-005 | P1 | Politica de cache com TTL e staleness visivel | Medio | M | BL-002 |
| BL-006 | P1 | Ajustar historicos para dia local (America/Sao_Paulo) | Medio | P | Nenhuma |
| BL-007 | P1 | Quality gate no CI (testes obrigatorios antes de deploy) | Alto | P | BL-008 |
| BL-008 | P1 | Suite de testes de dominio (indicadores/dados/vendidas) | Alto | G | Nenhuma |
| BL-009 | P2 | Gateway/BFF para dados de mercado (sem proxy publico) | Alto | G | BL-001, BL-005 |
| BL-010 | P2 | Componentizacao de blocos repetidos de UI | Medio | M | BL-004 |

---

## Detalhamento dos Itens

### BL-001 - Controlar concorrencia do polling da home
- Problema: refresh a cada 2s pode sobrepor chamadas e gerar corrida de respostas.
- Escopo:
  - Migrar polling para fluxo RxJS com controle de concorrencia (ex.: exhaustMap).
  - Evitar refresh simultaneo por ticker.
  - Pausar/reduzir polling com aba inativa.
- Criterio de aceite:
  - Sem sobreposicao de chamadas para o mesmo ticker.
  - Reducao observavel no volume de requisicoes por minuto.
  - Atualizacao visual continua estavel na home.

### BL-002 - Corrigir inferencia de preco no fallback
- Problema: fallback pode distorcer preco da acao e indicadores quando fonte principal falha.
- Escopo:
  - Revisar formula de inferencia por premio/distancia.
  - Padronizar unidade/percentual usado no calculo.
  - Cobrir cenario de falha da fonte principal com testes.
- Criterio de aceite:
  - Preco inferido dentro de faixa coerente em cenarios de fallback.
  - Indicadores derivados (NV/VDXX/taxa) sem saltos anormais.

### BL-003 - Separar estados de erro/vazio/mock na tela de opcoes
- Problema: erro tecnico pode parecer mercado fechado.
- Escopo:
  - Modelar estados explicitos: loading, erro de rede, sem dados de pregrao, mock.
  - Mostrar mensagem especifica por estado com opcao de tentar novamente.
- Criterio de aceite:
  - Cada cenario exibe mensagem correta e nao ambigua.
  - Usuario consegue acionar retry manual.

### BL-004 - Acessibilidade de interacoes principais
- Problema: areas clicaveis sem semantica completa de teclado/leitor de tela.
- Escopo:
  - Garantir acionamento por Enter/Espaco em cards/linhas expansivas.
  - Adicionar roles/aria-label/aria-expanded onde aplicavel.
  - Ajustar foco visivel consistente.
- Criterio de aceite:
  - Fluxo principal navegavel apenas por teclado.
  - Elementos interativos com nome acessivel.

### BL-005 - Politica de cache com TTL e staleness visivel
- Problema: cache sem validade clara pode exibir dado antigo como atual.
- Escopo:
  - Definir TTL por tipo de dado (preco/opcoes/historico).
  - Invalidar/renovar cache de forma previsivel.
  - Exibir indicador de dado desatualizado.
- Criterio de aceite:
  - Dados fora de TTL nao sao tratados como frescos.
  - UI informa quando exibindo cache antigo.

### BL-006 - Ajustar historicos para dia local
- Problema: chave diaria em UTC pode deslocar registro de dia no Brasil.
- Escopo:
  - Gerar chave de dia em timezone local de mercado.
  - Validar historico em virada de dia.
- Criterio de aceite:
  - Sem deslocamento de registros entre dias uteis locais.

### BL-007 - Quality gate no CI
- Problema: deploy sem bloqueio formal por testes aumenta risco de regressao.
- Escopo:
  - Exigir etapa de testes/lint antes do build/deploy.
  - Falha em testes bloqueia publicacao.
- Criterio de aceite:
  - Pipeline interrompe deploy quando testes falham.

### BL-008 - Suite de testes de dominio
- Problema: baixa cobertura do nucleo quantitativo e de fallback.
- Escopo:
  - Testes unitarios para indicator, market-data, sold-options, historicos.
  - Casos de erro e fallback.
- Criterio de aceite:
  - Cobertura minima definida para servicos criticos.
  - Casos de regressao conhecidos cobertos.

### BL-009 - Gateway/BFF para dados de mercado
- Problema: proxies publicos em producao reduzem confiabilidade e governanca.
- Escopo:
  - Criar backend leve para consolidar Yahoo/opcoes e normalizar resposta.
  - Aplicar retry/backoff e cache server-side.
  - Remover dependencia de proxy publico no frontend.
- Criterio de aceite:
  - Frontend consome endpoint proprio estavel.
  - Queda de proxy publico nao derruba operacao.

### BL-010 - Componentizacao de UI repetida
- Problema: repeticao de blocos aumenta custo de manutencao.
- Escopo:
  - Extrair componente de logo/avatar de ativo.
  - Extrair card de venda ativa e linha de opcao expansivel.
  - Centralizar tokens de tipografia/espacamento.
- Criterio de aceite:
  - Reducao de duplicacao de markup/estilo.
  - Consistencia visual entre telas.

---

## Ordem de Execucao Recomendada
1. Sprint 1: BL-001, BL-002, BL-003
2. Sprint 2: BL-004, BL-005, BL-006
3. Sprint 3: BL-008, BL-007
4. Sprint 4+: BL-009, BL-010

## Marco de Conclusao
Backlog P0 concluido quando:
- Nao ha sobreposicao de chamadas em runtime.
- Fallback de preco esta coerente e testado.
- Estados de erro sao claros para o usuario.
- Fluxo principal e acessivel por teclado.
