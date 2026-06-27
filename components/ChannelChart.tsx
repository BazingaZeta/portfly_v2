"use client";

import type { RegressionChannel } from "@/lib/regression";

/**
 * Draws the price line plus the regression channel (mid + ±2σ bands) over the
 * window the channel was fitted on. The channel lines are sloped, not flat.
 */
export function ChannelChart({
  closes,
  channel,
  width = 320,
  height = 90,
}: {
  closes: number[];
  channel: RegressionChannel;
  width?: number;
  height?: number;
}) {
  const n = closes.length;
  if (n < 2) return null;
  const pad = 4;
  const k = 2;

  const mid = (i: number) => channel.intercept + channel.slope * i;
  const upper = (i: number) => mid(i) + k * channel.stdev;
  const lower = (i: number) => mid(i) - k * channel.stdev;

  const allVals = [
    ...closes,
    upper(0), upper(n - 1), lower(0), lower(n - 1),
  ];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (n - 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - min) / range) * (height - 2 * pad);

  const line = (fn: (i: number) => number) =>
    `M ${x(0)} ${y(fn(0)).toFixed(1)} L ${x(n - 1)} ${y(fn(n - 1)).toFixed(1)}`;
  const pricePath = closes.map((c, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(c).toFixed(1)}`).join(" ");

  const color = channel.trend === "asc" ? "var(--positive)" : channel.trend === "desc" ? "var(--negative)" : "var(--muted)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
      {/* channel band fill */}
      <path
        d={`M ${x(0)} ${y(upper(0))} L ${x(n - 1)} ${y(upper(n - 1))} L ${x(n - 1)} ${y(lower(n - 1))} L ${x(0)} ${y(lower(0))} Z`}
        fill={color}
        opacity="0.08"
      />
      {/* upper / lower bands */}
      <path d={line(upper)} stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" fill="none" />
      <path d={line(lower)} stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" fill="none" />
      {/* mid (regression line) */}
      <path d={line(mid)} stroke={color} strokeWidth="1" opacity="0.35" fill="none" />
      {/* price */}
      <path d={pricePath} stroke="var(--foreground)" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      <circle cx={x(n - 1)} cy={y(closes[n - 1])} r="2.4" fill={color} />
    </svg>
  );
}
