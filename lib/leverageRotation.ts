/**
 * Rotazione a leva con filtro di regime — "Leverage for the Long Run"
 * ====================================================================
 * (Gayed, Dow Award 2016, testata 1928-2020.)
 *
 * Regola unica e meccanica: al close, se SPY > SMA(N) → investito al 100%
 * nell'asset "bull" (default SSO, S&P a leva 2×); se SPY < SMA(N) → 100%
 * nell'asset difensivo (default BIL, T-bill). Switch al close successivo.
 *
 * Perché funziona: la leva soffre il volatility decay nel chop e i crash;
 * sopra la SMA200 la volatilità è statisticamente più bassa e i trend
 * persistono → la leva compone. Sotto, si sta fuori. Non è stock picking:
 * è beta condizionale al regime.
 *
 * Validazione (motore dati del repo, mag 2022 → lug 2026, SPY B&H +78,9%
 * con DD 19%): SSO/BIL +100% (DD 20,1%), QQQ/cash +88,5% (DD 13,8%),
 * TQQQ/BIL +263% (DD 38,8%). ~5 switch/anno. Il timing da solo (SPY/cash)
 * PERDE contro buy&hold: è la leva a generare l'extra-rendimento, il filtro
 * la rende sopravvivibile (2022: TQQQ nudo -79%, con filtro -6%).
 */

import type { Candle } from "./types";
import { fetchCandles } from "./marketData";

export const BULL_ASSETS = ["SSO", "QQQ", "TQQQ", "SPY"] as const;
export const DEFENSIVE_ASSETS = ["BIL", "CASH"] as const;

export const ASSET_NAMES: Record<string, string> = {
  SSO: "S&P 500 leva 2×",
  TQQQ: "Nasdaq 100 leva 3×",
  QQQ: "Nasdaq 100",
  SPY: "S&P 500",
  BIL: "T-bill 1-3 mesi",
  CASH: "Cash",
};

export interface RotationConfig {
  bull: string;      // asset in regime rialzista
  defensive: string; // asset (o CASH) in regime ribassista
  smaPeriod: number; // periodo della SMA sul segnale SPY (default 200)
}

export const DEFAULT_ROTATION: RotationConfig = { bull: "SSO", defensive: "BIL", smaPeriod: 200 };

export function normalizeRotationConfig(partial?: Partial<RotationConfig>): RotationConfig {
  const bull = BULL_ASSETS.includes((partial?.bull ?? "") as (typeof BULL_ASSETS)[number])
    ? partial!.bull!
    : DEFAULT_ROTATION.bull;
  const defensive = DEFENSIVE_ASSETS.includes((partial?.defensive ?? "") as (typeof DEFENSIVE_ASSETS)[number])
    ? partial!.defensive!
    : DEFAULT_ROTATION.defensive;
  const smaPeriod = Math.min(300, Math.max(50, Math.round(partial?.smaPeriod ?? DEFAULT_ROTATION.smaPeriod)));
  return { bull, defensive, smaPeriod };
}

// ─── Segnale ──────────────────────────────────────────────────────────────────

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

export interface RotationStatus {
  config: RotationConfig;
  asOf: string;           // data ultima barra
  regime: "bull" | "bear";
  holding: string;        // asset da detenere ora
  holdingName: string;
  spyClose: number;
  sma: number;
  distancePct: number;    // distanza % del close dalla SMA
  daysInRegime: number;   // barre consecutive nel regime attuale
  lastCross: string | null; // data dell'ultimo incrocio
  spark: { date: string; close: number; sma: number }[]; // ultime ~120 barre
}

/** Decisione target per il motore autopilot: { targets, steps }. */
export function rotationDecision(
  spyCandles: Candle[],
  cfg: RotationConfig
): { targets: Record<string, number>; cashWeight: number; steps: string[] } {
  const steps: string[] = [];
  const closes = spyCandles.map((c) => c.close);
  if (closes.length < cfg.smaPeriod + 1) {
    steps.push(`Dati SPY insufficienti (${closes.length} barre < ${cfg.smaPeriod}). Resto in difensivo.`);
    const targets = cfg.defensive === "CASH" ? {} : { [cfg.defensive]: 1 };
    return { targets, cashWeight: cfg.defensive === "CASH" ? 1 : 0, steps };
  }
  const sma = rollingSma(closes, cfg.smaPeriod);
  const last = closes.length - 1;
  const bull = closes[last] > sma[last];
  const dist = ((closes[last] - sma[last]) / sma[last]) * 100;
  steps.push(
    `SPY ${closes[last].toFixed(2)} vs SMA${cfg.smaPeriod} ${sma[last].toFixed(2)} → ` +
    `${bull ? "SOPRA" : "SOTTO"} (${dist >= 0 ? "+" : ""}${dist.toFixed(1)}%). ` +
    `Regime ${bull ? "rialzista → " + cfg.bull : "ribassista → " + cfg.defensive}.`
  );
  const asset = bull ? cfg.bull : cfg.defensive;
  const targets = asset === "CASH" ? {} : { [asset]: 1 };
  return { targets, cashWeight: asset === "CASH" ? 1 : 0, steps };
}

/** Stato attuale del segnale, per la pagina Rotazione. */
export async function analyzeRotation(partial?: Partial<RotationConfig>): Promise<RotationStatus> {
  const cfg = normalizeRotationConfig(partial);
  const spy = await fetchCandles("SPY", 2);
  if (spy.length < cfg.smaPeriod + 1) throw new Error(`Dati SPY insufficienti (${spy.length} barre)`);

  const closes = spy.map((c) => c.close);
  const sma = rollingSma(closes, cfg.smaPeriod);
  const last = closes.length - 1;
  const bull = closes[last] > sma[last];

  // Barre consecutive nel regime attuale + data dell'ultimo incrocio.
  let daysInRegime = 0;
  let lastCross: string | null = null;
  for (let i = last; i >= cfg.smaPeriod - 1; i--) {
    if (closes[i] > sma[i] === bull) daysInRegime++;
    else { lastCross = spy[i + 1]?.date ?? null; break; }
  }

  const holding = bull ? cfg.bull : cfg.defensive;
  const sparkFrom = Math.max(cfg.smaPeriod - 1, spy.length - 120);
  return {
    config: cfg,
    asOf: spy[last].date,
    regime: bull ? "bull" : "bear",
    holding,
    holdingName: ASSET_NAMES[holding] ?? holding,
    spyClose: +closes[last].toFixed(2),
    sma: +sma[last].toFixed(2),
    distancePct: +(((closes[last] - sma[last]) / sma[last]) * 100).toFixed(2),
    daysInRegime,
    lastCross,
    spark: spy.slice(sparkFrom).map((c, k) => ({
      date: c.date,
      close: +c.close.toFixed(2),
      sma: +sma[sparkFrom + k].toFixed(2),
    })),
  };
}

// ─── Backtest ─────────────────────────────────────────────────────────────────

export interface RotationWfPeriod {
  start: string;
  end: string;
  strategyReturn: number; // % del periodo (capitale fresco)
  spyReturn: number;      // % SPY B&H stesso periodo
  maxDrawdown: number;    // % della strategia nel periodo
}

export interface RotationBtResult {
  config: RotationConfig;
  startDate: string;
  endDate: string;
  years: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  sharpe: number;         // su rendimenti giornalieri MTM
  switches: number;
  timeInvestedPct: number; // % di giorni nel bull asset
  spyTotalReturn: number;
  spyCagr: number;
  spyMaxDrawdown: number;
  equity: { date: string; equity: number }[];
  spyEquity: { date: string; equity: number }[];
  perYear: { year: string; strategy: number; spy: number }[];
  walkForward?: {
    periods: RotationWfPeriod[];
    beatSpyPeriods: number;
    positivePeriods: number;
  };
}

export interface RotationBtOptions extends Partial<RotationConfig> {
  years?: number;        // storia richiesta (max ~5 con Yahoo), default 5
  accountSize?: number;  // default 10000
  slippageBps?: number;  // per lato, sugli switch (default 5)
  folds?: number;        // walk-forward (0 = off)
}

export async function runRotationBacktest(options: RotationBtOptions = {}): Promise<RotationBtResult> {
  const cfg = normalizeRotationConfig(options);
  const years = Math.min(5, Math.max(1, options.years ?? 5));
  const accountSize = options.accountSize ?? 10000;
  const slip = (options.slippageBps ?? 5) / 10000;
  const folds = options.folds ?? 0;

  const tickers = [...new Set(["SPY", cfg.bull, ...(cfg.defensive === "CASH" ? [] : [cfg.defensive])])];
  const data = new Map<string, Map<string, number>>();
  const [spy, ...rest] = await Promise.all(tickers.map((t) => fetchCandles(t, years)));
  if (spy.length < cfg.smaPeriod + 30) throw new Error(`Dati SPY insufficienti (${spy.length} barre)`);
  data.set("SPY", new Map(spy.map((c) => [c.date, c.close])));
  rest.forEach((candles, i) => data.set(tickers[i + 1], new Map(candles.map((c) => [c.date, c.close]))));

  const dates = spy.map((c) => c.date);
  const closes = spy.map((c) => c.close);
  const sma = rollingSma(closes, cfg.smaPeriod);
  const startIdx = cfg.smaPeriod + 5; // warmup SMA

  const dailyRet = (sym: string, i: number): number => {
    if (sym === "CASH") return 0;
    const m = data.get(sym)!;
    const a = m.get(dates[i - 1]);
    const b = m.get(dates[i]);
    return a && b && a > 0 ? b / a - 1 : 0;
  };

  interface Slice {
    equity: { date: string; equity: number }[];
    spyEquity: { date: string; equity: number }[];
    totalReturn: number;
    spyReturn: number;
    maxDrawdown: number;
    spyMaxDrawdown: number;
    sharpe: number;
    switches: number;
    bullDays: number;
    days: number;
  }

  // Simula [from, to] con capitale fresco. Segnale al close t → asset da t+1.
  function simulate(from: number, to: number): Slice {
    let eq = accountSize, spyEq = accountSize;
    let peak = eq, dd = 0, spyPeak = spyEq, spyDd = 0;
    let switches = 0, bullDays = 0;
    const rets: number[] = [];
    let pos: string = closes[from - 1] > sma[from - 1] ? cfg.bull : cfg.defensive;
    const curve: { date: string; equity: number }[] = [];
    const spyCurve: { date: string; equity: number }[] = [];

    for (let i = from; i <= to; i++) {
      const r = dailyRet(pos, i);
      eq *= 1 + r;
      rets.push(r);
      if (pos === cfg.bull) bullDays++;
      spyEq *= 1 + dailyRet("SPY", i);
      peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak);
      spyPeak = Math.max(spyPeak, spyEq); spyDd = Math.max(spyDd, (spyPeak - spyEq) / spyPeak);
      // segnale al close di oggi → eventuale switch (costo su entrambe le gambe)
      const want = closes[i] > sma[i] ? cfg.bull : cfg.defensive;
      if (want !== pos) { eq *= 1 - 2 * slip; switches++; pos = want; }
      curve.push({ date: dates[i], equity: +eq.toFixed(2) });
      spyCurve.push({ date: dates[i], equity: +spyEq.toFixed(2) });
    }

    const mean = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
    const std = rets.length
      ? Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length)
      : 0;
    return {
      equity: curve,
      spyEquity: spyCurve,
      totalReturn: +(((eq - accountSize) / accountSize) * 100).toFixed(1),
      spyReturn: +(((spyEq - accountSize) / accountSize) * 100).toFixed(1),
      maxDrawdown: +(dd * 100).toFixed(1),
      spyMaxDrawdown: +(spyDd * 100).toFixed(1),
      sharpe: std > 0 ? +((mean / std) * Math.sqrt(252)).toFixed(2) : 0,
      switches,
      bullDays,
      days: to - from + 1,
    };
  }

  const lastIdx = dates.length - 1;
  const full = simulate(startIdx, lastIdx);
  const yrs = full.days / 252;
  const finalEq = full.equity[full.equity.length - 1].equity;
  const finalSpy = full.spyEquity[full.spyEquity.length - 1].equity;

  // Rendimenti per anno solare (capitale composto, non fresco)
  const perYear: { year: string; strategy: number; spy: number }[] = [];
  let yStart = 0;
  for (let k = 1; k <= full.equity.length; k++) {
    const isEnd = k === full.equity.length || full.equity[k].date.slice(0, 4) !== full.equity[yStart].date.slice(0, 4);
    if (isEnd) {
      const e0 = yStart > 0 ? full.equity[yStart - 1].equity : accountSize;
      const s0 = yStart > 0 ? full.spyEquity[yStart - 1].equity : accountSize;
      perYear.push({
        year: full.equity[yStart].date.slice(0, 4),
        strategy: +(((full.equity[k - 1].equity - e0) / e0) * 100).toFixed(1),
        spy: +(((full.spyEquity[k - 1].equity - s0) / s0) * 100).toFixed(1),
      });
      yStart = k;
    }
  }

  let walkForward: RotationBtResult["walkForward"];
  if (folds >= 2) {
    const span = lastIdx - startIdx + 1;
    const periods: RotationWfPeriod[] = [];
    for (let k = 0; k < folds; k++) {
      const from = startIdx + Math.floor((span * k) / folds);
      const to = k === folds - 1 ? lastIdx : startIdx + Math.floor((span * (k + 1)) / folds) - 1;
      if (to <= from) continue;
      const s = simulate(from, to);
      periods.push({
        start: dates[from],
        end: dates[to],
        strategyReturn: s.totalReturn,
        spyReturn: s.spyReturn,
        maxDrawdown: s.maxDrawdown,
      });
    }
    walkForward = {
      periods,
      beatSpyPeriods: periods.filter((p) => p.strategyReturn > p.spyReturn).length,
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
    timeInvestedPct: +((full.bullDays / full.days) * 100).toFixed(0),
    spyTotalReturn: full.spyReturn,
    spyCagr: +((Math.pow(finalSpy / accountSize, 1 / yrs) - 1) * 100).toFixed(1),
    spyMaxDrawdown: full.spyMaxDrawdown,
    equity: full.equity,
    spyEquity: full.spyEquity,
    perYear,
    walkForward,
  };
}
