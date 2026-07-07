import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAllTrades, getIndexTrades, getMomentumTrades } from "@/lib/db";
import { getAutoEquityCurve } from "@/lib/autopilotEngine";
import { fetchCandles } from "@/lib/marketData";
import type { Candle } from "@/lib/types";
import {
  replayEquity,
  type ReplayTrade,
  type EquityPoint,
  type EquitySeries,
} from "@/lib/portfolioEquity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StrategyEquity extends EquitySeries {
  key: string;
  label: string;
}

/** Anni di storico da scaricare in base allo span coperto dai trade. */
function yearsForSpan(earliest: string): 1 | 2 | 5 {
  const start = new Date(earliest).getTime();
  const spanYears = (Date.now() - start) / (365 * 24 * 60 * 60 * 1000);
  if (spanYears <= 1) return 1;
  if (spanYears <= 2) return 2;
  return 5;
}

/** Ricostruisce la serie di equity di un portafoglio manuale dai suoi trade. */
async function replayFromTrades(
  key: string,
  label: string,
  trades: ReplayTrade[],
  benchCandles: Candle[],
): Promise<StrategyEquity> {
  if (trades.length === 0) return { key, label, points: [], summary: null };

  const earliest = trades.reduce(
    (min, t) => (t.executedAt < min ? t.executedAt : min),
    trades[0].executedAt,
  );
  const years = yearsForSpan(earliest);
  const tickers = [...new Set(trades.map((t) => t.ticker))];

  const candlesByTicker: Record<string, Candle[]> = {};
  await Promise.all(
    tickers.map(async (tk) => {
      candlesByTicker[tk] = await fetchCandles(tk, years);
    }),
  );

  const series = replayEquity(trades, candlesByTicker, benchCandles);
  return { key, label, ...series };
}

/** Converte la curva di equity reale dell'autopilot nella stessa forma. */
function curveToSeries(
  key: string,
  label: string,
  curve: { date: string; equity: number }[],
  benchCandles: Candle[],
): StrategyEquity {
  if (curve.length === 0) return { key, label, points: [], summary: null };

  const startValue = curve[0].equity;
  const benchByDate = new Map(benchCandles.map((c) => [c.date, c.close]));
  const benchStart =
    benchByDate.get(curve[0].date) ??
    benchCandles.find((c) => c.date >= curve[0].date)?.close ??
    null;

  const points: EquityPoint[] = [];
  let peak = -Infinity;
  let maxDd = 0;
  let benchLastRaw: number | null = null;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    const dd = peak > 0 ? (peak - p.equity) / peak : 0;
    maxDd = Math.max(maxDd, dd);
    const bc = benchByDate.get(p.date) ?? null;
    if (bc != null) benchLastRaw = bc;
    const bench =
      benchStart && benchStart > 0 && benchLastRaw != null
        ? +(startValue * (benchLastRaw / benchStart)).toFixed(2)
        : null;
    points.push({
      date: p.date,
      value: +p.equity.toFixed(2),
      invested: +startValue.toFixed(2),
      drawdownPct: +(dd * 100).toFixed(2),
      bench,
    });
  }

  const current = curve[curve.length - 1].equity;
  const benchReturnPct =
    benchStart && benchStart > 0 && benchLastRaw != null
      ? +(((benchLastRaw - benchStart) / benchStart) * 100).toFixed(2)
      : null;

  return {
    key,
    label,
    points,
    summary: {
      startValue,
      currentValue: current,
      totalReturnPct: startValue > 0 ? +(((current - startValue) / startValue) * 100).toFixed(2) : 0,
      maxDrawdownPct: +(maxDd * 100).toFixed(2),
      benchReturnPct,
    },
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const userId = session.userId;

  const [mainTrades, indexTrades, momentumTrades, autoCurve] = await Promise.all([
    getAllTrades(userId),
    getIndexTrades(userId),
    getMomentumTrades(userId),
    getAutoEquityCurve().catch(() => []),
  ]);

  // Index Trader = index_trades che NON appartengono alla sezione Momentum.
  const indexOnly = indexTrades.filter((t) => !t.indexKey.startsWith("MOMENTUM_"));

  // Benchmark condiviso: 5 anni di SPY coprono qualsiasi span di questi portafogli.
  const benchCandles = await fetchCandles("SPY", 5);

  const strategies = await Promise.all([
    replayFromTrades("sentiment", "Sentiment Analysis", mainTrades, benchCandles),
    replayFromTrades("momentum", "Momentum RS", momentumTrades, benchCandles),
    replayFromTrades("index", "Index Trader", indexOnly, benchCandles),
    Promise.resolve(curveToSeries("autopilot", "Autopilot", autoCurve, benchCandles)),
  ]);

  return NextResponse.json({ strategies });
}
