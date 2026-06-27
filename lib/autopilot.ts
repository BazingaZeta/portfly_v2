import type { Candle } from "./types";
import { fetchCandles, fetchQuotes } from "./marketData";
import { sma } from "./indicators";

// Renowned, decades-tested tactical strategy (Faber GTAA / Antonacci Dual Momentum):
// hold the strongest assets that are ALSO above their long-term trend; otherwise cash.
// Asset-class ETF basket so it's diversified and low-frequency (sleep-friendly).
export const AUTO_UNIVERSE = [
  "SPY", // US large cap
  "QQQ", // US tech / nasdaq
  "IWM", // US small cap
  "EFA", // intl developed
  "EEM", // emerging markets
  "VNQ", // US real estate
  "GLD", // gold
  "TLT", // long-term treasuries
  "LQD", // investment-grade credit
  "DBC", // broad commodities
];

export const AUTO_NAMES: Record<string, string> = {
  SPY: "S&P 500", QQQ: "Nasdaq 100", IWM: "Russell 2000", EFA: "Mercati sviluppati",
  EEM: "Mercati emergenti", VNQ: "Immobiliare USA", GLD: "Oro", TLT: "Treasury lunghi",
  LQD: "Credito IG", DBC: "Materie prime",
};

export const TOP_K = 3; // hold the top 3 assets
export const BENCHMARK = "SPY";

export interface AssetScore {
  ticker: string;
  momentum: number; // blended 3/6/12m %, the relative-momentum score
  aboveTrend: boolean; // price > 200-day SMA (absolute momentum / trend filter)
  selected: boolean;
}

export interface StrategyDecision {
  targets: Record<string, number>; // ticker -> weight (0..1); remainder is cash
  cashWeight: number;
  scores: AssetScore[];
  steps: string[]; // transparent data-flow + reasoning log
}

/** Total return over `days` trading sessions ending at index `end`. */
function ret(closes: number[], end: number, days: number): number {
  const past = closes[end - days];
  if (past == null || past <= 0) return NaN;
  return (closes[end] / past - 1) * 100;
}

/**
 * Compute the dual-momentum target allocation as of bar index `at` (default last).
 * Pure function — used by both the live engine and the backtest.
 */
export function computeStrategy(
  candlesByTicker: Record<string, Candle[]>,
  at?: number
): StrategyDecision {
  const steps: string[] = [];
  const scores: AssetScore[] = [];

  for (const ticker of AUTO_UNIVERSE) {
    const candles = candlesByTicker[ticker];
    if (!candles || candles.length < 253) continue;
    const closes = candles.map((c) => c.close);
    const end = at != null ? Math.min(at, closes.length - 1) : closes.length - 1;
    if (end < 252) continue;
    const m3 = ret(closes, end, 63);
    const m6 = ret(closes, end, 126);
    const m12 = ret(closes, end, 252);
    if ([m3, m6, m12].some((v) => isNaN(v))) continue;
    const momentum = (m3 + m6 + m12) / 3;
    const sma200 = sma(closes.slice(0, end + 1), 200);
    const aboveTrend = closes[end] > sma200;
    scores.push({ ticker, momentum: +momentum.toFixed(2), aboveTrend, selected: false });
  }

  steps.push(`Calcolo momentum (media 3/6/12 mesi) su ${scores.length} asset.`);
  // Relative momentum: rank by score.
  scores.sort((a, b) => b.momentum - a.momentum);
  const ranked = scores.map((s) => `${s.ticker} ${s.momentum > 0 ? "+" : ""}${s.momentum.toFixed(1)}%${s.aboveTrend ? "" : " (sotto trend)"}`);
  steps.push(`Classifica momentum: ${ranked.join(" · ")}`);

  // Absolute momentum / trend filter: must be above 200-SMA AND positive momentum.
  const eligible = scores.filter((s) => s.aboveTrend && s.momentum > 0);
  steps.push(`Filtro trend (sopra SMA200 e momentum>0): passano ${eligible.length} asset${eligible.length ? " — " + eligible.map((e) => e.ticker).join(", ") : ""}.`);

  const chosen = eligible.slice(0, TOP_K);
  const targets: Record<string, number> = {};
  if (chosen.length > 0) {
    const w = 1 / TOP_K; // equal weight to TOP_K slots; empty slots stay in cash
    for (const c of chosen) {
      targets[c.ticker] = w;
      const sc = scores.find((s) => s.ticker === c.ticker);
      if (sc) sc.selected = true;
    }
  }
  const invested = Object.values(targets).reduce((a, b) => a + b, 0);
  const cashWeight = +(1 - invested).toFixed(4);

  if (chosen.length === 0) {
    steps.push("Nessun asset sopra trend con momentum positivo → 100% CASH (modalità difensiva).");
  } else {
    steps.push(
      `Seleziono i top ${chosen.length}: ${chosen.map((c) => `${c.ticker} ${Math.round((1 / TOP_K) * 100)}%`).join(", ")}${cashWeight > 0.001 ? ` · cash ${Math.round(cashWeight * 100)}%` : ""}.`
    );
  }

  return { targets, cashWeight, scores, steps };
}

// ---- Backtest of the strategy (monthly rebalance) ----

export interface AutoBacktest {
  cagr: number;
  totalReturn: number;
  maxDrawdown: number;
  benchCagr: number;
  benchMaxDrawdown: number;
  years: number;
  equity: { date: string; equity: number; bench: number }[];
}

const APPROX_MONTH = 21; // trading days

export async function runAutoBacktest(years = 5): Promise<AutoBacktest> {
  const tickers = [...new Set([...AUTO_UNIVERSE, BENCHMARK])];
  const data: Record<string, Candle[]> = {};
  await Promise.all(tickers.map(async (t) => { data[t] = await fetchCandles(t, years); }));

  const spy = data[BENCHMARK];
  if (!spy || spy.length < 260) {
    return { cagr: 0, totalReturn: 0, maxDrawdown: 0, benchCagr: 0, benchMaxDrawdown: 0, years: 0, equity: [] };
  }
  // Build a date axis from the benchmark; use index alignment per ticker by date.
  const closeByDate: Record<string, Map<string, number>> = {};
  for (const t of tickers) closeByDate[t] = new Map(data[t].map((c) => [c.date, c.close]));

  const dates = spy.map((c) => c.date);
  const start = 252; // need a year of history for momentum/trend
  const initial = 10000;
  let cash = initial; // explicit cash; holdings are $ allocated per ticker
  const benchShares = initial / (closeByDate[BENCHMARK].get(dates[start]) ?? 1);
  const holdings: Record<string, number> = {};
  const lastPrice: Record<string, number> = {};
  const curve: AutoBacktest["equity"] = [];
  let equity = initial;
  let peak = equity, maxDd = 0, benchPeak = 0, benchMaxDd = 0;

  for (let i = start; i < dates.length; i++) {
    const date = dates[i];
    // mark existing holdings to market by their daily return (cash unchanged)
    for (const tk of Object.keys(holdings)) {
      const px = closeByDate[tk].get(date);
      if (px != null && lastPrice[tk]) holdings[tk] *= px / lastPrice[tk];
      if (px != null) lastPrice[tk] = px;
    }
    equity = cash + Object.values(holdings).reduce((a, b) => a + b, 0);

    // Rebalance monthly
    if ((i - start) % APPROX_MONTH === 0) {
      // Build per-ticker candle slices up to this date for the strategy.
      const slice: Record<string, Candle[]> = {};
      for (const t of AUTO_UNIVERSE) {
        const arr = data[t];
        if (!arr) continue;
        // find index of `date` in this ticker (approx by date <= current)
        let idx = arr.length - 1;
        for (let k = arr.length - 1; k >= 0; k--) { if (arr[k].date <= date) { idx = k; break; } }
        slice[t] = arr.slice(0, idx + 1);
      }
      const dec = computeStrategy(slice);
      const total = equity; // cash + holdings
      for (const k of Object.keys(holdings)) delete holdings[k];
      let allocated = 0;
      for (const [tk, w] of Object.entries(dec.targets)) {
        holdings[tk] = total * w;
        allocated += total * w;
        lastPrice[tk] = closeByDate[tk].get(date) ?? lastPrice[tk] ?? 1;
      }
      cash = total - allocated; // remainder stays in cash
    }

    // benchmark mark-to-market
    const benchPx = closeByDate[BENCHMARK].get(date);
    const benchVal = benchPx != null ? benchShares * benchPx : initial;
    peak = Math.max(peak, equity); maxDd = Math.max(maxDd, (peak - equity) / peak);
    benchPeak = Math.max(benchPeak, benchVal); benchMaxDd = Math.max(benchMaxDd, (benchPeak - benchVal) / benchPeak);
    if ((i - start) % 5 === 0 || i === dates.length - 1) {
      curve.push({ date, equity: +equity.toFixed(0), bench: +benchVal.toFixed(0) });
    }
  }

  const yrs = (new Date(dates[dates.length - 1]).getTime() - new Date(dates[start]).getTime()) / (365.25 * 86_400_000);
  const benchFinal = curve.length ? curve[curve.length - 1].bench : initial;
  return {
    cagr: +(((Math.pow(equity / initial, 1 / yrs) - 1) * 100)).toFixed(1),
    totalReturn: +(((equity - initial) / initial) * 100).toFixed(1),
    maxDrawdown: +(maxDd * 100).toFixed(1),
    benchCagr: +(((Math.pow(benchFinal / initial, 1 / yrs) - 1) * 100)).toFixed(1),
    benchMaxDrawdown: +(benchMaxDd * 100).toFixed(1),
    years: +yrs.toFixed(1),
    equity: curve,
  };
}

// ---- Live data fetch helper ----

export async function fetchUniverseCandles(years = 2): Promise<Record<string, Candle[]>> {
  const data: Record<string, Candle[]> = {};
  await Promise.all(AUTO_UNIVERSE.map(async (t) => { data[t] = await fetchCandles(t, years); }));
  return data;
}

export { fetchQuotes };
