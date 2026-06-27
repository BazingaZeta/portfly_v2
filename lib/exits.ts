import type { Candle, NewsItem } from "./types";
import { computeIndicators } from "./indicators";
import { aggregateSentiment } from "./news";
import { STOP_ATR } from "./scanner";

export type ExitType = "trailing" | "overbought" | "momentum" | "news";

export interface ExitSignal {
  ticker: string;
  type: ExitType;
  message: string;
  tone: "warning" | "negative";
}

export interface ExitParams {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  currentPrice: number;
  candles: Candle[];
  news: NewsItem[];
}

/**
 * Re-evaluate the thesis on an open position and surface reasons to exit
 * beyond the static target/stop set at entry.
 */
export function computeExitSignals(p: ExitParams): ExitSignal[] {
  const signals: ExitSignal[] = [];
  const ind = computeIndicators(p.candles);
  if (!ind) return signals;

  // Trailing stop: lock in profit if price falls back from the peak since entry.
  const sinceEntry = p.candles.filter((c) => c.date >= p.entryDate);
  if (sinceEntry.length > 1) {
    const peak = Math.max(...sinceEntry.map((c) => c.high));
    const trail = peak - STOP_ATR * ind.atr;
    if (peak > p.entryPrice && p.currentPrice <= trail) {
      signals.push({
        ticker: p.ticker,
        type: "trailing",
        tone: "warning",
        message: `Trailing stop: il prezzo è sceso da un massimo di ${peak.toFixed(2)}. Proteggi il profitto.`,
      });
    }
  }

  // Overbought — momentum may be exhausting.
  if (ind.rsi > 72) {
    signals.push({
      ticker: p.ticker,
      type: "overbought",
      tone: "warning",
      message: `RSI ipercomprato (${ind.rsi.toFixed(0)}): rischio di storno, valuta la presa di profitto.`,
    });
  }

  // Momentum flip — short-term trend turned down.
  if (ind.emaFast < ind.emaSlow) {
    signals.push({
      ticker: p.ticker,
      type: "momentum",
      tone: "negative",
      message: `Momentum girato: EMA 9 è scesa sotto EMA 21, il trend di breve si è indebolito.`,
    });
  }

  // News turned negative.
  const sentiment = aggregateSentiment(p.news);
  if (sentiment < -0.2) {
    signals.push({
      ticker: p.ticker,
      type: "news",
      tone: "negative",
      message: `Notizie recenti negative (sentiment ${sentiment.toFixed(2)}).`,
    });
  }

  return signals;
}
