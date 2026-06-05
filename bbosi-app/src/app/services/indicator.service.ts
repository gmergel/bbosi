import { Injectable, inject } from '@angular/core';
import { OptionIndicators } from '../models/stock.model';
import { OptionWithGreeks } from './market-data.service';
import { LiquidityHistoryService } from './liquidity-history.service';
import { IvHistoryService } from './iv-history.service';

export type VolRegime = 'low' | 'normal' | 'high' | 'extreme';

/**
 * Regras de Elegibilidade para Venda Coberta:
 *
 * 1. APENAS OTM ou levemente ATM (lastro >= -2%)
 * 2. SEM POZINHOS: preço mínimo > R$0.05
 * 3. LIQUIDEZ: mínimo de negócios > 0
 * 4. DELTA IDEAL: entre 0.05 e 0.40 (zona do lançador)
 * 5. PRAZO: entre 10 e 45 dias úteis (ideal: vencimento mensal)
 * 6. VE > 0: deve ter valor extrínseco
 * 7. NV POSITIVO: VE - (Delta + Gama) > 0 → "pode vender"
 * 8. TAXA MÍNIMA: retorno anualizado >= 6% a.a.
 * 9. NÃO VENDER se IV muito alta (>100%) indica risco extremo
 * 10. Preferir opções com formador de mercado (liquidez garantida)
 */
@Injectable({ providedIn: 'root' })
export class IndicatorService {
  private liquidityHistory = inject(LiquidityHistoryService);
  private ivHistory = inject(IvHistoryService);

  // Constantes das regras de elegibilidade
  private readonly MIN_PRICE = 0.05;          // Sem pozinhos
  private readonly MIN_TRADES = 50;           // Mínimo negócios (liquidez)
  private readonly MIN_DELTA = 0.05;          // Delta mínimo útil
  private readonly MAX_DELTA = 0.40;          // Delta máximo para lançador
  private readonly MIN_TRADING_DAYS = 10;     // Mínimo dias úteis
  private readonly MAX_TRADING_DAYS = 45;     // Máximo dias úteis
  private readonly MIN_LASTRO_PERCENT = -2;   // Lastro mínimo (leve ITM ok)
  private readonly MIN_TAXA_ANUAL = 6;        // Taxa anualizada mínima (% a.a.)
  private readonly MAX_IV = 1.5;              // IV máxima (150%)

  /**
   * Calcula indicadores usando gregas vindas da API (opcoes.net.br)
   * e aplica todas as regras de elegibilidade para classificação.
   */
  calculateFromApi(options: OptionWithGreeks[], stockPrice: number, stockTicker?: string): OptionIndicators[] {
    if (stockPrice <= 0) return [];

    // Registra negócios do dia no histórico de liquidez
    this.liquidityHistory.recordDay(options.map(o => ({ ticker: o.ticker, trades: o.trades })));

    // Registra IV ATM no histórico (para IV Rank)
    if (stockTicker) {
      const atmIv = this.getAtmIv(options);
      if (atmIv > 0) {
        this.ivHistory.recordDay(stockTicker, atmIv);
      }
    }

    const totalTrades = options.reduce((sum, o) => sum + o.trades, 0);

    return options
      .map(option => this.calcIndicators(option, stockPrice, totalTrades))
      .filter((o): o is OptionIndicators => o !== null);
  }

  private calcIndicators(
    option: OptionWithGreeks,
    stockPrice: number,
    totalTrades: number
  ): OptionIndicators | null {
    const ve = this.calcVE(option.price, stockPrice, option.strike);
    const lastroPercent = this.calcLastro(option.strike, stockPrice);
    const delta = Math.abs(option.delta);
    const gama = Math.abs(option.gamma);
    const theta = option.theta;
    const impliedVol = option.impliedVol;
    const nv = ve - (delta + gama);
    const tradePercent = totalTrades > 0 ? (option.trades / totalTrades) * 100 : 0;
    const premiumPercent = stockPrice > 0 ? (option.price / stockPrice) * 100 : 0;

    // Taxa anualizada: (VE / preço_ação) * (252 / dias_úteis) * 100
    const taxaAnual = option.tradingDays > 0
      ? (ve / stockPrice) * (252 / option.tradingDays) * 100
      : 0;

    // VDXX: indicador composto (com delta score)
    const vdx = option.price > 0 ? (nv / option.price) * 100 : 0;
    const vdxx = this.calcVDXX(lastroPercent, nv, option.price, option.tradingDays, delta);
    const bosi = ve * tradePercent;

    // === REGRAS DE ELEGIBILIDADE: determina se pode vender ===
    // Usa média de liquidez (5 pregões) para o filtro, trades do dia para BOSI
    const avgTrades = this.liquidityHistory.getAverageTrades(option.ticker, option.trades);
    const { noSell, noSellReason } = this.applyEligibilityRules(
      option, ve, lastroPercent, delta, nv, taxaAnual, impliedVol, avgTrades
    );

    return {
      ticker: option.ticker,
      strike: option.strike,
      expiration: option.expiration,
      tradingDays: option.tradingDays,
      price: option.price,
      trades: option.trades,
      volume: option.volume,
      tradePercent: Math.round(tradePercent * 100) / 100,
      ve: Math.round(ve * 100) / 100,
      lastroPercent: Math.round(lastroPercent * 100) / 100,
      delta: Math.round(delta * 10000) / 10000,
      gama: Math.round(gama * 10000) / 10000,
      theta: Math.round(theta * 10000) / 10000,
      impliedVol: Math.round(impliedVol * 10000) / 10000,
      nv: Math.round(nv * 100) / 100,
      vdx: Math.round(vdx * 100) / 100,
      vdxx: Math.round(vdxx * 100) / 100,
      bosi: Math.round(bosi * 100) / 100,
      taxaAnual: Math.round(taxaAnual * 100) / 100,
      premiumPercent: Math.round(premiumPercent * 100) / 100,
      noSell,
      noSellReason,
    };
  }

  /**
   * Aplica as regras de elegibilidade e retorna se deve ou não vender + motivo.
   */
  private applyEligibilityRules(
    option: OptionWithGreeks,
    ve: number,
    lastroPercent: number,
    delta: number,
    nv: number,
    taxaAnual: number,
    impliedVol: number,
    avgTrades: number
  ): { noSell: boolean; noSellReason: string } {
    // Regra 1: Sem pozinhos
    if (option.price < this.MIN_PRICE) {
      return { noSell: true, noSellReason: 'Pozinho (< R$0.05)' };
    }

    // Regra 1b: Liquidez mínima (média 5 pregões)
    if (avgTrades < this.MIN_TRADES) {
      return { noSell: true, noSellReason: `Sem liquidez (média ${Math.round(avgTrades)} neg.)` };
    }

    // Regra 2: Lastro mínimo (muito ITM = risco de exercício)
    if (lastroPercent < this.MIN_LASTRO_PERCENT) {
      return { noSell: true, noSellReason: `ITM profundo (lastro ${lastroPercent.toFixed(1)}%)` };
    }

    // Regra 3: Prazo adequado
    if (option.tradingDays < this.MIN_TRADING_DAYS) {
      return { noSell: true, noSellReason: `Prazo curto (${option.tradingDays}du)` };
    }
    if (option.tradingDays > this.MAX_TRADING_DAYS) {
      return { noSell: true, noSellReason: `Prazo longo (${option.tradingDays}du)` };
    }

    // Regra 4: VE positivo
    if (ve <= 0) {
      return { noSell: true, noSellReason: 'VE zero ou negativo' };
    }

    // Regra 5: NV positivo (regra principal)
    if (nv < 0) {
      return { noSell: true, noSellReason: 'NV negativo (Delta+Gama > VE)' };
    }

    // Regra 6: Delta na faixa do lançador coberto
    if (delta > 0 && delta < this.MIN_DELTA) {
      return { noSell: true, noSellReason: `Delta muito baixo (${delta.toFixed(3)})` };
    }
    if (delta > this.MAX_DELTA) {
      return { noSell: true, noSellReason: `Delta alto (${delta.toFixed(3)}) - risco de exercício` };
    }

    // Regra 7: Taxa anualizada mínima
    if (taxaAnual < this.MIN_TAXA_ANUAL) {
      return { noSell: true, noSellReason: `Taxa baixa (${taxaAnual.toFixed(1)}% a.a.)` };
    }

    // Regra 8: IV não pode ser absurda (indica evento extremo)
    if (impliedVol > this.MAX_IV) {
      return { noSell: true, noSellReason: `IV extrema (${(impliedVol * 100).toFixed(0)}%)` };
    }

    return { noSell: false, noSellReason: '' };
  }

  calculateBBOSI(indicators: OptionIndicators[]): number {
    // GerBOSI usa TODAS as opções com BOSI > 0 (mede força do mercado, não filtra por vendabilidade)
    const validOptions = indicators.filter(o => o.bosi > 0);
    const sumStrikeBosi = validOptions.reduce((sum, o) => sum + o.strike * o.bosi, 0);
    const sumBosi = validOptions.reduce((sum, o) => sum + o.bosi, 0);
    if (sumBosi === 0) return 0;
    return Math.round((sumStrikeBosi / sumBosi) * 100) / 100;
  }

  private calcVE(optionPrice: number, stockPrice: number, strike: number): number {
    if (strike >= stockPrice) {
      // OTM/ATM: VE = cotação da opção inteira
      return optionPrice;
    } else {
      // ITM: VE = cotação - valor intrínseco
      return Math.max(0, optionPrice - (stockPrice - strike));
    }
  }

  private calcLastro(strike: number, stockPrice: number): number {
    return ((strike - stockPrice) / stockPrice) * 100;
  }

  private calcVDXX(lastroPercent: number, nv: number, optionPrice: number, tradingDays: number, delta: number): number {
    if (optionPrice <= 0 || tradingDays <= 0) return 0;
    // Penaliza prazo longo, bonifica lastro alto e NV alto
    const timeFactor = 1.3 - tradingDays / 100;
    const deltaScore = this.calcDeltaScore(delta);
    return lastroPercent * (nv / optionPrice) * 50 * timeFactor * deltaScore;
  }

  /**
   * Delta Score: premia opções no sweet spot de delta 0.15-0.25.
   * Retorna ~1.0 para delta=0.20, decai suavemente fora desse range.
   */
  private calcDeltaScore(delta: number): number {
    const ideal = 0.20;
    const spread = 0.12;
    return Math.exp(-Math.pow((delta - ideal) / spread, 2));
  }

  /**
   * Extrai a IV ATM representativa das opções.
   * Usa a mediana das IVs de opções ATM com vencimento 15-45 dias úteis,
   * evitando semanais com IV distorcida e outliers.
   */
  private getAtmIv(options: OptionWithGreeks[]): number {
    const withIv = options.filter(o => o.impliedVol > 0 && o.impliedVol < 3);
    if (withIv.length === 0) return 0;

    // Prioridade 1: mediana das ATM com vencimento 15-45du
    const idealAtm = withIv
      .filter(o => o.moneyness === 'ATM' && o.tradingDays >= 15 && o.tradingDays <= 45);
    if (idealAtm.length >= 3) return this.median(idealAtm.map(o => o.impliedVol));

    // Prioridade 2: mediana de qualquer opção 15-45du com distância <= 3%
    const idealRange = withIv
      .filter(o => o.tradingDays >= 15 && o.tradingDays <= 45 && Math.abs(o.distancePercent) <= 3);
    if (idealRange.length >= 3) return this.median(idealRange.map(o => o.impliedVol));

    // Prioridade 3: ATM com vencimento >= 10du, mediana
    const anyAtm = withIv.filter(o => o.moneyness === 'ATM' && o.tradingDays >= 10);
    if (anyAtm.length >= 2) return this.median(anyAtm.map(o => o.impliedVol));

    // Fallback: menor distância percentual com vencimento razoável
    const sorted = withIv
      .filter(o => o.tradingDays >= 10)
      .sort((a, b) => Math.abs(a.distancePercent) - Math.abs(b.distancePercent));
    return sorted[0]?.impliedVol ?? withIv[0]?.impliedVol ?? 0;
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * Determina o regime de volatilidade do mercado para o ativo.
   * Baseado na IV ATM atual vs. limiares fixos + contexto histórico.
   */
  getVolRegime(options: OptionWithGreeks[], stockTicker?: string): VolRegime {
    const atmIv = this.getAtmIv(options);
    if (atmIv <= 0) return 'normal';

    // Limiares absolutos
    if (atmIv > 0.80) return 'extreme';
    if (atmIv > 0.50) return 'high';
    if (atmIv < 0.15) return 'low';

    // Se tem histórico, verifica IV Rank
    if (stockTicker) {
      const rank = this.ivHistory.getIvRank(stockTicker, atmIv);
      if (rank >= 0) {
        if (rank > 85) return 'high';
        if (rank < 15) return 'low';
      }
    }

    return 'normal';
  }

  /**
   * Retorna dados de IV Rank/Percentile para um ativo.
   */
  getIvInfo(stockTicker: string, options: OptionWithGreeks[]): { rank: number; percentile: number; currentIv: number; days: number } {
    const currentIv = this.getAtmIv(options);
    const rank = this.ivHistory.getIvRank(stockTicker, currentIv);
    const percentile = this.ivHistory.getIvPercentile(stockTicker, currentIv);
    const days = this.ivHistory.getHistoryDays(stockTicker);
    return { rank, percentile, currentIv, days };
  }
}
