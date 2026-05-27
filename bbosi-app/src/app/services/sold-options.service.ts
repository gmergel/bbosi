import { Injectable, inject, signal } from '@angular/core';
import { OptionIndicators } from '../models/stock.model';
import { MarketDataService } from './market-data.service';
import { IndicatorService } from './indicator.service';
import { forkJoin } from 'rxjs';

export interface SoldOption {
  optionTicker: string;
  stockTicker: string;
  strike: number;
  sellPrice: number;
  sellDate: string;
  expiration: Date;
  tradingDays: number;
  nv: number;
  ve: number;
  vdxx: number;
  lastroPercent: number;
  bbosi: number;
  stockPrice: number;
  optionPrice: number;
  lastRefresh?: string;
}

export interface RollSignal {
  shouldRoll: boolean;
  reason: string;
  severity: 'info' | 'warn' | 'danger';
}

const STORAGE_KEY = 'bbosi-sold-options';

@Injectable({ providedIn: 'root' })
export class SoldOptionsService {
  private marketData = inject(MarketDataService);
  private indicatorService = inject(IndicatorService);
  private _soldOptions = signal<SoldOption[]>(this.loadFromStorage());

  readonly soldOptions = this._soldOptions.asReadonly();

  sell(option: OptionIndicators, stockTicker: string, bbosi: number, stockPrice: number): void {
    const sold: SoldOption = {
      optionTicker: option.ticker,
      stockTicker,
      strike: option.strike,
      sellPrice: option.price,
      sellDate: new Date().toISOString(),
      expiration: option.expiration,
      tradingDays: option.tradingDays,
      nv: option.nv,
      ve: option.ve,
      vdxx: option.vdxx,
      lastroPercent: option.lastroPercent,
      bbosi,
      stockPrice,
      optionPrice: option.price,
      lastRefresh: new Date().toISOString(),
    };

    const current = [...this._soldOptions(), sold];
    this._soldOptions.set(current);
    this.saveToStorage(current);
  }

  remove(optionTicker: string): void {
    const current = this._soldOptions().filter(o => o.optionTicker !== optionTicker);
    this._soldOptions.set(current);
    this.saveToStorage(current);
  }

  updateNv(optionTicker: string, nv: number): void {
    const current = this._soldOptions().map(o =>
      o.optionTicker === optionTicker ? { ...o, nv } : o
    );
    this._soldOptions.set(current);
    this.saveToStorage(current);
  }

  isSold(optionTicker: string): boolean {
    return this._soldOptions().some(o => o.optionTicker === optionTicker);
  }

  /**
   * Retorna cor da borda baseada no NV:
   * NV alto (positivo) → verde (seguro)
   * NV baixo/negativo → vermelho (recomprar)
   */
  getNvColor(nv: number): string {
    if (nv >= 0.5) return '#16a34a';       // verde (excelente)
    if (nv >= 0.2) return '#65a30d';       // verde-limão (bom)
    if (nv >= 0) return '#ca8a04';         // amarelo (atenção)
    if (nv >= -0.2) return '#ea580c';      // laranja (alerta)
    return '#dc2626';                       // vermelho (recomprar!)
  }

  /**
   * Atualiza dados live (stockPrice, bbosi, nv) de todas as vendidas agrupando por ação.
   */
  refreshAll(): void {
    const sold = this._soldOptions();
    if (sold.length === 0) return;

    // Agrupa por stock para não buscar duplicado
    const stockTickers = [...new Set(sold.map(s => s.stockTicker))];

    stockTickers.forEach(ticker => {
      this.marketData.fetchAll(ticker).subscribe(({ stock, options }) => {
        if (stock.price <= 0) return;

        const indicators = this.indicatorService.calculateFromApi(options, stock.price, ticker);
        const bbosi = this.indicatorService.calculateBBOSI(indicators);

        const updated = this._soldOptions().map(s => {
          if (s.stockTicker !== ticker) return s;

          // Busca indicadores da opção vendida específica
          const optInd = indicators.find(i => i.ticker === s.optionTicker);
          // Busca preço raw (mesmo que não passe nos filtros de indicadores)
          const rawOpt = options.find(o => o.ticker === s.optionTicker);

          return {
            ...s,
            stockPrice: stock.price,
            bbosi,
            nv: optInd ? optInd.nv : s.nv,
            ve: optInd ? optInd.ve : s.ve,
            lastroPercent: optInd ? optInd.lastroPercent : s.lastroPercent,
            tradingDays: optInd ? optInd.tradingDays : (rawOpt ? rawOpt.tradingDays : s.tradingDays),
            vdxx: optInd ? optInd.vdxx : s.vdxx,
            optionPrice: optInd ? optInd.price : (rawOpt ? rawOpt.price : (s.optionPrice ?? s.sellPrice)),
            lastRefresh: new Date().toISOString(),
          };
        });

        this._soldOptions.set(updated);
        this.saveToStorage(updated);
      });
    });
  }

  /**
   * Calcula % do prêmio já capturado (lucro realizado até agora).
   * 100% = opção zerou; 50% = metade do prêmio vendido já virou lucro.
   */
  getProfitCaptured(sold: SoldOption): number {
    const currentPrice = sold.optionPrice ?? sold.sellPrice;
    if (sold.sellPrice <= 0) return 0;
    return Math.max(0, ((sold.sellPrice - currentPrice) / sold.sellPrice) * 100);
  }

  /**
   * Determina se a posição deve ser rolada/fechada com base em regras quantitativas.
   */
  getRollSignal(sold: SoldOption): RollSignal {
    const pctCaptured = this.getProfitCaptured(sold);

    // Regra 1: Alvo atingido — 50% capturado → fechar com lucro
    if (pctCaptured >= 50 && sold.tradingDays > 5) {
      return { shouldRoll: true, reason: `Alvo 50% atingido (${pctCaptured.toFixed(0)}%)`, severity: 'info' };
    }

    // Regra 2: DTE curto + prêmio esgotado → rolar para próximo vencimento
    if (sold.tradingDays <= 7 && pctCaptured >= 75) {
      return { shouldRoll: true, reason: 'Prêmio esgotado, rolar para próximo vencimento', severity: 'info' };
    }

    // Regra 3: DTE curto + prêmio significativo → gamma risk
    if (sold.tradingDays <= 5 && pctCaptured < 50) {
      return { shouldRoll: true, reason: 'Risco Gamma! Pouco tempo, muito prêmio restante', severity: 'danger' };
    }

    // Regra 4: GerBOSI se aproximou do strike (lastro GerBOSI < 3%)
    if (sold.bbosi > 0 && sold.strike > 0) {
      const bbosiLastro = ((sold.strike - sold.bbosi) / sold.strike) * 100;
      if (bbosiLastro < 3 && bbosiLastro > -5) {
        return { shouldRoll: true, reason: 'GerBOSI próximo do strike — pressão compradora', severity: 'warn' };
      }
    }

    // Regra 5: NV ficou negativo
    if (sold.nv < 0) {
      return { shouldRoll: true, reason: 'NV negativo — risco supera ganho', severity: 'danger' };
    }

    return { shouldRoll: false, reason: '', severity: 'info' };
  }

  private loadFromStorage(): SoldOption[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveToStorage(options: SoldOption[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  }
}
