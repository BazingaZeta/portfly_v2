import { indexByKey } from "./indices";
import { nameFor } from "./universe";
import { fetchCandles, fetchMarketCaps } from "./marketData";
import { regressionChannel, type RegressionChannel } from "./regression";
import type { Candle } from "./types";

const CHANNEL_WINDOW = 40; // trading days for the regression channel
const RET_WINDOW = 20; // trading days for the "contribution" return

export type IndexSignal = "BUY" | "WAIT" | "AVOID";

export interface LeaderSignal {
  ticker: string;
  name: string;
  price: number;
  ret20: number; // % move over RET_WINDOW (its push on the index)
  contributionPct: number; // share of the index's upward push
  channel: RegressionChannel;
  rsRising: boolean; // relative strength (stock/index) trending up = leading
  rsSlopePctPerDay: number; // RS regression slope, % per day
  signal: IndexSignal;
  zone: "lower" | "mid" | "upper"; // position within the channel
  entry: number;
  stop: number; // lower channel band
  target: number; // upper channel band
  spark: number[]; // closes over the window (for the channel chart)
}

export interface IndexAnalysis {
  indexKey: string;
  indexLabel: string;
  analyzedAt: string;
  leaders: LeaderSignal[]; // ranked by contribution to the index
}

// AUDIT 2026-07: signali BUY CONGELATI. Nel walk-forward 5-fold su 4,5 anni
// (con equity marcata a mercato) NESSUNA struttura di uscita rende positiva questa
// strategia: config attuale a canale → PF 0,89, 0/5 periodi positivi, maxDD 49%;
// ATR 2/3, trailing e R²≥0,7 restano tutte a expectancy OOS ≤ 0. Finché una config
// non supera i criteri (mediana OOS expectancy > 0, peggior fold PF ≥ 0,9), il
// segnale massimo è WAIT: i setup si mostrano ma non si raccomanda l'ingresso.
// Per riattivare: rimuovere il cap qui sotto dopo una validazione che regga OOS.
const BUY_SIGNALS_FROZEN = true;

function signalFor(ch: RegressionChannel, rsRising: boolean): { signal: IndexSignal; zone: LeaderSignal["zone"] } {
  const zone: LeaderSignal["zone"] = ch.z <= -0.5 ? "lower" : ch.z >= 1.0 ? "upper" : "mid";
  if (ch.trend !== "asc") return { signal: "AVOID", zone };
  // Must also be LEADING the index (relative strength rising), else just wait.
  if (!rsRising) return { signal: "WAIT", zone };
  // Ascending + leading: would be BUY, but frozen pending a walk-forward that holds OOS.
  if (ch.z > 1.5) return { signal: "WAIT", zone };
  return { signal: BUY_SIGNALS_FROZEN ? "WAIT" : "BUY", zone };
}

/** Relative-strength regression channel: stock close / index close, aligned by date. */
function rsChannel(candles: Candle[], indexByDate: Map<string, number>, window: number): RegressionChannel | null {
  const rs: number[] = [];
  for (const c of candles) {
    const idx = indexByDate.get(c.date);
    if (idx && idx > 0) rs.push(c.close / idx);
  }
  if (rs.length < window) return null;
  return regressionChannel(rs.slice(-window), 2);
}

/** Simple concurrency-limited map. */
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

export interface AnalysisProgress {
  current: number;
  total: number;
  message: string;
}

export async function runIndexAnalysis(
  indexKey: string,
  onProgress?: (p: AnalysisProgress) => void,
  topN = 20
): Promise<IndexAnalysis> {
  const def = indexByKey(indexKey);
  if (!def) throw new Error(`Indice sconosciuto: ${indexKey}`);

  const [caps, indexCandles] = await Promise.all([
    fetchMarketCaps(def.tickers),
    fetchCandles(def.proxy),
  ]);
  const indexByDate = new Map<string, number>(indexCandles.map((c) => [c.date, c.close]));

  interface Row {
    ticker: string;
    price: number;
    ret20: number;
    push: number; // marketCap * max(0, ret20) — upward contribution
    channel: RegressionChannel | null;
    rs: RegressionChannel | null;
    spark: number[];
  }

  let done = 0;
  const rows = await pool(def.tickers, 8, async (ticker): Promise<Row | null> => {
    const candles = await fetchCandles(ticker);
    done++;
    onProgress?.({ current: done, total: def.tickers.length, message: `Analisi ${ticker} (${done}/${def.tickers.length})` });
    if (candles.length < CHANNEL_WINDOW + 2) return null;
    const closes = candles.map((c) => c.close);
    const price = closes[closes.length - 1];
    const past = closes[closes.length - 1 - RET_WINDOW];
    const ret20 = past > 0 ? ((price - past) / past) * 100 : 0;
    const cap = caps[ticker] ?? 0;
    const push = cap * Math.max(0, ret20);
    const channel = regressionChannel(closes.slice(-CHANNEL_WINDOW), 2);
    const rs = rsChannel(candles, indexByDate, CHANNEL_WINDOW);
    return { ticker, price, ret20, push, channel, rs, spark: closes.slice(-CHANNEL_WINDOW) };
  }).then((r) => r.filter((x): x is Row => x !== null));

  const totalPush = rows.reduce((s, r) => s + r.push, 0) || 1;

  const leaders: LeaderSignal[] = rows
    .filter((r) => r.channel)
    .map((r) => {
      const ch = r.channel!;
      const rsRising = r.rs != null && r.rs.slope > 0;
      const { signal, zone } = signalFor(ch, rsRising);
      return {
        ticker: r.ticker,
        name: nameFor(r.ticker),
        price: +r.price.toFixed(2),
        ret20: +r.ret20.toFixed(2),
        contributionPct: +((r.push / totalPush) * 100).toFixed(1),
        channel: ch,
        rsRising,
        rsSlopePctPerDay: r.rs ? r.rs.slopePctPerDay : 0,
        signal,
        zone,
        entry: +r.price.toFixed(2),
        stop: +Math.max(0, ch.lowerNow).toFixed(2),
        target: +ch.upperNow.toFixed(2),
        spark: r.spark.map((c) => +c.toFixed(2)),
      };
    })
    // Rank by how much they're pushing the index up.
    .sort((a, b) => b.contributionPct - a.contributionPct)
    .slice(0, topN);

  return {
    indexKey,
    indexLabel: def.label,
    analyzedAt: new Date().toISOString(),
    leaders,
  };
}
