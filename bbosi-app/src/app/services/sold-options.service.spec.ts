import { describe, expect, it } from 'vitest';
import { calculateDynamicStopPercent } from '../utils/dynamic-stop';

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
