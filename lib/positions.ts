import type { Trade, IndexTrade, Position } from "./types";

function buildPositions(
  openBuys: (Trade | IndexTrade)[],
  prices: Record<string, number>,
  source: "main" | "index" | "momentum",
): Position[] {
  const byTicker = new Map<string, (Trade | IndexTrade)[]>();
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

    const first = trades[0] as IndexTrade;
    const pos: Position = {
      ticker,
      name: source !== "main" ? first.name : undefined,
      shares,
      avgCost: +avgCost.toFixed(2),
      currentPrice: +currentPrice.toFixed(2),
      marketValue: +marketValue.toFixed(2),
      costBasis: +costBasis.toFixed(2),
      unrealizedPnl: +unrealizedPnl.toFixed(2),
      unrealizedPnlPct: costBasis ? +((unrealizedPnl / costBasis) * 100).toFixed(2) : 0,
      openTradeIds: trades.map((t) => t.id),
      source,
      indexKey: source !== "main" ? first.indexKey : undefined,
      target: source !== "main" ? first.stop : null, // will be overridden
      stop: source !== "main" ? first.stop : null,
    };

    // For index/momentum: use last trade's target/stop
    if (source !== "main") {
      const latest = trades[trades.length - 1] as IndexTrade;
      pos.target = latest.target;
      pos.stop = latest.stop;
    }

    positions.push(pos);
  }
  positions.sort((a, b) => b.marketValue - a.marketValue);
  return positions;
}

/**
 * Aggregate open BUY trades into positions and compute live P&L
 * against a map of current prices.
 */
export function computePositions(
  openBuys: Trade[],
  prices: Record<string, number>
): Position[] {
  return buildPositions(openBuys, prices, "main");
}

/**
 * Build positions from index/momentum trades.
 */
export function computeIndexPositions(
  openBuys: IndexTrade[],
  prices: Record<string, number>,
  source: "index" | "momentum"
): Position[] {
  return buildPositions(openBuys, prices, source);
}

