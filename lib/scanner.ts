import type {
  Recommendation,
  SignalReason,
  Indicators,
  NewsItem,
} from "./types";
import { UNIVERSE, nameFor } from "./universe";
import { fetchCandles } from "./marketData";
import { computeIndicators } from "./indicators";
import { fetchTickerNews, aggregateSentiment } from "./news";
import { fetchMarketRegime, type MarketRegime } from "./regime";
import { fetchEarnings } from "./earnings";

export interface ScanProgress {
  stage: "regime" | "fetch" | "news" | "done";
  current: number;
  total: number;
  message: string;
}

export interface ScanResult {
  recommendations: Omit<Recommendation, "id">[];
  regime: MarketRegime | null;
}

const EARNINGS_WARN_DAYS = 7; // flag/penalize signals with earnings within this window

// Thresholds (tweak to taste). Exported so the backtest reuses the exact rules.
export const TECH_GATE = 45; // min technical score to pull news + consider
export const FINAL_GATE = 64; // min final score to emit a recommendation (high conviction only)
export const STOP_ATR = 1.5; // stop-loss distance in ATR
export const TARGET_ATR = 2.5; // take-profit distance in ATR

interface Candidate {
  ticker: string;
  indicators: Indicators;
  reasons: SignalReason[];
  techScore: number;
  spark: number[];
}

/** Build technical reasons + score for one ticker. Returns null if no setup. */
export function evaluateTechnical(ind: Indicators): {
  reasons: SignalReason[];
  score: number;
} | null {
  const reasons: SignalReason[] = [];
  let score = 0;

  const add = (code: string, label: string, weight: number) => {
    reasons.push({ code, label, weight });
    score += weight;
  };

  // Medium-term trend intact
  if (ind.price > ind.sma50) {
    add("ABOVE_SMA50", "Prezzo sopra la media mobile a 50 giorni (trend di fondo rialzista)", 15);
  }

  // EMA momentum
  if (ind.emaFast > ind.emaSlow) {
    add("EMA_BULLISH", "EMA 9 sopra EMA 21 (momentum di breve positivo)", 15);
  }

  // RSI zones
  if (ind.rsi >= 50 && ind.rsi <= 68) {
    add("RSI_MOMENTUM", `RSI in zona di momentum sano (${ind.rsi.toFixed(0)})`, 15);
  } else if (ind.rsi < 32) {
    add("RSI_OVERSOLD", `RSI ipervenduto (${ind.rsi.toFixed(0)}), possibile rimbalzo`, 10);
  } else if (ind.rsi > 75) {
    add("RSI_OVERBOUGHT", `RSI ipercomprato (${ind.rsi.toFixed(0)}), rischio storno`, -12);
  }

  // Short-term momentum
  if (ind.roc > 2) {
    add("ROC_POSITIVE", `Momentum a 10 giorni positivo (+${ind.roc.toFixed(1)}%)`, 12);
  } else if (ind.roc < -10) {
    add("ROC_WEAK", `Forte calo recente (${ind.roc.toFixed(1)}%)`, -8);
  }

  // Volume confirmation
  if (ind.volumeRatio > 1.8) {
    add("VOLUME_SPIKE", `Volume ${ind.volumeRatio.toFixed(1)}× la media (forte interesse)`, 14);
  } else if (ind.volumeRatio > 1.2) {
    add("VOLUME_ABOVE", `Volume ${ind.volumeRatio.toFixed(1)}× la media`, 7);
  }

  // Breakout proximity
  if (ind.price >= 0.97 * ind.high52w) {
    add("NEAR_52W_HIGH", "Vicino ai massimi delle 52 settimane (potenziale breakout)", 12);
  }

  // Volatility note (informational penalty if extreme)
  if (ind.atrPct > 0.08) {
    add("HIGH_VOLATILITY", `Volatilità elevata (ATR ${(ind.atrPct * 100).toFixed(1)}% del prezzo)`, -6);
  }

  if (reasons.length === 0) return null;
  return { reasons, score: Math.max(0, Math.min(100, score)) };
}

/** Simple concurrency-limited map. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx], idx);
      }
    });
  await Promise.all(workers);
  return results;
}

/**
 * Run a full daily scan over the universe.
 * @param universe optional override (defaults to UNIVERSE)
 * @param onProgress progress callback for SSE streaming
 */
export async function runScan(
  onProgress?: (p: ScanProgress) => void,
  universe: string[] = UNIVERSE
): Promise<ScanResult> {
  const total = universe.length;
  let done = 0;

  // 0. Market regime (don't fight the broad trend)
  onProgress?.({ stage: "regime", current: 0, total, message: "Analisi del regime di mercato (SPY)" });
  const regime = await fetchMarketRegime();
  const regimeAdj =
    regime?.regime === "bear" ? -15 : regime?.regime === "bull" ? 5 : 0;
  const regimeReason =
    regime?.regime === "bear"
      ? { code: "REGIME_BEAR", label: "Mercato ribassista (SPY sotto le medie)", weight: -15 }
      : regime?.regime === "bull"
      ? { code: "REGIME_BULL", label: "Mercato rialzista (SPY sopra le medie)", weight: 5 }
      : null;

  // 1. Fetch + technical evaluation, concurrency-limited
  const candidates: Candidate[] = [];
  await pool(universe, 8, async (ticker) => {
    const candles = await fetchCandles(ticker);
    const ind = candles.length ? computeIndicators(candles) : null;
    done++;
    onProgress?.({
      stage: "fetch",
      current: done,
      total,
      message: `Analisi tecnica ${ticker} (${done}/${total})`,
    });
    if (!ind) return;
    const evalRes = evaluateTechnical(ind);
    if (evalRes && evalRes.score >= TECH_GATE && ind.price > ind.sma50) {
      candidates.push({
        ticker,
        indicators: ind,
        reasons: evalRes.reasons,
        techScore: evalRes.score,
        spark: candles.slice(-40).map((c) => +c.close.toFixed(2)),
      });
    }
  });

  // 2. Pull news only for technical finalists, apply sentiment overlay
  const nowIso = new Date().toISOString();
  const scanDate = nowIso.slice(0, 10);
  const recs: Omit<Recommendation, "id">[] = [];

  let newsDone = 0;
  await pool(candidates, 6, async (c) => {
    const [news, earnings] = await Promise.all([
      fetchTickerNews(c.ticker, 6),
      fetchEarnings(c.ticker),
    ]);
    const sentiment = aggregateSentiment(news);
    newsDone++;
    onProgress?.({
      stage: "news",
      current: newsDone,
      total: candidates.length,
      message: `Notizie & earnings ${c.ticker} (${newsDone}/${candidates.length})`,
    });

    const reasons = [...c.reasons];
    let finalScore = c.techScore;

    // Market regime overlay
    if (regimeReason) {
      reasons.push(regimeReason);
      finalScore += regimeAdj;
    }

    // Earnings overlay — imminent earnings = binary event, not a clean trend
    const ed = earnings.daysUntil;
    if (ed != null && ed >= 0 && ed <= EARNINGS_WARN_DAYS) {
      const w = -14;
      reasons.push({
        code: "EARNINGS_SOON",
        label: `Earnings tra ${ed} giorn${ed === 1 ? "o" : "i"} (evento binario, rischio gap)`,
        weight: w,
      });
      finalScore += w;
    }

    if (sentiment > 0.2) {
      const w = Math.round(sentiment * 18);
      reasons.push({
        code: "NEWS_POSITIVE",
        label: `Notizie recenti positive (sentiment ${sentiment.toFixed(2)})`,
        weight: w,
      });
      finalScore += w;
    } else if (sentiment < -0.2) {
      const w = Math.round(sentiment * 22); // negative
      reasons.push({
        code: "NEWS_NEGATIVE",
        label: `Notizie recenti negative (sentiment ${sentiment.toFixed(2)})`,
        weight: w,
      });
      finalScore += w; // w is negative
    }

    finalScore = Math.max(0, Math.min(100, finalScore));
    if (finalScore < FINAL_GATE) return;

    const ind = c.indicators;
    const stop = +(ind.price - STOP_ATR * ind.atr).toFixed(2);
    const target = +(ind.price + TARGET_ATR * ind.atr).toFixed(2);

    recs.push({
      scanDate,
      createdAt: nowIso,
      ticker: c.ticker,
      name: nameFor(c.ticker),
      action: "BUY",
      score: Math.round(finalScore),
      price: +ind.price.toFixed(2),
      target,
      stop,
      reasons: reasons.sort((a, b) => b.weight - a.weight),
      newsSentiment: +sentiment.toFixed(2),
      news,
      indicators: ind,
      earningsDate: earnings.date,
      earningsDays: earnings.daysUntil,
      spark: c.spark,
    });
  });

  recs.sort((a, b) => b.score - a.score);
  onProgress?.({
    stage: "done",
    current: total,
    total,
    message: `Scan completata: ${recs.length} segnali`,
  });
  return { recommendations: recs, regime };
}
