import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MarketDataService } from '../../services/market-data.service';
import { SoldOptionsService, SoldOption, RollSignal } from '../../services/sold-options.service';
import { Stock } from '../../models/stock.model';
import { RelativeTimePipe } from '../../pipes/relative-time.pipe';

@Component({
  selector: 'app-stock-selection',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule, RelativeTimePipe],
  templateUrl: './stock-selection.html',
  styleUrl: './stock-selection.scss',
})
export class StockSelectionComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private marketData = inject(MarketDataService);
  soldOptionsService = inject(SoldOptionsService);
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  Math = Math; // Expose Math for template

  stocks = signal<Stock[]>(this.marketData.getStocks());
  lastUpdated = signal<Date | null>(null);

  ngOnInit(): void {
    // Atualiza dados das opções vendidas
    this.soldOptionsService.refreshAll();

    // Auto-refresh a cada 2s
    this.refreshInterval = setInterval(() => {
      this.soldOptionsService.refreshAll();
    }, 2000);

    const tickers = this.stocks();
    tickers.forEach((stock, i) => {
      this.marketData.fetchStockPrice(stock.ticker).subscribe(({ price, marketTime }) => {
        if (price > 0) {
          const updated = [...this.stocks()];
          updated[i] = { ...updated[i], price, marketTime };
          this.stocks.set(updated);
          if (marketTime) {
            this.lastUpdated.set(marketTime);
          }
        }
      });
    });
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  selectStock(ticker: string): void {
    this.router.navigate(['/options', ticker]);
  }

  removeSold(optionTicker: string, event: Event): void {
    event.stopPropagation();
    this.soldOptionsService.remove(optionTicker);
  }

  getNvColor(nv: number): string {
    return this.soldOptionsService.getNvColor(nv);
  }

  getCardStatus(sold: SoldOption): 'safe' | 'alvo' | 'recomprar' | 'rolar' {
    const roll = this.getRollSignal(sold);
    if (roll.shouldRoll && roll.severity === 'danger') return 'recomprar';
    if (roll.shouldRoll && roll.severity === 'warn') return 'rolar';
    if (roll.shouldRoll && roll.severity === 'info') return 'alvo';
    return 'safe';
  }

  getBarFillLeft(sold: SoldOption): number {
    const bbosi = sold.bbosi || 0;
    if (!bbosi) return this.getMarkerPosition(sold.stockPrice, sold);
    const left = Math.min(sold.stockPrice, bbosi);
    return this.getMarkerPosition(left, sold);
  }

  getBarFillWidth(sold: SoldOption): number {
    const bbosi = sold.bbosi || 0;
    if (!bbosi) return 0;
    const left = Math.min(sold.stockPrice, bbosi);
    const right = Math.max(sold.stockPrice, bbosi);
    const leftPos = this.getMarkerPosition(left, sold);
    const rightPos = this.getMarkerPosition(right, sold);
    return Math.max(2, rightPos - leftPos);
  }

  getBarLastro(sold: SoldOption): number {
    if (!sold.bbosi || sold.strike === 0) return 100;
    return ((sold.strike - sold.bbosi) / sold.strike) * 100;
  }

  getMarkerPosition(value: number, sold: SoldOption): number {
    const price = sold.stockPrice;
    if (price <= 0) return 50;

    // Preço da ação sempre centralizado (50%). Escala simétrica baseada na maior distância.
    const bbosi = sold.bbosi || price;
    const maxDist = Math.max(
      Math.abs(sold.strike - price),
      Math.abs(bbosi - price),
      price * 0.02
    );
    const pos = 50 + ((value - price) / maxDist) * 45;
    return Math.max(0, Math.min(100, pos));
  }

  getBarLabels(sold: SoldOption): { label: string; value: number; type: string }[] {
    const items = [
      { label: `GerBOSI ${(sold.bbosi || 0).toFixed(2)}`, value: sold.bbosi || 0, type: 'bbosi' },
      { label: `Ação ${sold.stockPrice.toFixed(2)}`, value: sold.stockPrice, type: 'price' },
      { label: `Strike ${sold.strike.toFixed(2)}`, value: sold.strike, type: 'strike' },
    ];
    return items.sort((a, b) => a.value - b.value);
  }

  getTarget(sold: SoldOption): number {
    // Alvo: recomprar quando capturar 50% do prêmio vendido
    return sold.sellPrice * 0.50;
  }

  getProfitCaptured(sold: SoldOption): number {
    return this.soldOptionsService.getProfitCaptured(sold);
  }

  getRollSignal(sold: SoldOption): RollSignal {
    return this.soldOptionsService.getRollSignal(sold);
  }

  getNvBarWidth(nv: number): number {
    // Normaliza NV para 0-100%. Range esperado: -1 a +1
    const clamped = Math.max(-1, Math.min(1, nv));
    return ((clamped + 1) / 2) * 100;
  }
}
