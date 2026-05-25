import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MarketDataService } from '../../services/market-data.service';
import { SoldOptionsService, SoldOption } from '../../services/sold-options.service';
import { Stock } from '../../models/stock.model';

@Component({
  selector: 'app-stock-selection',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './stock-selection.html',
  styleUrl: './stock-selection.scss',
})
export class StockSelectionComponent implements OnInit {
  private router = inject(Router);
  private marketData = inject(MarketDataService);
  soldOptionsService = inject(SoldOptionsService);

  stocks = signal<Stock[]>(this.marketData.getStocks());

  ngOnInit(): void {
    const tickers = this.stocks();
    tickers.forEach((stock, i) => {
      this.marketData.fetchStockPrice(stock.ticker).subscribe(price => {
        if (price > 0) {
          const updated = [...this.stocks()];
          updated[i] = { ...updated[i], price };
          this.stocks.set(updated);
        }
      });
    });
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

  getCardStatus(sold: SoldOption): 'safe' | 'recomprar' | 'rolar' {
    const bbosi = sold.bbosi || 0;
    // Regra Bastter: NV <= 0 → recomprar a opção
    if (sold.nv <= 0) return 'recomprar';
    // Regra Bastter: BBOSI >= Strike → rolar (ação subiu demais)
    if (bbosi > 0 && bbosi >= sold.strike) return 'rolar';
    return 'safe';
  }

  getBbosiBarWidth(sold: SoldOption): number {
    if (sold.strike === 0 || !sold.bbosi) return 0;
    const ratio = (sold.bbosi / sold.strike) * 100;
    return Math.min(ratio, 100);
  }

  getMarkerPosition(value: number, sold: SoldOption): number {
    const bbosi = sold.bbosi || sold.stockPrice;
    const minVal = Math.min(sold.stockPrice, sold.strike, bbosi);
    const minRef = minVal * 0.95; // inicia 5% abaixo do menor valor
    const max = Math.max(sold.stockPrice, sold.strike, bbosi);
    if (max <= minRef) return 100;
    const pos = ((value - minRef) / (max - minRef)) * 100;
    return Math.max(0, Math.min(100, pos));
  }

  getBarLabels(sold: SoldOption): { label: string; value: number; type: string }[] {
    const items = [
      { label: `BBOSI ${(sold.bbosi || 0).toFixed(2)}`, value: sold.bbosi || 0, type: 'bbosi' },
      { label: `Ação ${sold.stockPrice.toFixed(2)}`, value: sold.stockPrice, type: 'price' },
      { label: `Strike ${sold.strike.toFixed(2)}`, value: sold.strike, type: 'strike' },
    ];
    return items.sort((a, b) => a.value - b.value);
  }

  getTarget(sold: SoldOption): number {
    // Alvo: recomprar quando restar ~20% do prêmio vendido
    return sold.sellPrice * 0.20;
  }

  getNvBarWidth(nv: number): number {
    // Normaliza NV para 0-100%. Range esperado: -1 a +1
    const clamped = Math.max(-1, Math.min(1, nv));
    return ((clamped + 1) / 2) * 100;
  }
}
