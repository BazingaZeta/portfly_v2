// Linear regression channel — fit a line to recent closes and build bands at
// ±k standard deviations of the residuals. Used to identify ascending trends
// and entry/stop/target levels.

export interface RegressionChannel {
  slope: number; // price change per bar
  intercept: number;
  r2: number; // 0..1 goodness of fit (how clean the trend is)
  stdev: number; // residual standard deviation (channel half-width / k)
  n: number;
  midNow: number; // regression value at the last bar
  upperNow: number; // midNow + k*stdev
  lowerNow: number; // midNow - k*stdev
  z: number; // (price - midNow) / stdev  → position within the channel
  slopePctPerDay: number; // slope as % of mean price
  trend: "asc" | "flat" | "desc";
}

export function regressionChannel(closes: number[], k = 2): RegressionChannel | null {
  const n = closes.length;
  if (n < 10) return null;

  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += closes[i];
    sxx += i * i;
    sxy += i * closes[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  const mean = sy / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const fit = intercept + slope * i;
    ssRes += (closes[i] - fit) ** 2;
    ssTot += (closes[i] - mean) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const stdev = Math.sqrt(ssRes / n);

  const lastX = n - 1;
  const midNow = intercept + slope * lastX;
  const price = closes[n - 1];
  const z = stdev > 0 ? (price - midNow) / stdev : 0;
  const slopePctPerDay = mean > 0 ? (slope / mean) * 100 : 0;

  // Ascending only if the line slopes up AND the fit is reasonably clean.
  let trend: RegressionChannel["trend"] = "flat";
  if (slope > 0 && r2 >= 0.5) trend = "asc";
  else if (slope < 0 && r2 >= 0.5) trend = "desc";

  return {
    slope,
    intercept,
    r2: +r2.toFixed(2),
    stdev,
    n,
    midNow,
    upperNow: midNow + k * stdev,
    lowerNow: midNow - k * stdev,
    z: +z.toFixed(2),
    slopePctPerDay: +slopePctPerDay.toFixed(3),
    trend,
  };
}
