import { NextRequest, NextResponse } from "next/server";
import {
  getMomentumTrades,
  getOpenMomentumBuys,
  insertIndexTrade,
  markIndexTradeClosed,
} from "@/lib/db";
import { getSession } from "@/lib/auth";
import { fetchQuotes } from "@/lib/marketData";
import type { Action } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const userId = session.userId;

  const trades = await getMomentumTrades(userId);
  const openBuys = await getOpenMomentumBuys(userId);
  const tickers = [...new Set(openBuys.map((t) => t.ticker))];
  const prices = tickers.length ? await fetchQuotes(tickers) : {};

  // Aggregate open buys per ticker into positions with live P&L
  const byTicker = new Map<string, typeof openBuys>();
  for (const b of openBuys) {
    const arr = byTicker.get(b.ticker) ?? [];
    arr.push(b);
    byTicker.set(b.ticker, arr);
  }

  const positions = [...byTicker.entries()].map(([ticker, buys]) => {
    const shares = buys.reduce((s, b) => s + b.shares, 0);
    const costBasis = buys.reduce((s, b) => s + b.shares * b.price, 0);
    const avgCost = costBasis / shares;
    const currentPrice = prices[ticker] ?? avgCost;
    const marketValue = shares * currentPrice;
    const unrealizedPnl = marketValue - costBasis;
    const latest = buys[buys.length - 1];
    return {
      indexKey: latest.indexKey,
      ticker,
      name: latest.name,
      shares: +shares.toFixed(4),
      avgCost: +avgCost.toFixed(2),
      currentPrice: +currentPrice.toFixed(2),
      marketValue: +marketValue.toFixed(2),
      costBasis: +costBasis.toFixed(2),
      unrealizedPnl: +unrealizedPnl.toFixed(2),
      unrealizedPnlPct: costBasis ? +((unrealizedPnl / costBasis) * 100).toFixed(2) : 0,
      stop: latest.stop,
      target: latest.target,
      stopHit: latest.stop != null && currentPrice <= latest.stop,
      targetHit: latest.target != null && currentPrice >= latest.target,
    };
  });
  positions.sort((a, b) => b.marketValue - a.marketValue);

  // Performance summary from closed trades
  const closed = trades.filter((t) => t.action === "SELL" && t.realizedPnl != null);
  const totalPnl = closed.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
  const wins = closed.filter((t) => (t.realizedPnl ?? 0) > 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : null;

  return NextResponse.json({ trades, positions, totalPnl: +totalPnl.toFixed(2), winRate });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const userId = session.userId;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  const action = body.action as Action;
  const ticker = String(body.ticker ?? "").toUpperCase().trim();
  const shares = Number(body.shares);
  const price = Number(body.price);
  const indexKey = `MOMENTUM_${String(body.indexKey ?? "SP500")}`;

  if (!ticker || (action !== "BUY" && action !== "SELL")) {
    return NextResponse.json({ error: "ticker/action non validi" }, { status: 400 });
  }
  if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: "shares/price devono essere > 0" }, { status: 400 });
  }

  const executedAt = new Date().toISOString();

  if (action === "BUY") {
    const trade = await insertIndexTrade(
      {
        indexKey,
        ticker,
        name: String(body.name ?? ticker),
        action: "BUY",
        shares,
        price,
        executedAt,
        status: "open",
        notes: body.notes ?? null,
        target: body.target != null ? Number(body.target) : null,
        stop: body.stop != null ? Number(body.stop) : null,
        realizedPnl: null,
      },
      userId
    );
    return NextResponse.json({ trade });
  }

  // SELL: close all open buys for this ticker in the momentum section
  const openBuys = (await getOpenMomentumBuys(userId)).filter((t) => t.ticker === ticker);
  const closedShares = openBuys.reduce((s, b) => s + b.shares, 0);
  const costBasis = openBuys.reduce((s, b) => s + b.shares * b.price, 0);
  const realizedPnl = closedShares > 0 ? +(price * closedShares - costBasis).toFixed(2) : null;
  for (const b of openBuys) await markIndexTradeClosed(b.id);

  const trade = await insertIndexTrade(
    {
      indexKey: openBuys[0]?.indexKey ?? indexKey,
      ticker,
      name: openBuys[0]?.name ?? ticker,
      action: "SELL",
      shares: closedShares || shares,
      price,
      executedAt,
      status: "closed",
      notes: body.notes ?? null,
      target: null,
      stop: null,
      realizedPnl,
    },
    userId
  );

  return NextResponse.json({ trade, closed: openBuys.length, realizedPnl });
}
