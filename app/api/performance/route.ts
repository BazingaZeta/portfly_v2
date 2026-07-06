import { NextResponse } from "next/server";
import { getSellTrades, getMomentumTrades, countSentimentHistoryDays } from "@/lib/db";
import { getAutoEquityCurve, getAutoStateRow } from "@/lib/autopilotEngine";
import { fetchCandles } from "@/lib/marketData";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Riferimenti dai backtest validati (walk-forward). Servono come metro per il
// reality check: se il realizzato diverge a lungo da questi numeri, o il mercato
// è cambiato o il backtest era ottimista (survivorship). Aggiornali quando
// rivalidi le strategie.
const BACKTEST_REFS = {
  sentiment: { pf: 1.32, winRate: 45, note: "backtest soglia 70 + cap rischio 3%, 4,5 anni WF" },
  momentum: { pf: 1.31, winRate: 44, note: "backtest v3 (trail+trend exit), 2021-26 WF5" },
};

interface RealizedStats {
  count: number;
  winRate: number | null;
  profitFactor: number | null;
  totalRealized: number;
}

function realizedStats(rows: { realized: number }[]): RealizedStats {
  const count = rows.length;
  if (!count) return { count: 0, winRate: null, profitFactor: null, totalRealized: 0 };
  const wins = rows.filter((r) => r.realized > 0);
  const grossWin = wins.reduce((s, r) => s + r.realized, 0);
  const grossLoss = Math.abs(rows.filter((r) => r.realized < 0).reduce((s, r) => s + r.realized, 0));
  return {
    count,
    winRate: +((wins.length / count) * 100).toFixed(1),
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 999 : null,
    totalRealized: +rows.reduce((s, r) => s + r.realized, 0).toFixed(2),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const sells = await getSellTrades(session.userId);

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

  // ── Reality check: realizzato vs riferimenti dei backtest ──────────────────
  const [momentumRows, autoCurve, autoState, sentimentDays] = await Promise.all([
    getMomentumTrades(session.userId),
    getAutoEquityCurve().catch(() => []),
    getAutoStateRow().catch(() => null),
    countSentimentHistoryDays().catch(() => 0),
  ]);

  const momentumClosed = momentumRows
    .filter((t) => t.action === "SELL" && t.realizedPnl != null)
    .map((t) => ({ realized: t.realizedPnl! }));

  // Autopilot vs SPY sulla stessa finestra (dal primo snapshot di equity).
  let autopilot: {
    days: number;
    strategyReturn: number;
    spyReturn: number | null;
    maxDrawdown: number;
    startedAt: string | null;
  } | null = null;
  if (autoCurve.length >= 2) {
    const first = autoCurve[0];
    const last = autoCurve[autoCurve.length - 1];
    let peak = 0, maxDd = 0;
    for (const p of autoCurve) {
      peak = Math.max(peak, p.equity);
      if (peak > 0) maxDd = Math.max(maxDd, (peak - p.equity) / peak);
    }
    let spyReturn: number | null = null;
    const spy = await fetchCandles("SPY", 1);
    const closes = new Map(spy.map((c) => [c.date, c.close]));
    const spyStart = closes.get(first.date) ?? spy.find((c) => c.date >= first.date)?.close;
    const spyEnd = spy[spy.length - 1]?.close;
    if (spyStart && spyEnd) spyReturn = +(((spyEnd - spyStart) / spyStart) * 100).toFixed(2);
    autopilot = {
      days: autoCurve.length,
      strategyReturn: first.equity > 0 ? +(((last.equity - first.equity) / first.equity) * 100).toFixed(2) : 0,
      spyReturn,
      maxDrawdown: +(maxDd * 100).toFixed(1),
      startedAt: autoState?.started_at ?? null,
    };
  }

  return NextResponse.json({
    summary: { count, totalRealized, wins, losses, winRate, avgReturn, best, worst },
    closed,
    realityCheck: {
      sentiment: { realized: realizedStats(closed), ref: BACKTEST_REFS.sentiment },
      momentum: { realized: realizedStats(momentumClosed), ref: BACKTEST_REFS.momentum },
      autopilot,
      sentimentHistoryDays: sentimentDays,
      sentimentAbReady: sentimentDays >= 60,
    },
  });
}
