import type { Candle } from "./types";
import { UNIVERSE } from "./universe";
import { fetchCandles } from "./marketData";
import { computeIndicators, sma } from "./indicators";
import { evaluateTechnical, STOP_ATR, TARGET_ATR } from "./scanner";

export interface BacktestOptions {
  lookbackDays?: number; // bars of history to test over (default 504 ≈ 2y)
  scoreThreshold?: number; // min technical score to enter (default 60)
  maxHoldDays?: number; // exit at market after N bars (default 10)
  useRegime?: boolean; // only enter when SPY not in a downtrend (default true)
  riskPct?: number; // % of equity risked per trade (default 1)
  accountSize?: number; // starting capital (default 10000)
  maxConcurrent?: number; // max simultaneously open positions (default 10)
  slippageBps?: number; // per-side slippage in basis points (default 5)
  commission?: number; // flat $ commission per side (default 0 — T212 stocks)
  splitPct?: number; // in-sample fraction for OOS validation (default 0.7)
}

type ResolvedOptions = Required<BacktestOptions>;

/** A potential trade discovered by the rules, with its deterministic exit. */
interface Candidate {
  ticker: string;
  score: number;
  regimeOk: boolean;
  entryDate: string;
  entryPrice: number; // raw next-open
  stop: number;
  target: number;
  exitDate: string;
  exitPrice: number; // raw fill (gap-aware)
  outcome: "target" | "stop" | "time";
}

/** A trade actually taken by the portfolio simulation, with net $ result. */
export interface BacktestTrade {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  returnPct: number; // net of slippage/commission
  rMultiple: number; // net, in units of risk
  pnl: number; // net $ on the position
  bars: number;
  outcome: "target" | "stop" | "time";
}

export interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number; // % per trade
  avgLoss: number; // % per trade
  profitFactor: number; // $ gains / $ losses
  expectancy: number; // avg net R per trade
  maxDrawdown: number; // % of the $ equity curve
  totalReturn: number; // % over the window
  cagr: number; // annualized %
  finalEquity: number;
  byOutcome: { target: number; stop: number; time: number };
}

export interface BacktestResult {
  summary: BacktestSummary; // full period
  equity: { date: string; equity: number }[]; // full period
  is: BacktestSummary; // in-sample (training)
  oos: BacktestSummary; // out-of-sample (held out)
  oosEquity: { date: string; equity: number }[];
  splitDate: string;
  trades: BacktestTrade[]; // sample of taken trades (full)
  config: ResolvedOptions;
  tickersTested: number;
  signalsTotal: number; // candidates passing threshold (full period)
  signalsTaken: number; // actually entered (after concurrency/cash limits)
}

export interface BacktestProgress {
  current: number;
  total: number;
  message: string;
}

type Regime = "bull" | "neutral" | "bear";

function regimeByDate(spy: Candle[]): Map<string, Regime> {
  const closes = spy.map((c) => c.close);
  const map = new Map<string, Regime>();
  for (let i = 0; i < spy.length; i++) {
    if (i < 200) {
      map.set(spy[i].date, "neutral");
      continue;
    }
    const slice = closes.slice(0, i + 1);
    const price = closes[i];
    const s50 = sma(slice, 50);
    const s200 = sma(slice, 200);
    map.set(spy[i].date, price > s50 && s50 > s200 ? "bull" : price < s50 && s50 < s200 ? "bear" : "neutral");
  }
  return map;
}

/**
 * Discover every candidate trade for a ticker over the window, with a
 * gap-aware deterministic exit. Threshold/regime are stored, NOT filtered,
 * so the portfolio sim can slice by threshold/window cheaply.
 */
function generateCandidates(
  ticker: string,
  candles: Candle[],
  opts: ResolvedOptions,
  regime: Map<string, Regime>
): Candidate[] {
  const out: Candidate[] = [];
  if (candles.length < 60) return out;
  const startIdx = Math.max(55, candles.length - opts.lookbackDays);

  let i = startIdx;
  while (i < candles.length - 1) {
    // Only the trailing ~300 bars matter (longest window is 52w = 252) — keeps
    // this O(lookback × 300) instead of O(n²) so deep history stays fast.
    const ind = computeIndicators(candles.slice(Math.max(0, i + 1 - 300), i + 1));
    if (!ind) {
      i++;
      continue;
    }
    const evalRes = evaluateTechnical(ind);
    // Tech gate only; precise threshold applied later by the sim.
    if (!evalRes || evalRes.score < 45 || ind.price <= ind.sma50) {
      i++;
      continue;
    }

    const entryIdx = i + 1;
    const entryPrice = candles[entryIdx].open;
    const stop = entryPrice - STOP_ATR * ind.atr;
    const target = entryPrice + TARGET_ATR * ind.atr;
    const lastAllowed = Math.min(entryIdx + opts.maxHoldDays, candles.length - 1);

    let exitIdx = entryIdx;
    let exitPrice = candles[entryIdx].close;
    let outcome: Candidate["outcome"] = "time";
    for (let j = entryIdx; j <= lastAllowed; j++) {
      const bar = candles[j];
      // Gap at the open fills there (realistic worst/best case).
      if (bar.open <= stop) { exitIdx = j; exitPrice = bar.open; outcome = "stop"; break; }
      if (bar.open >= target) { exitIdx = j; exitPrice = bar.open; outcome = "target"; break; }
      // Otherwise intraday; assume stop touched before target (conservative).
      if (bar.low <= stop) { exitIdx = j; exitPrice = stop; outcome = "stop"; break; }
      if (bar.high >= target) { exitIdx = j; exitPrice = target; outcome = "target"; break; }
      if (j === lastAllowed) { exitIdx = j; exitPrice = bar.close; outcome = "time"; }
    }

    out.push({
      ticker,
      score: evalRes.score,
      regimeOk: (regime.get(candles[i].date) ?? "neutral") !== "bear",
      entryDate: candles[entryIdx].date,
      entryPrice,
      stop,
      target,
      exitDate: candles[exitIdx].date,
      exitPrice,
      outcome,
    });

    i = exitIdx + 1; // no overlapping trades on the same ticker
  }
  return out;
}

/**
 * Simulate a single real account over [start, end): chronological entries,
 * capped concurrent positions, cash constraint, slippage + commission.
 */
function simulatePortfolio(
  candidates: Candidate[],
  opts: ResolvedOptions,
  startDate: string,
  endDate: string,
  inclusiveEnd: boolean
): { summary: BacktestSummary; equity: { date: string; equity: number }[]; taken: BacktestTrade[]; signalsTotal: number } {
  const slip = opts.slippageBps / 10000;
  const eligible = candidates
    .filter(
      (c) =>
        c.score >= opts.scoreThreshold &&
        (!opts.useRegime || c.regimeOk) &&
        c.entryDate >= startDate &&
        (inclusiveEnd ? c.entryDate <= endDate : c.entryDate < endDate)
    )
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  let equity = opts.accountSize;
  let peak = equity;
  let maxDd = 0;
  const equity_curve: { date: string; equity: number }[] = [];
  const taken: BacktestTrade[] = [];

  interface Open {
    c: Candidate;
    shares: number;
    effEntry: number;
    effExit: number;
  }
  const open: Open[] = [];

  const realize = (upToDate: string) => {
    for (let k = open.length - 1; k >= 0; k--) {
      const o = open[k];
      if (o.c.exitDate <= upToDate) {
        const pnl = o.shares * (o.effExit - o.effEntry) - 2 * opts.commission;
        equity += pnl;
        const riskPerShare = o.effEntry - o.c.stop;
        taken.push({
          ticker: o.c.ticker,
          entryDate: o.c.entryDate,
          entryPrice: +o.effEntry.toFixed(2),
          exitDate: o.c.exitDate,
          exitPrice: +o.effExit.toFixed(2),
          returnPct: +(((o.effExit - o.effEntry) / o.effEntry) * 100).toFixed(2),
          rMultiple: riskPerShare > 0 ? +((o.effExit - o.effEntry) / riskPerShare).toFixed(3) : 0,
          pnl: +pnl.toFixed(2),
          bars: Math.max(
            0,
            Math.round((new Date(o.c.exitDate).getTime() - new Date(o.c.entryDate).getTime()) / 86_400_000)
          ),
          outcome: o.c.outcome,
        });
        peak = Math.max(peak, equity);
        if (peak > 0) maxDd = Math.max(maxDd, (peak - equity) / peak);
        equity_curve.push({ date: o.c.exitDate, equity: +equity.toFixed(2) });
        open.splice(k, 1);
      }
    }
  };

  for (const c of eligible) {
    realize(c.entryDate); // free slots/cash for positions exited before this entry
    if (open.length >= opts.maxConcurrent) continue; // can't take more
    const effEntry = c.entryPrice * (1 + slip);
    const riskPerShare = effEntry - c.stop;
    if (!(riskPerShare > 0)) continue;
    const committed = open.reduce((s, o) => s + o.shares * o.effEntry, 0);
    const cash = equity - committed;
    if (cash <= 0) continue;
    let shares = (equity * (opts.riskPct / 100)) / riskPerShare;
    if (shares * effEntry > cash) shares = cash / effEntry; // cash cap
    if (shares <= 0) continue;
    open.push({ c, shares, effEntry, effExit: c.exitPrice * (1 - slip) });
  }
  realize("9999-99-99"); // close any still-open at their exit

  taken.sort((a, b) => a.exitDate.localeCompare(b.exitDate));

  const wins = taken.filter((t) => t.pnl > 0);
  const losses = taken.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  let cagr = 0;
  const years = (new Date(endDate).getTime() - new Date(startDate).getTime()) / (365.25 * 86_400_000);
  if (years > 0.1 && equity > 0) cagr = (Math.pow(equity / opts.accountSize, 1 / years) - 1) * 100;

  const summary: BacktestSummary = {
    trades: taken.length,
    wins: wins.length,
    losses: losses.length,
    winRate: taken.length ? +((wins.length / taken.length) * 100).toFixed(1) : 0,
    avgWin: wins.length ? +(wins.reduce((s, t) => s + t.returnPct, 0) / wins.length).toFixed(2) : 0,
    avgLoss: losses.length ? +(losses.reduce((s, t) => s + t.returnPct, 0) / losses.length).toFixed(2) : 0,
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? Infinity : 0,
    expectancy: taken.length ? +(taken.reduce((s, t) => s + t.rMultiple, 0) / taken.length).toFixed(3) : 0,
    maxDrawdown: +(maxDd * 100).toFixed(1),
    totalReturn: +(((equity - opts.accountSize) / opts.accountSize) * 100).toFixed(1),
    cagr: +cagr.toFixed(1),
    finalEquity: +equity.toFixed(0),
    byOutcome: {
      target: taken.filter((t) => t.outcome === "target").length,
      stop: taken.filter((t) => t.outcome === "stop").length,
      time: taken.filter((t) => t.outcome === "time").length,
    },
  };

  return { summary, equity: equity_curve, taken, signalsTotal: eligible.length };
}

export async function runBacktest(
  onProgress?: (p: BacktestProgress) => void,
  options: BacktestOptions = {},
  universe: string[] = UNIVERSE
): Promise<BacktestResult> {
  const opts: ResolvedOptions = {
    lookbackDays: options.lookbackDays ?? 504,
    scoreThreshold: options.scoreThreshold ?? 60,
    maxHoldDays: options.maxHoldDays ?? 10,
    useRegime: options.useRegime ?? true,
    riskPct: options.riskPct ?? 1,
    accountSize: options.accountSize ?? 10000,
    maxConcurrent: options.maxConcurrent ?? 10,
    slippageBps: options.slippageBps ?? 5,
    commission: options.commission ?? 0,
    splitPct: options.splitPct ?? 0.7,
  };

  // Deep history so multi-year lookbacks are real (Yahoo gives ~5y of daily).
  const HISTORY_YEARS = 5;
  onProgress?.({ current: 0, total: universe.length, message: "Carico SPY per il regime…" });
  const spy = await fetchCandles("SPY", HISTORY_YEARS);
  const regime = regimeByDate(spy);

  const allCandidates: Candidate[] = [];
  let done = 0;
  let tickersTested = 0;
  const concurrency = 8;
  let idx = 0;
  async function worker() {
    while (idx < universe.length) {
      const ticker = universe[idx++];
      const candles = await fetchCandles(ticker, HISTORY_YEARS);
      if (candles.length >= 60) {
        tickersTested++;
        allCandidates.push(...generateCandidates(ticker, candles, opts, regime));
      }
      done++;
      onProgress?.({ current: done, total: universe.length, message: `Backtest ${ticker} (${done}/${universe.length})` });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  // Window over which we actually have candidate entries.
  const dates = allCandidates.map((c) => c.entryDate).sort();
  const firstDate = dates[0] ?? "2000-01-01";
  const lastDate = dates[dates.length - 1] ?? "2100-01-01";
  // Split date for OOS: chronological split of the entry timeline.
  const splitIdx = Math.floor(dates.length * opts.splitPct);
  const splitDate = dates[splitIdx] ?? firstDate;

  const full = simulatePortfolio(allCandidates, opts, firstDate, lastDate, true);
  const is = simulatePortfolio(allCandidates, opts, firstDate, splitDate, false);
  const oos = simulatePortfolio(allCandidates, opts, splitDate, lastDate, true);

  return {
    summary: full.summary,
    equity: full.equity,
    is: is.summary,
    oos: oos.summary,
    oosEquity: oos.equity,
    splitDate,
    trades: full.taken.slice(-100).reverse(),
    config: opts,
    tickersTested,
    signalsTotal: full.signalsTotal,
    signalsTaken: full.taken.length,
  };
}
