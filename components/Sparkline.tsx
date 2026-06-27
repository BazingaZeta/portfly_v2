"use client";

export interface SparkRef {
  value: number;
  color: string;
  dashed?: boolean;
}

/**
 * Minimal dependency-free price sparkline. Optionally appends a live point and
 * draws horizontal reference lines (entry/target/stop).
 */
export function Sparkline({
  values,
  live,
  refs = [],
  width = 160,
  height = 44,
  color,
}: {
  values: number[];
  live?: number;
  refs?: SparkRef[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const series = live != null ? [...values, live] : values;
  if (series.length < 2) {
    return <div style={{ width, height }} className="grid place-items-center text-[10px] text-[var(--muted)]">—</div>;
  }

  const pad = 3;
  const refVals = refs.map((r) => r.value);
  const min = Math.min(...series, ...refVals);
  const max = Math.max(...series, ...refVals);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (series.length - 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - min) / range) * (height - 2 * pad);

  const path = series.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const up = series[series.length - 1] >= series[0];
  const stroke = color ?? (up ? "var(--positive)" : "var(--negative)");
  const lastX = x(series.length - 1);
  const lastY = y(series[series.length - 1]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {refs.map((r, i) => (
        <line
          key={i}
          x1={pad}
          x2={width - pad}
          y1={y(r.value)}
          y2={y(r.value)}
          stroke={r.color}
          strokeWidth="1"
          strokeDasharray={r.dashed ? "3 3" : undefined}
          opacity="0.6"
        />
      ))}
      <path d={`${path} L ${lastX} ${height - pad} L ${x(0)} ${height - pad} Z`} fill={stroke} opacity="0.12" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.2" fill={stroke} />
    </svg>
  );
}
