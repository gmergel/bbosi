import { describe, expect, it } from 'vitest';
import { calculateDynamicStopPercent } from '../utils/dynamic-stop';
import { mergeRemoteSoldOptions, SoldOption } from './sold-options.service';

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
  it('should tighten the stop for high gamma and short DTE', () => {
    const stop = calculateDynamicStopPercent(10, 3, 0.35, -0.1, 0);

    expect(stop).toBeLessThan(20);
    expect(stop).toBeGreaterThanOrEqual(15);
  });

  it('should keep a broader stop for calmer positions', () => {
    const stop = calculateDynamicStopPercent(10, 25, 0.08, 0.4, 0);

    expect(stop).toBeGreaterThanOrEqual(23);
    expect(stop).toBeLessThanOrEqual(35);
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
