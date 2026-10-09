import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DatePipe } from '@angular/common';
import { MarketDataService } from '../../services/market-data.service';
import { IndicatorService, VolRegime } from '../../services/indicator.service';
import { SoldOptionsService } from '../../services/sold-options.service';
import { GerBosiSnapshot, Stock, OptionIndicators } from '../../models/stock.model';

type OptionsDataState = 'loading' | 'ready' | 'empty' | 'error';

@Component({
  selector: 'app-options-list',
  standalone: true,
  imports: [
    MatTableModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatTooltipModule,
    DatePipe,
  ],
  templateUrl: './options-list.html',
  styleUrl: './options-list.scss',
})
export class OptionsListComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private marketData = inject(MarketDataService);
  private indicatorService = inject(IndicatorService);
  private soldOptionsService = inject(SoldOptionsService);

  stock = signal<Stock | undefined>(undefined);
  allOptions = signal<OptionIndicators[]>([]);
  gerbosiSnapshots = signal<GerBosiSnapshot[]>([]);
  selectedGerbosiExpiration = signal<string | null>(null);
  loading = signal<boolean>(true);
  dataState = signal<OptionsDataState>('loading');
  loadError = signal<string>('');
  showNoSell = signal<boolean>(false);
  expandedRow = signal<string | null>(null);
  sellingTicker = signal<string | null>(null);
  sellPriceInput = signal<string>('');
  lastUpdated = signal<Date | null>(null);
  volRegime = signal<VolRegime>('normal');
  ivRank = signal<number>(-1);
  ivPercentile = signal<number>(-1);
  ivCurrent = signal<number>(0);
  ivDays = signal<number>(0);
  searchQuery = signal<string>('');

  gerbosiValues = computed(() =>
    [...this.gerbosiSnapshots()].sort((a, b) => a.tradingDays - b.tradingDays)
  );

  selectedGerbosi = computed(() => {
    const values = this.gerbosiValues();
    const selectedExpiration = this.selectedGerbosiExpiration();
    return values.find(snapshot => this.expirationKey(snapshot.expiration) === selectedExpiration) ?? values[0];
  });

  /** Opções filtradas e ordenadas por VDXX decrescente */
  options = computed(() => {
    let data = this.allOptions();
    if (!this.showNoSell()) {
      data = data.filter(o => !o.noSell);
    }
    const query = this.searchQuery().trim().toUpperCase();
    if (query) {
      // Remove dígitos finais do ticker da ação (ex: VALE3 → VALE) para obter o prefixo correto das opções
      const stockBase = (this.stock()?.ticker ?? '').replace(/\d+$/, '').toUpperCase();
      data = data.filter(o => {
        const serie = o.ticker.toUpperCase().slice(stockBase.length);
        return serie.includes(query);
      });
    }
    return [...data].sort((a, b) => b.vdxx - a.vdxx);
  });

  /** Melhor opção (maior VDXX positivo) */
  bestOption = computed(() => {
    const valid = this.allOptions().filter(o => !o.noSell && o.vdxx > 0);
    if (valid.length === 0) return null;
    return valid.reduce((best, o) => o.vdxx > best.vdxx ? o : best);
  });

  displayedColumns = ['rank', 'ticker', 'strike', 'lastroPercent', 'pregoes', 've', 'vdxx'];
  private selectedTicker = '';

  ngOnInit(): void {
    this.selectedTicker = this.route.snapshot.paramMap.get('ticker') || '';
    if (!this.selectedTicker) {
      this.router.navigate(['/']);
      return;
    }

    this.loadData();
  }

  retryLoad(): void {
    this.loadData();
  }

  private loadData(): void {
    this.loading.set(true);
    this.dataState.set('loading');
    this.loadError.set('');

    this.marketData.fetchAll(this.selectedTicker).subscribe({
      next: ({ stock, options, gerbosiOptions, timestamp }) => {
        this.stock.set(stock);
        this.lastUpdated.set(timestamp);

        this.allOptions.set([]);
        this.gerbosiSnapshots.set([]);

        if (options.length > 0) {
          const indicators = this.indicatorService.calculateFromApi(options, stock.price, this.selectedTicker);
          this.allOptions.set(indicators);
          const snapshots = this.indicatorService.calculateGerBosiByExpiration(
            gerbosiOptions,
            stock.price,
            options
          );
          this.gerbosiSnapshots.set(snapshots);

          // Vol regime e IV Rank
          this.volRegime.set(this.indicatorService.getVolRegime(options, this.selectedTicker));
          const ivInfo = this.indicatorService.getIvInfo(this.selectedTicker, options);
          this.ivRank.set(ivInfo.rank);
          this.ivPercentile.set(ivInfo.percentile);
          this.ivCurrent.set(ivInfo.currentIv);
          this.ivDays.set(ivInfo.days);

          this.dataState.set('ready');
        } else {
          this.dataState.set('empty');
        }

        this.loading.set(false);
      },
      error: (error: Error) => {
        this.loading.set(false);
        this.dataState.set('error');
        this.loadError.set(error?.message || 'Não foi possível obter dados reais. Verifique sua conexão ou tente novamente.');
        this.gerbosiSnapshots.set([]);
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  toggleRow(ticker: string): void {
    this.expandedRow.set(this.expandedRow() === ticker ? null : ticker);
  }

  onOptionRowKeydown(event: KeyboardEvent, ticker: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleRow(ticker);
  }

  getVdxxClass(vdxx: number): string {
    if (vdxx >= 50) return 'vdxx-excellent';
    if (vdxx >= 20) return 'vdxx-good';
    if (vdxx >= 5) return 'vdxx-ok';
    return 'vdxx-low';
  }

  getVdxxBarWidth(vdxx: number): number {
    // Normaliza para 0-100% com max de 100
    return Math.min(100, Math.max(0, vdxx));
  }

  getDailyTargetMove(option: OptionIndicators): number {
    const stockPrice = this.stock()?.price ?? 0;
    if (stockPrice <= 0 || option.strike <= 0 || option.tradingDays <= 0) return 0;

    return (Math.pow(option.strike / stockPrice, 1 / option.tradingDays) - 1) * 100;
  }

  getDailyTargetDirection(option: OptionIndicators): string {
    const move = this.getDailyTargetMove(option);
    return move > 0 ? 'subir' : move < 0 ? 'descer' : 'manter';
  }

  getGerbosiTooltip(snapshot: GerBosiSnapshot): string {
    const expiration = snapshot.expiration.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    const reference = snapshot.marketDataTime
      ? new Date(snapshot.marketDataTime).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
      : 'data não informada';
    return `Vencimento ${expiration} · opcoes.net.br · referência ${reference} · ${snapshot.trades} negócios reais. Centro ponderado, sem indicação de direção compradora ou vendedora.`;
  }

  getGerbosiForExpiration(expiration: Date): GerBosiSnapshot | undefined {
    const key = this.expirationKey(expiration);
    return this.gerbosiSnapshots().find(snapshot => this.expirationKey(snapshot.expiration) === key);
  }

  selectGerbosiExpiration(event: Event): void {
    const expiration = (event.target as HTMLSelectElement).value;
    this.selectedGerbosiExpiration.set(expiration || null);
  }

  private expirationKey(expiration: Date): string {
    return expiration.toISOString().slice(0, 10);
  }

  isSold(optionTicker: string): boolean {
    return this.soldOptionsService.isSold(optionTicker);
  }

  sellOption(option: OptionIndicators, event: Event): void {
    event.stopPropagation();
    this.sellingTicker.set(option.ticker);
    this.sellPriceInput.set(option.price.toFixed(2));
  }

  cancelSell(): void {
    this.sellingTicker.set(null);
    this.sellPriceInput.set('');
  }

  confirmSell(option: OptionIndicators, event: Event): void {
    event.stopPropagation();
    const sellPrice = Number(this.sellPriceInput().replace(',', '.'));
    if (!Number.isFinite(sellPrice) || sellPrice <= 0) return;

    const ticker = this.route.snapshot.paramMap.get('ticker') || '';
    this.soldOptionsService.sell(
      option,
      ticker,
      this.getGerbosiForExpiration(option.expiration),
      this.stock()?.price || 0,
      sellPrice
    );
    this.cancelSell();
  }

  unsellOption(optionTicker: string, event: Event): void {
    event.stopPropagation();
    this.soldOptionsService.remove(optionTicker);
  }
}
