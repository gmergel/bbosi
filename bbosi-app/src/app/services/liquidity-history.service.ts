import { Injectable } from '@angular/core';

interface DailySnapshot {
  date: string; // YYYY-MM-DD
  trades: number;
}

interface LiquidityStore {
  [optionTicker: string]: DailySnapshot[];
}

const STORAGE_KEY = 'bbosi-liquidity-history';
const MAX_DAYS = 5;

/**
 * Armazena histórico de negócios por opção (últimos 5 pregões)
 * para calcular média móvel de liquidez.
 *
 * - BOSI/GerBOSI continuam usando trades do dia
 * - A média é usada apenas no FILTRO de liquidez mínima
 */
@Injectable({ providedIn: 'root' })
export class LiquidityHistoryService {
  private store: LiquidityStore = this.loadFromStorage();

  /**
   * Registra os negócios do dia para cada opção.
   * Chamado uma vez por consulta de opções.
   */
  recordDay(options: { ticker: string; trades: number }[]): void {
    const today = this.getToday();

    for (const opt of options) {
      if (!this.store[opt.ticker]) {
        this.store[opt.ticker] = [];
      }

      const history = this.store[opt.ticker];

      // Atualiza se já tem registro de hoje, senão adiciona
      const existing = history.findIndex(s => s.date === today);
      if (existing >= 0) {
        history[existing].trades = opt.trades;
      } else {
        history.push({ date: today, trades: opt.trades });
      }

      // Mantém apenas os últimos MAX_DAYS dias
      if (history.length > MAX_DAYS) {
        history.splice(0, history.length - MAX_DAYS);
      }
    }

    this.saveToStorage();
  }

  /**
   * Retorna a média de negócios dos últimos N dias disponíveis.
   * Se não há histórico, retorna o valor do dia (trades passado).
   */
  getAverageTrades(ticker: string, todayTrades: number): number {
    const history = this.store[ticker];
    if (!history || history.length === 0) return todayTrades;

    const sum = history.reduce((acc, s) => acc + s.trades, 0);
    return sum / history.length;
  }

  /**
   * Limpa opções expiradas (sem registro nos últimos 10 dias).
   */
  cleanup(): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 15);
    const cutoffStr = this.formatDateLocal(cutoff);

    for (const ticker of Object.keys(this.store)) {
      const history = this.store[ticker];
      if (history.length === 0 || history[history.length - 1].date < cutoffStr) {
        delete this.store[ticker];
      }
    }
    this.saveToStorage();
  }

  private getToday(): string {
    return this.formatDateLocal(new Date());
  }

  private formatDateLocal(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
    }).format(date);
  }

  private loadFromStorage(): LiquidityStore {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  private saveToStorage(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
  }
}
