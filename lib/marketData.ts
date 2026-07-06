import YahooFinance from "yahoo-finance2";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
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

// ─── Best-effort local candle cache ───────────────────────────────────────────
// Backtests re-fetch 80-150 tickers per run: a small file cache makes
// experiments ~10× faster and reproducible within the day. Fully optional:
// any FS error (read-only serverless, missing dir) silently falls back to the
// network. Disable with CANDLE_CACHE=off.

const CACHE_TTL_MS = 18 * 60 * 60 * 1000; // refreshed at most daily (post-close)
const cacheDir = () =>
  process.env.CANDLE_CACHE_DIR ?? join(process.cwd(), ".cache", "candles");
const cacheEnabled = () => process.env.CANDLE_CACHE !== "off";

function cacheRead(ticker: string, years: number): Candle[] | null {
  if (!cacheEnabled()) return null;
  try {
    const file = join(cacheDir(), `${ticker.replace(/[^A-Za-z0-9^.-]/g, "_")}-${years}y.json`);
    if (Date.now() - statSync(file).mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(readFileSync(file, "utf8")) as Candle[];
  } catch {
    return null;
  }
}

function cacheWrite(ticker: string, years: number, candles: Candle[]): void {
  if (!cacheEnabled() || candles.length === 0) return;
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const file = join(cacheDir(), `${ticker.replace(/[^A-Za-z0-9^.-]/g, "_")}-${years}y.json`);
    writeFileSync(file, JSON.stringify(candles));
  } catch {
    /* read-only FS (serverless) — cache is best-effort */
  }
}

/** Fetch daily candles for a ticker (default ~1 year). Returns [] on failure. */
export async function fetchCandles(ticker: string, years = 1): Promise<Candle[]> {
  const cached = cacheRead(ticker, years);
  if (cached) return cached;

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
        adjClose: (q as { adjclose?: number | null }).adjclose ?? q.close,
      });
    }
    cacheWrite(ticker, years, candles);
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
