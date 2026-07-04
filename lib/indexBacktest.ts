import type { Candle } from "./types";
import { indexByKey } from "./indices";
import { fetchCandles } from "./marketData";
import { regressionChannel } from "./regression";
import type { BacktestSummary, BacktestProgress, WalkForwardPeriod, WalkForwardReport } from "./backtest";
import { walkForwardStats } from "./backtest";

export type ExitMode = "channel" | "atr" | "trail";

export interface StrategyConfig {
  label: string;
  buyZoneZ: number; // enter only if channel z <= this
  minR2: number; // require channel r2 >= this
  requireRs: boolean; // require rising relative strength
  exitMode: ExitMode;
  maxHoldDays: number;
  stopAtr: number; // ATR multiple for stop (atr/trail modes)
  targetAtr: number; // ATR multiple for target (atr mode)
  trailAtr: number; // ATR multiple for trailing stop (trail mode)
}

export interface IndexBacktestOptions extends Partial<StrategyConfig> {
  indexKey: string;
  lookbackDays?: number;
  channelWindow?: number;
  riskPct?: number;
  accountSize?: number;
  maxConcurrent?: number;
  slippageBps?: number;
  splitPct?: number;
  folds?: number; // walk-forward periods (0 = off)
}

interface SimParams {
  lookbackDays: number;
  channelWindow: number;
  riskPct: number;
  accountSize: number;
  maxConcurrent: number;
  slippageBps: number;
  splitPct: number;
  folds: number;
}

const HISTORY_YEARS = 5;
const FWD_MAX = 60; // forward bars stored per entry (max hold we'd ever test)

const DEFAULT_CONFIG: StrategyConfig = {
  label: "default",
  buyZoneZ: 1.0,
  minR2: 0.5,
  requireRs: true,
  exitMode: "channel",
  maxHoldDays: 10,
  stopAtr: 2,
  targetAtr: 3,
  trailAtr: 3,
};

/** A potential entry with everything needed to derive an exit for any config. */
interface RawEntry {
  ticker: string;
  entryDate: string;
  entryPrice: number; // next-open
  z: number;
  r2: number;
  rsRising: boolean;
  atr: number;
  lowerNow: number;
  upperNow: number;
  fwd: Candle[]; // entry bar .. entry+FWD_MAX
}

interface Candidate {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  stop: number;
  exitDate: string;
  exitPrice: number;
  outcome: "target" | "stop" | "time";
}

function alignIndex(candles: Candle[], indexByDate: Map<string, number>): number[] {
  const out: number[] = [];
  let last = NaN;
  for (const c of candles) {
    const v = indexByDate.get(c.date);
    if (v && v > 0) last = v;
    out.push(last);
  }
  return out;
}

function atrAt(candles: Candle[], idx: number, period = 14): number {
  if (idx < period) return NaN;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    sum += Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  }
  return sum / period;
}

/** Generate every qualifying entry (loose gate), storing forward bars + context. */
function generateRawEntries(
  ticker: string,
  candles: Candle[],
  idxAligned: number[],
  channelWindow: number,
  lookbackDays: number
): RawEntry[] {
  const out: RawEntry[] = [];
  const W = channelWindow;
  if (candles.length < W + 20) return out;
  const closes = candles.map((c) => c.close);
  const rs = closes.map((c, i) => (idxAligned[i] > 0 ? c / idxAligned[i] : NaN));
  const startIdx = Math.max(W, candles.length - lookbackDays);

  for (let i = startIdx; i < candles.length - 1; i++) {
    const priceCh = regressionChannel(closes.slice(i + 1 - W, i + 1), 2);
    if (!priceCh || priceCh.trend !== "asc") continue;
    const rsWin = rs.slice(i + 1 - W, i + 1);
    const rsCh = rsWin.some((v) => isNaN(v)) ? null : regressionChannel(rsWin, 2);
    const atr = atrAt(candles, i);
    if (!(atr > 0)) continue;
    out.push({
      ticker,
      entryDate: candles[i + 1].date,
      entryPrice: candles[i + 1].open,
      z: priceCh.z,
      r2: priceCh.r2,
      rsRising: rsCh != null && rsCh.slope > 0,
      atr,
      lowerNow: priceCh.lowerNow,
      upperNow: priceCh.upperNow,
      fwd: candles.slice(i + 1, Math.min(i + 1 + FWD_MAX, candles.length)),
    });
  }
  return out;
}

/** Derive the deterministic exit for one entry under a given config. */
function exitFor(e: RawEntry, cfg: StrategyConfig): Candidate | null {
  const entry = e.entryPrice;
  let stop: number;
  let target: number;
  if (cfg.exitMode === "channel") {
    stop = e.lowerNow;
    target = e.upperNow;
  } else if (cfg.exitMode === "atr") {
    stop = entry - cfg.stopAtr * e.atr;
    target = entry + cfg.targetAtr * e.atr;
  } else {
    stop = entry - cfg.stopAtr * e.atr; // trailing: target is open-ended
    target = Infinity;
  }
  if (!(entry - stop > 0)) return null;

  const last = Math.min(cfg.maxHoldDays, e.fwd.length - 1);
  let curStop = stop;
  let exitIdx = 0;
  let exitPrice = e.fwd[0]?.close ?? entry;
  let outcome: Candidate["outcome"] = "time";

  for (let j = 0; j <= last; j++) {
    const bar = e.fwd[j];
    if (bar.open <= curStop) { exitIdx = j; exitPrice = bar.open; outcome = "stop"; break; }
    if (bar.open >= target) { exitIdx = j; exitPrice = bar.open; outcome = "target"; break; }
    if (bar.low <= curStop) { exitIdx = j; exitPrice = curStop; outcome = "stop"; break; }
    if (bar.high >= target) { exitIdx = j; exitPrice = target; outcome = "target"; break; }
    if (cfg.exitMode === "trail") {
      curStop = Math.max(curStop, bar.high - cfg.trailAtr * e.atr); // chandelier trail
    }
    if (j === last) { exitIdx = j; exitPrice = bar.close; outcome = "time"; }
  }

  return {
    ticker: e.ticker,
    entryDate: e.entryDate,
    entryPrice: entry,
    stop,
    exitDate: e.fwd[exitIdx].date,
    exitPrice,
    outcome,
  };
}

function buildCandidates(entries: RawEntry[], cfg: StrategyConfig): Candidate[] {
  const out: Candidate[] = [];
  for (const e of entries) {
    if (e.z > cfg.buyZoneZ) continue;
    if (e.r2 < cfg.minR2) continue;
    if (cfg.requireRs && !e.rsRising) continue;
    const c = exitFor(e, cfg);
    if (c) out.push(c);
  }
  return out;
}

function simulate(
  candidates: Candidate[],
  p: SimParams,
  startDate: string,
  endDate: string,
  inclusiveEnd: boolean,
  calendar: string[],
  closesByTicker: Map<string, Map<string, number>>
): { summary: BacktestSummary; equity: { date: string; equity: number }[]; taken: number } {
  const slip = p.slippageBps / 10000;
  const eligible = candidates
    .filter((c) => c.entryDate >= startDate && (inclusiveEnd ? c.entryDate <= endDate : c.entryDate < endDate))
    // Deterministic order on same-day ties (array order depends on fetch order).
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.ticker.localeCompare(b.ticker));

  let equity = p.accountSize; // realized (open positions valued at cost)
  let peak = equity;
  let maxDd = 0;
  const curve: { date: string; equity: number }[] = [];
  interface Open { c: Candidate; shares: number; effEntry: number; effExit: number; }
  const open: Open[] = [];
  const openTickers = new Set<string>();
  const closed: { pnl: number; r: number; ret: number; outcome: Candidate["outcome"] }[] = [];

  const realize = (upTo: string) => {
    for (let k = open.length - 1; k >= 0; k--) {
      const o = open[k];
      if (o.c.exitDate <= upTo) {
        const pnl = o.shares * (o.effExit - o.effEntry);
        equity += pnl;
        const rps = o.effEntry - o.c.stop;
        closed.push({
          pnl,
          r: rps > 0 ? (o.effExit - o.effEntry) / rps : 0,
          ret: ((o.effExit - o.effEntry) / o.effEntry) * 100,
          outcome: o.c.outcome,
        });
        openTickers.delete(o.c.ticker);
        open.splice(k, 1);
      }
    }
  };

  const days = calendar.filter(
    (d) => d >= startDate && (inclusiveEnd ? d <= endDate : d < endDate)
  );
  let ei = 0;
  for (const date of days) {
    realize(date);

    while (ei < eligible.length && eligible[ei].entryDate <= date) {
      const c = eligible[ei++];
      if (openTickers.has(c.ticker)) continue; // one position per ticker
      if (open.length >= p.maxConcurrent) continue;
      const effEntry = c.entryPrice * (1 + slip);
      const rps = effEntry - c.stop;
      if (!(rps > 0)) continue;
      const committed = open.reduce((s, o) => s + o.shares * o.effEntry, 0);
      const cash = equity - committed;
      if (cash <= 0) continue;
      let shares = (equity * (p.riskPct / 100)) / rps;
      if (shares * effEntry > cash) shares = cash / effEntry;
      if (shares <= 0) continue;
      open.push({ c, shares, effEntry, effExit: c.exitPrice * (1 - slip) });
      openTickers.add(c.ticker);
    }

    // Daily mark-to-market
    let unrealized = 0;
    for (const o of open) {
      const px = closesByTicker.get(o.c.ticker)?.get(date);
      if (px != null) unrealized += o.shares * (px - o.effEntry);
    }
    const mtm = equity + unrealized;
    peak = Math.max(peak, mtm);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - mtm) / peak);
    curve.push({ date, equity: +mtm.toFixed(2) });
  }
  realize("9999-99-99");

  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  let cagr = 0;
  const years = (new Date(endDate).getTime() - new Date(startDate).getTime()) / (365.25 * 86_400_000);
  if (years > 0.1 && equity > 0) cagr = (Math.pow(equity / p.accountSize, 1 / years) - 1) * 100;

  const summary: BacktestSummary = {
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : 0,
    avgWin: wins.length ? +(wins.reduce((s, t) => s + t.ret, 0) / wins.length).toFixed(2) : 0,
    avgLoss: losses.length ? +(losses.reduce((s, t) => s + t.ret, 0) / losses.length).toFixed(2) : 0,
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? Infinity : 0,
    expectancy: closed.length ? +(closed.reduce((s, t) => s + t.r, 0) / closed.length).toFixed(3) : 0,
    maxDrawdown: +(maxDd * 100).toFixed(1),
    totalReturn: +(((equity - p.accountSize) / p.accountSize) * 100).toFixed(1),
    cagr: +cagr.toFixed(1),
    finalEquity: +equity.toFixed(0),
    byOutcome: {
      target: closed.filter((t) => t.outcome === "target").length,
      stop: closed.filter((t) => t.outcome === "stop").length,
      time: closed.filter((t) => t.outcome === "time").length,
    },
  };
  return { summary, equity: curve, taken: closed.length };
}

// ---- Public API ----

export interface IndexBacktestResult {
  summary: BacktestSummary;
  equity: { date: string; equity: number }[];
  is: BacktestSummary;
  oos: BacktestSummary;
  splitDate: string;
  walkForward?: WalkForwardReport; // present when folds >= 2
  config: StrategyConfig & SimParams & { indexKey: string };
  tickersTested: number;
  signalsTotal: number;
  signalsTaken: number;
}

async function loadEntries(
  indexKey: string,
  channelWindow: number,
  lookbackDays: number,
  onProgress?: (p: BacktestProgress) => void
): Promise<{
  entries: RawEntry[];
  tickersTested: number;
  calendar: string[];
  closesByTicker: Map<string, Map<string, number>>;
}> {
  const def = indexByKey(indexKey);
  if (!def) throw new Error(`Indice sconosciuto: ${indexKey}`);
  onProgress?.({ current: 0, total: def.tickers.length, message: "Carico l'indice…" });
  const idxCandles = await fetchCandles(def.proxy, HISTORY_YEARS);
  const idxByDate = new Map<string, number>(idxCandles.map((c) => [c.date, c.close]));

  const entries: RawEntry[] = [];
  const closesByTicker = new Map<string, Map<string, number>>();
  let tickersTested = 0;
  let done = 0;
  let i = 0;
  const conc = 8;
  await Promise.all(
    new Array(conc).fill(0).map(async () => {
      while (i < def.tickers.length) {
        const ticker = def.tickers[i++];
        const candles = await fetchCandles(ticker, HISTORY_YEARS);
        if (candles.length >= channelWindow + 20) {
          tickersTested++;
          entries.push(...generateRawEntries(ticker, candles, alignIndex(candles, idxByDate), channelWindow, lookbackDays));
          closesByTicker.set(ticker, new Map(candles.map((c) => [c.date, c.close])));
        }
        done++;
        onProgress?.({ current: done, total: def.tickers.length, message: `Dati ${ticker} (${done}/${def.tickers.length})` });
      }
    })
  );
  return { entries, tickersTested, calendar: idxCandles.map((c) => c.date), closesByTicker };
}

function splitDates(candidates: Candidate[], splitPct: number) {
  const dates = candidates.map((c) => c.entryDate).sort();
  return {
    first: dates[0] ?? "2000-01-01",
    last: dates[dates.length - 1] ?? "2100-01-01",
    split: dates[Math.floor(dates.length * splitPct)] ?? (dates[0] ?? "2000-01-01"),
  };
}

export async function runIndexBacktest(
  options: IndexBacktestOptions,
  onProgress?: (p: BacktestProgress) => void
): Promise<IndexBacktestResult> {
  const cfg: StrategyConfig = {
    label: "custom",
    buyZoneZ: options.buyZoneZ ?? DEFAULT_CONFIG.buyZoneZ,
    minR2: options.minR2 ?? DEFAULT_CONFIG.minR2,
    requireRs: options.requireRs ?? DEFAULT_CONFIG.requireRs,
    exitMode: options.exitMode ?? DEFAULT_CONFIG.exitMode,
    maxHoldDays: options.maxHoldDays ?? DEFAULT_CONFIG.maxHoldDays,
    stopAtr: options.stopAtr ?? DEFAULT_CONFIG.stopAtr,
    targetAtr: options.targetAtr ?? DEFAULT_CONFIG.targetAtr,
    trailAtr: options.trailAtr ?? DEFAULT_CONFIG.trailAtr,
  };
  const p: SimParams = {
    lookbackDays: options.lookbackDays ?? 504,
    channelWindow: options.channelWindow ?? 40,
    riskPct: options.riskPct ?? 1,
    accountSize: options.accountSize ?? 10000,
    maxConcurrent: options.maxConcurrent ?? 10,
    slippageBps: options.slippageBps ?? 5,
    splitPct: options.splitPct ?? 0.7,
    folds: options.folds ?? 0,
  };

  const { entries, tickersTested, calendar, closesByTicker } = await loadEntries(options.indexKey, p.channelWindow, p.lookbackDays, onProgress);
  const candidates = buildCandidates(entries, cfg);
  const { first, last, split } = splitDates(candidates, p.splitPct);

  const full = simulate(candidates, p, first, last, true, calendar, closesByTicker);
  const is = simulate(candidates, p, first, split, false, calendar, closesByTicker);
  const oos = simulate(candidates, p, split, last, true, calendar, closesByTicker);

  let walkForward: WalkForwardReport | undefined;
  const entryDates = candidates.map((c) => c.entryDate).sort();
  if (p.folds >= 2 && entryDates.length >= p.folds) {
    const periods: WalkForwardPeriod[] = [];
    for (let k = 0; k < p.folds; k++) {
      const start = entryDates[Math.floor((entryDates.length * k) / p.folds)];
      const isLast = k === p.folds - 1;
      const end = isLast ? last : entryDates[Math.floor((entryDates.length * (k + 1)) / p.folds)];
      periods.push({ start, end, summary: simulate(candidates, p, start, end, isLast, calendar, closesByTicker).summary });
    }
    walkForward = walkForwardStats(periods);
  }

  return {
    walkForward,
    summary: full.summary,
    equity: full.equity,
    is: is.summary,
    oos: oos.summary,
    splitDate: split,
    config: { ...cfg, ...p, indexKey: options.indexKey },
    tickersTested,
    signalsTotal: candidates.length,
    signalsTaken: full.taken,
  };
}

// ---- Optimizer: evaluate a grid of variants, validated out-of-sample ----

export interface OptimizeRow {
  config: StrategyConfig;
  full: BacktestSummary;
  is: BacktestSummary;
  oos: BacktestSummary;
  holdsOos: boolean;
}

const GRID: StrategyConfig[] = [
  { label: "Baseline (canale, z≤1)", buyZoneZ: 1.0, minR2: 0.5, requireRs: true, exitMode: "channel", maxHoldDays: 10, stopAtr: 2, targetAtr: 3, trailAtr: 3 },
  { label: "Canale, zona bassa z≤-0.5", buyZoneZ: -0.5, minR2: 0.5, requireRs: true, exitMode: "channel", maxHoldDays: 10, stopAtr: 2, targetAtr: 3, trailAtr: 3 },
  { label: "Canale, zona bassa + R²≥0.7", buyZoneZ: -0.5, minR2: 0.7, requireRs: true, exitMode: "channel", maxHoldDays: 15, stopAtr: 2, targetAtr: 3, trailAtr: 3 },
  { label: "ATR 1.5/3, z≤0.5", buyZoneZ: 0.5, minR2: 0.5, requireRs: true, exitMode: "atr", maxHoldDays: 15, stopAtr: 1.5, targetAtr: 3, trailAtr: 3 },
  { label: "ATR 1.5/3, zona bassa", buyZoneZ: -0.5, minR2: 0.5, requireRs: true, exitMode: "atr", maxHoldDays: 15, stopAtr: 1.5, targetAtr: 3, trailAtr: 3 },
  { label: "ATR 2/4, zona bassa, R²≥0.7", buyZoneZ: -0.5, minR2: 0.7, requireRs: true, exitMode: "atr", maxHoldDays: 20, stopAtr: 2, targetAtr: 4, trailAtr: 3 },
  { label: "Trail 2/3, z≤0.5, hold40", buyZoneZ: 0.5, minR2: 0.5, requireRs: true, exitMode: "trail", maxHoldDays: 40, stopAtr: 2, targetAtr: 3, trailAtr: 3 },
  { label: "Trail 2/3, zona bassa, hold40", buyZoneZ: -0.5, minR2: 0.5, requireRs: true, exitMode: "trail", maxHoldDays: 40, stopAtr: 2, targetAtr: 3, trailAtr: 3 },
  { label: "Trail 1.5/2.5, z≤0.5, hold60", buyZoneZ: 0.5, minR2: 0.5, requireRs: true, exitMode: "trail", maxHoldDays: 60, stopAtr: 1.5, targetAtr: 3, trailAtr: 2.5 },
  { label: "Trail 2/3, R²≥0.7, hold60", buyZoneZ: 0.5, minR2: 0.7, requireRs: true, exitMode: "trail", maxHoldDays: 60, stopAtr: 2, targetAtr: 3, trailAtr: 3 },
  { label: "Trail 2/3 SENZA RS, hold40", buyZoneZ: 0.5, minR2: 0.5, requireRs: false, exitMode: "trail", maxHoldDays: 40, stopAtr: 2, targetAtr: 3, trailAtr: 3 },
  { label: "ATR 1.5/4.5, zona bassa, R²≥0.7", buyZoneZ: -0.5, minR2: 0.7, requireRs: true, exitMode: "atr", maxHoldDays: 20, stopAtr: 1.5, targetAtr: 4.5, trailAtr: 3 },
  // Momentum-continuation: ride the leaders (any zone) with a wide trail.
  { label: "Cavalca leader: trail 4, hold60", buyZoneZ: 2, minR2: 0.5, requireRs: true, exitMode: "trail", maxHoldDays: 60, stopAtr: 3, targetAtr: 3, trailAtr: 4 },
  { label: "Cavalca leader: ATR 2.5/6, hold30", buyZoneZ: 2, minR2: 0.5, requireRs: true, exitMode: "atr", maxHoldDays: 30, stopAtr: 2.5, targetAtr: 6, trailAtr: 4 },
  { label: "Cavalca: R²≥0.7, trail 4, hold60", buyZoneZ: 2, minR2: 0.7, requireRs: true, exitMode: "trail", maxHoldDays: 60, stopAtr: 3, targetAtr: 3, trailAtr: 4 },
  { label: "Cavalca: trail 5 largo, hold60", buyZoneZ: 2, minR2: 0.5, requireRs: true, exitMode: "trail", maxHoldDays: 60, stopAtr: 4, targetAtr: 3, trailAtr: 5 },
];

export async function runIndexOptimize(
  indexKey: string,
  onProgress?: (p: BacktestProgress) => void
): Promise<{ rows: OptimizeRow[]; tickersTested: number }> {
  const p: SimParams = {
    lookbackDays: 504, channelWindow: 40, riskPct: 1, accountSize: 10000,
    maxConcurrent: 10, slippageBps: 5, splitPct: 0.7, folds: 0,
  };
  const { entries, tickersTested, calendar, closesByTicker } = await loadEntries(indexKey, p.channelWindow, p.lookbackDays, onProgress);

  const rows: OptimizeRow[] = GRID.map((cfg) => {
    const cands = buildCandidates(entries, cfg);
    const { first, last, split } = splitDates(cands, p.splitPct);
    const full = simulate(cands, p, first, last, true, calendar, closesByTicker).summary;
    const is = simulate(cands, p, first, split, false, calendar, closesByTicker).summary;
    const oos = simulate(cands, p, split, last, true, calendar, closesByTicker).summary;
    const holdsOos = oos.profitFactor >= 1.1 && oos.expectancy > 0 && oos.trades >= 20;
    return { config: cfg, full, is, oos, holdsOos };
  });
  // Rank by IN-sample expectancy: selecting on OOS would make the holdout part
  // of the selection and overstate it. OOS (and holdsOos) is confirmation only.
  rows.sort((a, b) => b.is.expectancy - a.is.expectancy);
  return { rows, tickersTested };
}
