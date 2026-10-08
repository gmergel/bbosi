import { Injectable, inject, signal } from '@angular/core';
import { GerBosiSnapshot, OptionIndicators } from '../models/stock.model';
import { MarketDataService } from './market-data.service';
import { IndicatorService } from './indicator.service';
import { Observable, catchError, finalize, forkJoin, map, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface SoldOption {
  id: string;
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
  bbosiValid?: boolean;
  bbosiTrades?: number;
  bbosiMarketDataTime?: string;
  stockPrice: number;
  optionPrice: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  lastRefresh?: string;
  marketDataTime?: string;
  buybackPrice?: number;
  buybackDate?: string;
}

export interface RollSignal {
  shouldRoll: boolean;
  reason: string;
  severity: 'info' | 'warn' | 'danger';
}

const STORAGE_KEY = 'bbosi-sold-options';
const SYNC_TOKEN_KEY = 'bbosi-sync-token';

export function mergeRemoteSoldOptions(remote: SoldOption[], current: SoldOption[]): SoldOption[] {
  return remote.map(remoteOption => {
    const currentOption = current.find(option => option.id === remoteOption.id)
      ?? current.find(option => option.optionTicker === remoteOption.optionTicker);
    if (!currentOption) return remoteOption;

    return {
      ...remoteOption,
      tradingDays: currentOption.tradingDays,
      nv: currentOption.nv,
      ve: currentOption.ve,
      vdxx: currentOption.vdxx,
      lastroPercent: currentOption.lastroPercent,
      bbosi: currentOption.bbosi,
      bbosiValid: currentOption.bbosiValid,
      bbosiTrades: currentOption.bbosiTrades,
      bbosiMarketDataTime: currentOption.bbosiMarketDataTime,
      stockPrice: currentOption.stockPrice,
      optionPrice: currentOption.optionPrice,
      delta: currentOption.delta,
      gamma: currentOption.gamma,
      theta: currentOption.theta,
      lastRefresh: currentOption.lastRefresh,
      marketDataTime: currentOption.marketDataTime,
    };
  });
}

@Injectable({ providedIn: 'root' })
export class SoldOptionsService {
  private marketData = inject(MarketDataService);
  private indicatorService = inject(IndicatorService);
  private http = inject(HttpClient);
  private _soldOptions = signal<SoldOption[]>(this.loadFromStorage());
  private _hasSyncToken = signal<boolean>(this.hasStoredSyncToken());
  private isRefreshing = false;
  private isSyncingToRemote = false;

  readonly soldOptions = this._soldOptions.asReadonly();
  readonly hasSyncToken = this._hasSyncToken.asReadonly();

  readonly activeOptions = signal<SoldOption[]>([]);

  constructor() {
    this.updateActiveOptions(this._soldOptions());
    void this.loadFromRemote();
  }

  sell(option: OptionIndicators, stockTicker: string, bbosiSnapshot: GerBosiSnapshot | undefined, stockPrice: number, sellPrice = option.price): void {
    const sold: SoldOption = {
      id: globalThis.crypto.randomUUID(),
      optionTicker: option.ticker,
      stockTicker,
      strike: option.strike,
      sellPrice,
      sellDate: new Date().toISOString(),
      expiration: option.expiration,
      tradingDays: option.tradingDays,
      nv: option.nv,
      ve: option.ve,
      vdxx: option.vdxx,
      lastroPercent: option.lastroPercent,
      bbosi: bbosiSnapshot?.value ?? 0,
      bbosiValid: bbosiSnapshot?.value !== null && bbosiSnapshot !== undefined,
      bbosiTrades: bbosiSnapshot?.trades ?? 0,
      bbosiMarketDataTime: bbosiSnapshot?.marketDataTime ?? undefined,
      stockPrice,
      optionPrice: option.price,
      delta: option.delta,
      gamma: option.gama,
      theta: option.theta,
      lastRefresh: new Date().toISOString(),
      marketDataTime: option.marketDataTime ?? undefined,
    };

    const current = [...this._soldOptions(), sold];
    this._soldOptions.set(current);
    this.updateActiveOptions(current);
    this.saveToStorage(current);
    this.syncToRemote(current);
  }

  remove(optionTicker: string): void {
    const current = this._soldOptions().filter(o => o.optionTicker !== optionTicker);
    this._soldOptions.set(current);
    this.updateActiveOptions(current);
    this.saveToStorage(current);
    this.syncToRemote(current);
  }

  updateNv(optionTicker: string, nv: number): void {
    const current = this._soldOptions().map(o =>
      o.optionTicker === optionTicker ? { ...o, nv } : o
    );
    this._soldOptions.set(current);
    this.saveToStorage(current);
    this.syncToRemote(current);
  }

  updateSellPrice(optionTicker: string, sellPrice: number): void {
    if (!Number.isFinite(sellPrice) || sellPrice <= 0) return;

    const current = this._soldOptions().map(option =>
      option.optionTicker === optionTicker ? { ...option, sellPrice } : option
    );
    this._soldOptions.set(current);
    this.updateActiveOptions(current);
    this.saveToStorage(current);
    this.syncToRemote(current);
  }

  isSold(optionTicker: string): boolean {
    return this.activeOptions().some(o => o.optionTicker === optionTicker);
  }

  buyback(optionTicker: string, buybackPrice: number): void {
    if (!Number.isFinite(buybackPrice) || buybackPrice < 0) return;

    const current = this._soldOptions().map(option =>
      option.optionTicker === optionTicker && !option.buybackDate
        ? { ...option, buybackPrice, buybackDate: new Date().toISOString() }
        : option
    );
    this._soldOptions.set(current);
    this.updateActiveOptions(current);
    this.saveToStorage(current);
    this.syncToRemote(current);
  }

  removeById(id: string): void {
    const current = this._soldOptions().filter(option => option.id !== id);
    this._soldOptions.set(current);
    this.updateActiveOptions(current);
    this.saveToStorage(current);
    this.syncToRemote(current);
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
  refreshAll(): Observable<void> {
    const sold = this._soldOptions();
    if (sold.length === 0 || this.isRefreshing) return of(void 0);
    this.isRefreshing = true;

    // Agrupa por stock para não buscar duplicado
    const stockTickers = [...new Set(sold.map(s => s.stockTicker))];

    return forkJoin(
      stockTickers.map(ticker =>
        this.marketData.fetchAll(ticker).pipe(
          map(data => ({ ticker, ...data })),
          catchError(() => of(null))
        )
      )
    ).pipe(
      map(results => {
        const now = new Date().toISOString();
        let updated = this._soldOptions();

        for (const result of results) {
          if (!result || result.stock.price <= 0) continue;

          const indicators = this.indicatorService.calculateFromApi(
            result.options,
            result.stock.price,
            result.ticker
          );
          const gerbosiSnapshots = this.indicatorService.calculateGerBosiByExpiration(
            result.gerbosiOptions,
            result.stock.price
          );

          updated = updated.map(s => {
            if (s.stockTicker !== result.ticker) return s;

            const expirationKey = s.expiration.toISOString().slice(0, 10);
            const gerbosi = gerbosiSnapshots.find(snapshot =>
              snapshot.expiration.toISOString().slice(0, 10) === expirationKey
            );

            // Busca indicadores da opção vendida específica
            const optInd = indicators.find(i => i.ticker === s.optionTicker);
            // Busca preço raw (mesmo que não passe nos filtros de indicadores)
            const rawOpt = result.options.find(o => o.ticker === s.optionTicker);

            return {
              ...s,
              stockPrice: result.stock.price,
              bbosi: gerbosi?.value ?? 0,
              bbosiValid: gerbosi?.value !== null && gerbosi !== undefined,
              bbosiTrades: gerbosi?.trades ?? 0,
              bbosiMarketDataTime: gerbosi?.marketDataTime ?? undefined,
              nv: optInd ? optInd.nv : rawOpt
                ? Math.round(((rawOpt.strike >= result.stock.price ? rawOpt.price : Math.max(0, rawOpt.price - (result.stock.price - rawOpt.strike))) - Math.abs(rawOpt.delta) - Math.abs(rawOpt.gamma)) * 100) / 100
                : s.nv,
              ve: optInd ? optInd.ve : s.ve,
              lastroPercent: optInd ? optInd.lastroPercent : s.lastroPercent,
              tradingDays: optInd ? optInd.tradingDays : (rawOpt ? rawOpt.tradingDays : s.tradingDays),
              vdxx: optInd ? optInd.vdxx : s.vdxx,
              optionPrice: optInd ? optInd.price : (rawOpt ? rawOpt.price : (s.optionPrice ?? s.sellPrice)),
              gamma: optInd?.gama ?? rawOpt?.gamma ?? s.gamma,
              marketDataTime: optInd?.marketDataTime ?? rawOpt?.marketDataTime ?? s.marketDataTime,
              lastRefresh: now,
            };
          });
        }

        this._soldOptions.set(updated);
        this.updateActiveOptions(updated);
        this.saveToStorage(updated);
        this.syncToRemote(updated);
      }),
      map(() => void 0),
      finalize(() => {
        this.isRefreshing = false;
      })
    );
  }

  refreshRemote(): Observable<void> {
    const token = localStorage.getItem(SYNC_TOKEN_KEY);
    if (!token || this.isSyncingToRemote) return of(void 0);

    return this.http.get<SoldOption[]>(environment.positionsBaseUrl, {
      headers: { 'X-BBOSI-Token': token },
    }).pipe(
      map(options => {
        const remote = options.map(option => ({
          ...option,
          expiration: new Date(option.expiration),
        }));
        const merged = mergeRemoteSoldOptions(remote, this._soldOptions());
        this._soldOptions.set(merged);
        this.updateActiveOptions(merged);
        this.saveToStorage(merged);
      }),
      map(() => void 0),
      catchError(() => of(void 0)),
    );
  }

  /**
   * Calcula % do prêmio já capturado (lucro realizado até agora).
   * 100% = opção zerou; 50% = metade do prêmio vendido já virou lucro.
   */
  getProfitCaptured(sold: SoldOption): number {
    const currentPrice = sold.optionPrice ?? sold.sellPrice;
    if (sold.sellPrice <= 0) return 0;
    return ((sold.sellPrice - currentPrice) / sold.sellPrice) * 100;
  }

  getStopPercent(_sold: SoldOption): number {
    return 25;
  }

  /**
   * Determina se a posição deve ser rolada/fechada com base em regras quantitativas.
   */
  getRollSignal(sold: SoldOption): RollSignal {
    const pctCaptured = this.getProfitCaptured(sold);
    const currentPrice = sold.optionPrice ?? sold.sellPrice;
    const stopPct = this.getStopPercent(sold);
    const stopPrice = sold.sellPrice * (1 + stopPct / 100);

    if (sold.sellPrice > 0 && currentPrice >= stopPrice) {
      return { shouldRoll: true, reason: `Stop fixo atingido (${stopPct.toFixed(0)}%) — recomprar agora`, severity: 'danger' };
    }

    // Regra 0: Opção em pó — recomprar e rolar para próxima série
    if (currentPrice <= 0.05 && sold.tradingDays > 5) {
      return { shouldRoll: true, reason: 'Em pó — recomprar e rolar', severity: 'info' };
    }

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
    if (sold.bbosiValid && sold.bbosi > 0 && sold.strike > 0) {
      const bbosiLastro = ((sold.strike - sold.bbosi) / sold.strike) * 100;
      if (bbosiLastro < 3 && bbosiLastro > -5) {
        return { shouldRoll: true, reason: 'Centro de strikes próximo do strike — acompanhar posição', severity: 'warn' };
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
      const options = data ? JSON.parse(data) : [];
      return options.map((option: SoldOption) => ({
        ...option,
        id: option.id || globalThis.crypto.randomUUID(),
        expiration: new Date(option.expiration),
      }));
    } catch {
      return [];
    }
  }

  private saveToStorage(options: SoldOption[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  }

  private updateActiveOptions(options: SoldOption[]): void {
    this.activeOptions.set(options.filter(option => !option.buybackDate));
  }

  setSyncToken(token: string): void {
    const normalizedToken = token.trim();
    if (!normalizedToken) return;
    localStorage.setItem(SYNC_TOKEN_KEY, normalizedToken);
    this._hasSyncToken.set(true);
    void this.loadFromRemote();
  }

  clearSyncToken(): void {
    localStorage.removeItem(SYNC_TOKEN_KEY);
    this._hasSyncToken.set(false);
  }

  getSyncToken(): string | null {
    return localStorage.getItem(SYNC_TOKEN_KEY);
  }

  private hasStoredSyncToken(): boolean {
    return Boolean(localStorage.getItem(SYNC_TOKEN_KEY));
  }

  private loadFromRemote(): Promise<void> {
    return new Promise(resolve => this.refreshRemote().subscribe(() => resolve()));
  }

  private syncToRemote(options: SoldOption[]): void {
    const token = localStorage.getItem(SYNC_TOKEN_KEY);
    if (!token) return;
    this.isSyncingToRemote = true;

    this.http.put(environment.positionsBaseUrl, options, {
      headers: { 'X-BBOSI-Token': token },
    }).pipe(
      catchError(() => of(null)),
      finalize(() => { this.isSyncingToRemote = false; }),
    ).subscribe();
  }
}
