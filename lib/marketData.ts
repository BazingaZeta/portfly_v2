import YahooFinance from "yahoo-finance2";
import type { Candle } from "./types";

// v3 of yahoo-finance2 requires an instance.
const yahooFinance = new YahooFinance();

// Quiet the library's startup notices (survey / ripHistorical etc.).
// suppressNotices isn't in v3's published types but exists at runtime.
try {
  const yf = yahooFinance as unknown as {
    suppressNotices?: (notices: string[]) => void;
  };
  yf.suppressNotices?.(["yahooSurvey", "ripHistorical"]);
} catch {
  /* safe to ignore */
}

/** Fetch daily candles for a ticker (default ~1 year). Returns [] on failure. */
export async function fetchCandles(ticker: string, years = 1): Promise<Candle[]> {
  const period2 = new Date();
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - years);

  try {
    const result = await yahooFinance.chart(ticker, {
      period1,
      period2,
      interval: "1d",
    });
    const quotes = result?.quotes ?? [];
    const candles: Candle[] = [];
    for (const q of quotes) {
      if (
        q.open == null ||
        q.high == null ||
        q.low == null ||
        q.close == null
      ) {
        continue; // skip incomplete bars
      }
      candles.push({
        date: (q.date instanceof Date ? q.date : new Date(q.date))
          .toISOString()
          .slice(0, 10),
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume ?? 0,
      });
    }
    return candles;
  } catch {
    return [];
  }
}

/** Fetch market cap for a set of tickers (weight proxy for index analysis). */
export async function fetchMarketCaps(
  tickers: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (tickers.length === 0) return out;
  try {
    const results = await yahooFinance.quote(tickers);
    const arr = Array.isArray(results) ? results : [results];
    for (const r of arr) {
      const mc = r?.marketCap;
      if (r?.symbol && typeof mc === "number" && mc > 0) out[r.symbol] = mc;
    }
  } catch {
    /* best-effort; callers handle missing caps */
  }
  return out;
}

/** Whether the US market is currently open (from SPY's market state). */
export async function fetchMarketStatus(): Promise<{ open: boolean; state: string; asOf: string | null }> {
  try {
    const r = await yahooFinance.quote("SPY");
    const q = Array.isArray(r) ? r[0] : r;
    const state = (q?.marketState as string) ?? "UNKNOWN";
    const time = q?.regularMarketTime;
    const asOf = time ? (time instanceof Date ? time : new Date(time)).toISOString() : null;
    return { open: state === "REGULAR", state, asOf };
  } catch {
    return { open: false, state: "UNKNOWN", asOf: null };
  }
}

/** Fetch the latest price for a set of tickers. Missing entries are omitted. */
export async function fetchQuotes(
  tickers: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (tickers.length === 0) return out;
  try {
    const results = await yahooFinance.quote(tickers);
    const arr = Array.isArray(results) ? results : [results];
    for (const r of arr) {
      const price = r?.regularMarketPrice;
      if (r?.symbol && typeof price === "number") {
        out[r.symbol] = price;
      }
    }
  } catch {
    // fall back to per-ticker so one bad symbol doesn't sink the batch
    for (const t of tickers) {
      try {
        const r = await yahooFinance.quote(t);
        const price = Array.isArray(r) ? r[0]?.regularMarketPrice : r?.regularMarketPrice;
        if (typeof price === "number") out[t] = price;
      } catch {
        /* skip */
      }
    }
  }
  return out;
}
