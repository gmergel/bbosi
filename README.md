# GerBOSI

Aplicação para análise de venda coberta de calls da B3, com indicadores GerBOSI, ranking de opções e monitoramento de posições vendidas.

O app também exibe a taxa mensal estimada da venda, o alvo diário composto necessário para a ação alcançar o strike no prazo restante e o NV com orientação de acompanhamento ou recompra.

## Documentação

- [PRD e estado atual do produto](docs/PRD.md)
- [Indicadores e regras quantitativas](docs/indicadores-bbosi.md)
- [Backlog técnico](docs/backlog-tecnico.md)
- [Frontend Angular](bbosi-app/README.md)
- [Proxy de produção](bbosi-proxy/README.md)

## Desenvolvimento local

```bash
cd bbosi-app
npm install
npm run start
```

Abra `http://localhost:4200/` no navegador.
Consultor de indicadores de opções na B3
