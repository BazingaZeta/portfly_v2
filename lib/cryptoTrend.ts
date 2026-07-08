/**
 * Crypto Trend rotation — filtro di regime su BTC/ETH
 * ===================================================
 * Analogo crypto della "Rotazione a leva" (lib/leverageRotation.ts): NON è stock
 * picking, è beta condizionale al trend. Per ogni asset del paniere: se il close
 * è sopra la SMA(N) (con banda anti-whipsaw) lo si tiene a peso 1/N, altrimenti
 * quella quota resta cash. Così il portafoglio de-riska da solo quando una sola
 * coin è in trend (BTC su, ETH giù → 50% BTC, 50% cash) e va 100% cash nei bear.
 *
 * Perché ha senso nella crypto: i drawdown di buy&hold sono brutali (BTC −75%+ nei
 * bear 2018/2022). Un semplice filtro di trend taglia la coda sinistra pur restando
 * investito nei grandi uptrend. Riusa `investedSeries` (isteresi già validata) del
 * modulo rotation, così la logica di regime è UNA sola in tutto il repo.
 *
 * ATTENZIONE (survivorship): BTC/ETH sono le blue-chip sopravvissute — i numeri di
 * backtest vanno letti come indicativi, mai promessi come attesi live. I default
 * (smaPeriod/hysteresisPct) vanno fissati SOLO dopo walk-forward multi-fold.
 */

import type { Candle } from "./types";
import { fetchCandles } from "./marketData";
import { investedSeries } from "./leverageRotation";

// Paniere della strategia (blue-chip, minimo survivorship bias).
export const CRYPTO_TREND_ASSETS = ["BTC-USD", "ETH-USD"] as const;

// Paniere più largo, SOLO per la dashboard della sezione (non per la strategia).
export const CRYPTO_DASHBOARD = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "BNB-USD", "DOGE-USD"] as const;

export const CRYPTO_NAMES: Record<string, string> = {
  "BTC-USD": "Bitcoin",
  "ETH-USD": "Ethereum",
  "SOL-USD": "Solana",
  "XRP-USD": "XRP",
  "BNB-USD": "BNB",
  "DOGE-USD": "Dogecoin",
};

export interface CryptoTrendConfig {
  assets: string[];      // paniere equal-weight (default BTC-USD, ETH-USD)
  smaPeriod: number;     // periodo SMA sul close per il filtro di trend
  hysteresisPct: number; // banda anti-whipsaw: esci sotto SMA×(1−h), rientra sopra SMA×(1+h)
}

// NB: default provvisori — confermati/aggiornati dalla validazione walk-forward.
export const DEFAULT_CRYPTO_TREND: CryptoTrendConfig = {
  assets: [...CRYPTO_TREND_ASSETS],
  smaPeriod: 100,
  hysteresisPct: 3,
};

export function normalizeCryptoTrendConfig(partial?: Partial<CryptoTrendConfig>): CryptoTrendConfig {
  const allowed = new Set(Object.keys(CRYPTO_NAMES));
  const assets =
    partial?.assets?.filter((a) => allowed.has(a)) && partial.assets.filter((a) => allowed.has(a)).length > 0
      ? [...new Set(partial!.assets!.filter((a) => allowed.has(a)))]
      : [...DEFAULT_CRYPTO_TREND.assets];
  // Number(undefined) → NaN (che `??` non intercetta): guardia esplicita con isFinite.
  const smaRaw = partial?.smaPeriod;
  const smaPeriod = Math.min(300, Math.max(20, Math.round(Number.isFinite(smaRaw) ? (smaRaw as number) : DEFAULT_CRYPTO_TREND.smaPeriod)));
  const hRaw = partial?.hysteresisPct;
  const hysteresisPct = Math.min(10, Math.max(0, Number.isFinite(hRaw) ? (hRaw as number) : DEFAULT_CRYPTO_TREND.hysteresisPct));
  return { assets, smaPeriod, hysteresisPct };
}

/** SMA rolling per ogni barra (solo dati passati; NaN finché non ci sono N barre). */
function rollingSma(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function nameFor(asset: string): string {
  return CRYPTO_NAMES[asset] ?? asset;
}

// ─── Decisione (per il motore autopilot) ────────────────────────────────────────

/**
 * Target allocation al close più recente: ogni asset del paniere in uptrend riceve
 * peso 1/N (N = dimensione paniere); gli altri restano cash. Funzione pura, usata
 * sia dal live/autopilot sia (barra per barra) dal backtest.
 */
export function cryptoTrendDecision(
  candlesByAsset: Record<string, Candle[]>,
  cfg: CryptoTrendConfig
): { targets: Record<string, number>; cashWeight: number; steps: string[] } {
  const steps: string[] = [];
  const n = cfg.assets.length;
  const weight = n > 0 ? 1 / n : 0;
  const targets: Record<string, number> = {};
  const parts: string[] = [];

  for (const asset of cfg.assets) {
    const candles = candlesByAsset[asset];
    if (!candles || candles.length < cfg.smaPeriod + 1) {
      parts.push(`${nameFor(asset)}: dati insufficienti → cash`);
      continue;
    }
    const closes = candles.map((c) => c.close);
    const sma = rollingSma(closes, cfg.smaPeriod);
    const last = closes.length - 1;
    const bull = investedSeries(closes, cfg.smaPeriod, cfg.hysteresisPct)[last];
    const dist = sma[last] ? ((closes[last] - sma[last]) / sma[last]) * 100 : 0;
    if (bull) targets[asset] = weight;
    parts.push(
      `${nameFor(asset)} ${closes[last].toFixed(2)} vs SMA${cfg.smaPeriod} ${sma[last].toFixed(2)} ` +
        `(${dist >= 0 ? "+" : ""}${dist.toFixed(1)}%) → ${bull ? `TIENE ${Math.round(weight * 100)}%` : "CASH"}`
    );
  }

  steps.push(`Filtro di trend (SMA${cfg.smaPeriod}, banda ±${cfg.hysteresisPct}%): ${parts.join(" · ")}.`);
  const invested = Object.values(targets).reduce((a, b) => a + b, 0);
  const cashWeight = +(1 - invested).toFixed(4);
  if (invested <= 0) steps.push("Nessuna coin sopra trend → 100% CASH (difensivo).");
  else steps.push(`Allocazione: ${Object.keys(targets).map((t) => `${nameFor(t)} ${Math.round(weight * 100)}%`).join(" · ")}${cashWeight > 0.001 ? ` · cash ${Math.round(cashWeight * 100)}%` : ""}.`);

  return { targets, cashWeight, steps };
}

// ─── Analisi (per la sezione Crypto) ────────────────────────────────────────────

export interface CryptoAssetStatus {
  asset: string;
  name: string;
  asOf: string;
  price: number;
  sma: number;
  distancePct: number;
  regime: "bull" | "bear";
  daysInRegime: number;
  lastCross: string | null;
  weight: number; // peso target attuale nella strategia (0 o 1/N)
  spark: { date: string; close: number; sma: number }[];
}

export interface CryptoTrendStatus {
  config: CryptoTrendConfig;
  asOf: string;
  holdingLabel: string; // es. "Bitcoin 50% · cash 50%"
  cashWeight: number;
  assets: CryptoAssetStatus[];
}

/** Stato corrente del segnale per ciascun asset del paniere. */
export async function analyzeCryptoTrend(partial?: Partial<CryptoTrendConfig>): Promise<CryptoTrendStatus> {
  const cfg = normalizeCryptoTrendConfig(partial);
  const n = cfg.assets.length;
  const weight = n > 0 ? 1 / n : 0;

  const candles = await Promise.all(cfg.assets.map((a) => fetchCandles(a, 2)));
  const statuses: CryptoAssetStatus[] = [];
  let asOf = "";
  const holdParts: string[] = [];

  cfg.assets.forEach((asset, k) => {
    const c = candles[k];
    if (!c || c.length < cfg.smaPeriod + 1) return;
    const closes = c.map((x) => x.close);
    const sma = rollingSma(closes, cfg.smaPeriod);
    const invested = investedSeries(closes, cfg.smaPeriod, cfg.hysteresisPct);
    const last = closes.length - 1;
    const bull = invested[last];
    asOf = c[last].date;

    let daysInRegime = 0;
    let lastCross: string | null = null;
    for (let i = last; i >= cfg.smaPeriod - 1; i--) {
      if (invested[i] === bull) daysInRegime++;
      else { lastCross = c[i + 1]?.date ?? null; break; }
    }

    const sparkFrom = Math.max(cfg.smaPeriod - 1, c.length - 120);
    statuses.push({
      asset,
      name: nameFor(asset),
      asOf: c[last].date,
      price: +closes[last].toFixed(2),
      sma: +sma[last].toFixed(2),
      distancePct: +(((closes[last] - sma[last]) / sma[last]) * 100).toFixed(2),
      regime: bull ? "bull" : "bear",
      daysInRegime,
      lastCross,
      weight: bull ? weight : 0,
      spark: c.slice(sparkFrom).map((x, i) => ({
        date: x.date,
        close: +x.close.toFixed(2),
        sma: +sma[sparkFrom + i].toFixed(2),
      })),
    });
    if (bull) holdParts.push(`${nameFor(asset)} ${Math.round(weight * 100)}%`);
  });

  const investedW = statuses.reduce((s, a) => s + a.weight, 0);
  const cashWeight = +(1 - investedW).toFixed(4);
  if (cashWeight > 0.001) holdParts.push(`cash ${Math.round(cashWeight * 100)}%`);

  return {
    config: cfg,
    asOf,
    holdingLabel: holdParts.length ? holdParts.join(" · ") : "100% cash",
    cashWeight,
    assets: statuses,
  };
}

// ─── Backtest (MTM giornaliero, walk-forward) ───────────────────────────────────
//
// Modello identico a runRotationBacktest: rendimenti total-return (adjClose),
// stato di trend per-coin al close, sleeve equal-weight, slippage sugli switch.
// Benchmark = BTC-USD buy&hold (la domanda onesta: batte l'HODL di bitcoin e ne
// taglia il drawdown?).

function trReturns(candles: Candle[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1].adjClose ?? candles[i - 1].close;
    const b = candles[i].adjClose ?? candles[i].close;
    if (a > 0) m.set(candles[i].date, b / a - 1);
  }
  return m;
}

export interface CryptoWfPeriod {
  start: string;
  end: string;
  strategyReturn: number;
  benchReturn: number;
  maxDrawdown: number;
}

export interface CryptoTrendBtResult {
  config: CryptoTrendConfig;
  startDate: string;
  endDate: string;
  years: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  sharpe: number;
  switches: number;
  timeInvestedPct: number;
  benchSymbol: string;
  benchTotalReturn: number;
  benchCagr: number;
  benchMaxDrawdown: number;
  equity: { date: string; equity: number }[];
  benchEquity: { date: string; equity: number }[];
  perYear: { year: string; strategy: number; bench: number }[];
  walkForward?: {
    periods: CryptoWfPeriod[];
    beatBenchPeriods: number;
    positivePeriods: number;
  };
}

export interface CryptoTrendBtOptions extends Partial<CryptoTrendConfig> {
  years?: number;
  accountSize?: number;
  slippageBps?: number; // per lato, sugli switch di ogni sleeve
  folds?: number;       // walk-forward (0 = off)
  benchSymbol?: string; // default BTC-USD buy&hold
}

export async function runCryptoTrendBacktest(options: CryptoTrendBtOptions = {}): Promise<CryptoTrendBtResult> {
  const cfg = normalizeCryptoTrendConfig(options);
  const years = Math.min(20, Math.max(1, options.years ?? 12));
  const accountSize = options.accountSize ?? 10000;
  const slip = (options.slippageBps ?? 8) / 10000; // crypto: spread/slippage più alti
  const folds = options.folds ?? 0;
  const benchSymbol = options.benchSymbol ?? "BTC-USD";
  const hyst = cfg.hysteresisPct / 100;
  const n = cfg.assets.length;
  const weight = n > 0 ? 1 / n : 0;

  // Dati: paniere strategia + benchmark. L'asse date è l'intersezione (ogni coin
  // scambia 7/7 quindi le date combaciano; ci allineiamo comunque per data).
  const symbols = [...new Set([...cfg.assets, benchSymbol])];
  const fetched = await Promise.all(symbols.map((s) => fetchCandles(s, years)));
  const bySym = new Map<string, Candle[]>(symbols.map((s, i) => [s, fetched[i]]));

  // Calendario: dall'asset con lo storico più corto tra quelli in paniere (così
  // tutti hanno dati). Usiamo il benchmark come riferimento di calendario.
  const bench = bySym.get(benchSymbol)!;
  if (!bench || bench.length < cfg.smaPeriod + 30) {
    throw new Error(`Dati ${benchSymbol} insufficienti (${bench?.length ?? 0} barre)`);
  }

  // Serie di close raw e SMA per il segnale, e mappe di rendimento TR per asset.
  const closesBy: Record<string, number[]> = {};
  const smaBy: Record<string, number[]> = {};
  const trBy: Record<string, Map<string, number>> = {};
  for (const s of cfg.assets) {
    const c = bySym.get(s)!;
    closesBy[s] = c.map((x) => x.close);
    smaBy[s] = rollingSma(closesBy[s], cfg.smaPeriod);
    trBy[s] = trReturns(c);
  }
  trBy[benchSymbol] = trReturns(bench);

  // Indice di stato trend per asset lungo il calendario del benchmark, con
  // isteresi ricostruita sulla serie propria dell'asset per data.
  const dates = bench.map((c) => c.date);
  const dateIdxBy: Record<string, Map<string, number>> = {};
  for (const s of cfg.assets) {
    const c = bySym.get(s)!;
    dateIdxBy[s] = new Map(c.map((x, i) => [x.date, i]));
  }
  const investedBy: Record<string, boolean[]> = {};
  for (const s of cfg.assets) investedBy[s] = investedSeries(closesBy[s], cfg.smaPeriod, hyst);

  // Stato bull dell'asset alla data `d` (false se non ha ancora dati/SMA).
  const bullAt = (s: string, d: string): boolean => {
    const i = dateIdxBy[s].get(d);
    if (i == null) return false;
    return investedBy[s][i];
  };
  const firstUsableDate = (s: string): string => {
    const c = bySym.get(s)!;
    return c[cfg.smaPeriod]?.date ?? c[c.length - 1]?.date ?? dates[0];
  };

  // Finestra: dalla data in cui TUTTI gli asset hanno SMA valida, tagliata a `years`.
  const startDateStr = cfg.assets.reduce((mx, s) => {
    const d = firstUsableDate(s);
    return d > mx ? d : mx;
  }, dates[0]);
  let startIdx = Math.max(0, dates.findIndex((d) => d >= startDateStr));
  if (startIdx < 0) startIdx = cfg.smaPeriod;
  const lastIdx = dates.length - 1;
  const wantBars = Math.round(years * 365);
  if (lastIdx - startIdx + 1 > wantBars) startIdx = lastIdx - wantBars + 1;

  interface Slice {
    equity: { date: string; equity: number }[];
    benchEquity: { date: string; equity: number }[];
    totalReturn: number;
    benchReturn: number;
    maxDrawdown: number;
    benchMaxDrawdown: number;
    sharpe: number;
    switches: number;
    investedDays: number; // giorni con almeno una coin tenuta
    days: number;
  }

  function simulate(from: number, to: number): Slice {
    let eq = accountSize;
    let benchEq = accountSize;
    let peak = eq, dd = 0, bPeak = benchEq, bDd = 0;
    let switches = 0, investedDays = 0;
    const rets: number[] = [];
    const curve: { date: string; equity: number }[] = [];
    const bCurve: { date: string; equity: number }[] = [];

    // Stato iniziale = stato al giorno prima dell'inizio finestra.
    const prevDate = dates[from - 1] ?? dates[from];
    let held: Record<string, boolean> = {};
    for (const s of cfg.assets) held[s] = from > 0 ? bullAt(s, prevDate) : false;

    for (let i = from; i <= to; i++) {
      const d = dates[i];
      // Rendimento del giorno = media pesata degli sleeve tenuti (cash = 0).
      let r = 0;
      let anyHeld = false;
      for (const s of cfg.assets) {
        if (held[s]) {
          r += weight * (trBy[s].get(d) ?? 0);
          anyHeld = true;
        }
      }
      eq *= 1 + r;
      rets.push(r);
      if (anyHeld) investedDays++;
      benchEq *= 1 + (trBy[benchSymbol].get(d) ?? 0);

      peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak);
      bPeak = Math.max(bPeak, benchEq); bDd = Math.max(bDd, (bPeak - benchEq) / bPeak);

      // Rivaluta lo stato di trend al close di oggi; ogni sleeve che cambia paga slippage.
      const next: Record<string, boolean> = {};
      for (const s of cfg.assets) {
        next[s] = bullAt(s, d);
        if (next[s] !== held[s]) { eq *= 1 - weight * slip; switches++; }
      }
      held = next;

      curve.push({ date: d, equity: +eq.toFixed(2) });
      bCurve.push({ date: d, equity: +benchEq.toFixed(2) });
    }

    const mean = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
    const std = rets.length ? Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length) : 0;
    return {
      equity: curve,
      benchEquity: bCurve,
      totalReturn: +(((eq - accountSize) / accountSize) * 100).toFixed(1),
      benchReturn: +(((benchEq - accountSize) / accountSize) * 100).toFixed(1),
      maxDrawdown: +(dd * 100).toFixed(1),
      benchMaxDrawdown: +(bDd * 100).toFixed(1),
      sharpe: std > 0 ? +((mean / std) * Math.sqrt(365)).toFixed(2) : 0,
      switches,
      investedDays,
      days: to - from + 1,
    };
  }

  const full = simulate(startIdx, lastIdx);
  const yrs = full.days / 365;
  const finalEq = full.equity[full.equity.length - 1].equity;
  const finalBench = full.benchEquity[full.benchEquity.length - 1].equity;

  const perYear: { year: string; strategy: number; bench: number }[] = [];
  let yStart = 0;
  for (let k = 1; k <= full.equity.length; k++) {
    const isEnd = k === full.equity.length || full.equity[k].date.slice(0, 4) !== full.equity[yStart].date.slice(0, 4);
    if (isEnd) {
      const e0 = yStart > 0 ? full.equity[yStart - 1].equity : accountSize;
      const b0 = yStart > 0 ? full.benchEquity[yStart - 1].equity : accountSize;
      perYear.push({
        year: full.equity[yStart].date.slice(0, 4),
        strategy: +(((full.equity[k - 1].equity - e0) / e0) * 100).toFixed(1),
        bench: +(((full.benchEquity[k - 1].equity - b0) / b0) * 100).toFixed(1),
      });
      yStart = k;
    }
  }

  let walkForward: CryptoTrendBtResult["walkForward"];
  if (folds >= 2) {
    const span = lastIdx - startIdx + 1;
    const periods: CryptoWfPeriod[] = [];
    for (let k = 0; k < folds; k++) {
      const from = startIdx + Math.floor((span * k) / folds);
      const to = k === folds - 1 ? lastIdx : startIdx + Math.floor((span * (k + 1)) / folds) - 1;
      if (to <= from) continue;
      const s = simulate(from, to);
      periods.push({
        start: dates[from],
        end: dates[to],
        strategyReturn: s.totalReturn,
        benchReturn: s.benchReturn,
        maxDrawdown: s.maxDrawdown,
      });
    }
    walkForward = {
      periods,
      beatBenchPeriods: periods.filter((p) => p.strategyReturn > p.benchReturn).length,
      positivePeriods: periods.filter((p) => p.strategyReturn > 0).length,
    };
  }

  return {
    config: cfg,
    startDate: dates[startIdx],
    endDate: dates[lastIdx],
    years: +yrs.toFixed(1),
    totalReturn: full.totalReturn,
    cagr: +((Math.pow(finalEq / accountSize, 1 / yrs) - 1) * 100).toFixed(1),
    maxDrawdown: full.maxDrawdown,
    sharpe: full.sharpe,
    switches: full.switches,
    timeInvestedPct: +((full.investedDays / full.days) * 100).toFixed(0),
    benchSymbol,
    benchTotalReturn: full.benchReturn,
    benchCagr: +((Math.pow(finalBench / accountSize, 1 / yrs) - 1) * 100).toFixed(1),
    benchMaxDrawdown: full.benchMaxDrawdown,
    equity: full.equity,
    benchEquity: full.benchEquity,
    perYear,
    walkForward,
  };
}
