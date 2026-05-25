import { Injectable, signal } from '@angular/core';
import { OptionIndicators } from '../models/stock.model';

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
}

const STORAGE_KEY = 'bbosi-sold-options';

@Injectable({ providedIn: 'root' })
export class SoldOptionsService {
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
