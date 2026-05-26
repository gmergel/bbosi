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

        const indicators = this.indicatorService.calculateFromApi(options, stock.price);
        const bbosi = this.indicatorService.calculateBBOSI(indicators);

        const updated = this._soldOptions().map(s => {
          if (s.stockTicker !== ticker) return s;

          // Busca indicadores da opção vendida específica
          const optInd = indicators.find(i => i.ticker === s.optionTicker);
          return {
            ...s,
            stockPrice: stock.price,
            bbosi,
            nv: optInd ? optInd.nv : s.nv,
            ve: optInd ? optInd.ve : s.ve,
            lastroPercent: optInd ? optInd.lastroPercent : s.lastroPercent,
            tradingDays: optInd ? optInd.tradingDays : s.tradingDays,
            vdxx: optInd ? optInd.vdxx : s.vdxx,
            optionPrice: optInd ? optInd.price : s.optionPrice,
            lastRefresh: new Date().toISOString(),
          };
        });

        this._soldOptions.set(updated);
        this.saveToStorage(updated);
      });
    });
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
