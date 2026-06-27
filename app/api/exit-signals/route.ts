import { NextResponse } from "next/server";
import { getOpenBuyTrades } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { fetchCandles, fetchQuotes } from "@/lib/marketData";
import { fetchTickerNews } from "@/lib/news";
import { computeExitSignals, type ExitSignal } from "@/lib/exits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-evaluates open positions and returns exit signals per ticker.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const openBuys = getOpenBuyTrades(session.userId);
  const tickers = [...new Set(openBuys.map((t) => t.ticker))];
  if (tickers.length === 0) return NextResponse.json({ signals: [] });

  const prices = await fetchQuotes(tickers);

  const all: ExitSignal[] = [];
  await Promise.all(
    tickers.map(async (ticker) => {
      const buys = openBuys
        .filter((b) => b.ticker === ticker)
        .sort((a, b) => a.executedAt.localeCompare(b.executedAt));
      const entryDate = buys[0].executedAt.slice(0, 10);
      const entryPrice =
        buys.reduce((s, b) => s + b.shares * b.price, 0) /
        buys.reduce((s, b) => s + b.shares, 0);
      const [candles, news] = await Promise.all([
        fetchCandles(ticker),
        fetchTickerNews(ticker, 6),
      ]);
      if (!candles.length) return;
      const currentPrice = prices[ticker] ?? candles[candles.length - 1].close;
      all.push(
        ...computeExitSignals({ ticker, entryDate, entryPrice, currentPrice, candles, news })
      );
    })
  );

  return NextResponse.json({ signals: all });
}
