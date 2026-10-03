import { describe, expect, it } from 'vitest';
import { mergeRemoteSoldOptions, SoldOption, SoldOptionsService } from './sold-options.service';

const createSoldOption = (overrides: Partial<SoldOption> = {}): SoldOption => ({
  id: 'position-1',
  optionTicker: 'PETRJ563',
  stockTicker: 'PETR4',
  strike: 56.36,
  sellPrice: 0.46,
  sellDate: '2026-09-01T12:00:00.000Z',
  expiration: new Date('2026-10-16T00:00:00.000Z'),
  tradingDays: 14,
  nv: 0.11,
  ve: 0.2,
  vdxx: 1.5,
  lastroPercent: 16.06,
  bbosi: 47.02,
  stockPrice: 48.56,
  optionPrice: 0.21,
  gamma: 0.03,
  lastRefresh: '2026-09-28T13:00:00.000Z',
  marketDataTime: '2026-09-28T12:57:00.000Z',
  ...overrides,
});

describe('SoldOptionsService stop logic', () => {
  it('keeps the stop at 25% regardless of gamma, DTE, NV or captured profit', () => {
    for (const overrides of [
      { tradingDays: 3, gamma: 0.35, nv: -0.1, optionPrice: 0.6 },
      { tradingDays: 25, gamma: 0.08, nv: 0.4, optionPrice: 0.2 },
      { sellPrice: 0 },
    ]) {
      expect(SoldOptionsService.prototype.getStopPercent(createSoldOption(overrides))).toBe(25);
    }
  });

  it('does not trigger a stop below 125% of the sell price', () => {
    const signal = SoldOptionsService.prototype.getRollSignal(createSoldOption({
      sellPrice: 1, optionPrice: 1.249,
    }));

    expect(signal.shouldRoll).toBe(false);
  });

  it('triggers the fixed stop at and above 125% of the sell price', () => {
    for (const optionPrice of [1.25, 1.251]) {
      const signal = SoldOptionsService.prototype.getRollSignal(createSoldOption({
        sellPrice: 1, optionPrice,
      }));

      expect(signal.shouldRoll).toBe(true);
      expect(signal.reason).toContain('Stop fixo atingido (25%)');
      expect(signal.severity).toBe('danger');
    }
  });
});

describe('mergeRemoteSoldOptions', () => {
  it('preserves current market data while applying persisted position changes', () => {
    const current = createSoldOption();
    const staleRemote = createSoldOption({
      sellPrice: 0.5,
      stockPrice: 47.99,
      optionPrice: 0.18,
      nv: 0.09,
      bbosi: 46.21,
      marketDataTime: '2026-09-28T12:47:00.000Z',
    });

    const [merged] = mergeRemoteSoldOptions([staleRemote], [current]);

    expect(merged.sellPrice).toBe(0.5);
    expect(merged.stockPrice).toBe(current.stockPrice);
    expect(merged.optionPrice).toBe(current.optionPrice);
    expect(merged.nv).toBe(current.nv);
    expect(merged.bbosi).toBe(current.bbosi);
    expect(merged.marketDataTime).toBe(current.marketDataTime);
  });
});
