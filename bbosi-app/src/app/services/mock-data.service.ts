import { Injectable } from '@angular/core';
import { Observable, of, delay } from 'rxjs';
import { Stock } from '../models/stock.model';
import { OptionWithGreeks } from './market-data.service';

/**
 * Mock service para desenvolvimento offline.
 * Simula dados realistas de opções da B3.
 * Remover quando a integração com API real estiver pronta.
 */
@Injectable({ providedIn: 'root' })
export class MockDataService {

  private stockPrices: Record<string, number> = {
    BBAS3: 28.45,
    BBDC4: 13.72,
    KLBN4: 21.65,
    PETR4: 37.88,
    VALE3: 58.30,
  };

  getStockPrice(ticker: string): number {
    return this.stockPrices[ticker] || 30;
  }

  generateOptions(ticker: string): OptionWithGreeks[] {
    const price = this.getStockPrice(ticker);
    const prefix = ticker.substring(0, 4);
    const now = new Date();

    // Gerar 2 séries de vencimento (próximo mês e mês seguinte)
    const series = this.getNextSeries(now);

    const options: OptionWithGreeks[] = [];

    for (const serie of series) {
      const strikes = this.generateStrikes(price);
      for (const strike of strikes) {
        const opt = this.buildOption(prefix, strike, price, serie);
        if (opt) options.push(opt);
      }
    }

    return options;
  }

  fetchAll(ticker: string): Observable<{ stock: Stock; options: OptionWithGreeks[] }> {
    const price = this.getStockPrice(ticker);
    const stock: Stock = {
      ticker,
      name: this.getStockName(ticker),
      price,
    };
    const options = this.generateOptions(ticker);
    return of({ stock, options }).pipe(delay(300));
  }

  private getStockName(ticker: string): string {
    const names: Record<string, string> = {
      BBAS3: 'Banco do Brasil',
      BBDC4: 'Bradesco',
      KLBN4: 'Klabin',
      PETR4: 'Petrobras',
      VALE3: 'Vale',
    };
    return names[ticker] || ticker;
  }

  private getNextSeries(now: Date): { letter: string; expiration: Date; tradingDays: number }[] {
    const months = 'ABCDEFGHIJKL';
    const currentMonth = now.getMonth();

    const result = [];
    for (let offset = 1; offset <= 2; offset++) {
      const targetMonth = (currentMonth + offset) % 12;
      const targetYear = now.getFullYear() + (currentMonth + offset >= 12 ? 1 : 0);
      const expiration = this.thirdMonday(targetYear, targetMonth);
      const tradingDays = this.calcTradingDays(now, expiration);
      result.push({
        letter: months[targetMonth],
        expiration,
        tradingDays,
      });
    }
    return result;
  }

  private thirdMonday(year: number, month: number): Date {
    const d = new Date(year, month, 1);
    const dayOfWeek = d.getDay();
    const firstMonday = dayOfWeek <= 1 ? 1 + (1 - dayOfWeek) : 1 + (8 - dayOfWeek);
    return new Date(year, month, firstMonday + 14);
  }

  private calcTradingDays(from: Date, to: Date): number {
    let count = 0;
    const d = new Date(from);
    while (d < to) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) count++;
    }
    return count;
  }

  private generateStrikes(price: number): number[] {
    // Strikes em intervalos adequados ao preço
    const step = price < 20 ? 0.5 : price < 50 ? 1 : 2;
    const strikes: number[] = [];
    const baseStrike = Math.round(price / step) * step;

    for (let i = -3; i <= 5; i++) {
      strikes.push(+(baseStrike + i * step).toFixed(2));
    }
    return strikes;
  }

  private buildOption(
    prefix: string,
    strike: number,
    stockPrice: number,
    serie: { letter: string; expiration: Date; tradingDays: number }
  ): OptionWithGreeks | null {
    const strikeCode = Math.round(strike * 100)
      .toString()
      .replace('.', '');
    const ticker = `${prefix}${serie.letter}${strike.toFixed(0).padStart(3, '0')}`;

    const distance = ((strike - stockPrice) / stockPrice) * 100;
    const isOTM = strike > stockPrice;
    const isATM = Math.abs(distance) < 3;

    // Simular delta realista baseado na distância (valores menores para venda coberta funcionar)
    let delta: number;
    if (isATM) delta = 0.35 + Math.random() * 0.1;
    else if (isOTM) delta = Math.max(0.03, 0.3 - Math.abs(distance) * 0.03 + (Math.random() * 0.03));
    else delta = Math.min(0.7, 0.4 + Math.abs(distance) * 0.02 + (Math.random() * 0.03));

    // Gamma menor para não inflacionar noSell
    const gamma = isATM
      ? 0.01 + Math.random() * 0.01
      : 0.003 + Math.random() * 0.007;

    // Preço da opção (VE deve ser > delta+gamma para NV positivo em OTM)
    const intrinsic = Math.max(0, stockPrice - strike);
    const timeValue = stockPrice * (0.02 + Math.random() * 0.04) * Math.sqrt(serie.tradingDays / 252);
    const optionPrice = +(intrinsic + timeValue * (isATM ? 1.5 : isOTM ? 1.0 : 0.7)).toFixed(2);

    if (optionPrice < 0.01) return null;

    const premiumPercent = +((optionPrice / stockPrice) * 100).toFixed(2);
    const trades = Math.floor(Math.random() * 500) + 50;
    const volume = Math.floor(Math.random() * 5000) + 100;

    // Moneyness label
    let moneyness: string;
    if (Math.abs(distance) < 2) moneyness = 'ATM';
    else if (distance > 0) moneyness = 'OTM';
    else moneyness = 'ITM';

    return {
      ticker,
      strike,
      expiration: serie.expiration,
      tradingDays: serie.tradingDays,
      price: optionPrice,
      trades,
      volume,
      tradePercent: 0,
      impliedVol: +(0.25 + Math.random() * 0.2).toFixed(4),
      delta: +delta.toFixed(4),
      gamma: +gamma.toFixed(4),
      theta: +(-0.005 - Math.random() * 0.01).toFixed(4),
      vega: +(0.02 + Math.random() * 0.03).toFixed(4),
      moneyness,
      distancePercent: +distance.toFixed(2),
      premiumPercent,
    };
  }
}
