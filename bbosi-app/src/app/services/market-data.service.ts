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

/** Resposta da API vendacoberta: /api/v1/options/stocks */
export interface VendaCobertaStock {
  symbol: string;
  highestOptionsVolumeRank: number;
  open: number;
  close: number;
  high: number;
  low: number;
  previousClose: number;
}

/** Resposta da API vendacoberta: POST /api/v1/options */
export interface VendaCobertaOptionsResponse {
  options: VendaCobertaOption[];
  currentPage: number;
  totalItems: number;
  totalPages: number;
  uniqueDueDates: string[];
}

export interface VendaCobertaOption {
  ticker: string;
  externalReferenceDate: string;
  fm: boolean;
  type: 'CALL' | 'PUT';
  mod: string;
  moneyness: string;
  strike: number;
  strikeDistance: number;
  strikeRate: number;
  optionPremium: number;
  impliedVolatility: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  createdAt: string;
  dueDate: string;
  stockSymbol: string;
  version: number;
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
  private vendacobertaBaseUrls = this.getBaseUrls('vendacoberta');
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
   * Busca lista de ações disponíveis na API vendacoberta com preços.
   */
  fetchVendaCobertaStocks(): Observable<VendaCobertaStock[]> {
    return this.getWithFallback<VendaCobertaStock[]>(
      this.vendacobertaBaseUrls,
      '/api/v1/options/stocks'
    ).pipe(
      catchError(() => of([] as VendaCobertaStock[]))
    );
  }

  /**
   * Busca cotação atual da ação via Yahoo Finance (fonte mais rápida e confiável para preços).
   * Fallback: vendacoberta → cache.
   */
  fetchStockPrice(ticker: string): Observable<{ price: number; marketTime: Date | null }> {
    return this.fetchStockPriceYahoo(ticker).pipe(
      switchMap(data => {
        if (data.price > 0) return of(data);
        // Fallback: vendacoberta /stocks
        return this.fetchVendaCobertaStocks().pipe(
          map(stocks => {
            const found = stocks.find(s => s.symbol === ticker);
            if (found && found.close > 0) {
              this.cachePrice(ticker, found.close);
              return { price: found.close, marketTime: new Date() };
            }
            return { price: this.getCachedPrice(ticker), marketTime: null as Date | null };
          })
        );
      })
    );
  }

  private fetchStockPriceYahoo(ticker: string): Observable<{ price: number; marketTime: Date | null }> {
    const yahooTicker = `${ticker}.SA`;
    return this.getWithFallback<any>(
      this.yahooBaseUrls,
      `/v8/finance/chart/${yahooTicker}?interval=1d&range=1d`
    ).pipe(
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
        return of({ price: this.getCachedPrice(ticker), marketTime: null as Date | null });
      })
    );
  }

  /**
   * Busca opções (calls) de uma ação.
   * Fonte principal: vendacoberta POST /api/v1/options.
   * Fallback: opcoes.net.br OptionsChain → cache.
   */
  fetchOptions(ticker: string): Observable<OptionWithGreeks[]> {
    return this.fetchOptionsVendaCoberta(ticker).pipe(
      switchMap(options => {
        if (options.length > 0) {
          this.cacheOptions(ticker, options);
          return of(options);
        }
        // Fallback: opcoes.net.br
        return this.fetchOptionsOpcoes(ticker);
      })
    );
  }

  private fetchOptionsVendaCoberta(ticker: string): Observable<OptionWithGreeks[]> {
    const body = {
      size: '100000',
      page: '0',
      stockSelection: ticker,
      optionType: 'call_put',
      strikeDistance: 20,
    };

    return this.postWithFallback<VendaCobertaOptionsResponse>(
      this.vendacobertaBaseUrls,
      '/api/v1/options',
      body
    ).pipe(
      map(res => this.parseVendaCobertaOptions(res, ticker)),
      catchError(err => {
        console.warn(`VendaCoberta falhou para ${ticker}:`, err);
        return of([] as OptionWithGreeks[]);
      })
    );
  }

  private fetchOptionsOpcoes(ticker: string): Observable<OptionWithGreeks[]> {
    const z = Math.floor(Date.now() / 10000);
    const path = `/api/v1?z=${z}&r0t=OptionsChain&r0p.underlying_asset_id=${ticker}`;

    return this.getWithFallback<OptionsChainResponse>(this.opcoesBaseUrls, path).pipe(
      map(res => this.parseOptionsChain(res, ticker)),
      map(options => {
        if (options.length > 0) {
          this.cacheOptions(ticker, options);
          return options;
        }
        return this.getCachedOptions(ticker);
      }),
      catchError(err => {
        console.error(`Erro ao buscar opções de ${ticker} (opcoes.net.br):`, err);
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
   * Busca cotação + opções em paralelo (fonte principal: vendacoberta)
   */
  fetchAll(ticker: string): Observable<{ stock: Stock; options: OptionWithGreeks[]; isMock: boolean; timestamp: Date }> {
    const stock = this.stocks.find(s => s.ticker === ticker) || {
      ticker,
      name: ticker,
      price: 0,
    };

    return forkJoin({
      priceData: this.fetchStockPrice(ticker),
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

  private postWithFallback<T>(baseUrls: string[], path: string, body: any, attempt = 0): Observable<T> {
    const base = baseUrls[attempt];
    if (!base) {
      return throwError(() => new Error('Nenhum endpoint de proxy configurado'));
    }

    return this.http.post<T>(`${base}${path}`, body).pipe(
      timeout(15000),
      catchError(err => {
        if (attempt < baseUrls.length - 1) {
          return this.postWithFallback<T>(baseUrls, path, body, attempt + 1);
        }
        return throwError(() => err);
      })
    );
  }

  private getBaseUrls(kind: 'yahoo' | 'opcoes' | 'vendacoberta'): string[] {
    let legacy: string;
    let list: string[] | undefined;

    switch (kind) {
      case 'yahoo':
        legacy = environment.yahooBaseUrl;
        list = (environment as any).yahooBaseUrls;
        break;
      case 'opcoes':
        legacy = environment.opcoesBaseUrl;
        list = (environment as any).opcoesBaseUrls;
        break;
      case 'vendacoberta':
        legacy = (environment as any).vendacobertaBaseUrl;
        list = (environment as any).vendacobertaBaseUrls;
        break;
    }

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
   * Parseia a resposta da API vendacoberta POST /api/v1/options.
   * Filtra apenas CALLs com vencimento até 80 dias úteis.
   */
  private parseVendaCobertaOptions(response: VendaCobertaOptionsResponse, stockTicker: string): OptionWithGreeks[] {
    if (!response?.options?.length) return [];

    const options: OptionWithGreeks[] = [];

    for (const opt of response.options) {
      // Apenas CALLs para venda coberta
      if (opt.type !== 'CALL') continue;

      // Descarta opções semanais (W1, W2, W3, W4) — IV distorcida e baixa liquidez
      if (/W\d$/.test(opt.ticker)) continue;

      const expiration = new Date(opt.dueDate);
      const tradingDays = this.calcTradingDays(expiration);

      // Filtra vencimentos até 80 dias úteis
      if (tradingDays <= 0 || tradingDays > 80) continue;

      // Descarta opções sem prêmio
      if (opt.optionPremium <= 0) continue;

      // Converte IV de percentual (35.05 = 35.05%) para decimal (0.3505)
      const impliedVol = opt.impliedVolatility / 100;

      // strikeDistance já vem em percentual da API (ex: -0.64 = -0.64%)
      const distancePercent = opt.strikeDistance;
      const premiumPercent = opt.strike > 0 ? (opt.optionPremium / opt.strike) * 100 : 0;

      options.push({
        ticker: opt.ticker,
        strike: opt.strike,
        expiration,
        tradingDays,
        price: opt.optionPremium,
        trades: 100, // vendacoberta pré-filtra opções líquidas; sem dado de negócios
        volume: 0,
        tradePercent: 0,
        impliedVol,
        delta: opt.delta,
        gamma: opt.gamma,
        theta: opt.theta,
        vega: opt.vega,
        moneyness: opt.moneyness,
        distancePercent,
        premiumPercent,
      });
    }

    return options;
  }

  /**
   * Parseia a resposta do /api/v1 OptionsChain (opcoes.net.br).
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
