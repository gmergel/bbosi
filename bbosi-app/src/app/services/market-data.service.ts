import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, forkJoin, of, catchError, switchMap, throwError, timeout } from 'rxjs';
import { Stock, OptionData } from '../models/stock.model';
import { MockDataService } from './mock-data.service';
import { environment } from '../../environments/environment';

export interface OptionsChainResponse {
  success: boolean;
  requests: Array<{
    type: string;
    params: any;
    results: {
      columns: Array<{ id: string; title: string }>;
      expirations: Array<{
        dt: string;
        du: number;
        dc: number;
        calls: Array<any[]>;
        puts: Array<any[]>;
      }>;
    } | null;
    error: any;
  }>;
}

export interface OptionWithGreeks extends OptionData {
  impliedVol: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  moneyness: string;
  distancePercent: number;
  premiumPercent: number;
}

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private http = inject(HttpClient);
  private mock = inject(MockDataService);
  private yahooBaseUrls = this.getBaseUrls('yahoo');
  private opcoesBaseUrls = this.getBaseUrls('opcoes');
  private readonly OPTIONS_CACHE_TTL_MS = 30 * 60 * 1000;
  private readonly PRICE_CACHE_TTL_MS = 15 * 60 * 1000;

  private stocks: Stock[] = [
    { ticker: 'BBAS3', name: 'Banco do Brasil', price: 0 },
    { ticker: 'BBDC4', name: 'Bradesco', price: 0 },
    { ticker: 'BBSE3', name: 'BB Seguridade', price: 0 },
    { ticker: 'ITUB4', name: 'Itaú Unibanco', price: 0 },
    { ticker: 'KLBN4', name: 'Klabin', price: 0 },
    { ticker: 'PETR4', name: 'Petrobras', price: 0 },
    { ticker: 'VALE3', name: 'Vale', price: 0 },
  ];

  getStocks(): Stock[] {
    return this.stocks;
  }

  /**
   * Busca cotação atual da ação via Yahoo Finance.
   * Fallback: infere das opções (opcoes.net.br) ou usa cache.
   */
  fetchStockPrice(ticker: string): Observable<{ price: number; marketTime: Date | null }> {
    const yahooTicker = `${ticker}.SA`;

    return this.getWithFallback<any>(
      this.yahooBaseUrls,
      `/v8/finance/chart/${yahooTicker}?interval=1d&range=1d`
    )
      .pipe(
        map(res => {
          const meta = res?.chart?.result?.[0]?.meta;
          const price = meta?.regularMarketPrice ?? meta?.previousClose ?? 0;
          const marketTime = meta?.regularMarketTime
            ? new Date(meta.regularMarketTime * 1000)
            : null;
          return { price, marketTime };
        }),
        catchError(() => of({ price: 0, marketTime: null as Date | null })),
        switchMap(data => {
          if (data.price > 0) {
            this.cachePrice(ticker, data.price);
            return of(data);
          }
          // Fallback: infere das opções
          return this.fetchOptions(ticker).pipe(
            map(options => {
              const inferred = this.inferPriceFromOptions(options);
              if (inferred > 0) {
                this.cachePrice(ticker, inferred);
                return { price: inferred, marketTime: null as Date | null };
              }
              return { price: this.getCachedPrice(ticker), marketTime: null as Date | null };
            })
          );
        })
      );
  }

  /**
   * Busca opções (calls) de uma ação via /api/v1 OptionsChain do opcoes.net.br.
   * Se o API retornar vazio (fora do pregão), usa cache do último resultado.
   */
  fetchOptions(ticker: string): Observable<OptionWithGreeks[]> {
    const z = Math.floor(Date.now() / 10000);
    const path = `/api/v1?z=${z}&r0t=OptionsChain&r0p.underlying_asset_id=${ticker}`;

    return this.getWithFallback<OptionsChainResponse>(this.opcoesBaseUrls, path).pipe(
      map(res => this.parseOptionsChain(res, ticker)),
      map(options => {
        if (options.length > 0) {
          this.cacheOptions(ticker, options);
          return options;
        }
        // Fora do pregão: usa cache
        return this.getCachedOptions(ticker);
      }),
      catchError(err => {
        console.error(`Erro ao buscar opções de ${ticker}:`, err);
        return of(this.getCachedOptions(ticker));
      })
    );
  }

  private cacheOptions(ticker: string, options: OptionWithGreeks[]): void {
    const data = { options, timestamp: Date.now() };
    localStorage.setItem(`bbosi-options-${ticker}`, JSON.stringify(data));
  }

  private getCachedOptions(ticker: string): OptionWithGreeks[] {
    try {
      const raw = localStorage.getItem(`bbosi-options-${ticker}`);
      if (!raw) return [];
      const { options, timestamp } = JSON.parse(raw);
      if (this.isCacheExpired(timestamp, this.OPTIONS_CACHE_TTL_MS)) return [];
      return (options || []).map((o: any) => ({
        ...o,
        expiration: new Date(o.expiration),
      }));
    } catch {
      return [];
    }
  }

  private cachePrice(ticker: string, price: number): void {
    localStorage.setItem(`bbosi-price-${ticker}`, JSON.stringify({ price, timestamp: Date.now() }));
  }

  private getCachedPrice(ticker: string): number {
    try {
      const raw = localStorage.getItem(`bbosi-price-${ticker}`);
      if (!raw) return 0;
      const { price, timestamp } = JSON.parse(raw);
      if (this.isCacheExpired(timestamp, this.PRICE_CACHE_TTL_MS)) return 0;
      return price || 0;
    } catch {
      return 0;
    }
  }

  private isCacheExpired(timestamp: number | undefined, ttlMs: number): boolean {
    if (!timestamp || timestamp <= 0) return true;
    return Date.now() - timestamp > ttlMs;
  }

  /**
   * Busca cotação + opções em paralelo
   */
  fetchAll(ticker: string): Observable<{ stock: Stock; options: OptionWithGreeks[]; isMock: boolean; timestamp: Date }> {
    const stock = this.stocks.find(s => s.ticker === ticker) || {
      ticker,
      name: ticker,
      price: 0,
    };

    const yahooTicker = `${ticker}.SA`;
    const priceSource$ = this.getWithFallback<any>(
      this.yahooBaseUrls,
      `/v8/finance/chart/${yahooTicker}?interval=1d&range=1d`
    )
      .pipe(
        map(res => {
          const meta = res?.chart?.result?.[0]?.meta;
          const price = meta?.regularMarketPrice ?? meta?.previousClose ?? 0;
          const marketTime = meta?.regularMarketTime
            ? new Date(meta.regularMarketTime * 1000)
            : null;
          return { price, marketTime };
        }),
        catchError(() => of({ price: 0, marketTime: null as Date | null }))
      );

    return forkJoin({
      priceData: priceSource$,
      options: this.fetchOptions(ticker),
    }).pipe(
      map(({ priceData, options }) => {
        let price = priceData.price;
        const timestamp = priceData.marketTime || new Date();

        // Se não conseguiu preço de nenhuma fonte, infere pelas opções
        if (price === 0 && options.length > 0) {
          price = this.inferPriceFromOptions(options);
        }

        // Fallback: preço cacheado
        if (price === 0) {
          price = this.getCachedPrice(ticker);
        } else {
          this.cachePrice(ticker, price);
        }

        // Se ainda sem dados, usa mock
        if (options.length === 0) {
          const mockData = this.mock.generateOptions(ticker);
          if (price === 0) price = this.mock.getStockPrice(ticker);
          return {
            stock: { ...stock, price },
            options: mockData,
            isMock: true,
            timestamp,
          };
        }

        return {
          stock: { ...stock, price },
          options,
          isMock: false,
          timestamp,
        };
      })
    );
  }

  private getWithFallback<T>(baseUrls: string[], path: string, attempt = 0): Observable<T> {
    const base = baseUrls[attempt];
    if (!base) {
      return throwError(() => new Error('Nenhum endpoint de proxy configurado'));
    }

    return this.http.get<T>(`${base}${path}`).pipe(
      timeout(10000),
      catchError(err => {
        if (attempt < baseUrls.length - 1) {
          return this.getWithFallback<T>(baseUrls, path, attempt + 1);
        }
        return throwError(() => err);
      })
    );
  }

  private getBaseUrls(kind: 'yahoo' | 'opcoes'): string[] {
    const legacy = kind === 'yahoo' ? environment.yahooBaseUrl : environment.opcoesBaseUrl;
    const list = kind === 'yahoo'
      ? (environment as any).yahooBaseUrls
      : (environment as any).opcoesBaseUrls;

    const normalized = Array.isArray(list) ? list : [];
    if (legacy && !normalized.includes(legacy)) {
      return [legacy, ...normalized];
    }
    return normalized;
  }

  /**
   * Infere o preço da ação a partir dos dados das opções.
   * Método principal: usa "Distância % do Strike":
   *   cotação = strike / (1 + distância% / 100)
   * Fallback: ATM ou delta mais próximo de 0.5.
   */
  private inferPriceFromOptions(options: OptionWithGreeks[]): number {
    // Método 1: usar distancePercent
    const withDistance = options.filter(o => o.distancePercent !== 0);
    if (withDistance.length > 0) {
      const sorted = [...withDistance].sort(
        (a, b) => Math.abs(a.distancePercent) - Math.abs(b.distancePercent)
      );
      const closest = sorted[0];
      const inferred = closest.strike / (1 + closest.distancePercent / 100);
      if (Number.isFinite(inferred) && inferred > 0) {
        return inferred;
      }
    }

    // Método 2: opção ATM → strike ≈ preço
    const atm = options.find(o => o.moneyness === 'ATM');
    if (atm) return atm.strike;

    // Método 3: delta mais próximo de 0.5
    const byDelta = [...options].sort(
      (a, b) => Math.abs(a.delta - 0.5) - Math.abs(b.delta - 0.5)
    );
    return byDelta[0]?.strike ?? 0;
  }

  /**
   * Parseia a resposta do /api/v1 OptionsChain.
   * Formato: cada expiration tem .calls[] onde cada call é um array:
   * [0] suffix, [1] fm, [2] mod, [3] strike, [4] aio (I/A/O),
   * [5] dist%, [6] último, [7] var%, [8] data/hora, [9] negócios,
   * [10] vol financeiro, [11] iq, [12] coberto, [13] travado,
   * [14] descoberto, [15] tit, [16] lanc, [17] vol.impl,
   * [18] delta, [19] gamma, [20] theta($), [21] theta(%), [22] vega
   */
  private parseOptionsChain(response: OptionsChainResponse, stockTicker: string): OptionWithGreeks[] {
    if (!response?.success || !response.requests?.[0]?.results?.expirations) {
      return [];
    }

    const expirations = response.requests[0].results.expirations;
    const options: OptionWithGreeks[] = [];

    for (const exp of expirations) {
      const tradingDays = exp.du;

      // Apenas vencimentos até 80 dias úteis
      if (tradingDays <= 0 || tradingDays > 80) continue;

      const expDate = new Date(exp.dt + 'T00:00:00');

      for (const row of exp.calls) {
        const parsed = this.parseChainRow(row, stockTicker, expDate, tradingDays);
        if (parsed) options.push(parsed);
      }
    }

    return options;
  }

  private parseChainRow(
    row: any[],
    stockTicker: string,
    expiration: Date,
    tradingDays: number
  ): OptionWithGreeks | null {
    if (!row || row.length < 17) return null;

    const suffix = row[0];
    const strike = this.parseNumber(row[3]);
    const price = this.parseNumber(row[6]);
    const trades = this.parseNumber(row[9]);
    const volume = this.parseNumber(row[10]);

    // Descarta opções sem preço ou strike
    if (strike === 0 || price === 0) return null;

    // Pré-filtro: descarta pozinhos irrelevantes (< 1 centavo)
    if (price < 0.01) return null;

    // Ticker da opção = 4 primeiras letras da ação + suffix (ex: VALE + F946 = VALEF946)
    const ticker = stockTicker.substring(0, 4) + suffix;
    const moneyness = row[4] === 'I' ? 'ITM' : row[4] === 'A' ? 'ATM' : 'OTM';
    const distancePercent = this.parseNumber(row[5]) * 100; // API retorna decimal
    const premiumPercent = price / strike * 100;

    return {
      ticker,
      strike,
      expiration,
      tradingDays,
      price,
      trades,
      volume,
      tradePercent: 0,
      impliedVol: this.parseNumber(row[17]),
      delta: this.parseNumber(row[18]),
      gamma: this.parseNumber(row[19]),
      theta: this.parseNumber(row[20]),
      vega: this.parseNumber(row[22]),
      moneyness,
      distancePercent,
      premiumPercent,
    };
  }

  private parseNumber(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    const num = typeof value === 'string'
      ? parseFloat(value.replace(',', '.'))
      : Number(value);
    return isNaN(num) ? 0 : num;
  }

  private calcTradingDays(targetDate: Date): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);

    if (target <= today) return 0;

    let count = 0;
    const current = new Date(today);
    while (current < target) {
      current.setDate(current.getDate() + 1);
      const dow = current.getDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    return count;
  }
}
