export function calculateDynamicStopPercent(
  sellPrice: number,
  tradingDays: number,
  gamma: number,
  nv: number,
  realized: number
): number {
  if (sellPrice <= 0) return 25;

  const gammaValue = Math.abs(gamma ?? 0);
  const tradingDaysValue = Math.max(0, tradingDays ?? 0);

  const gammaAdj = Math.max(0, Math.min(8, gammaValue * 24));
  const dteAdj = tradingDaysValue <= 5 ? 8 : tradingDaysValue <= 10 ? 6 : tradingDaysValue <= 20 ? 3 : 0;
  const nvAdj = nv < 0 ? 6 : nv < 0.2 ? 3 : 0;
  const timeAdj = tradingDaysValue >= 25 ? 4 : tradingDaysValue >= 15 ? 2 : 0;
  const profitAdj = realized >= 50 ? 2 : realized <= -10 ? -2 : 0;

  let stopPct = 25 - gammaAdj - dteAdj - nvAdj + timeAdj + profitAdj;
  stopPct = Math.min(32, Math.max(18, stopPct));

  return Number(stopPct.toFixed(1));
}
