"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChannelPoint, DrawnChannel } from "@/lib/worldMomentum";

/** Un periodo di possesso da ombreggiare, con i marcatori di ingresso e uscita. */
export interface HoldingSpan {
  from: string;
  /** null = ancora aperta alla fine dello storico. */
  to: string | null;
  returnPct: number | null;
}

/**
 * Grafico temporale che condivide ASSE e CURSORE con gli altri grafici della
 * pagina: tutti ricevono lo stesso `domain` (le date mostrate) e lo stesso
 * `hoverDate`, e chi viene sorvolato aggiorna la data per tutti. Così una
 * barra del metatitolo, la stessa barra del prezzo e il segnale di quel giorno
 * stanno sulla stessa verticale.
 *
 * Il canale di regressione, se c'è, viene disegnato solo sulle date su cui è
 * stato fittato: si vede dove comincia la finestra e cosa resta fuori.
 *
 * I canali ancorati (`channels`) si disegnano come su ProRealTime: metà
 * superiore verde, metà inferiore rossa, retta centrale tratteggiata, bordi
 * del colore della direzione. Il pallino segna la seduta in cui la nascita del
 * canale è stata confermata — da lì in poi lo si sapeva davvero.
 *
 * Un clic fissa una data (`pinnedDate`) su tutti i grafici; un secondo clic
 * sulla stessa data la toglie. Il cursore del mouse resta libero di muoversi.
 */
export function SyncedTimeChart({
  domain,
  series,
  channel,
  channels,
  entryMaxZ,
  spans,
  kind,
  hoverDate,
  onHover,
  pinnedDate = null,
  onPin,
  height = 300,
}: {
  domain: string[];
  series: { date: string; value: number }[];
  channel?: ChannelPoint[];
  channels?: DrawnChannel[];
  entryMaxZ?: number;
  spans?: HoldingSpan[];
  kind: "price" | "meta";
  hoverDate: string | null;
  onHover: (date: string | null) => void;
  pinnedDate?: string | null;
  onPin?: (date: string | null) => void;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // La larghezza del disegno è quella VERA del contenitore: con una larghezza
  // fissa l'SVG, scalato mantenendo le proporzioni, restava centrato con dei
  // margini vuoti sui lati, e il cursore — calcolato sulla larghezza intera —
  // non stava più sotto il mouse.
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
  const n = domain.length;

  const fmt = (v: number) => (kind === "price" ? `$${v.toFixed(2)}` : v.toFixed(5));

  const idx = useMemo(() => new Map(domain.map((d, i) => [d, i])), [domain]);
  const byDate = useMemo(() => new Map(series.map((p) => [p.date, p.value])), [series]);
  const chByDate = useMemo(() => new Map((channel ?? []).map((p) => [p.date, p])), [channel]);

  // Solo i punti che cadono nel periodo mostrato.
  const visible = useMemo(() => series.filter((p) => idx.has(p.date)), [series, idx]);
  const visibleCh = useMemo(() => (channel ?? []).filter((p) => idx.has(p.date)), [channel, idx]);

  // Canali ancorati ritagliati sul periodo mostrato. La retta è lineare
  // nell'indice di barra della serie, quindi bastano i due estremi.
  const anchored = useMemo(() => {
    if (!channels?.length || domain.length < 2) return [];
    const g = new Map(series.map((p, i) => [p.date, i]));
    const first = domain[0];
    const last = domain[domain.length - 1];
    return channels
      .map((c) => {
        if (c.to < first || c.from > last) return null;
        const a = c.from < first ? first : c.from;
        const b = c.to > last ? last : c.to;
        const ga = g.get(a), gb = g.get(b), g0 = g.get(c.from);
        if (ga == null || gb == null || g0 == null || !idx.has(a) || !idx.has(b)) return null;
        const midA = c.startMid + c.slope * (ga - g0);
        const midB = c.startMid + c.slope * (gb - g0);
        return { c, a, b, midA, midB, confirmedVisible: c.cause !== "start" && idx.has(c.confirmedAt) };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  }, [channels, series, domain, idx]);

  const { min, max } = useMemo(() => {
    const vals = [
      ...visible.map((p) => p.value),
      ...visibleCh.flatMap((p) => [p.upper, p.lower]),
    ].filter((v) => isFinite(v));
    if (!vals.length) return { min: 0, max: 1 };
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    // I canali ancorati allargano la scala, ma al massimo di metà dell'escursione
    // dei prezzi per lato: un canale molto largo non deve schiacciare il grafico
    // (quello che esce dall'area viene ritagliato).
    const span = hi - lo;
    for (const s of anchored) {
      for (const v of [s.midA + s.c.band, s.midA - s.c.band, s.midB + s.c.band, s.midB - s.c.band]) {
        if (!isFinite(v)) continue;
        lo = Math.min(lo, Math.max(v, Math.min(...vals) - span * 0.5));
        hi = Math.max(hi, Math.min(v, Math.max(...vals) + span * 0.5));
      }
    }
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.01 || 1;
    // Prezzi e metatitolo sono positivi: l'asse non scende sotto zero.
    return { min: Math.max(0, lo - pad), max: hi + pad };
  }, [visible, visibleCh, anchored]);

  if (n < 2 || visible.length < 2) return null;

  const x = (d: string) => PAD.left + ((idx.get(d) ?? 0) / (n - 1)) * iw;
  const y = (v: number) => PAD.top + ((max - v) / (max - min || 1)) * ih;
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const xLabels = [domain[0], domain[Math.floor((n - 1) / 2)], domain[n - 1]];

  const line = (pts: { date: string }[], get: (p: never) => number) =>
    pts.map((p) => `${x(p.date).toFixed(1)},${y(get(p as never)).toFixed(1)}`).join(" ");

  const bandPath = (pts: ChannelPoint[], up: (p: ChannelPoint) => number, lo: (p: ChannelPoint) => number) =>
    pts.length < 2
      ? ""
      : `M ${x(pts[0].date)} ${y(up(pts[0]))} ` +
        pts.map((p) => `L ${x(p.date)} ${y(up(p))}`).join(" ") +
        ` L ${x(pts[pts.length - 1].date)} ${y(lo(pts[pts.length - 1]))} ` +
        [...pts].reverse().map((p) => `L ${x(p.date)} ${y(lo(p))}`).join(" ") +
        " Z";

  const chColor =
    visibleCh.length > 1 && visibleCh[visibleCh.length - 1].fit > visibleCh[0].fit
      ? "var(--positive)"
      : visibleCh.length > 1 && visibleCh[visibleCh.length - 1].fit < visibleCh[0].fit
      ? "var(--negative)"
      : "var(--muted)";

  // Fascia d'ingresso: dalla banda inferiore alla quota z = entryMaxZ.
  // Le bande sono a ±2σ, quindi 1σ = (upper − fit) / 2.
  const entryTop = (p: ChannelPoint) => p.fit + (entryMaxZ ?? 0) * ((p.upper - p.fit) / 2);

  // Periodi di possesso ritagliati sul periodo mostrato.
  const lastDate = domain[n - 1];
  const visibleSpans = (spans ?? [])
    .map((s) => {
      const end = s.to ?? lastDate;
      if (end < domain[0] || s.from > lastDate) return null;
      const a = s.from < domain[0] ? domain[0] : s.from;
      const b = end > lastDate ? lastDate : end;
      // Le date di ingresso/uscita possono non essere nel dominio (festivi):
      // si aggancia alla prima data disponibile.
      const aD = idx.has(a) ? a : domain.find((d) => d >= a);
      const bD = idx.has(b) ? b : [...domain].reverse().find((d) => d <= b);
      if (!aD || !bD) return null;
      return { ...s, aD, bD, entryVisible: s.from >= domain[0], exitVisible: s.to != null && s.to <= lastDate };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  /** Data sotto il mouse, dalle coordinate reali del disegno (matrice dello schermo). */
  function dateAt(e: React.MouseEvent<SVGSVGElement>): string | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    if (pt.x < PAD.left - 12 || pt.x > W - PAD.right + 12) return null;
    const i = Math.round(((pt.x - PAD.left) / iw) * (n - 1));
    return domain[Math.min(n - 1, Math.max(0, i))];
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    onHover(dateAt(e));
  }

  function onClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!onPin) return;
    const d = dateAt(e);
    if (d) onPin(d === pinnedDate ? null : d);
  }

  const pv = pinnedDate && idx.has(pinnedDate) ? pinnedDate : null;
  // Il riquadro sotto il grafico mostra la data sotto il mouse, o in sua
  // assenza quella fissata.
  const hv = hoverDate && idx.has(hoverDate) ? hoverDate : pv;
  const showingPin = hv != null && hv === pv && !(hoverDate && idx.has(hoverDate));
  const hvValue = hv ? byDate.get(hv) : undefined;
  const hvCh = hv ? chByDate.get(hv) : undefined;
  const hvSpan = hv ? visibleSpans.find((s) => hv >= s.aD && hv <= s.bD) : undefined;
  // Canale ancorato attivo alla data sorvolata: fra quelli che la contengono,
  // l'ultimo già confermato (i canali si sovrappongono di qualche barra).
  const hvAnch = hv
    ? [...anchored].reverse().find((s) => hv >= s.a && hv <= s.b && s.c.confirmedAt <= hv) ??
      anchored.find((s) => hv >= s.a && hv <= s.b)
    : undefined;
  const dirColor = (d: DrawnChannel["dir"]) =>
    d === "up" ? "var(--positive)" : d === "down" ? "var(--negative)" : "var(--muted)";
  const dirLabel = (d: DrawnChannel["dir"]) => (d === "up" ? "rialzista" : d === "down" ? "ribassista" : "laterale");

  return (
    <div ref={boxRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={height}
        className={onPin ? "cursor-crosshair" : undefined}
        onMouseMove={onMove}
        onMouseLeave={() => onHover(null)}
        onClick={onClick}
        role="img"
        aria-label={kind === "price" ? "Prezzo nel tempo" : "Metatitolo nel tempo"}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="monospace">
              {fmt(v)}
            </text>
          </g>
        ))}

        {/* periodi di possesso */}
        {visibleSpans.map((s, k) => (
          <rect
            key={`s${k}`}
            x={x(s.aD)}
            y={PAD.top}
            width={Math.max(1.5, x(s.bD) - x(s.aD))}
            height={ih}
            fill={s.to == null ? "var(--accent)" : (s.returnPct ?? 0) >= 0 ? "var(--positive)" : "var(--negative)"}
            opacity={hvSpan === s ? 0.24 : 0.11}
          />
        ))}

        {/* canale di regressione, solo sulla sua finestra di fit */}
        {visibleCh.length > 1 && (
          <>
            <line
              x1={x(visibleCh[0].date)} x2={x(visibleCh[0].date)} y1={PAD.top} y2={H - PAD.bottom}
              stroke={chColor} strokeWidth="1" strokeDasharray="2 3" opacity="0.6"
            />
            <text x={x(visibleCh[0].date) + 4} y={PAD.top + 11} fontSize="10" fill={chColor} opacity="0.85">
              inizio finestra del canale
            </text>
            {entryMaxZ != null && (
              <path d={bandPath(visibleCh, entryTop, (p) => p.lower)} fill="var(--accent)" opacity="0.10" />
            )}
            <path d={bandPath(visibleCh, (p) => p.upper, (p) => p.lower)} fill={chColor} opacity="0.07" />
            <polyline points={line(visibleCh, (p: ChannelPoint) => p.upper)} fill="none" stroke={chColor} strokeWidth="1.2" strokeDasharray="5 4" opacity="0.65" />
            <polyline points={line(visibleCh, (p: ChannelPoint) => p.lower)} fill="none" stroke={chColor} strokeWidth="1.2" strokeDasharray="5 4" opacity="0.65" />
            <polyline points={line(visibleCh, (p: ChannelPoint) => p.fit)} fill="none" stroke={chColor} strokeWidth="1.4" opacity="0.55" />
          </>
        )}

        {/* canali ancorati, stile ProRealTime (ritagliati sull'area del grafico) */}
        <clipPath id={`plot-${kind}-${height}`}>
          <rect x={PAD.left} y={PAD.top} width={iw} height={ih} />
        </clipPath>
        <g clipPath={`url(#plot-${kind}-${height})`}>
        {anchored.map((s, k) => {
          const { c, a, b, midA, midB } = s;
          const col = dirColor(c.dir);
          const active = hvAnch === s;
          return (
            <g key={`a${k}`}>
              <polygon
                points={`${x(a)},${y(midA + c.band)} ${x(b)},${y(midB + c.band)} ${x(b)},${y(midB)} ${x(a)},${y(midA)}`}
                fill="var(--positive)" opacity={active ? 0.2 : 0.11}
              />
              <polygon
                points={`${x(a)},${y(midA)} ${x(b)},${y(midB)} ${x(b)},${y(midB - c.band)} ${x(a)},${y(midA - c.band)}`}
                fill="var(--negative)" opacity={active ? 0.16 : 0.08}
              />
              <line x1={x(a)} y1={y(midA + c.band)} x2={x(b)} y2={y(midB + c.band)} stroke={col} strokeWidth={active ? 1.6 : 1.1} />
              <line x1={x(a)} y1={y(midA - c.band)} x2={x(b)} y2={y(midB - c.band)} stroke={col} strokeWidth={active ? 1.6 : 1.1} />
              <line x1={x(a)} y1={y(midA)} x2={x(b)} y2={y(midB)} stroke="var(--warning)" strokeWidth="1" strokeDasharray="4 3" opacity="0.75" />
            </g>
          );
        })}
        </g>

        {/* serie */}
        <polyline
          points={line(visible, (p: { value: number }) => p.value)}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />

        {/* marcatori ▲ acquisto / ▼ vendita */}
        {visibleSpans.map((s, k) => {
          const ev = byDate.get(s.aD);
          const xv = byDate.get(s.bD);
          return (
            <g key={`m${k}`}>
              {s.entryVisible && ev != null && (
                <polygon
                  points={`${x(s.aD)},${y(ev) + 7} ${x(s.aD) - 5},${y(ev) + 16} ${x(s.aD) + 5},${y(ev) + 16}`}
                  fill="var(--positive)"
                />
              )}
              {s.exitVisible && xv != null && (
                <polygon
                  points={`${x(s.bD)},${y(xv) - 7} ${x(s.bD) - 5},${y(xv) - 16} ${x(s.bD) + 5},${y(xv) - 16}`}
                  fill="var(--negative)"
                />
              )}
            </g>
          );
        })}

        {/* pallino: seduta in cui la nascita del canale è stata confermata */}
        {anchored.map((s, k) => {
          if (!s.confirmedVisible) return null;
          const v = byDate.get(s.c.confirmedAt);
          if (v == null) return null;
          return (
            <circle key={`c${k}`} cx={x(s.c.confirmedAt)} cy={y(v)} r="3.5"
              fill={dirColor(s.c.dir)} stroke="var(--surface)" strokeWidth="1" />
          );
        })}

        {xLabels.map((d, k) => (
          <text
            key={k}
            x={x(d)}
            y={H - 10}
            textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
            fontSize="11"
            fill="var(--muted)"
            fontFamily="monospace"
          >
            {d}
          </text>
        ))}

        {/* data fissata con un clic: resta finché non la togli */}
        {pv && (
          <g>
            <line x1={x(pv)} x2={x(pv)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--accent)" strokeWidth="2" />
            <rect x={Math.min(W - PAD.right - 78, Math.max(PAD.left, x(pv) - 39))} y={PAD.top - 14} width="78" height="14" rx="3" fill="var(--accent)" />
            <text x={Math.min(W - PAD.right - 39, Math.max(PAD.left + 39, x(pv)))} y={PAD.top - 3.5} textAnchor="middle" fontSize="10" fill="white" fontFamily="monospace">
              {pv}
            </text>
            {byDate.get(pv) != null && <circle cx={x(pv)} cy={y(byDate.get(pv)!)} r="4.5" fill="var(--accent)" stroke="white" strokeWidth="1.2" />}
          </g>
        )}

        {/* cursore condiviso */}
        {hv && hv !== pv && (
          <g>
            <line x1={x(hv)} x2={x(hv)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--accent-2)" strokeWidth="1.2" opacity="0.9" />
            {hvValue != null && <circle cx={x(hv)} cy={y(hvValue)} r="4" fill="var(--accent-2)" />}
            {hvCh && <circle cx={x(hv)} cy={y(hvCh.fit)} r="3" fill={chColor} opacity="0.85" />}
          </g>
        )}
      </svg>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-mono mt-1 min-h-[20px] px-1">
        {hv ? (
          <>
            <span className={showingPin ? "text-[var(--accent)]" : "text-[var(--accent-2)]"}>
              {showingPin ? "📌 " : ""}{hv}
            </span>
            {hvValue != null && <span>valore <strong>{fmt(hvValue)}</strong></span>}
            {hvCh ? (
              <>
                <span className="text-[var(--muted)]">retta {fmt(hvCh.fit)}</span>
                <span className="text-[var(--muted)]">banda {fmt(hvCh.lower)} – {fmt(hvCh.upper)}</span>
                <span className={hvCh.z > 0 ? "text-[var(--warning)]" : "text-[var(--positive)]"}>z {hvCh.z}</span>
              </>
            ) : (
              channel && <span className="text-[var(--muted)]">fuori dalla finestra del canale</span>
            )}
            {hvAnch && (
              <span style={{ color: dirColor(hvAnch.c.dir) }}>
                canale {dirLabel(hvAnch.c.dir)} dal {hvAnch.c.from}
                {hvAnch.c.cause !== "start" ? ` (confermato il ${hvAnch.c.confirmedAt})` : ""}
                {" · "}{hvAnch.c.slopePct >= 0 ? "+" : ""}{hvAnch.c.slopePct}%/anno
              </span>
            )}
            {spans && (
              hvSpan ? (
                <span className={hvSpan.to == null ? "text-[var(--accent)]" : (hvSpan.returnPct ?? 0) >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                  in posizione dal {hvSpan.from}
                  {hvSpan.returnPct != null ? ` · chiusa a ${hvSpan.returnPct >= 0 ? "+" : ""}${hvSpan.returnPct}%` : " · ancora aperta"}
                </span>
              ) : (
                <span className="text-[var(--muted)]">fuori dal mercato</span>
              )
            )}
          </>
        ) : (
          <span className="text-[var(--muted)]">
            Passa il mouse su uno qualsiasi dei grafici: il cursore si muove su tutti.
            {onPin ? " Clic per fissare una data." : ""}
          </span>
        )}
      </div>
    </div>
  );
}
