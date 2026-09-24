export interface Stock {
  ticker: string;
  name: string;
  price: number;
  marketTime?: Date | null;
}

export interface OptionData {
  ticker: string;
  strike: number;
  expiration: Date;
  tradingDays: number;
  price: number;
  trades: number;         // Número de negócios
  volume: number;         // Volume financeiro (R$)
  tradePercent: number;
  marketDataTime?: string | null; // Data/hora de referência informada pela fonte
}

export interface OptionIndicators extends OptionData {
  ve: number;
  lastroPercent: number;
  delta: number;
  gama: number;
  theta: number;
  impliedVol: number;
  nv: number;
  vdx: number;
  vdxx: number;
  bosi: number;
  taxaAnual: number;       // Retorno anualizado usado na elegibilidade (% a.a.)
  taxaMensal: number;      // Retorno mensal estimado da venda coberta (% a.m.)
  premiumPercent: number;  // Prêmio como % do preço da ação
  noSell: boolean;
  noSellReason: string;    // Motivo pelo qual não deve vender
}
