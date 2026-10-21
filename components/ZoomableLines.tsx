"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface ZoomLine {
  label: string;
  color: string;
  points: { date: string; value: number }[];
  dashed?: boolean;
  /** Area colorata fra la linea e lo zero (per drawdown e P&L). */
  fill?: boolean;
  /** Linea in primo piano (più spessa). */
  strong?: boolean;
}

/** Periodo mostrato: due date incluse. null = tutto. */
export type DateRange = { from: string; to: string } | null;

const MONTHS_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/**
 * Tacche dell'asse delle date, tante quante ne stanno (`maxTicks`). Asse a due
 * righe: sopra l'unità fine (giorno o mese), sotto il contesto (mese o anno)
 * solo quando cambia — così le etichette sono corte e se ne possono mettere
 * molte. Su periodi brevi si contano le sedute, su quelli lunghi i mesi a passo
 * 1/2/3/6/12.
 */
export function dateTicks(dates: string[], maxTicks: number): { i: number; label: string; sub?: string }[] {
  const n = dates.length;
  if (n < 2) return [];
  const mon = (d: string) => MONTHS_IT[Number(d.slice(5, 7)) - 1];

  // Periodo breve: una tacca ogni k sedute, giorno sopra e mese sotto quando cambia.
  if (n <= 90) {
    const k = [1, 2, 5, 10, 20].find((st) => n / st <= maxTicks) ?? 20;
    const out: { i: number; label: string; sub?: string }[] = [];
    let lastMonth = "";
    for (let i = 0; i < n; i += k) {
      const m = dates[i].slice(0, 7);
      out.push({ i, label: String(Number(dates[i].slice(8, 10))), sub: m !== lastMonth ? `${mon(dates[i])} ${dates[i].slice(2, 4)}` : undefined });
      lastMonth = m;
    }
    return out;
  }

  const monthOf = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  const span = monthOf(dates[n - 1]) - monthOf(dates[0]);
  const step = [1, 2, 3, 6, 12, 24].find((st) => span / st <= maxTicks) ?? 24;
  const out: { i: number; label: string; sub?: string }[] = [];
  let prev = -1;
  let lastYear = "";
  for (let i = 0; i < n; i++) {
    const abs = monthOf(dates[i]);
    if (abs === prev) continue;
    prev = abs;
    if (i === 0 && Number(dates[0].slice(8, 10)) > 7) continue; // il primo mese conta solo se inizia lì
    if (abs % step !== 0) continue;
    const year = dates[i].slice(0, 4);
    if (step >= 12) out.push({ i, label: year });
    else out.push({ i, label: mon(dates[i]), sub: year !== lastYear ? year : undefined });
    lastYear = year;
  }
  return out;
}

/**
 * Grafico a linee con zoom: si trascina per selezionare un periodo, doppio
 * clic per tornare a tutto. Periodo e cursore sono controllati dal genitore,
 * così più grafici ingrandiscono e si muovono insieme.
 */
export function ZoomableLines({
  lines,
  range,
  onRange,
  hoverDate,
  onHover,
  formatY,
  baseline,
  zeroTop = false,
  height = 240,
}: {
  lines: ZoomLine[];
  range: DateRange;
  onRange: (r: DateRange) => void;
  hoverDate: string | null;
  onHover: (d: string | null) => void;
  formatY: (v: number) => string;
  /** Linea orizzontale di riferimento (es. il capitale iniziale). */
  baseline?: number;
  /** Asse con lo zero in alto (drawdown: tutti i valori ≤ 0). */
  zeroTop?: boolean;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(720);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const w = Math.round(e[0].contentRect.width);
      if (w > 0) setBoxW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Asse: le date della linea più lunga, ritagliate sul periodo scelto.
  const allDates = useMemo(
    () => lines.reduce<string[]>((a, l) => (l.points.length > a.length ? l.points.map((p) => p.date) : a), []),
    [lines]
  );
  const dates = useMemo(() => {
    if (!range) return allDates;
    return allDates.filter((d) => d >= range.from && d <= range.to);
  }, [allDates, range]);
  const idx = useMemo(() => new Map(dates.map((d, i) => [d, i])), [dates]);
  const byLine = useMemo(() => lines.map((l) => new Map(l.points.map((p) => [p.date, p.value]))), [lines]);

  const W = Math.max(320, boxW);
  const H = height;
  const PAD = { t: 12, r: 14, b: 40, l: 66 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const n = dates.length;

  const { min, max } = useMemo(() => {
    const vals: number[] = [];
    for (const m of byLine) for (const d of dates) { const v = m.get(d); if (v != null && isFinite(v)) vals.push(v); }
    if (baseline != null) vals.push(baseline);
    if (zeroTop) vals.push(0);
    if (!vals.length) return { min: 0, max: 1 };
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.02 || 1;
    if (zeroTop) { hi = 0; lo -= pad; } else { lo -= pad; hi += pad; }
    return { min: lo, max: hi };
  }, [byLine, dates, baseline, zeroTop]);

  // Trascinamento in corso: indice di partenza e indice corrente. Il rilascio
  // si ascolta su tutta la finestra: se il mouse esce dal grafico mentre
  // trascini, la selezione si chiude comunque dove l'hai lasciata.
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const dragRef = useRef<{ a: number; b: number } | null>(null);
  const datesRef = useRef(dates);
  const onRangeRef = useRef(onRange);
  useEffect(() => {
    datesRef.current = dates;
    onRangeRef.current = onRange;
  }, [dates, onRange]);
  useEffect(() => {
    const up = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setDrag(null);
      const a = Math.min(d.a, d.b), b = Math.max(d.a, d.b);
      // Almeno 5 sedute: un clic semplice non deve zoomare.
      if (b - a >= 4) onRangeRef.current({ from: datesRef.current[a], to: datesRef.current[b] });
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  const setDragBoth = (d: { a: number; b: number } | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  if (n < 2) return null;

  const x = (i: number) => PAD.l + (i / (n - 1)) * iw;
  const y = (v: number) => PAD.t + ((max - v) / (max - min || 1)) * ih;
  const yTicks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  // Etichette corte ("apr", "12"): ne sta una ogni ~40 px.
  const ticks = dateTicks(dates, Math.max(4, Math.floor(iw / 40)));

  const indexAt = (e: React.MouseEvent) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const i = Math.round(((pt.x - PAD.l) / iw) * (n - 1));
    return Math.min(n - 1, Math.max(0, i));
  };

  const pathOf = (l: number) => {
    const m = byLine[l];
    let d = "";
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = m.get(dates[i]);
      if (v == null || !isFinite(v)) { started = false; continue; }
      d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      started = true;
    }
    return d;
  };
  const areaOf = (l: number) => {
    const m = byLine[l];
    const pts: string[] = [];
    let first = -1, last = -1;
    for (let i = 0; i < n; i++) {
      const v = m.get(dates[i]);
      if (v == null || !isFinite(v)) continue;
      if (first < 0) first = i;
      last = i;
      pts.push(`L${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    }
    if (first < 0) return "";
    const y0 = y(Math.min(max, Math.max(min, 0)));
    return `M${x(first).toFixed(1)},${y0} ${pts.join(" ")} L${x(last).toFixed(1)},${y0} Z`;
  };

  const hv = hoverDate && idx.has(hoverDate) ? hoverDate : null;
  const sel = drag && Math.abs(drag.b - drag.a) >= 1 ? { a: Math.min(drag.a, drag.b), b: Math.max(drag.a, drag.b) } : null;

  return (
    <div ref={boxRef} className="select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className="cursor-crosshair"
        onMouseDown={(e) => {
          e.preventDefault(); // niente selezione del testo mentre si trascina
          const i = indexAt(e);
          if (i != null) setDragBoth({ a: i, b: i });
        }}
        onMouseMove={(e) => {
          const i = indexAt(e);
          if (i == null) return;
          onHover(dates[i]);
          if (dragRef.current) setDragBoth({ ...dragRef.current, b: i });
        }}
        onMouseLeave={() => onHover(null)}
        onDoubleClick={() => onRange(null)}
        role="img"
        aria-label="Grafico con zoom: trascina per ingrandire un periodo"
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{formatY(v)}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t.i}>
            <line x1={x(t.i)} x2={x(t.i)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border)" strokeWidth="0.5" opacity="0.55" />
            <line x1={x(t.i)} x2={x(t.i)} y1={H - PAD.b} y2={H - PAD.b + 4} stroke="var(--muted)" strokeWidth="0.8" />
            <text x={x(t.i)} y={H - PAD.b + 15} textAnchor="middle" fontSize="11" fill="var(--muted)">{t.label}</text>
            {t.sub && (
              <text x={x(t.i)} y={H - PAD.b + 29} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--foreground)" opacity="0.8">
                {t.sub}
              </text>
            )}
          </g>
        ))}
        {baseline != null && baseline >= min && baseline <= max && (
          <line x1={PAD.l} x2={W - PAD.r} y1={y(baseline)} y2={y(baseline)} stroke="var(--muted)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.6" />
        )}

        {lines.map((l, k) => l.fill && <path key={`a${k}`} d={areaOf(k)} fill={l.color} opacity={l.strong ? 0.2 : 0.1} />)}
        {lines.map((l, k) => (
          <path
            key={`l${k}`} d={pathOf(k)} fill="none" stroke={l.color}
            strokeWidth={l.strong ? 2 : l.dashed ? 1.3 : 1.5}
            strokeDasharray={l.dashed ? "5 4" : undefined}
            strokeLinejoin="round"
          />
        ))}

        {sel && (
          <rect x={x(sel.a)} y={PAD.t} width={x(sel.b) - x(sel.a)} height={ih}
            fill="var(--accent)" opacity="0.15" stroke="var(--accent)" strokeWidth="1" />
        )}

        {hv && !drag && (
          <g pointerEvents="none">
            <line x1={x(idx.get(hv)!)} x2={x(idx.get(hv)!)} y1={PAD.t} y2={H - PAD.b} stroke="var(--accent-2)" strokeWidth="1.2" />
            {lines.map((l, k) => {
              const v = byLine[k].get(hv);
              return v != null ? <circle key={k} cx={x(idx.get(hv)!)} cy={y(v)} r="3.5" fill={l.color} /> : null;
            })}
          </g>
        )}
      </svg>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] mt-1 px-1 min-h-[18px]">
        {hv && <span className="font-mono text-[var(--accent-2)]">{hv}</span>}
        {lines.map((l, k) => {
          const v = hv ? byLine[k].get(hv) : undefined;
          return (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="inline-block w-4" style={{ borderTop: `2px ${l.dashed ? "dashed" : "solid"} ${l.color}` }} />
              <span className="text-[var(--muted)]">{l.label}</span>
              {v != null && <span className="font-mono">{formatY(v)}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
