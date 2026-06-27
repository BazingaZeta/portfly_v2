import { NextResponse } from "next/server";
import { getSellTrades } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sells = getSellTrades();

  const closed = sells.map((t) => {
    const realized = t.realizedPnl ?? 0;
    const proceeds = t.price * t.shares;
    const costBasis = proceeds - realized;
    const returnPct = costBasis > 0 ? (realized / costBasis) * 100 : 0;
    return {
      id: t.id,
      ticker: t.ticker,
      shares: t.shares,
      price: t.price,
      executedAt: t.executedAt,
      realized: +realized.toFixed(2),
      returnPct: +returnPct.toFixed(2),
    };
  });

  const count = closed.length;
  const totalRealized = +closed.reduce((s, c) => s + c.realized, 0).toFixed(2);
  const wins = closed.filter((c) => c.realized > 0).length;
  const losses = closed.filter((c) => c.realized < 0).length;
  const winRate = count ? +((wins / count) * 100).toFixed(1) : 0;
  const avgReturn = count
    ? +(closed.reduce((s, c) => s + c.returnPct, 0) / count).toFixed(2)
    : 0;
  const best = closed.reduce(
    (b, c) => (b == null || c.realized > b.realized ? c : b),
    null as (typeof closed)[number] | null
  );
  const worst = closed.reduce(
    (w, c) => (w == null || c.realized < w.realized ? c : w),
    null as (typeof closed)[number] | null
  );

  return NextResponse.json({
    summary: { count, totalRealized, wins, losses, winRate, avgReturn, best, worst },
    closed,
  });
}
