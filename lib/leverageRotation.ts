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
  /**
   * Banda anti-whipsaw attorno alla SMA (%): esci solo sotto SMA×(1−h),
   * rientri solo sopra SMA×(1+h). Default 2 — validato su 33 anni (1993-2026,
   * 4 bear market): batte SPY in 6/6 periodi walk-forward, CAGR 14,6% vs 10,9%,
   * DD 39% vs 55%, switch 222→58. Plateau solido su h=1,5-3.
   */
  hysteresisPct: number;
}

export const DEFAULT_ROTATION: RotationConfig = { bull: "SSO", defensive: "BIL", smaPeriod: 200, hysteresisPct: 2 };

export function normalizeRotationConfig(partial?: Partial<RotationConfig>): RotationConfig {
  const bull = BULL_ASSETS.includes((partial?.bull ?? "") as (typeof BULL_ASSETS)[number])
    ? partial!.bull!
    : DEFAULT_ROTATION.bull;
  const defensive = DEFENSIVE_ASSETS.includes((partial?.defensive ?? "") as (typeof DEFENSIVE_ASSETS)[number])
    ? partial!.defensive!
    : DEFAULT_ROTATION.defensive;
  const smaPeriod = Math.min(300, Math.max(50, Math.round(partial?.smaPeriod ?? DEFAULT_ROTATION.smaPeriod)));
  const hysteresisPct = Math.min(5, Math.max(0, partial?.hysteresisPct ?? DEFAULT_ROTATION.hysteresisPct));
  return { bull, defensive, smaPeriod, hysteresisPct };
}

/**
 * Replay deterministico del regime con isteresi: invested[i] = true se al close
 * della barra i si è nell'asset bull. Dentro la banda [SMA×(1−h), SMA×(1+h)]
 * lo stato precedente viene mantenuto — per questo serve il replay dall'inizio.
 */
export function investedSeries(closes: number[], smaPeriod: number, hysteresisPct: number): boolean[] {
  const sma = rollingSma(closes, smaPeriod);
  const h = hysteresisPct / 100;
  const out = new Array<boolean>(closes.length).fill(false);
  let invested = false;
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(sma[i])) {
      if (invested) invested = closes[i] > sma[i] * (1 - h);
      else invested = closes[i] > sma[i] * (1 + h);
    }
    out[i] = invested;
  }
  return out;
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
  const bull = investedSeries(closes, cfg.smaPeriod, cfg.hysteresisPct)[last];
  const dist = ((closes[last] - sma[last]) / sma[last]) * 100;
  steps.push(
    `SPY ${closes[last].toFixed(2)} vs SMA${cfg.smaPeriod} ${sma[last].toFixed(2)} ` +
    `(${dist >= 0 ? "+" : ""}${dist.toFixed(1)}%, banda anti-whipsaw ±${cfg.hysteresisPct}%) → ` +
    `regime ${bull ? "rialzista → " + cfg.bull : "ribassista → " + cfg.defensive}.`
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
  const invested = investedSeries(closes, cfg.smaPeriod, cfg.hysteresisPct);
  const bull = invested[last];

  // Barre consecutive nel regime attuale + data dell'ultimo switch effettivo.
  let daysInRegime = 0;
  let lastCross: string | null = null;
  for (let i = last; i >= cfg.smaPeriod - 1; i--) {
    if (invested[i] === bull) daysInRegime++;
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
//
// Due sorgenti dati:
// - shallow (default): ~5 anni, solo ETF reali — comportamento storico della pagina.
// - deep: ~33 anni. SPY reale dal 1993 (il segnale SMA usa il close raw; i
//   rendimenti usano adjClose = total return, dividendi inclusi). Dove l'ETF a
//   leva non esiste ancora (SSO < 2006, TQQQ < 2010) la serie è sintetica:
//     r_lev = L × r_base − (L−1) × r_cash − fee_giornaliera
//   con r_cash dal rendimento ^IRX (T-bill 13 settimane). La qualità della
//   sintesi è misurata sull'overlap con l'ETF reale e riportata nel risultato.
//
// Varianti anti-whipsaw (da validare, non default):
// - hysteresisPct: esci solo sotto SMA×(1−h), rientra solo sopra SMA×(1+h).
// - mode "ladder": sopra SMA200 e SMA50 → leva; solo SMA200 → base 1×; sotto → difensivo.

const LEV_SPEC: Record<string, { base: string; l: number; feeAnnualPct: number }> = {
  SSO: { base: "SPY", l: 2, feeAnnualPct: 0.89 },
  TQQQ: { base: "QQQ", l: 3, feeAnnualPct: 0.86 },
};

/** Rendimento giornaliero total-return (adjClose) per data. */
function trMap(candles: Candle[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1].adjClose ?? candles[i - 1].close;
    const b = candles[i].adjClose ?? candles[i].close;
    if (a > 0) m.set(candles[i].date, b / a - 1);
  }
  return m;
}

interface SeriesView {
  dates: string[];        // calendario di trading (SPY)
  signalClose: number[];  // SPY close raw per il segnale SMA
  retOf: (asset: string, i: number) => number; // TR giornaliero di asset a dates[i]
  midAsset: string;       // asset 1× per la modalità ladder
  bullFrom: string;       // prima data con dati (reali o sintetici) per l'asset bull
  note?: string;          // qualità della serie sintetica (solo deep)
}

async function loadView(cfg: RotationConfig, deep: boolean, years: number): Promise<SeriesView> {
  const midAsset = LEV_SPEC[cfg.bull]?.base ?? cfg.bull;
  const horizon = deep ? 35 : years;
  const tickers = [...new Set(["SPY", midAsset, cfg.bull, ...(cfg.defensive === "CASH" ? [] : [cfg.defensive])])];

  const fetched = await Promise.all([
    ...tickers.map((t) => fetchCandles(t, horizon)),
    ...(deep ? [fetchCandles("^IRX", horizon)] : []),
  ]);
  const bySym = new Map<string, Candle[]>(tickers.map((t, i) => [t, fetched[i]]));
  const spy = bySym.get("SPY")!;
  if (spy.length < cfg.smaPeriod + 30) throw new Error(`Dati SPY insufficienti (${spy.length} barre)`);

  const dates = spy.map((c) => c.date);
  const signalClose = spy.map((c) => c.close);
  const tr = new Map<string, Map<string, number>>();
  for (const t of tickers) tr.set(t, trMap(bySym.get(t)!));

  // Cash giornaliero: BIL reale dove esiste, altrimenti accrual da ^IRX (deep).
  const irx = deep ? new Map((fetched[tickers.length] ?? []).map((c) => [c.date, c.close])) : new Map<string, number>();
  let lastIrx = 3; // % annuo, fallback conservativo
  const cashRetByDate = new Map<string, number>();
  if (deep) {
    const bilTr = tr.get("BIL");
    for (const d of dates) {
      const y = irx.get(d);
      if (y != null && y > 0 && y < 25) lastIrx = y;
      const real = bilTr?.get(d);
      cashRetByDate.set(d, real ?? lastIrx / 100 / 252);
    }
  }
  const cashRet = (d: string) => cashRetByDate.get(d) ?? 0;

  // Serie sintetica per l'asset a leva dove l'ETF reale non esiste.
  let note: string | undefined;
  const spec = LEV_SPEC[cfg.bull];
  const synth = new Map<string, number>();
  if (deep && spec) {
    const baseTr = tr.get(spec.base)!;
    const feeDaily = spec.feeAnnualPct / 100 / 252;
    for (const d of dates) {
      const rb = baseTr.get(d);
      if (rb != null) synth.set(d, spec.l * rb - (spec.l - 1) * cashRet(d) - feeDaily);
    }
    // Qualità: CAGR sintetico vs reale sull'overlap.
    const realTr = tr.get(cfg.bull)!;
    let cumS = 1, cumR = 1, n = 0;
    for (const d of dates) {
      const rr = realTr.get(d);
      const rs = synth.get(d);
      if (rr != null && rs != null) { cumR *= 1 + rr; cumS *= 1 + rs; n++; }
    }
    if (n > 252) {
      const yrs = n / 252;
      const diff = (Math.pow(cumS, 1 / yrs) - Math.pow(cumR, 1 / yrs)) * 100;
      const realFrom = bySym.get(cfg.bull)![0]?.date ?? "?";
      note = `${cfg.bull} sintetico prima del ${realFrom}: tracking vs ETF reale ${diff >= 0 ? "+" : ""}${diff.toFixed(2)} pt CAGR su ${yrs.toFixed(1)} anni di overlap`;
    }
  }

  const retOf = (asset: string, i: number): number => {
    const d = dates[i];
    if (asset === "CASH") return 0;
    if (asset === cfg.defensive && deep) return cashRet(d); // BIL sintetico pre-2007
    const real = tr.get(asset)?.get(d);
    if (real != null) return real;
    if (asset === cfg.bull) return synth.get(d) ?? 0;
    return 0;
  };

  // Prima data utile per l'asset bull (reale o sintetico) e per il mid (ladder).
  const firstOf = (m?: Map<string, number>) => {
    let min: string | null = null;
    for (const d of m?.keys() ?? []) if (min === null || d < min) min = d;
    return min;
  };
  const bullReal = firstOf(tr.get(cfg.bull));
  const bullSynth = firstOf(synth);
  const midFirst = firstOf(tr.get(midAsset));
  let bullFrom = bullReal && bullSynth ? (bullSynth < bullReal ? bullSynth : bullReal) : bullReal ?? bullSynth ?? dates[0];
  if (midFirst && midFirst > bullFrom) bullFrom = midFirst; // il ladder richiede anche il mid

  return { dates, signalClose, retOf, midAsset, bullFrom, note };
}

export interface RotationWfPeriod {
  start: string;
  end: string;
  strategyReturn: number;
  spyReturn: number;
  maxDrawdown: number;
}

export interface RotationBtResult {
  config: RotationConfig;
  mode: "binary" | "ladder";
  hysteresisPct: number;
  deep: boolean;
  startDate: string;
  endDate: string;
  years: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  sharpe: number;
  switches: number;
  timeInvestedPct: number; // % giorni nell'asset a leva
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
  dataNote?: string;
}

export interface RotationBtOptions extends Partial<RotationConfig> {
  years?: number;         // storia (fino a ~33 con deep)
  deep?: boolean;         // storico esteso con leva sintetica
  accountSize?: number;
  slippageBps?: number;   // per lato, sugli switch
  folds?: number;         // walk-forward (0 = off)
  mode?: "binary" | "ladder"; // ladder testato e bocciato su 33y (CAGR 8,2 vs 14,6) — resta per esperimenti
}

export async function runRotationBacktest(options: RotationBtOptions = {}): Promise<RotationBtResult> {
  const cfg = normalizeRotationConfig(options);
  const deep = options.deep ?? false;
  const years = Math.min(deep ? 35 : 5, Math.max(1, options.years ?? (deep ? 35 : 5)));
  const accountSize = options.accountSize ?? 10000;
  const slip = (options.slippageBps ?? 5) / 10000;
  const folds = options.folds ?? 0;
  const hyst = cfg.hysteresisPct / 100;
  const mode = options.mode ?? "binary";

  const view = await loadView(cfg, deep, years);
  const { dates, signalClose, retOf, midAsset } = view;
  const smaMain = rollingSma(signalClose, cfg.smaPeriod);
  const sma50 = rollingSma(signalClose, 50);

  // Finestra effettiva: warmup SMA, disponibilità dati dell'asset, taglio a `years`.
  let startIdx = Math.max(cfg.smaPeriod, 200) + 5;
  const firstBullIdx = dates.findIndex((d) => d >= view.bullFrom);
  if (firstBullIdx > startIdx) startIdx = firstBullIdx + 1;
  const lastIdx = dates.length - 1;
  const wantBars = Math.round(years * 252);
  if (lastIdx - startIdx + 1 > wantBars) startIdx = lastIdx - wantBars + 1;

  type State = "bull" | "mid" | "def";
  const assetOf = (s: State) => (s === "bull" ? cfg.bull : s === "mid" ? midAsset : cfg.defensive);

  // Stato desiderato al close della barra i, con isteresi sulla SMA principale.
  const desired = (i: number, cur: State): State => {
    const c = signalClose[i];
    const m = smaMain[i];
    if (isNaN(m)) return cur;
    const invested = cur !== "def";
    const aboveMain = invested ? c > m * (1 - hyst) : c > m * (1 + hyst);
    if (!aboveMain) return "def";
    if (mode === "ladder") return c > sma50[i] ? "bull" : "mid";
    return "bull";
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

  function simulate(from: number, to: number): Slice {
    let eq = accountSize, spyEq = accountSize;
    let peak = eq, dd = 0, spyPeak = spyEq, spyDd = 0;
    let switches = 0, bullDays = 0;
    const rets: number[] = [];
    let state: State = desired(from - 1, "def");
    const curve: { date: string; equity: number }[] = [];
    const spyCurve: { date: string; equity: number }[] = [];

    for (let i = from; i <= to; i++) {
      const r = retOf(assetOf(state), i);
      eq *= 1 + r;
      rets.push(r);
      if (state === "bull") bullDays++;
      spyEq *= 1 + retOf("SPY", i);
      peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak);
      spyPeak = Math.max(spyPeak, spyEq); spyDd = Math.max(spyDd, (spyPeak - spyEq) / spyPeak);
      const want = desired(i, state);
      if (want !== state) { eq *= 1 - 2 * slip; switches++; state = want; }
      curve.push({ date: dates[i], equity: +eq.toFixed(2) });
      spyCurve.push({ date: dates[i], equity: +spyEq.toFixed(2) });
    }

    const mean = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
    const std = rets.length ? Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length) : 0;
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

  const full = simulate(startIdx, lastIdx);
  const yrs = full.days / 252;
  const finalEq = full.equity[full.equity.length - 1].equity;
  const finalSpy = full.spyEquity[full.spyEquity.length - 1].equity;

  // Rendimenti per anno solare (capitale composto)
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
    mode,
    hysteresisPct: +(hyst * 100).toFixed(2),
    deep,
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
    dataNote: view.note,
  };
}
