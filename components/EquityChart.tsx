"use client";

import { useMemo, useRef, useState } from "react";
import { pct } from "@/lib/format";
import type { EquityPoint, EquitySummary } from "@/lib/portfolioEquity";

export type Currency = "USD" | "EUR";

/** Formatter valuta coerente col toggle €/$ del grafico. */
function moneyIn(currency: Currency): (n: number) => string {
  const fmt = new Intl.NumberFormat(currency === "EUR" ? "it-IT" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (n) => fmt.format(n);
}

// Grafico di andamento riutilizzabile: linea equity + benchmark SPY + baseline
// capitale investito, con una striscia "underwater" del drawdown sotto e
// crosshair/tooltip al passaggio del mouse. SVG puro (nessuna dipendenza), in
// linea con Sparkline/ChannelChart. Coordinate in uno spazio viewBox fisso; il
// contenitore scala a larghezza piena.

const W = 800;
const H = 300;
const PAD_L = 56;
const PAD_R = 14;
const MAIN_TOP = 14;
const MAIN_BOT = 212;
const DD_TOP = 236;
const DD_BOT = 290;

function niceDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" });
}

export function EquityChart({
  points,
  summary,
  label,
  currency = "USD",
  onCurrencyChange,
  fxDeltaPt = null,
}: {
  points: EquityPoint[];
  summary: EquitySummary | null;
  label: string;
  /** Valuta dei punti già passati (la conversione avviene a monte). */
  currency?: Currency;
  /** Se presente, mostra il toggle €/$ nell'header. */
  onCurrencyChange?: (c: Currency) => void;
  /** Effetto cambio in punti % (rendimento EUR − rendimento USD), solo vista EUR. */
  fxDeltaPt?: number | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const money = moneyIn(currency);

  const layout = useMemo(() => {
    if (points.length < 2 || !summary) return null;
    const n = points.length;
    const xi = (i: number) => PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R);

    // Range verticale su equity + benchmark + baseline investito.
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      for (const v of [p.value, p.bench, p.invested]) {
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const span = max - min || 1;
    min -= span * 0.06;
    max += span * 0.06;
    const yVal = (v: number) => MAIN_BOT - ((v - min) / (max - min)) * (MAIN_BOT - MAIN_TOP);

    const maxDd = Math.max(0.0001, ...points.map((p) => p.drawdownPct));
    const yDd = (dd: number) => DD_TOP + (dd / maxDd) * (DD_BOT - DD_TOP);

    const line = (accessor: (p: EquityPoint) => number | null) => {
      let d = "";
      points.forEach((p, i) => {
        const v = accessor(p);
        if (v == null) return;
        d += `${d ? "L" : "M"} ${xi(i).toFixed(1)} ${yVal(v).toFixed(1)} `;
      });
      return d.trim();
    };

    const equityPath = line((p) => p.value);
    const benchPath = line((p) => p.bench);
    const investedPath = line((p) => p.invested);

    // Area underwater del drawdown (0 in alto → picco di calo in basso).
    let ddArea = `M ${xi(0).toFixed(1)} ${DD_TOP} `;
    points.forEach((p, i) => {
      ddArea += `L ${xi(i).toFixed(1)} ${yDd(p.drawdownPct).toFixed(1)} `;
    });
    ddArea += `L ${xi(n - 1).toFixed(1)} ${DD_TOP} Z`;

    // Etichette asse Y (3 tacche sul valore).
    const yTicks = [max - (max - min) * 0.06, (max + min) / 2, min + (max - min) * 0.06].map((v) => ({
      v,
      y: yVal(v),
    }));

    return { n, xi, yVal, equityPath, benchPath, investedPath, ddArea, yDd, maxDd, yTicks };
  }, [points, summary]);

  if (!layout || !summary) return null;

  const hp = hover != null ? points[hover] : null;
  const returnColor = summary.totalReturnPct >= 0 ? "var(--positive)" : "var(--negative)";

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || !layout) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (x - PAD_L) / (W - PAD_L - PAD_R);
    const idx = Math.round(frac * (layout.n - 1));
    setHover(Math.max(0, Math.min(layout.n - 1, idx)));
  }

  const hoverX = hp && hover != null ? layout.xi(hover) : null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {/* KPI */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 mb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide">
            📈 Andamento — {label}
          </h3>
          {onCurrencyChange && (
            <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-[11px] font-mono">
              {(["USD", "EUR"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => onCurrencyChange(c)}
                  className={`px-2 py-0.5 transition-colors ${
                    currency === c
                      ? "bg-[var(--accent)]/15 text-[var(--accent)] font-semibold"
                      : "text-[var(--muted)] hover:bg-[var(--surface-2)]"
                  }`}
                  title={c === "EUR" ? "Vista in euro al cambio storico giornaliero" : "Valuta degli asset"}
                >
                  {c === "USD" ? "$" : "€"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <Kpi label="Valore" value={money(summary.currentValue)} />
          <Kpi label="Rendimento" value={pct(summary.totalReturnPct)} color={returnColor} />
          {fxDeltaPt != null && (
            <Kpi
              label="Effetto cambio"
              value={`${fxDeltaPt >= 0 ? "+" : ""}${fxDeltaPt}pt`}
              color={fxDeltaPt >= 0 ? "var(--positive)" : "var(--negative)"}
            />
          )}
          <Kpi label="Max drawdown" value={`-${summary.maxDrawdownPct.toFixed(1)}%`} color="var(--negative)" />
          <Kpi
            label="SPY"
            value={summary.benchReturnPct != null ? pct(summary.benchReturnPct) : "—"}
            color="var(--muted)"
          />
        </div>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ touchAction: "none" }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* griglia + etichette Y */}
          {layout.yTicks.map((t, i) => (
            <g key={i}>
              <line x1={PAD_L} x2={W - PAD_R} y1={t.y} y2={t.y} stroke="var(--border)" strokeWidth="1" opacity="0.5" />
              <text x={PAD_L - 8} y={t.y + 3} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="var(--font-mono)">
                {Math.round(t.v).toLocaleString()}
              </text>
            </g>
          ))}

          {/* baseline capitale investito (punteggiata) */}
          <path d={layout.investedPath} fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="2 3" opacity="0.55" />
          {/* benchmark SPY (tratteggiata) */}
          {layout.benchPath && (
            <path d={layout.benchPath} fill="none" stroke="var(--accent-3)" strokeWidth="1.6" strokeDasharray="5 4" opacity="0.75" />
          )}
          {/* equity */}
          <path d={layout.equityPath} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />

          {/* striscia drawdown */}
          <path d={layout.ddArea} fill="var(--negative)" opacity="0.16" />
          <line x1={PAD_L} x2={W - PAD_R} y1={DD_TOP} y2={DD_TOP} stroke="var(--border)" strokeWidth="1" opacity="0.5" />
          <text x={PAD_L - 8} y={DD_TOP + 3} textAnchor="end" fontSize="10" fill="var(--muted)">0%</text>
          <text x={PAD_L - 8} y={DD_BOT} textAnchor="end" fontSize="10" fill="var(--negative)" fontFamily="var(--font-mono)">
            -{layout.maxDd.toFixed(0)}%
          </text>

          {/* etichette asse X (start / mid / end) */}
          {[0, Math.floor((layout.n - 1) / 2), layout.n - 1].map((i, k) => (
            <text
              key={i}
              x={layout.xi(i)}
              y={H - 2}
              textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
              fontSize="11"
              fill="var(--muted)"
            >
              {niceDate(points[i].date)}
            </text>
          ))}

          {/* crosshair + marker */}
          {hp && hoverX != null && (
            <g>
              <line x1={hoverX} x2={hoverX} y1={MAIN_TOP} y2={DD_BOT} stroke="var(--foreground)" strokeWidth="1" opacity="0.25" />
              <circle cx={hoverX} cy={layout.yVal(hp.value)} r="3.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
              {hp.bench != null && (
                <circle cx={hoverX} cy={layout.yVal(hp.bench)} r="3" fill="var(--accent-3)" stroke="var(--surface)" strokeWidth="1.5" />
              )}
            </g>
          )}
        </svg>

        {/* tooltip */}
        {hp && hover != null && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${(layout.xi(hover) / W) * 100}%`,
              transform: `translateX(${hover > layout.n / 2 ? "-105%" : "5%"})`,
            }}
          >
            <p className="text-[var(--muted)] mb-1">{niceDate(hp.date)}</p>
            <p className="font-mono font-semibold" style={{ color: "var(--accent)" }}>{money(hp.value)}</p>
            {hp.bench != null && (
              <p className="font-mono text-[var(--accent-3)]">SPY {money(hp.bench)}</p>
            )}
            {hp.drawdownPct > 0 && (
              <p className="font-mono text-[var(--negative)]">DD -{hp.drawdownPct.toFixed(1)}%</p>
            )}
          </div>
        )}
      </div>

      {/* legenda */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-[var(--muted)]">
        <Legend color="var(--accent)">Equity</Legend>
        <Legend color="var(--accent-3)" dashed>SPY</Legend>
        <Legend color="var(--muted)" dashed>Investito</Legend>
        <Legend color="var(--negative)" area>Drawdown</Legend>
      </div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <span className="font-mono font-semibold" style={{ color: color ?? "var(--foreground)" }}>{value}</span>
    </span>
  );
}

function Legend({ color, dashed, area, children }: { color: string; dashed?: boolean; area?: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-4 rounded-sm"
        style={{
          background: area ? `color-mix(in srgb, ${color} 25%, transparent)` : "transparent",
          borderTop: area ? "none" : `2px ${dashed ? "dashed" : "solid"} ${color}`,
        }}
      />
      {children}
    </span>
  );
}
