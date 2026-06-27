/**
 * Momentum RS Backtest Engine — v2
 * ==================================
 * Strategy: weekly scan of the index constituents, enter the top-N stocks
 * by composite RS score (RS_30d × 0.2 + RS_90d × 0.5 + RS_180d × 0.3) that
 * also have an ascending meta-stock (stock/SPY) regression channel.
 *
 * Rationale for weekly scan: daily signals on 80 tickers produce thousands of
 * redundant entries (same stock, consecutive bars). A weekly scan concentrates
 * capital in the real leaders and drastically reduces churn.
 *
 * Entry:  weekly scan → meta-channel ascending + minR2 filter → top topN by RS
 * Stop:   entry − stopAtr × ATR(14)
 * Target: entry + targetAtr × ATR(14)
 * Exit:   first of stop / target / maxHoldBars / stock drops out of top-N
 */

import type { Candle } from "./types";
import { indexByKey } from "./indices";
import { fetchCandles } from "./marketData";
import { regressionChannel } from "./regression";
import type { BacktestSummary, BacktestProgress } from "./backtest";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface MomentumBtOptions {
  indexKey: string;
  startDate: string;
  endDate: string;
  accountSize?: number;
  riskPct?: number;
  maxPositions?: number;   // max simultaneous open positions, default 5
  slippageBps?: number;
  metaWindow?: number;     // bars for meta-stock channel, default 60
  minMetaR2?: number;      // min R² for meta-channel, default 0.5
  stopAtr?: number;        // ATR multiple for stop, default 2
  targetAtr?: number;      // ATR multiple for target, default 3
  maxHoldBars?: number;    // max bars to hold (time stop), default 20
  scanFreq?: number;       // how often to scan (bars), default 5 (weekly)
  topN?: number;           // top stocks per scan by RS score, default 5
}

export interface MomentumBtResult {
  summary: BacktestSummary;
  equity: { date: string; equity: number }[];
  spyEquity: { date: string; equity: number }[];
  sharpe: number;
  calmar: number;
  trades: MomentumBtTrade[];
  signalsTotal: number;
  signalsTaken: number;
  tickersTested: number;
  options: Required<MomentumBtOptions>;
}

export interface MomentumBtTrade {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  shares: number;
  pnl: number;
  returnPct: number;
  rMultiple: number;
  outcome: "target" | "stop" | "time";
}

// ─── Internal types ────────────────────────────────────────────────────────────

interface TickerData {
  ticker: string;
  candles: Candle[];
  closes: number[];
  meta: number[];
  atrByIdx: number[];
}

interface OpenPosition {
  ticker: string;
  entryBar: number; // global bar index of entry
  entryDate: string;
  entryPrice: number;
  stop: number;
  target: number;
  rps: number;
  shares: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildMeta(closes: number[], candles: Candle[], spyByDate: Map<string, number>): number[] {
  return candles.map((c, i) => {
    const spy = spyByDate.get(c.date);
    return spy && spy > 0 ? closes[i] / spy : NaN;
  });
}

function atr14(candles: Candle[], idx: number): number {
  const period = 14;
  if (idx < period) return NaN;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    sum += Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  }
  return sum / period;
}

function metaReturn(meta: number[], endIdx: number, lookback: number): number | null {
  const startIdx = endIdx - lookback;
  if (startIdx < 0 || isNaN(meta[startIdx]) || meta[startIdx] === 0) return null;
  return ((meta[endIdx] - meta[startIdx]) / meta[startIdx]) * 100;
}

function rsScore(meta: number[], endIdx: number): number {
  const r30 = metaReturn(meta, endIdx, 30);
  const r90 = metaReturn(meta, endIdx, 90);
  const r180 = metaReturn(meta, endIdx, 180);
  let num = 0, den = 0;
  if (r30 !== null) { num += r30 * 0.2; den += 0.2; }
  if (r90 !== null) { num += r90 * 0.5; den += 0.5; }
  if (r180 !== null) { num += r180 * 0.3; den += 0.3; }
  return den > 0 ? num / den : -Infinity;
}

function sharpeFromReturns(returns: number[]): number {
  if (returns.length < 4) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  // Annualize: returns are per-trade, avg hold ~maxHoldBars days
  return +((mean / std) * Math.sqrt(252 / 15)).toFixed(2);
}

function sharpeFromEquityCurve(curve: { date: string; equity: number }[]): number {
  if (curve.length < 3) return 0;
  const dailyReturns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    dailyReturns.push((curve[i].equity - curve[i - 1].equity) / curve[i - 1].equity);
  }
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const std = Math.sqrt(dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length);
  if (std === 0) return 0;
  return +((mean / std) * Math.sqrt(252)).toFixed(2);
}

// ─── Pool helper ──────────────────────────────────────────────────────────────

async function pool<T, R>(items: T[], limit: number, fn: (i: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (idx < items.length) {
        const k = idx++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

// ─── SPY buy-and-hold ─────────────────────────────────────────────────────────

function buildSpyCurve(
  spyCandles: Candle[],
  startDate: string,
  endDate: string,
  accountSize: number
): { date: string; equity: number }[] {
  const filtered = spyCandles.filter((c) => c.date >= startDate && c.date <= endDate);
  if (filtered.length < 2) return [];
  const base = filtered[0].close;
  return filtered.map((c) => ({
    date: c.date,
    equity: +(accountSize * (c.close / base)).toFixed(2),
  }));
}

// ─── Main simulation ──────────────────────────────────────────────────────────

function simulate(
  allData: TickerData[],
  spyCandles: Candle[],
  opts: Required<MomentumBtOptions>
): {
  summary: BacktestSummary;
  equity: { date: string; equity: number }[];
  trades: MomentumBtTrade[];
  signalsTotal: number;
  signalsTaken: number;
} {
  const slip = opts.slippageBps / 10_000;

  // Build a sorted list of all unique trading dates in range
  const spyDates = spyCandles
    .filter((c) => c.date >= opts.startDate && c.date <= opts.endDate)
    .map((c) => c.date);

  if (spyDates.length === 0) {
    const empty: BacktestSummary = {
      trades: 0, wins: 0, losses: 0, winRate: 0, avgWin: 0, avgLoss: 0,
      profitFactor: 0, expectancy: 0, maxDrawdown: 0, totalReturn: 0,
      cagr: 0, finalEquity: opts.accountSize,
      byOutcome: { target: 0, stop: 0, time: 0 },
    };
    return { summary: empty, equity: [], trades: [], signalsTotal: 0, signalsTaken: 0 };
  }

  // For each ticker, build a date→bar-index map
  const tickerDateIdx = new Map<string, Map<string, number>>();
  for (const td of allData) {
    const m = new Map<string, number>();
    td.candles.forEach((c, i) => m.set(c.date, i));
    tickerDateIdx.set(td.ticker, m);
  }

  let equity = opts.accountSize;
  let peak = equity;
  let maxDd = 0;
  const curve: { date: string; equity: number }[] = [{ date: opts.startDate, equity }];

  const openPositions = new Map<string, OpenPosition>();
  const cooldown = new Map<string, number>(); // ticker → bar index until which it's in cooldown
  const takenTrades: MomentumBtTrade[] = [];
  let signalsTotal = 0;
  let signalsTaken = 0;

  const W = opts.metaWindow;

  for (let di = 0; di < spyDates.length; di++) {
    const date = spyDates[di];

    // 1. Update open positions: check stop/target/time
    for (const [ticker, pos] of openPositions) {
      const td = allData.find((d) => d.ticker === ticker);
      if (!td) continue;
      const barIdxMap = tickerDateIdx.get(ticker)!;
      const barIdx = barIdxMap.get(date);
      if (barIdx == null) continue;

      const bar = td.candles[barIdx];
      const barsHeld = di - openPositions.get(ticker)!.entryBar;

      let exitPrice: number | null = null;
      let outcome: MomentumBtTrade["outcome"] = "time";

      // Gap open through stop
      if (bar.open <= pos.stop) { exitPrice = bar.open; outcome = "stop"; }
      // Gap open through target
      else if (bar.open >= pos.target) { exitPrice = bar.open; outcome = "target"; }
      // Intrabar stop
      else if (bar.low <= pos.stop) { exitPrice = pos.stop; outcome = "stop"; }
      // Intrabar target
      else if (bar.high >= pos.target) { exitPrice = pos.target; outcome = "target"; }
      // Time stop
      else if (barsHeld >= opts.maxHoldBars) { exitPrice = bar.close; outcome = "time"; }

      if (exitPrice !== null) {
        const effExit = outcome === "stop" ? exitPrice : exitPrice * (1 - slip);
        const pnl = pos.shares * (effExit - pos.entryPrice);
        equity += pnl;
        peak = Math.max(peak, equity);
        maxDd = Math.max(maxDd, peak > 0 ? (peak - equity) / peak : 0);
        curve.push({ date, equity: +equity.toFixed(2) });
        const returnPct = ((effExit - pos.entryPrice) / pos.entryPrice) * 100;
        takenTrades.push({
          ticker,
          entryDate: pos.entryDate,
          entryPrice: pos.entryPrice,
          exitDate: date,
          exitPrice: effExit,
          shares: pos.shares,
          pnl: +pnl.toFixed(2),
          returnPct: +returnPct.toFixed(2),
          rMultiple: pos.rps > 0 ? +((effExit - pos.entryPrice) / pos.rps).toFixed(3) : 0,
          outcome,
        });
        openPositions.delete(ticker);
        cooldown.set(ticker, di + 5); // 5-bar cooldown after exit
      }
    }

    // 2. Weekly scan: only look for entries every scanFreq bars
    if (di % opts.scanFreq !== 0) continue;
    if (openPositions.size >= opts.maxPositions) continue;

    // Score all tickers at this date
    const candidates: { ticker: string; score: number; atr: number; price: number }[] = [];

    for (const td of allData) {
      if (openPositions.has(td.ticker)) continue;
      const until = cooldown.get(td.ticker) ?? 0;
      if (di < until) continue;

      const barIdxMap = tickerDateIdx.get(td.ticker)!;
      const barIdx = barIdxMap.get(date);
      if (barIdx == null || barIdx < W + 20) continue;

      // Meta-channel must be ascending
      const metaSlice = td.meta.slice(barIdx + 1 - W, barIdx + 1);
      if (metaSlice.some((v) => isNaN(v))) continue;
      const metaCh = regressionChannel(metaSlice, 2);
      if (!metaCh || metaCh.trend !== "asc" || metaCh.r2 < opts.minMetaR2) continue;

      signalsTotal++;

      const atr = td.atrByIdx[barIdx];
      if (!(atr > 0)) continue;

      const score = rsScore(td.meta, barIdx);
      if (!isFinite(score)) continue;

      const price = td.candles[barIdx].close;
      candidates.push({ ticker: td.ticker, score, atr, price });
    }

    // Take top-N by RS score
    candidates.sort((a, b) => b.score - a.score);
    const slots = opts.maxPositions - openPositions.size;
    const toEnter = candidates.slice(0, Math.min(slots, opts.topN));

    for (const c of toEnter) {
      const nextBarDate = spyDates[di + 1];
      if (!nextBarDate) continue;

      const barIdxMap = tickerDateIdx.get(c.ticker)!;
      const nextBarIdx = barIdxMap.get(nextBarDate);
      if (nextBarIdx == null) continue;

      const entryBar = allData.find((d) => d.ticker === c.ticker)!.candles[nextBarIdx];
      const entryPrice = entryBar.open * (1 + slip);
      if (!(entryPrice > 0)) continue;

      const stop = entryPrice - opts.stopAtr * c.atr;
      const target = entryPrice + opts.targetAtr * c.atr;
      const rps = entryPrice - stop;
      if (!(rps > 0)) continue;

      const committed = [...openPositions.values()].reduce((s, p) => s + p.shares * p.entryPrice, 0);
      const cash = equity - committed;
      if (cash <= 0) continue;

      let shares = (equity * (opts.riskPct / 100)) / rps;
      if (shares * entryPrice > cash) shares = cash / entryPrice;
      if (shares <= 0) continue;

      openPositions.set(c.ticker, {
        ticker: c.ticker,
        entryBar: di + 1,
        entryDate: nextBarDate,
        entryPrice,
        stop,
        target,
        rps,
        shares: +shares.toFixed(4),
      });
      signalsTaken++;
    }
  }

  // Close remaining open positions at endDate
  const lastDate = spyDates[spyDates.length - 1];
  for (const [ticker, pos] of openPositions) {
    const td = allData.find((d) => d.ticker === ticker);
    if (!td) continue;
    const barIdxMap = tickerDateIdx.get(ticker)!;
    const barIdx = barIdxMap.get(lastDate);
    if (barIdx == null) continue;
    const bar = td.candles[barIdx];
    const effExit = bar.close * (1 - slip);
    const pnl = pos.shares * (effExit - pos.entryPrice);
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak > 0 ? (peak - equity) / peak : 0);
    curve.push({ date: lastDate, equity: +equity.toFixed(2) });
    const returnPct = ((effExit - pos.entryPrice) / pos.entryPrice) * 100;
    takenTrades.push({
      ticker,
      entryDate: pos.entryDate,
      entryPrice: pos.entryPrice,
      exitDate: lastDate,
      exitPrice: effExit,
      shares: pos.shares,
      pnl: +pnl.toFixed(2),
      returnPct: +returnPct.toFixed(2),
      rMultiple: pos.rps > 0 ? +((effExit - pos.entryPrice) / pos.rps).toFixed(3) : 0,
      outcome: "time",
    });
  }

  const wins = takenTrades.filter((t) => t.pnl > 0);
  const losses = takenTrades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const years = (new Date(opts.endDate).getTime() - new Date(opts.startDate).getTime()) / (365.25 * 86_400_000);
  let cagr = 0;
  if (years > 0.05 && equity > 0) cagr = (Math.pow(equity / opts.accountSize, 1 / years) - 1) * 100;

  const summary: BacktestSummary = {
    trades: takenTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: takenTrades.length ? +((wins.length / takenTrades.length) * 100).toFixed(1) : 0,
    avgWin: wins.length ? +(wins.reduce((s, t) => s + t.returnPct, 0) / wins.length).toFixed(2) : 0,
    avgLoss: losses.length ? +(losses.reduce((s, t) => s + t.returnPct, 0) / losses.length).toFixed(2) : 0,
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 99 : 0,
    expectancy: takenTrades.length
      ? +(takenTrades.reduce((s, t) => s + t.rMultiple, 0) / takenTrades.length).toFixed(3)
      : 0,
    maxDrawdown: +(maxDd * 100).toFixed(1),
    totalReturn: +(((equity - opts.accountSize) / opts.accountSize) * 100).toFixed(1),
    cagr: +cagr.toFixed(1),
    finalEquity: +equity.toFixed(0),
    byOutcome: {
      target: takenTrades.filter((t) => t.outcome === "target").length,
      stop: takenTrades.filter((t) => t.outcome === "stop").length,
      time: takenTrades.filter((t) => t.outcome === "time").length,
    },
  };

  return { summary, equity: curve, trades: takenTrades, signalsTotal, signalsTaken };
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runMomentumBacktest(
  opts: MomentumBtOptions,
  onProgress?: (p: BacktestProgress) => void
): Promise<MomentumBtResult> {
  const def = indexByKey(opts.indexKey);
  if (!def) throw new Error(`Indice sconosciuto: ${opts.indexKey}`);

  const resolved: Required<MomentumBtOptions> = {
    indexKey: opts.indexKey,
    startDate: opts.startDate,
    endDate: opts.endDate,
    accountSize: opts.accountSize ?? 10_000,
    riskPct: opts.riskPct ?? 1,
    maxPositions: opts.maxPositions ?? 5,
    slippageBps: opts.slippageBps ?? 5,
    metaWindow: opts.metaWindow ?? 60,
    minMetaR2: opts.minMetaR2 ?? 0.5,
    stopAtr: opts.stopAtr ?? 2,
    targetAtr: opts.targetAtr ?? 3,
    maxHoldBars: opts.maxHoldBars ?? 20,
    scanFreq: opts.scanFreq ?? 5,
    topN: opts.topN ?? 5,
  };

  onProgress?.({ current: 0, total: def.tickers.length, message: "Scarico dati benchmark…" });
  const spyCandles = await fetchCandles(def.proxy, 3);
  const spyByDate = new Map<string, number>(spyCandles.map((c) => [c.date, c.close]));
  if (spyCandles.length < resolved.metaWindow + 10)
    throw new Error("Dati SPY insufficienti");

  let done = 0;
  let tickersTested = 0;
  const allData: TickerData[] = [];

  await pool(def.tickers, 8, async (ticker) => {
    const candles = await fetchCandles(ticker, 3);
    done++;
    onProgress?.({
      current: done,
      total: def.tickers.length,
      message: `${ticker} (${done}/${def.tickers.length})`,
    });
    if (candles.length < resolved.metaWindow + 30) return;
    tickersTested++;
    const closes = candles.map((c) => c.close);
    const meta = buildMeta(closes, candles, spyByDate);
    const atrByIdx = candles.map((_, i) => atr14(candles, i));
    allData.push({ ticker, candles, closes, meta, atrByIdx });
  });

  onProgress?.({ current: done, total: done, message: "Simulazione portafoglio…" });
  const { summary, equity, trades, signalsTotal, signalsTaken } = simulate(allData, spyCandles, resolved);

  const sharpe = sharpeFromEquityCurve(equity);
  const calmar = summary.maxDrawdown > 0 ? +(summary.cagr / summary.maxDrawdown).toFixed(2) : 0;
  const spyEquity = buildSpyCurve(spyCandles, resolved.startDate, resolved.endDate, resolved.accountSize);

  return {
    summary,
    equity,
    spyEquity,
    sharpe,
    calmar,
    trades: trades.slice(-200),
    signalsTotal,
    signalsTaken,
    tickersTested,
    options: resolved,
  };
}
