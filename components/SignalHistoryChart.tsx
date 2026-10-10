"use client";

import { useMemo, useRef, useState } from "react";
import type { TickerSignal } from "@/lib/worldMomentum";

/**
 * Prezzo nel tempo con i segnali della strategia marcati sopra: triangolo su
 * verde dove avrebbe comprato, triangolo giù rosso dove avrebbe venduto, e la
 * fascia del periodo di possesso ombreggiata fra i due.
 *
 * È il "cosa sarebbe successo" in forma visiva: un periodo ombreggiato che
 * sale è un trade andato bene, uno che scende è una perdita, e lo spazio
 * bianco fra due fasce è il tempo passato fuori dal mercato.
 */
export function SignalHistoryChart({
  series,
  signals,
  height = 320,
}: {
  series: { date: string; close: number }[];
  signals: TickerSignal[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 900;
  const H = height;
  const PAD = { top: 16, right: 16, bottom: 32, left: 68 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;

  const idxByDate = useMemo(() => {
    const m = new Map<string, number>();
    series.forEach((p, i) => m.set(p.date, i));
    return m;
  }, [series]);

  const { min, max } = useMemo(() => {
    const vals = series.map((p) => p.close);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || 1;
    return { min: lo - pad, max: hi + pad };
  }, [series]);

  if (series.length < 2) return null;

  const n = series.length;
  const x = (i: number) => PAD.left + (i / Math.max(1, n - 1)) * iw;
  const y = (v: number) => PAD.top + ((max - v) / (max - min || 1)) * ih;

  // Un segmento per ogni periodo di possesso, con il suo esito.
  const spans = signals
    .map((s) => {
      const a = idxByDate.get(s.entryDate);
      const b = s.exitDate ? idxByDate.get(s.exitDate) : n - 1;
      if (a == null || b == null) return null;
      return { from: a, to: b, signal: s, win: (s.returnPct ?? 0) >= 0, open: s.exitDate == null };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const xLabels = [0, Math.floor((n - 1) / 2), n - 1];

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((vx - PAD.left) / iw) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  }

  // Il trade che contiene la barra sotto il mouse, se c'è.
  const hoveredSpan = hover != null ? spans.find((s) => hover >= s.from && hover <= s.to) : undefined;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Prezzo con i segnali storici di acquisto e vendita"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="monospace">
              ${v.toFixed(0)}
            </text>
          </g>
        ))}

        {/* periodi di possesso */}
        {spans.map((s, k) => (
          <rect
            key={k}
            x={x(s.from)}
            y={PAD.top}
            width={Math.max(1.5, x(s.to) - x(s.from))}
            height={ih}
            fill={s.open ? "var(--accent)" : s.win ? "var(--positive)" : "var(--negative)"}
            opacity={hoveredSpan === s ? 0.26 : 0.13}
          />
        ))}

        {/* prezzo */}
        <polyline
          points={series.map((p, i) => `${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join(" ")}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />

        {/* marcatori: ▲ acquisto, ▼ vendita */}
        {spans.map((s, k) => {
          const bx = x(s.from);
          const by = y(series[s.from].close);
          return (
            <g key={`m${k}`}>
              <polygon
                points={`${bx},${by + 7} ${bx - 5},${by + 16} ${bx + 5},${by + 16}`}
                fill="var(--positive)"
              />
              {!s.open && (
                <polygon
                  points={`${x(s.to)},${y(series[s.to].close) - 7} ${x(s.to) - 5},${y(series[s.to].close) - 16} ${x(s.to) + 5},${y(series[s.to].close) - 16}`}
                  fill="var(--negative)"
                />
              )}
            </g>
          );
        })}

        {xLabels.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 11}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fontSize="11"
            fill="var(--muted)"
            fontFamily="monospace"
          >
            {series[i].date}
          </text>
        ))}

        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            <circle cx={x(hover)} cy={y(series[hover].close)} r="3.5" fill="var(--foreground)" />
          </g>
        )}
      </svg>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-mono mt-1 min-h-[20px] px-1">
        {hover != null ? (
          <>
            <span className="text-[var(--muted)]">{series[hover].date}</span>
            <span>${series[hover].close.toFixed(2)}</span>
            {hoveredSpan ? (
              <span className={hoveredSpan.open ? "text-[var(--accent)]" : hoveredSpan.win ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                in posizione dal {hoveredSpan.signal.entryDate}
                {hoveredSpan.signal.returnPct != null
                  ? ` · chiusa a ${hoveredSpan.signal.returnPct >= 0 ? "+" : ""}${hoveredSpan.signal.returnPct}%`
                  : " · ancora aperta"}
              </span>
            ) : (
              <span className="text-[var(--muted)]">fuori dal mercato</span>
            )}
          </>
        ) : (
          <span className="text-[var(--muted)]">
            ▲ acquisto · ▼ vendita · fascia colorata = periodo in posizione (verde in utile, rossa in perdita)
          </span>
        )}
      </div>
    </div>
  );
}
