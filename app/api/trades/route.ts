import { NextRequest, NextResponse } from "next/server";
import {
  getAllTrades,
  getOpenBuyTrades,
  insertTrade,
  markTradeClosed,
  getRecommendationById,
} from "@/lib/db";
import { fetchQuotes } from "@/lib/marketData";
import { computePositions } from "@/lib/positions";
import type { Action } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const trades = getAllTrades();
  const openBuys = getOpenBuyTrades();
  const tickers = [...new Set(openBuys.map((t) => t.ticker))];
  const prices = tickers.length ? await fetchQuotes(tickers) : {};
  const positions = computePositions(openBuys, prices);

  // Enrich each position with target/stop snapshotted on its open buy trades
  // (most recent buy that carries them). Independent of the recommendation,
  // so it survives re-scans.
  for (const pos of positions) {
    const buys = openBuys
      .filter((b) => b.ticker === pos.ticker && b.target != null)
      .sort((a, b) => b.executedAt.localeCompare(a.executedAt));
    if (buys[0]) {
      pos.recommendationId = buys[0].recommendationId;
      pos.target = buys[0].target;
      pos.stop = buys[0].stop;
    }
  }

  return NextResponse.json({ trades, positions });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  const action = body.action as Action;
  const ticker = String(body.ticker ?? "").toUpperCase().trim();
  const shares = Number(body.shares);
  const price = Number(body.price);

  if (!ticker || (action !== "BUY" && action !== "SELL")) {
    return NextResponse.json({ error: "ticker/action mancanti o non validi" }, { status: 400 });
  }
  if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: "shares/price devono essere > 0" }, { status: 400 });
  }

  const executedAt = body.executedAt ? new Date(body.executedAt).toISOString() : new Date().toISOString();

  if (action === "BUY") {
    // Snapshot target/stop from the recommendation so the position keeps them
    // even after the recommendation is replaced by a later scan.
    const recId = body.recommendationId ? Number(body.recommendationId) : null;
    const rec = recId != null ? getRecommendationById(recId) : null;
    const trade = insertTrade({
      recommendationId: recId,
      ticker,
      action: "BUY",
      shares,
      price,
      executedAt,
      status: "open",
      notes: body.notes ?? null,
      closesTradeId: null,
      realizedPnl: null,
      target: rec?.target ?? null,
      stop: rec?.stop ?? null,
    });
    return NextResponse.json({ trade });
  }

  // SELL: close open BUY positions for this ticker, record realized P&L.
  const openBuys = getOpenBuyTrades().filter((t) => t.ticker === ticker);
  const closedShares = openBuys.reduce((s, b) => s + b.shares, 0);
  const costBasis = openBuys.reduce((s, b) => s + b.shares * b.price, 0);
  // Realized = proceeds on the shares actually closed minus their cost basis.
  const sharesSold = Math.min(shares, closedShares) || closedShares;
  const realizedPnl =
    closedShares > 0
      ? +(price * closedShares - costBasis).toFixed(2)
      : null;

  for (const b of openBuys) markTradeClosed(b.id);

  const trade = insertTrade({
    recommendationId: body.recommendationId ? Number(body.recommendationId) : null,
    ticker,
    action: "SELL",
    shares: sharesSold,
    price,
    executedAt,
    status: "closed",
    notes: body.notes ?? null,
    closesTradeId: openBuys[0]?.id ?? null,
    realizedPnl,
    target: null,
    stop: null,
  });
  return NextResponse.json({ trade, closed: openBuys.length, realizedPnl });
}
