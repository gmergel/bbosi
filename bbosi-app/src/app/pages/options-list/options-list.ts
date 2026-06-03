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
import { Stock, OptionIndicators } from '../../models/stock.model';

type OptionsDataState = 'loading' | 'ready' | 'empty' | 'mock' | 'error';

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
  bbosi = signal<number>(0);
  loading = signal<boolean>(true);
  dataState = signal<OptionsDataState>('loading');
  loadError = signal<string>('');
  isMock = signal<boolean>(false);
  showNoSell = signal<boolean>(false);
  expandedRow = signal<string | null>(null);
  lastUpdated = signal<Date | null>(null);
  volRegime = signal<VolRegime>('normal');
  ivRank = signal<number>(-1);
  ivPercentile = signal<number>(-1);
  ivCurrent = signal<number>(0);
  ivDays = signal<number>(0);
  searchQuery = signal<string>('');

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
      next: ({ stock, options, isMock, timestamp }) => {
        this.stock.set(stock);
        this.isMock.set(isMock);
        this.lastUpdated.set(timestamp);

        this.allOptions.set([]);
        this.bbosi.set(0);

        if (options.length > 0) {
          const indicators = this.indicatorService.calculateFromApi(options, stock.price, this.selectedTicker);
          this.allOptions.set(indicators);
          this.bbosi.set(this.indicatorService.calculateBBOSI(indicators));

          // Vol regime e IV Rank
          this.volRegime.set(this.indicatorService.getVolRegime(options, this.selectedTicker));
          const ivInfo = this.indicatorService.getIvInfo(this.selectedTicker, options);
          this.ivRank.set(ivInfo.rank);
          this.ivPercentile.set(ivInfo.percentile);
          this.ivCurrent.set(ivInfo.currentIv);
          this.ivDays.set(ivInfo.days);

          this.dataState.set(isMock ? 'mock' : 'ready');
        } else {
          this.dataState.set('empty');
        }

        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.dataState.set('error');
        this.loadError.set('Falha ao carregar dados de opcoes. Verifique sua conexao ou tente novamente.');
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

  isSold(optionTicker: string): boolean {
    return this.soldOptionsService.isSold(optionTicker);
  }

  sellOption(option: OptionIndicators, event: Event): void {
    event.stopPropagation();
    const ticker = this.route.snapshot.paramMap.get('ticker') || '';
    this.soldOptionsService.sell(option, ticker, this.bbosi(), this.stock()?.price || 0);
  }

  unsellOption(optionTicker: string, event: Event): void {
    event.stopPropagation();
    this.soldOptionsService.remove(optionTicker);
  }
}
