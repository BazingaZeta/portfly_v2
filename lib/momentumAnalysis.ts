/**
 * Momentum RS Analysis
 * ====================
 * Inspired by the portfly-python-refactor approach:
 * - For each stock, compute the "meta-stock" = stock_close / benchmark_close (daily ratio)
 * - Apply a regression channel to this ratio series → signal comes from the meta-stock trend
 * - Rank all stocks by a composite RS score (RS_30d × 0.2 + RS_90d × 0.5 + RS_180d × 0.3)
 * - BUY: meta-stock channel ascending AND near lower band (mean-reversion within uptrend)
 * - WAIT: ascending but overextended or RS ambiguous
 * - AVOID: descending or flat meta-stock
 *
 * Nota (audit 2026-07, v3): logica validata walk-forward 5-fold 2021-2026 con
 * equity marcata a mercato — ogni fold PF ≥ 1.0, incluso il chop 2021-22:
 *   - entry: canale meta ascendente PULITO (R² ≥ 0.7) + z ≤ 0.5, con SPY > SMA200
 *   - exit:  trailing 3 × ATR + rottura del trend meta (niente target fisso:
 *            il target a +6% medio troncava la coda destra dei winner)
 *   - sizing: equal weight — il rischio fisso per trade penalizzava i leader
 * Il backtest (/api/momentum/backtest) usa questi default; gli stop/target
 * mostrati qui sono i livelli iniziali indicativi del canale prezzo.
 */
const BUY_MIN_R2 = 0.7; // canale meta "pulito": sotto, il trend è rumore (v3)

import { fetchCandles } from "./marketData";
import { regressionChannel, type RegressionChannel } from "./regression";
import { indexByKey } from "./indices";
import { nameFor } from "./universe";
import type { Candle } from "./types";

const META_WINDOW = 60;  // bars for the meta-stock regression channel
const PRICE_WINDOW = 40; // bars for the raw-price channel (stop/target)

export type MomentumSignal = "BUY" | "WAIT" | "AVOID";

export interface RsScore {
  rs30d: number | null;
  rs90d: number | null;
  rs180d: number | null;
  composite: number;
}

export interface MomentumLeader {
  ticker: string;
  name: string;
  price: number;
  metaValue: number;       // current stock/SPY ratio
  rsScore: RsScore;
  metaChannel: RegressionChannel;
  priceChannel: RegressionChannel | null;
  signal: MomentumSignal;
  zone: "lower" | "mid" | "upper";
  entry: number;
  stop: number;
  target: number;
  spark: number[];     // last 60 raw closes
  metaSpark: number[]; // last 60 meta-stock values
}

export interface MomentumAnalysis {
  indexKey: string;
  indexLabel: string;
  analyzedAt: string;
  leaders: MomentumLeader[];
}

export interface MomentumProgress {
  current: number;
  total: number;
  message: string;
}

/** Build an aligned meta-series by joining stock and SPY on date. */
function buildMetaSeries(candles: Candle[], spyByDate: Map<string, number>): number[] {
  const out: number[] = [];
  for (const c of candles) {
    const spyClose = spyByDate.get(c.date);
    if (spyClose && spyClose > 0) {
      out.push(c.close / spyClose);
    }
  }
  return out;
}

/** Return over a lookback window in the meta-series (percentage). */
function metaReturn(meta: number[], endIdx: number, lookback: number): number | null {
  const startIdx = endIdx - lookback;
  if (startIdx < 0 || !meta[startIdx] || meta[startIdx] === 0) return null;
  return ((meta[endIdx] - meta[startIdx]) / meta[startIdx]) * 100;
}

function signalFromChannel(ch: RegressionChannel): { signal: MomentumSignal; zone: MomentumLeader["zone"] } {
  const zone: MomentumLeader["zone"] = ch.z <= -0.5 ? "lower" : ch.z >= 1.0 ? "upper" : "mid";

  if (ch.trend !== "asc") return { signal: "AVOID", zone };
  // Trend ascendente ma rumoroso: non è il setup validato → aspetta.
  if (ch.r2 < BUY_MIN_R2) return { signal: "WAIT", zone };
  // Ascending channel but overextended near the top
  if (ch.z > 1.5) return { signal: "WAIT", zone };
  // Ascending, clean, price near lower/mid band → best entry opportunity (v3)
  if (ch.z <= 0.5) return { signal: "BUY", zone };
  return { signal: "WAIT", zone };
}

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

export async function runMomentumAnalysis(
  indexKey: string,
  onProgress?: (p: MomentumProgress) => void,
  topN = 25
): Promise<MomentumAnalysis> {
  const def = indexByKey(indexKey);
  if (!def) throw new Error(`Indice sconosciuto: ${indexKey}`);

  // Fetch 2 years of benchmark candles up front
  const spyCandles = await fetchCandles(def.proxy, 2);
  const spyByDate = new Map<string, number>(spyCandles.map((c) => [c.date, c.close]));

  if (spyCandles.length < META_WINDOW) {
    throw new Error(`Dati benchmark insufficienti (${spyCandles.length} barre)`);
  }

  interface Row {
    ticker: string;
    price: number;
    meta: number[];
    priceCloses: number[];
    metaChannel: RegressionChannel;
    priceChannel: RegressionChannel | null;
    rsScore: RsScore;
  }

  let done = 0;
  const rows = await pool(def.tickers, 8, async (ticker): Promise<Row | null> => {
    const candles = await fetchCandles(ticker, 2);
    done++;
    onProgress?.({
      current: done,
      total: def.tickers.length,
      message: `${ticker} (${done}/${def.tickers.length})`,
    });

    if (candles.length < META_WINDOW + 20) return null;

    const priceCloses = candles.map((c) => c.close);
    const price = priceCloses[priceCloses.length - 1];
    const meta = buildMetaSeries(candles, spyByDate);

    if (meta.length < META_WINDOW) return null;

    const metaChannel = regressionChannel(meta.slice(-META_WINDOW), 2);
    if (!metaChannel) return null;

    const priceChannel = regressionChannel(priceCloses.slice(-PRICE_WINDOW), 2);

    const endIdx = meta.length - 1;
    const rs30d = metaReturn(meta, endIdx, 30);
    const rs90d = metaReturn(meta, endIdx, 90);
    const rs180d = metaReturn(meta, endIdx, 180);

    // Weighted composite RS score
    let num = 0;
    let den = 0;
    if (rs30d !== null) { num += rs30d * 0.2; den += 0.2; }
    if (rs90d !== null) { num += rs90d * 0.5; den += 0.5; }
    if (rs180d !== null) { num += rs180d * 0.3; den += 0.3; }
    const composite = den > 0 ? num / den : 0;

    return {
      ticker,
      price,
      meta,
      priceCloses,
      metaChannel,
      priceChannel,
      rsScore: { rs30d, rs90d, rs180d, composite },
    };
  }).then((r) => r.filter((x): x is Row => x !== null));

  // Sort by RS composite score descending (strongest RS leaders first)
  rows.sort((a, b) => b.rsScore.composite - a.rsScore.composite);

  const leaders: MomentumLeader[] = rows.map((r): MomentumLeader => {
    const ch = r.metaChannel;
    const { signal, zone } = signalFromChannel(ch);
    const pc = r.priceChannel;

    const stop = pc ? Math.max(0, pc.lowerNow) : r.price * 0.95;
    const target = pc ? pc.upperNow : r.price * 1.10;

    return {
      ticker: r.ticker,
      name: nameFor(r.ticker),
      price: +r.price.toFixed(2),
      metaValue: +(r.meta[r.meta.length - 1]).toFixed(6),
      rsScore: {
        rs30d: r.rsScore.rs30d !== null ? +r.rsScore.rs30d.toFixed(2) : null,
        rs90d: r.rsScore.rs90d !== null ? +r.rsScore.rs90d.toFixed(2) : null,
        rs180d: r.rsScore.rs180d !== null ? +r.rsScore.rs180d.toFixed(2) : null,
        composite: +r.rsScore.composite.toFixed(2),
      },
      metaChannel: ch,
      priceChannel: pc,
      signal,
      zone,
      entry: +r.price.toFixed(2),
      stop: +Math.max(0, stop).toFixed(2),
      target: +target.toFixed(2),
      spark: r.priceCloses.slice(-META_WINDOW).map((c) => +c.toFixed(2)),
      metaSpark: r.meta.slice(-META_WINDOW).map((v) => +v.toFixed(6)),
    };
  });

  // Prioritise BUY signals, then WAIT, keep overall topN cap
  const buys = leaders.filter((l) => l.signal === "BUY");
  const waits = leaders.filter((l) => l.signal === "WAIT");
  const avoids = leaders.filter((l) => l.signal === "AVOID");
  const final = [...buys, ...waits, ...avoids].slice(0, topN);

  return {
    indexKey,
    indexLabel: def.label,
    analyzedAt: new Date().toISOString(),
    leaders: final,
  };
}

/** Check which open positions have exit signals (stop/target hit). */
export function checkExitSignals(
  positions: { ticker: string; avgCost: number; stop: number | null; target: number | null }[],
  prices: Record<string, number>
): { ticker: string; reason: "stop" | "target"; price: number }[] {
  const signals: { ticker: string; reason: "stop" | "target"; price: number }[] = [];
  for (const p of positions) {
    const cur = prices[p.ticker];
    if (cur == null) continue;
    if (p.stop != null && cur <= p.stop) {
      signals.push({ ticker: p.ticker, reason: "stop", price: cur });
    } else if (p.target != null && cur >= p.target) {
      signals.push({ ticker: p.ticker, reason: "target", price: cur });
    }
  }
  return signals;
}
