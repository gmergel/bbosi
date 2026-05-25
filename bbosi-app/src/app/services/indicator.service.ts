import { Injectable } from '@angular/core';
import { OptionIndicators } from '../models/stock.model';
import { OptionWithGreeks } from './market-data.service';

/**
 * Regras do Bastter.com para Venda Coberta:
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

  // Constantes das regras Bastter
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
   * e aplica todas as regras do Bastter para classificação.
   */
  calculateFromApi(options: OptionWithGreeks[], stockPrice: number): OptionIndicators[] {
    if (stockPrice <= 0) return [];

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

    // VDXX: indicador composto do Bastter
    const vdx = option.price > 0 ? (nv / option.price) * 100 : 0;
    const vdxx = this.calcVDXX(lastroPercent, nv, option.price, option.tradingDays);
    const bosi = ve * tradePercent;

    // === REGRAS DO BASTTER: determina se pode vender ===
    const { noSell, noSellReason } = this.applyBastterRules(
      option, ve, lastroPercent, delta, nv, taxaAnual, impliedVol
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
   * Aplica as regras do Bastter e retorna se deve ou não vender + motivo.
   */
  private applyBastterRules(
    option: OptionWithGreeks,
    ve: number,
    lastroPercent: number,
    delta: number,
    nv: number,
    taxaAnual: number,
    impliedVol: number
  ): { noSell: boolean; noSellReason: string } {
    // Regra 1: Sem pozinhos
    if (option.price < this.MIN_PRICE) {
      return { noSell: true, noSellReason: 'Pozinho (< R$0.05)' };
    }

    // Regra 1b: Liquidez mínima (Bastter: "sem negócio, não existe")
    if (option.trades < this.MIN_TRADES) {
      return { noSell: true, noSellReason: `Sem liquidez (${Math.round(option.trades)} neg.)` };
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

    // Regra 5: NV positivo (regra principal Bastter)
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
    // BBOSI usa TODAS as opções com BOSI > 0 (mede força do mercado, não filtra por vendabilidade)
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

  private calcVDXX(lastroPercent: number, nv: number, optionPrice: number, tradingDays: number): number {
    if (optionPrice <= 0 || tradingDays <= 0) return 0;
    // Penaliza prazo longo, bonifica lastro alto e NV alto
    const timeFactor = 1.3 - tradingDays / 100;
    return lastroPercent * (nv / optionPrice) * 50 * timeFactor;
  }
}
