"use client";

import { useMemo, useRef, useState } from "react";
import type { ChannelPoint } from "@/lib/worldMomentum";

/**
 * Canale di regressione in formato leggibile: assi etichettati, banda ±kσ,
 * retta di regressione e lettura puntuale al passaggio del mouse.
 *
 * A differenza della miniatura nelle card, qui ogni elemento è dichiarato —
 * lo scopo è poter verificare come il canale è stato costruito, non solo
 * vederne la forma.
 */
export function RegressionDetailChart({
  points,
  kind,
  entryMaxZ,
  height = 340,
}: {
  points: ChannelPoint[];
  /** Formatta i valori: prezzi in dollari, metatitolo con più decimali. */
  kind: "price" | "meta";
  /** Se presente, ombreggia la zona d'ingresso (z ≤ soglia). */
  entryMaxZ?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 900;
  const H = height;
  const PAD = { top: 18, right: 18, bottom: 34, left: 74 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;

  const fmt = useMemo(
    () =>
      kind === "price"
        ? (v: number) => `$${v.toFixed(2)}`
        : (v: number) => v.toFixed(5),
    [kind]
  );

  const { min, max, x, y } = useMemo(() => {
    const all = points.flatMap((p) => [p.value, p.upper, p.lower]);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo) * 0.06 || 1;
    const min = lo - pad;
    const max = hi + pad;
    const n = points.length;
    return {
      min,
      max,
      x: (i: number) => PAD.left + (i / Math.max(1, n - 1)) * iw,
      y: (v: number) => PAD.top + ((max - v) / (max - min || 1)) * ih,
    };
  }, [points, iw, ih, PAD.left, PAD.top]);

  if (points.length < 2) return null;

  const n = points.length;
  const first = points[0];
  const lastP = points[n - 1];
  const color =
    lastP.fit > first.fit ? "var(--positive)" : lastP.fit < first.fit ? "var(--negative)" : "var(--muted)";

  const line = (get: (p: ChannelPoint) => number) =>
    points.map((p, i) => `${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join(" ");

  // Etichette dell'asse Y: 5 tacche equispaziate sul dominio mostrato.
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);

  // Etichette dell'asse X: prima, metà e ultima data (di più si accavallano).
  const xLabels = [0, Math.floor((n - 1) / 2), n - 1];

  // Zona d'ingresso: la fascia fra la banda inferiore e la quota z = entryMaxZ.
  const entryBand =
    entryMaxZ != null
      ? points.map((p) => {
          const sigma = p.upper - p.fit; // = k·stdev
          const kStd = sigma / 2; // torna a 1σ (le bande sono a 2σ)
          return { lower: p.lower, upper: p.fit + entryMaxZ * kStd };
        })
      : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Da pixel dello schermo a coordinate del viewBox, poi a indice di barra.
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((vx - PAD.left) / iw) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  }

  const hp = hover != null ? points[hover] : null;

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
        aria-label={kind === "price" ? "Canale di regressione sul prezzo" : "Canale di regressione sul metatitolo"}
      >
        {/* griglia + asse Y */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="monospace">
              {fmt(v)}
            </text>
          </g>
        ))}

        {/* zona d'ingresso */}
        {entryBand && (
          <path
            d={
              `M ${x(0)} ${y(entryBand[0].upper)} ` +
              entryBand.map((b, i) => `L ${x(i)} ${y(b.upper)}`).join(" ") +
              ` L ${x(n - 1)} ${y(entryBand[n - 1].lower)} ` +
              entryBand.map((b, i) => `L ${x(n - 1 - i)} ${y(entryBand[n - 1 - i].lower)}`).join(" ") +
              " Z"
            }
            fill="var(--accent)"
            opacity="0.10"
          />
        )}

        {/* banda del canale */}
        <path
          d={
            `M ${x(0)} ${y(first.upper)} ` +
            points.map((p, i) => `L ${x(i)} ${y(p.upper)}`).join(" ") +
            ` L ${x(n - 1)} ${y(lastP.lower)} ` +
            points.map((p, i) => `L ${x(n - 1 - i)} ${y(points[n - 1 - i].lower)}`).join(" ") +
            " Z"
          }
          fill={color}
          opacity="0.07"
        />

        <polyline points={line((p) => p.upper)} fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="5 4" opacity="0.6" />
        <polyline points={line((p) => p.lower)} fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="5 4" opacity="0.6" />
        <polyline points={line((p) => p.fit)} fill="none" stroke={color} strokeWidth="1.4" opacity="0.5" />
        <polyline points={line((p) => p.value)} fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinejoin="round" />

        {/* asse X */}
        {xLabels.map((i) => (
          <text key={i} x={x(i)} y={H - 12} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fontSize="11" fill="var(--muted)" fontFamily="monospace">
            {points[i].date}
          </text>
        ))}

        {/* ultimo punto */}
        <circle cx={x(n - 1)} cy={y(lastP.value)} r="4" fill={color} />

        {/* crosshair */}
        {hp && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            <circle cx={x(hover!)} cy={y(hp.value)} r="4" fill="var(--foreground)" />
            <circle cx={x(hover!)} cy={y(hp.fit)} r="3" fill={color} opacity="0.8" />
          </g>
        )}
      </svg>

      {/* Lettura puntuale: fuori dall'SVG così il testo resta nitido e selezionabile. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-mono mt-1 min-h-[20px] px-1">
        {hp ? (
          <>
            <span className="text-[var(--muted)]">{hp.date}</span>
            <span>valore <strong>{fmt(hp.value)}</strong></span>
            <span className="text-[var(--muted)]">retta {fmt(hp.fit)}</span>
            <span className="text-[var(--muted)]">banda {fmt(hp.lower)} – {fmt(hp.upper)}</span>
            <span className={hp.z > 0 ? "text-[var(--warning)]" : "text-[var(--positive)]"}>z {hp.z}</span>
          </>
        ) : (
          <span className="text-[var(--muted)]">Passa il mouse sul grafico per leggere i valori barra per barra.</span>
        )}
      </div>
    </div>
  );
}
