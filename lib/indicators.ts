import type { Candle, Indicators } from "./types";

/** Simple moving average of the last `period` values. */
export function sma(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Exponential moving average (returns the final EMA value). */
export function ema(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const k = 2 / (period + 1);
  // seed with SMA of the first `period` values
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/** Wilder's RSI over `period` (default 14). */
export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return NaN;
  let gains = 0;
  let losses = 0;
  // initial average over the first `period` changes
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  // Wilder smoothing across the rest
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Rate of change (%) over `period` bars. */
export function roc(closes: number[], period: number): number {
  if (closes.length < period + 1) return NaN;
  const past = closes[closes.length - 1 - period];
  const now = closes[closes.length - 1];
  return ((now - past) / past) * 100;
}

/** Average True Range (Wilder), default period 14. */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return NaN;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    trs.push(tr);
  }
  // Wilder smoothing
  let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    value = (value * (period - 1) + trs[i]) / period;
  }
  return value;
}

/** Compute the full indicator snapshot from a series of daily candles. */
export function computeIndicators(candles: Candle[]): Indicators | null {
  // need enough history for SMA50 + RSI + ATR
  if (candles.length < 55) return null;
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const price = closes[closes.length - 1];
  const volume = volumes[volumes.length - 1];
  const avgVolume = sma(volumes, 20);
  const atrVal = atr(candles, 14);

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const window = candles.length >= 252 ? 252 : candles.length;
  const high52w = Math.max(...highs.slice(-window));
  const low52w = Math.min(...lows.slice(-window));

  return {
    price,
    rsi: rsi(closes, 14),
    emaFast: ema(closes, 9),
    emaSlow: ema(closes, 21),
    sma50: sma(closes, 50),
    roc: roc(closes, 10),
    volume,
    avgVolume,
    volumeRatio: avgVolume ? volume / avgVolume : 1,
    atr: atrVal,
    atrPct: price ? atrVal / price : 0,
    high52w,
    low52w,
  };
}
