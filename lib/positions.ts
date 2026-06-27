import type { Trade, Position } from "./types";

/**
 * Aggregate open BUY trades into positions and compute live P&L
 * against a map of current prices.
 */
export function computePositions(
  openBuys: Trade[],
  prices: Record<string, number>
): Position[] {
  const byTicker = new Map<string, Trade[]>();
  for (const t of openBuys) {
    const arr = byTicker.get(t.ticker) ?? [];
    arr.push(t);
    byTicker.set(t.ticker, arr);
  }

  const positions: Position[] = [];
  for (const [ticker, trades] of byTicker) {
    const shares = trades.reduce((s, t) => s + t.shares, 0);
    if (shares <= 0) continue;
    const costBasis = trades.reduce((s, t) => s + t.shares * t.price, 0);
    const avgCost = costBasis / shares;
    const currentPrice = prices[ticker] ?? avgCost;
    const marketValue = shares * currentPrice;
    const unrealizedPnl = marketValue - costBasis;
    positions.push({
      ticker,
      shares,
      avgCost: +avgCost.toFixed(2),
      currentPrice: +currentPrice.toFixed(2),
      marketValue: +marketValue.toFixed(2),
      costBasis: +costBasis.toFixed(2),
      unrealizedPnl: +unrealizedPnl.toFixed(2),
      unrealizedPnlPct: costBasis ? +((unrealizedPnl / costBasis) * 100).toFixed(2) : 0,
      openTradeIds: trades.map((t) => t.id),
    });
  }
  positions.sort((a, b) => b.marketValue - a.marketValue);
  return positions;
}
