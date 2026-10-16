"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface EquityLine {
  label: string;
  color: string;
  points: { date: string; equity: number }[];
  /** Linea di riferimento (tratteggiata e più sottile). */
  dashed?: boolean;
}

/**
 * Curve di equity a confronto sullo stesso asse, con cursore e data fissata
 * condivisi con gli altri grafici della pagina (stesse props di
 * SyncedTimeChart). Sotto il grafico, il valore di ogni linea alla data
 * indicata: è la lettura che serve per confrontare due strategie a una data.
 */
export function MultiEquityChart({
  lines,
  base,
  hoverDate,
  onHover,
  pinnedDate = null,
  onPin,
  height = 300,
}: {
  lines: EquityLine[];
  base: number;
  hoverDate: string | null;
  onHover: (date: string | null) => void;
  pinnedDate?: string | null;
  onPin?: (date: string | null) => void;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(900);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setBoxW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(320, boxW);
  const H = height;
  const PAD = { top: 16, right: 16, bottom: 30, left: 74 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;

  // Asse: le date della prima linea (tutte coprono lo stesso periodo).
  const domain = useMemo(() => lines[0]?.points.map((p) => p.date) ?? [], [lines]);
  const idx = useMemo(() => new Map(domain.map((d, i) => [d, i])), [domain]);
  const byLine = useMemo(() => lines.map((l) => new Map(l.points.map((p) => [p.date, p.equity]))), [lines]);
  const n = domain.length;

  const { min, max } = useMemo(() => {
    const vals = lines.flatMap((l) => l.points.map((p) => p.equity)).concat(base);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.05 || 1;
    // Il capitale non scende sotto zero: niente asse con valori negativi.
    return { min: Math.max(0, lo - pad), max: hi + pad };
  }, [lines, base]);

  if (n < 2) return null;

  const x = (d: string) => PAD.left + ((idx.get(d) ?? 0) / (n - 1)) * iw;
  const y = (v: number) => PAD.top + ((max - v) / (max - min || 1)) * ih;
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const xLabels = [domain[0], domain[Math.floor((n - 1) / 2)], domain[n - 1]];
  const money = (v: number) => `$${Math.round(v).toLocaleString("it-IT")}`;

  function dateAt(e: React.MouseEvent<SVGSVGElement>): string | null {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    if (pt.x < PAD.left - 12 || pt.x > W - PAD.right + 12) return null;
    const i = Math.round(((pt.x - PAD.left) / iw) * (n - 1));
    return domain[Math.min(n - 1, Math.max(0, i))];
  }

  const pv = pinnedDate && idx.has(pinnedDate) ? pinnedDate : null;
  const hoverIn = hoverDate && idx.has(hoverDate) ? hoverDate : null;
  const hv = hoverIn ?? pv;

  return (
    <div ref={boxRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className={onPin ? "cursor-crosshair" : undefined}
        onMouseMove={(e) => onHover(dateAt(e))}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => {
          if (!onPin) return;
          const d = dateAt(e);
          if (d) onPin(d === pinnedDate ? null : d);
        }}
        role="img"
        aria-label="Curve di equity a confronto"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="monospace">
              {money(v)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(base)} y2={y(base)} stroke="var(--muted)" strokeWidth="0.8" strokeDasharray="2 3" />

        {lines.map((l) => (
          <polyline
            key={l.label}
            points={l.points.map((p) => `${x(p.date).toFixed(1)},${y(p.equity).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={l.color}
            strokeWidth={l.dashed ? 1.2 : 2}
            strokeDasharray={l.dashed ? "5 4" : undefined}
            opacity={l.dashed ? 0.8 : 1}
            strokeLinejoin="round"
          />
        ))}

        {xLabels.map((d, k) => (
          <text key={k} x={x(d)} y={H - 10} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
            fontSize="11" fill="var(--muted)" fontFamily="monospace">
            {d}
          </text>
        ))}

        {pv && (
          <g>
            <line x1={x(pv)} x2={x(pv)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--accent)" strokeWidth="2" />
            <rect x={Math.min(W - PAD.right - 78, Math.max(PAD.left, x(pv) - 39))} y={PAD.top - 14} width="78" height="14" rx="3" fill="var(--accent)" />
            <text x={Math.min(W - PAD.right - 39, Math.max(PAD.left + 39, x(pv)))} y={PAD.top - 3.5} textAnchor="middle" fontSize="10" fill="white" fontFamily="monospace">
              {pv}
            </text>
          </g>
        )}
        {hv && (
          <g>
            {hv !== pv && <line x1={x(hv)} x2={x(hv)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--accent-2)" strokeWidth="1.2" opacity="0.9" />}
            {lines.map((l, k) => {
              const v = byLine[k].get(hv);
              return v != null ? <circle key={l.label} cx={x(hv)} cy={y(v)} r="3.5" fill={l.color} /> : null;
            })}
          </g>
        )}
      </svg>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs mt-1 px-1 min-h-[20px]">
        {hv && (
          <span className={`font-mono ${hv === pv && !hoverIn ? "text-[var(--accent)]" : "text-[var(--accent-2)]"}`}>
            {hv === pv && !hoverIn ? "📌 " : ""}{hv}
          </span>
        )}
        {lines.map((l, k) => {
          const v = hv ? byLine[k].get(hv) : l.points[l.points.length - 1]?.equity;
          const r = v != null ? ((v - base) / base) * 100 : null;
          return (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5" style={{ background: l.color, opacity: l.dashed ? 0.7 : 1 }} />
              <span className="text-[var(--muted)]">{l.label}</span>
              {v != null && (
                <span className="font-mono">
                  {money(v)}{" "}
                  <span className={r != null && r >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                    ({r != null ? `${r >= 0 ? "+" : ""}${r.toFixed(1)}%` : "—"})
                  </span>
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
