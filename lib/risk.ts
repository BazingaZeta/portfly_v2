// Risk & position-sizing helpers. Pure functions, used on client and in backtest.

export interface PositionSize {
  shares: number; // suggested quantity (fractional allowed)
  dollarRisk: number; // amount risked if stop is hit
  cost: number; // capital deployed (shares * entry)
  riskPerShare: number; // entry - stop
  capped: boolean; // true if limited by available capital rather than risk
}

/**
 * Size a position so that hitting the stop loses `riskPct`% of the account.
 * shares = (account * risk%) / (entry - stop), capped so cost ≤ account.
 */
export function positionSize(
  accountSize: number,
  riskPct: number,
  entry: number,
  stop: number
): PositionSize | null {
  const riskPerShare = entry - stop;
  if (!(riskPerShare > 0) || !(entry > 0) || !(accountSize > 0)) return null;
  const dollarRisk = (accountSize * riskPct) / 100;
  let shares = dollarRisk / riskPerShare;
  let capped = false;
  if (shares * entry > accountSize) {
    shares = accountSize / entry; // can't deploy more than you have
    capped = true;
  }
  return {
    shares: +shares.toFixed(shares >= 10 ? 2 : 4),
    dollarRisk: +dollarRisk.toFixed(2),
    cost: +(shares * entry).toFixed(2),
    riskPerShare: +riskPerShare.toFixed(2),
    capped,
  };
}

/** Open risk to stop for a held position (how much you'd lose if stopped now). */
export function openRisk(
  shares: number,
  reference: number, // current price or avg cost
  stop: number | null | undefined
): number {
  if (stop == null) return 0;
  return Math.max(0, (reference - stop) * shares);
}

/** Total open risk across a set of positions (sum of per-position risk-to-stop). */
export function portfolioOpenRisk(
  positions: { shares: number; reference: number; stop: number | null | undefined }[]
): number {
  return positions.reduce((s, p) => s + openRisk(p.shares, p.reference, p.stop), 0);
}

/**
 * Cap the size of a new position so that total portfolio risk-to-stop
 * (existing open risk + this trade's risk) does not exceed `maxPortfolioPct`%
 * of equity. Returns the allowed share count (0 if no budget is left).
 * Correlation between positions isn't modelled — this is a hard aggregate
 * ceiling, the first line of defence against stacking many correlated longs.
 */
export function riskCappedShares(
  desiredShares: number,
  riskPerShare: number,
  equity: number,
  currentOpenRisk: number,
  maxPortfolioPct: number
): number {
  if (!(riskPerShare > 0) || !(equity > 0)) return 0;
  const budget = (equity * maxPortfolioPct) / 100 - currentOpenRisk;
  if (budget <= 0) return 0;
  const maxByRisk = budget / riskPerShare;
  return Math.max(0, Math.min(desiredShares, maxByRisk));
}
