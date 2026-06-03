import { Injectable } from '@angular/core';

interface IvSnapshot {
  date: string; // YYYY-MM-DD
  iv: number;   // IV ATM (decimal, e.g., 0.35 = 35%)
}

interface IvStore {
  [stockTicker: string]: IvSnapshot[];
}

const STORAGE_KEY = 'bbosi-iv-history';
const MAX_DAYS = 90;

/**
 * Armazena histórico de IV ATM por ação (últimos 90 pregões)
 * para calcular IV Rank e IV Percentile.
 *
 * - IV Rank: posição relativa no range (min-max) dos últimos N dias
 * - IV Percentile: % de dias com IV abaixo da atual
 */
@Injectable({ providedIn: 'root' })
export class IvHistoryService {
  private store: IvStore = this.loadFromStorage();

  /**
   * Registra a IV ATM do dia para o ativo.
   */
  recordDay(stockTicker: string, atmIv: number): void {
    if (atmIv <= 0) return;

    const today = this.getToday();
    if (!this.store[stockTicker]) this.store[stockTicker] = [];

    const history = this.store[stockTicker];
    const existing = history.findIndex(s => s.date === today);

    if (existing >= 0) {
      history[existing].iv = atmIv;
    } else {
      history.push({ date: today, iv: atmIv });
    }

    if (history.length > MAX_DAYS) {
      history.splice(0, history.length - MAX_DAYS);
    }

    this.saveToStorage();
  }

  /**
   * IV Rank: posição relativa da IV atual dentro do range histórico.
   * Retorna 0-100. Valores altos = IV cara (bom para vender).
   */
  getIvRank(stockTicker: string, currentIv: number): number {
    const history = this.store[stockTicker];
    if (!history || history.length < 5) return -1; // dados insuficientes

    const ivs = history.map(h => h.iv);
    const min = Math.min(...ivs);
    const max = Math.max(...ivs);
    if (max === min) return 50;

    return Math.round(((currentIv - min) / (max - min)) * 100);
  }

  /**
   * IV Percentile: % de dias com IV abaixo da atual.
   * Retorna 0-100. Valores altos = IV mais cara que a maioria dos dias.
   */
  getIvPercentile(stockTicker: string, currentIv: number): number {
    const history = this.store[stockTicker];
    if (!history || history.length < 5) return -1; // dados insuficientes

    const below = history.filter(h => h.iv < currentIv).length;
    return Math.round((below / history.length) * 100);
  }

  /**
   * Retorna número de dias de histórico disponíveis.
   */
  getHistoryDays(stockTicker: string): number {
    return this.store[stockTicker]?.length ?? 0;
  }

  private getToday(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
    }).format(new Date());
  }

  private loadFromStorage(): IvStore {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private saveToStorage(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
  }
}
