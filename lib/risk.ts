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
