import type { Candle } from "./types";
import { fetchCandles } from "./marketData";
import { sma } from "./indicators";

export type Regime = "bull" | "neutral" | "bear";

export interface MarketRegime {
  regime: Regime;
  price: number;
  sma50: number;
  sma200: number;
  label: string;
}

/** Classify the broad-market trend from a price series (SPY). */
export function classifyRegime(candles: Candle[]): MarketRegime | null {
  if (candles.length < 200) return null;
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);

  let regime: Regime;
  if (price > sma50 && sma50 > sma200) regime = "bull";
  else if (price < sma50 && sma50 < sma200) regime = "bear";
  else regime = "neutral";

  const label =
    regime === "bull"
      ? "Mercato rialzista — condizioni favorevoli ai breakout"
      : regime === "bear"
      ? "Mercato ribassista — segnali long più rischiosi, soglia alzata"
      : "Mercato neutro/laterale — cautela";

  return { regime, price, sma50, sma200, label };
}

/** Fetch SPY and classify the current market regime. Null on failure. */
export async function fetchMarketRegime(): Promise<MarketRegime | null> {
  const candles = await fetchCandles("SPY");
  return candles.length ? classifyRegime(candles) : null;
}
