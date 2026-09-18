# GerBOSI App

Aplicacao Angular para analise de calls de venda coberta no GerBOSI.

O frontend possui selecao de acoes, ranking de opcoes por VDXX, filtros de elegibilidade, historico de IV/liquidez e monitoramento de posicoes vendidas. A documentacao funcional esta em `../docs/PRD.md`.

## Development server

To start a local development server, run:

```bash
npm install
npm run start
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

O app local usa `http://localhost:4200/`. As rotas `/api` sao encaminhadas pelo `proxy.conf.json`; em producao, o frontend usa o Worker descrito em `../bbosi-proxy/README.md`.
