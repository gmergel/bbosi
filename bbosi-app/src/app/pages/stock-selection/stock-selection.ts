import { Component, computed, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { DatePipe } from '@angular/common';
import { MarketDataService } from '../../services/market-data.service';
import { SoldOptionsService, SoldOption, RollSignal } from '../../services/sold-options.service';
import { Stock } from '../../models/stock.model';
import { RelativeTimePipe } from '../../pipes/relative-time.pipe';
import { finalize, switchMap } from 'rxjs';

@Component({
  selector: 'app-stock-selection',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule, MatMenuModule, DatePipe, RelativeTimePipe],
  templateUrl: './stock-selection.html',
  styleUrl: './stock-selection.scss',
})
export class StockSelectionComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private marketData = inject(MarketDataService);
  soldOptionsService = inject(SoldOptionsService);
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private readonly ACTIVE_REFRESH_MS = 10000;
  editingSellTicker = signal<string | null>(null);
  sellPriceInput = signal<string>('');
  buybackTicker = signal<string | null>(null);
  buybackPriceInput = signal<string>('');
  isSyncTokenEditorOpen = signal<boolean>(false);
  syncTokenInput = signal<string>('');

  Math = Math; // Expose Math for template

  stocks = signal<Stock[]>(this.marketData.getStocks());
  lastUpdated = signal<Date | null>(null);
  refreshingSoldData = signal<boolean>(false);
  sortedActiveOptions = computed(() => [...this.soldOptionsService.activeOptions()].sort((a, b) =>
    a.stockTicker.localeCompare(b.stockTicker) || a.optionTicker.localeCompare(b.optionTicker)
  ));

  ngOnInit(): void {
    // Atualiza dados das opções vendidas
    this.refreshSoldData();

    // Auto-refresh com menor carga e adaptado à visibilidade da aba
    this.refreshInterval = setInterval(() => {
      this.refreshSoldData();
    }, this.ACTIVE_REFRESH_MS);

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

  private refreshSoldData(): void {
    // Com aba oculta, evita agressividade desnecessária de atualização.
    const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
    if (hidden) {
      return;
    }
    this.refreshingSoldData.set(true);
    this.soldOptionsService.refreshRemote().pipe(
      switchMap(() => this.soldOptionsService.refreshAll()),
      finalize(() => this.refreshingSoldData.set(false)),
    ).subscribe();
  }

  selectStock(ticker: string): void {
    this.router.navigate(['/options', ticker]);
  }

  onStockCardKeydown(event: KeyboardEvent, ticker: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.selectStock(ticker);
  }

  removeSold(optionTicker: string, event: Event): void {
    event.stopPropagation();
    const confirmed = window.confirm(
      `Remover a opcao vendida ${optionTicker} da tela inicial?`
    );
    if (!confirmed) return;
    this.soldOptionsService.remove(optionTicker);
  }

  configureSyncToken(): void {
    this.syncTokenInput.set('');
    this.isSyncTokenEditorOpen.set(true);
  }

  cancelSyncToken(): void {
    this.isSyncTokenEditorOpen.set(false);
    this.syncTokenInput.set('');
  }

  saveSyncToken(): void {
    const token = this.syncTokenInput().trim();
    if (!token) return;
    this.soldOptionsService.setSyncToken(token);
    this.cancelSyncToken();
  }

  unlinkSyncToken(): void {
    this.soldOptionsService.clearSyncToken();
  }

  editSellPrice(sold: SoldOption, event: Event): void {
    event.stopPropagation();
    this.editingSellTicker.set(sold.optionTicker);
    this.sellPriceInput.set(sold.sellPrice.toFixed(2));
  }

  cancelEditSellPrice(): void {
    this.editingSellTicker.set(null);
    this.sellPriceInput.set('');
  }

  confirmEditSellPrice(sold: SoldOption, event: Event): void {
    event.stopPropagation();
    const sellPrice = Number(this.sellPriceInput().replace(',', '.'));
    if (!Number.isFinite(sellPrice) || sellPrice <= 0) return;

    this.soldOptionsService.updateSellPrice(sold.optionTicker, sellPrice);
    this.cancelEditSellPrice();
  }

  editBuybackPrice(sold: SoldOption, event: Event): void {
    event.stopPropagation();
    this.buybackTicker.set(sold.optionTicker);
    this.buybackPriceInput.set((sold.optionPrice || 0).toFixed(2));
  }

  cancelBuyback(): void {
    this.buybackTicker.set(null);
    this.buybackPriceInput.set('');
  }

  confirmBuyback(sold: SoldOption, event: Event): void {
    event.stopPropagation();
    const price = Number(this.buybackPriceInput().replace(',', '.'));
    if (!Number.isFinite(price) || price < 0) return;
    this.soldOptionsService.buyback(sold.optionTicker, price);
    this.cancelBuyback();
  }

  getRealizedProfit(sold: SoldOption): number {
    return (sold.sellPrice - (sold.buybackPrice ?? 0)) * 100;
  }

  removeFromHistory(sold: SoldOption, event: Event): void {
    event.stopPropagation();
    this.soldOptionsService.removeById(sold.id);
  }

  getNvColor(nv: number): string {
    return this.soldOptionsService.getNvColor(nv);
  }

  getNvActionTooltip(nv: number): string {
    if (nv < 0) return `NV ${nv.toFixed(2)} — considerar recompra`;
    if (nv < 0.2) return `NV ${nv.toFixed(2)} — acompanhar de perto`;
    return `NV ${nv.toFixed(2)} — manter posição`;
  }

  getCardStatus(sold: SoldOption): 'safe' | 'alvo' | 'recomprar' | 'rolar' {
    const roll = this.getRollSignal(sold);
    if (roll.shouldRoll && roll.severity === 'danger') return 'recomprar';
    if (roll.shouldRoll && roll.severity === 'warn') return 'rolar';
    if (roll.shouldRoll && roll.severity === 'info') return 'alvo';
    return 'safe';
  }

  private getBarFillBounds(sold: SoldOption): { left: number; width: number } {
    const bbosi = sold.bbosi || 0;
    if (!bbosi) {
      return { left: this.getMarkerPosition(sold.stockPrice, sold), width: 0 };
    }
    const left = Math.min(sold.stockPrice, bbosi);
    const right = Math.max(sold.stockPrice, bbosi);
    let leftPos = this.getMarkerPosition(left, sold);
    let rightPos = this.getMarkerPosition(right, sold);

    // Garante uma largura mínima visível sem ultrapassar os indicadores:
    // cresce simetricamente a partir do centro e limita ao intervalo [0, 100].
    const minWidth = 2;
    if (rightPos - leftPos < minWidth) {
      const center = (leftPos + rightPos) / 2;
      leftPos = Math.max(0, center - minWidth / 2);
      rightPos = Math.min(100, center + minWidth / 2);
    }

    return { left: leftPos, width: Math.max(0, rightPos - leftPos) };
  }

  getBarFillLeft(sold: SoldOption): number {
    return this.getBarFillBounds(sold).left;
  }

  getBarFillWidth(sold: SoldOption): number {
    return this.getBarFillBounds(sold).width;
  }

  getBarLastro(sold: SoldOption): number {
    if (!sold.bbosi || sold.strike === 0) return 100;
    return ((sold.strike - sold.bbosi) / sold.strike) * 100;
  }

  getCurrentStrikeDistance(sold: SoldOption): number {
    if (sold.stockPrice <= 0 || sold.strike <= 0) return 0;
    return ((sold.strike - sold.stockPrice) / sold.stockPrice) * 100;
  }

  getDailyStrikeMove(sold: SoldOption): number {
    if (sold.stockPrice <= 0 || sold.strike <= 0 || sold.tradingDays <= 0) return 0;
    return (Math.pow(sold.strike / sold.stockPrice, 1 / sold.tradingDays) - 1) * 100;
  }

  getStrikeDistanceLabelPosition(sold: SoldOption): number {
    const pricePosition = this.getMarkerPosition(sold.stockPrice, sold);
    const strikePosition = this.getMarkerPosition(sold.strike, sold);
    return (pricePosition + strikePosition) / 2;
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

  getStopPercent(sold: SoldOption): number {
    return this.soldOptionsService.getStopPercent(sold);
  }

  getStopPosition(sold: SoldOption): number {
    return 50 - this.getStopPercent(sold) / 2;
  }

  getStop(sold: SoldOption): number {
    return sold.sellPrice * (1 + this.getStopPercent(sold) / 100);
  }

  getProfitCaptured(sold: SoldOption): number {
    return this.soldOptionsService.getProfitCaptured(sold);
  }

  getProfitBarWidth(sold: SoldOption): number {
    return Math.min(50, Math.abs(this.getProfitCaptured(sold)) / 2);
  }

  getProfitBarLeft(sold: SoldOption): number {
    const profit = this.getProfitCaptured(sold);
    return profit < 0 ? 50 - this.getProfitBarWidth(sold) : 50;
  }

  getProfitCurrentPosition(sold: SoldOption): number {
    const profit = Math.max(-100, Math.min(100, this.getProfitCaptured(sold)));
    return 50 + profit / 2;
  }

  getNvPosition(sold: SoldOption): number {
    // Usa a mesma escala de preço->posição do stop/alvo, tratando o NV como um nível de preço.
    if (sold.sellPrice <= 0) return 50;
    const pct = ((sold.sellPrice - sold.nv) / sold.sellPrice) * 100;
    return 50 + Math.max(-100, Math.min(100, pct)) / 2;
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
