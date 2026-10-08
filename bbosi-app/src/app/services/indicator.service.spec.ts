import { describe, expect, it } from 'vitest';
import { OptionWithGreeks } from './market-data.service';
import { IndicatorService } from './indicator.service';

const makeOption = (overrides: Partial<OptionWithGreeks> = {}): OptionWithGreeks => ({
  ticker: 'PETRJ563',
  strike: 105,
  expiration: new Date('2026-11-20T00:00:00.000Z'),
  tradingDays: 30,
  price: 2,
  trades: 10,
  volume: 1000,
  tradePercent: 0,
  impliedVol: 0.3,
  delta: 0.2,
  gamma: 0.01,
  theta: -0.01,
  vega: 0.1,
  moneyness: 'OTM',
  distancePercent: 5,
  premiumPercent: 2,
  tradesAreReal: true,
  ...overrides,
});

const calculate = (options: OptionWithGreeks[]) => {
  const service = Object.create(IndicatorService.prototype) as IndicatorService;
  return service.calculateGerBosiByExpiration(options, 100);
};

describe('GerBOSI by expiration', () => {
  it('calculates a separate weighted center for each expiration', () => {
    const snapshots = calculate([
      makeOption({ strike: 105, price: 2, trades: 10 }),
      makeOption({ strike: 110, price: 4, trades: 5 }),
      makeOption({
        ticker: 'PETRL563',
        strike: 120,
        price: 1,
        trades: 3,
        expiration: new Date('2026-12-18T00:00:00.000Z'),
        tradingDays: 50,
      }),
    ]);

    expect(snapshots.map(snapshot => snapshot.value)).toEqual([107.5, 120]);
    expect(snapshots.map(snapshot => snapshot.trades)).toEqual([15, 3]);
  });

  it('ignores synthetic trade counts and reports no value without real trading activity', () => {
    const withRealActivity = calculate([
      makeOption({ strike: 105, trades: 10 }),
      makeOption({ strike: 200, trades: 1000, tradesAreReal: false }),
    ]);
    const withoutRealActivity = calculate([
      makeOption({ trades: 1000, tradesAreReal: false }),
    ]);

    expect(withRealActivity[0].value).toBe(105);
    expect(withRealActivity[0].trades).toBe(10);
    expect(withoutRealActivity[0].value).toBeNull();
    expect(withoutRealActivity[0].trades).toBe(0);
  });
});