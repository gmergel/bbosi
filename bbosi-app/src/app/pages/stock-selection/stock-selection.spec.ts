import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { MarketDataService } from '../../services/market-data.service';
import { SoldOption, SoldOptionsService } from '../../services/sold-options.service';
import { StockSelectionComponent } from './stock-selection';

describe('StockSelectionComponent Telegram status', () => {
  let component: StockSelectionComponent;
  let http: HttpTestingController;
  let token: string | null;
  const historyOptions: SoldOption[] = [
    { id: 'old', optionTicker: 'OLD', stockTicker: 'BBAS3', strike: 10, sellPrice: 0.3, sellDate: '2026-10-01T12:00:00Z', expiration: new Date(), tradingDays: 1, nv: 0, ve: 0, vdxx: 0, lastroPercent: 0, bbosi: 0, stockPrice: 10, optionPrice: 0.3, buybackDate: '2026-10-02T12:00:00Z' },
    { id: 'new', optionTicker: 'NEW', stockTicker: 'BBAS3', strike: 10, sellPrice: 0.3, sellDate: '2026-10-03T12:00:00Z', expiration: new Date(), tradingDays: 1, nv: 0, ve: 0, vdxx: 0, lastroPercent: 0, bbosi: 0, stockPrice: 10, optionPrice: 0.3, buybackDate: '2026-10-04T12:00:00Z' },
  ];
  const statusUrl = environment.positionsBaseUrl.replace(/\/positions$/, '/telegram/status');

  beforeEach(() => {
    token = 'sync-token';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: MarketDataService, useValue: { getStocks: () => [] } },
        {
          provide: SoldOptionsService,
          useValue: {
            hasSyncToken: () => Boolean(token),
            getSyncToken: () => token,
            setSyncToken: (value: string) => { token = value; },
            clearSyncToken: () => { token = null; },
            soldOptions: () => historyOptions,
            activeOptions: () => [],
            refreshRemote: () => of(void 0),
            refreshAll: () => of(void 0),
          },
        },
      ],
    });
    component = TestBed.runInInjectionContext(() => new StockSelectionComponent());
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    component.ngOnDestroy();
    http.verify();
  });

  it('shows closed operations from newest to oldest', () => {
    expect(component.sortedHistoryOptions().map(option => option.optionTicker)).toEqual(['NEW', 'OLD']);
  });

  it('restores an existing link on startup without opening the panel', () => {
    component.ngOnInit();

    expect(component.telegramLinked()).toBeNull();
    const request = http.expectOne(statusUrl);
    expect(request.request.headers.get('X-BBOSI-Token')).toBe('sync-token');
    request.flush({ linked: true });

    expect(component.telegramLinked()).toBe(true);
    expect(component.telegramOpen()).toBe(false);
  });

  it('does not request Telegram status without a sync token', () => {
    token = null;
    component.ngOnInit();

    http.expectNone(statusUrl);
    expect(component.telegramLinked()).toBeNull();
  });

  it('checks the link after saving a sync token', () => {
    token = null;
    component.syncTokenInput.set(' new-token ');
    component.saveSyncToken();

    const request = http.expectOne(statusUrl);
    expect(request.request.headers.get('X-BBOSI-Token')).toBe('new-token');
    request.flush({ linked: true });
    expect(component.telegramLinked()).toBe(true);
  });

  it('only reports unlinked after a successful status response', () => {
    component.ngOnInit();
    http.expectOne(statusUrl).flush({ linked: false });

    expect(component.telegramLinked()).toBe(false);
  });

  it('does not report an unlinked account when the status request fails', () => {
    component.ngOnInit();
    http.expectOne(statusUrl).flush({}, { status: 503, statusText: 'Unavailable' });

    expect(component.telegramLinked()).toBeNull();
    expect(component.telegramMessage()).toContain('Não foi possível consultar');
  });

  it('ignores an outstanding response after removing the sync token', () => {
    component.ngOnInit();
    const request = http.expectOne(statusUrl);
    component.unlinkSyncToken();
    request.flush({ linked: true });

    expect(component.telegramLinked()).toBeNull();
  });
});