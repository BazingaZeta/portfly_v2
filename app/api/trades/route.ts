import { NextRequest, NextResponse } from "next/server";
import {
  getAllTrades,
  getOpenBuyTrades,
  insertTrade,
  markTradeClosed,
  getRecommendationById,
  getOpenIndexBuys,
  getOpenMomentumBuys,
} from "@/lib/db";
import { getSession } from "@/lib/auth";
import { fetchQuotes } from "@/lib/marketData";
import { computePositions, computeIndexPositions } from "@/lib/positions";
import type { Action } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const userId = session.userId;

  // Fetch open buys from all sources in parallel
  const [trades, openBuys, openIndex, openMomentum] = await Promise.all([
    getAllTrades(userId),
    getOpenBuyTrades(userId),
    getOpenIndexBuys(userId),
    getOpenMomentumBuys(userId),
  ]);

  // Collect all unique tickers for live price fetch
  const allTickers = [
    ...new Set([
      ...openBuys.map((t) => t.ticker),
      ...openIndex.map((t) => t.ticker),
      ...openMomentum.map((t) => t.ticker),
    ]),
  ];
  const prices = allTickers.length ? await fetchQuotes(allTickers) : {};

  // Build positions per source
  const mainPositions = computePositions(openBuys, prices);
  const indexPositions = computeIndexPositions(openIndex, prices, "index");
  const momentumPositions = computeIndexPositions(openMomentum, prices, "momentum");

  // Enrich main positions with target/stop from open buy trades
  for (const pos of mainPositions) {
    const buys = openBuys
      .filter((b) => b.ticker === pos.ticker && b.target != null)
      .sort((a, b) => b.executedAt.localeCompare(a.executedAt));
    if (buys[0]) {
      pos.recommendationId = buys[0].recommendationId;
      pos.target = buys[0].target;
      pos.stop = buys[0].stop;
    }
  }

  // Merge all positions, sorted by market value descending
  const positions = [...mainPositions, ...indexPositions, ...momentumPositions]
    .sort((a, b) => b.marketValue - a.marketValue);

  return NextResponse.json({ trades, positions });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const userId = session.userId;

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
    const rec = recId != null ? await getRecommendationById(recId) : null;
    // Riancoraggio al PREZZO DI ESECUZIONE: i livelli assoluti dello scan
    // (stop = scanPrice − 1,5·ATR, target = scanPrice + 2,5·ATR) diventano
    // stantii se compri a un prezzo diverso da quello dello scan — es. sotto lo
    // stop → "stop colpito" appena comprato pur essendo in profit. Preserviamo le
    // DISTANZE percentuali della raccomandazione e le riapplichiamo all'entry reale.
    let target: number | null = null;
    let stop: number | null = null;
    if (rec && rec.price > 0) {
      const stopPct = (rec.price - rec.stop) / rec.price;     // frazione sotto l'entry
      const targetPct = (rec.target - rec.price) / rec.price; // frazione sopra l'entry
      if (stopPct > 0) stop = +(price * (1 - stopPct)).toFixed(2);
      if (targetPct > 0) target = +(price * (1 + targetPct)).toFixed(2);
    }
    const trade = await insertTrade({
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
      target,
      stop,
    }, userId);
    return NextResponse.json({ trade });
  }

  // SELL: close open BUY positions for this ticker, record realized P&L.
  const openBuys = (await getOpenBuyTrades(userId)).filter((t) => t.ticker === ticker);
  const closedShares = openBuys.reduce((s, b) => s + b.shares, 0);
  const costBasis = openBuys.reduce((s, b) => s + b.shares * b.price, 0);
  // Realized = proceeds on the shares actually closed minus their cost basis.
  const sharesSold = Math.min(shares, closedShares) || closedShares;
  const realizedPnl =
    closedShares > 0
      ? +(price * closedShares - costBasis).toFixed(2)
      : null;

  for (const b of openBuys) await markTradeClosed(b.id);

  const trade = await insertTrade({
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
  }, userId);
  return NextResponse.json({ trade, closed: openBuys.length, realizedPnl });
}
