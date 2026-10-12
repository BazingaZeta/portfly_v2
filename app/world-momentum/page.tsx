"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { runFetchJob, runSseJob, useJob, usePersistentState } from "@/lib/analysisStore";
import { ChannelChart } from "@/components/ChannelChart";
import { LoadingPanel } from "@/components/Loading";
import { money } from "@/lib/format";
import { INDICES } from "@/lib/indices";
import type { RegressionChannel } from "@/lib/regression";

// ─── Tipi serializzati dalle API ─────────────────────────────────────────────

interface Leader {
  ticker: string;
  name: string;
  price: number;
  rank: number;
  rs: number;
  metaChannel: RegressionChannel;
  priceChannel: RegressionChannel | null;
  signal: "COMPRA" | "ATTENDI" | "DEBOLE";
  reason: string;
  entry: number;
  channelLow: number;
  channelHigh: number;
  priceSpark: number[];
  metaSpark: number[];
}

interface Analysis {
  indexLabel: string;
  benchmark: string;
  analyzedAt: string;
  regimeOk: boolean;
  regimeNote: string;
  exposure?: { pct: number; realizedVol: number | null; note: string };
  leaders: Leader[];
}

interface TickerRow {
  ticker: string;
  trades: number;
  wins: number;
  winRate: number;
  realizedPnl: number;
  avgReturnPct: number;
  bestPct: number;
  worstPct: number;
  avgBarsHeld: number;
}

interface BacktestResult {
  summary: {
    trades: number; wins: number; losses: number; winRate: number;
    profitFactor: number; expectancy: number; maxDrawdown: number;
    totalReturn: number; cagr: number; finalEquity: number;
  };
  equity: { date: string; equity: number }[];
  realizedCurve: { date: string; realized: number }[];
  benchEquity: { date: string; equity: number }[];
  trades: {
    ticker: string; entryDate: string; entryPrice: number; exitDate: string;
    exitPrice: number; shares: number; pnl: number; returnPct: number;
    barsHeld: number; outcome: string;
  }[];
  perTicker: TickerRow[];
  rankingHistory: { date: string; strong: string[]; entered: string[]; exited: string[] }[];
  walkForward?: {
    periods: { start: string; end: string; summary: { totalReturn: number; profitFactor: number; trades: number } }[];
    worstProfitFactor: number;
    positivePeriods: number;
  };
  /** La stessa strategia senza protezione dai drawdown, sugli stessi dati. */
  comparison?: {
    summary: BacktestResult["summary"];
    equity: { date: string; equity: number }[];
    walkForward?: BacktestResult["walkForward"];
  };
  options: { benchmark: string; exitRule: string; maxPositions: number; metaWindow: number; volTarget: number };
  tickersTested: number;
}

// ─── Parametri condivisi fra i due pannelli ──────────────────────────────────

interface Params {
  index: string;
  metaWindow: number;
  minMetaR2: number;
  strongTopN: number;
  priceWindow: number;
  entryMaxZ: number;
  maxPositions: number;
  exitRule: string;
  years: number;
  useRegime: boolean;
  /** Volatility targeting: volatilità annua obiettivo in %, 0 = spento. */
  volTarget: number;
}

const DEFAULTS: Params = {
  index: "SP500",
  metaWindow: 60,
  minMetaR2: 0.5,
  strongTopN: 20,
  priceWindow: 40,
  entryMaxZ: 0,
  maxPositions: 5,
  exitRule: "meta_break",
  years: 5,
  useRegime: true,
  volTarget: 20,
};

/** Perché si è chiusa una riga del registro: vedi WorldExitKind nel motore. */
const OUTCOME_LABELS: Record<string, string> = {
  channel_break: "rottura metatitolo",
  trim: "riduzione esposizione (parziale)",
  stop: "stop",
  trail: "trailing stop",
  regime: "regime negativo",
  time: "time stop",
  end_of_test: "aperta a fine test",
};

const EXIT_LABELS: Record<string, string> = {
  meta_break: "Rottura del canale del metatitolo",
  channel_flat: "Canale prezzo non più ascendente",
  price_band: "Prezzo sotto la banda inferiore",
};

function qs(p: Params): string {
  return new URLSearchParams({
    index: p.index,
    metaWindow: String(p.metaWindow),
    minMetaR2: String(p.minMetaR2),
    strongTopN: String(p.strongTopN),
    priceWindow: String(p.priceWindow),
    entryMaxZ: String(p.entryMaxZ),
    maxPositions: String(p.maxPositions),
    exitRule: p.exitRule,
    years: String(p.years),
    useRegime: String(p.useRegime),
    volTarget: String(p.volTarget),
  }).toString();
}

// ─── Controlli ───────────────────────────────────────────────────────────────

function NumField({
  label, value, onChange, step = 1, min, max, hint,
}: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]" title={hint}>{label}</span>
      <input
        type="number" className="input" value={value} step={step} min={min} max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

function ParamPanel({
  params, setParams, disabled,
}: {
  params: Params; setParams: (p: Params) => void; disabled: boolean;
}) {
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams({ ...params, [k]: v });
  return (
    <div className="glass rounded-2xl p-4 mb-5">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-semibold">Parametri</h3>
        <div className="flex gap-2">
          <button
            className="btn-ghost text-xs" disabled={disabled}
            onClick={() => setParams(DEFAULTS)}
            title="5 posizioni, finestra 60 barre — il centro della regione validata"
          >
            Profilo prudente
          </button>
          <button
            className="btn-ghost text-xs" disabled={disabled}
            onClick={() => setParams({ ...DEFAULTS, maxPositions: 3 })}
            title="3 posizioni: più rendimento sulla finestra testata, ma stai scommettendo su tre nomi alla volta"
          >
            Profilo concentrato
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Indice</span>
          <select className="input" value={params.index} onChange={(e) => set("index", e.target.value)}>
            {INDICES.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
          </select>
        </label>
        <NumField label="Finestra metatitolo" value={params.metaWindow} min={20} max={150}
          hint="Barre del canale sul metatitolo (stadio 1). Più lunga = segnale più lento, posizioni tenute più a lungo." onChange={(v) => set("metaWindow", v)} />
        <NumField label="R² minimo" value={params.minMetaR2} step={0.1} min={0} max={1}
          hint="Quanto deve essere pulito il trend del metatitolo per considerarlo un canale." onChange={(v) => set("minMetaR2", v)} />
        <NumField label="Quanti forti" value={params.strongTopN} min={5} max={60}
          hint="Quanti titoli tenere nell'insieme dei forti (stadio 1)." onChange={(v) => set("strongTopN", v)} />
        <NumField label="Finestra prezzo" value={params.priceWindow} min={20} max={120}
          hint="Barre del canale sul prezzo grezzo (stadio 2, il timing)." onChange={(v) => set("priceWindow", v)} />
        <NumField label="z massimo entrata" value={params.entryMaxZ} step={0.5} min={-2} max={2}
          hint="Quanto in basso nel canale deve stare il prezzo per comprare. 0 = metà bassa." onChange={(v) => set("entryMaxZ", v)} />
        <NumField label="Posizioni max" value={params.maxPositions} min={1} max={15}
          hint="Quante posizioni contemporanee. Meno posizioni = più concentrazione." onChange={(v) => set("maxPositions", v)} />
        <NumField label="Volatilità obiettivo %" value={params.volTarget} step={5} min={0} max={60}
          hint="Riduzione del drawdown: quando la volatilità realizzata della strategia supera questo valore, si investe meno in proporzione. 0 = spento (strategia senza protezione)." onChange={(v) => set("volTarget", v)} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Regola di uscita</span>
          <select className="input" value={params.exitRule} onChange={(e) => set("exitRule", e.target.value)}>
            {Object.entries(EXIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 mt-3 text-xs text-[var(--muted)]">
        <input type="checkbox" checked={params.useRegime} onChange={(e) => set("useRegime", e.target.checked)} />
        Filtro di regime: nessuna nuova entrata mentre il benchmark è sotto la SMA 200
      </label>
    </div>
  );
}

// ─── Pannello 1 — Analisi live (i due stadi, oggi) ───────────────────────────

function SignalBadge({ signal }: { signal: Leader["signal"] }) {
  const style =
    signal === "COMPRA"
      ? { bg: "color-mix(in srgb, var(--positive) 18%, transparent)", fg: "var(--positive)" }
      : signal === "ATTENDI"
      ? { bg: "color-mix(in srgb, var(--warning) 18%, transparent)", fg: "var(--warning)" }
      : { bg: "var(--surface-2)", fg: "var(--muted)" };
  return (
    <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold tracking-wide"
      style={{ background: style.bg, color: style.fg }}>
      {signal}
    </span>
  );
}

function LeaderCard({ leader, params }: { leader: Leader; params: Params }) {
  const mc = leader.metaChannel;
  const pc = leader.priceChannel;
  return (
    <Link
      href={`/world-momentum/${encodeURIComponent(leader.ticker)}?${qs(params)}`}
      className="glass rounded-2xl p-4 flex flex-col gap-3 transition-colors hover:bg-[var(--surface-2)] cursor-pointer"
      title={`Apri il dettaglio di ${leader.ticker}: grafici grandi e costruzione dei canali`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{leader.ticker}</span>
            {leader.rank > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] text-[var(--muted)]">
                #{leader.rank} forza
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--muted)] truncate">{leader.name}</p>
        </div>
        <div className="text-right shrink-0">
          <SignalBadge signal={leader.signal} />
          <p className="font-mono text-sm mt-1">{money(leader.price)}</p>
        </div>
      </div>

      <p className="text-xs text-[var(--muted)] leading-snug">{leader.reason}</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1">
            Stadio 1 · metatitolo / benchmark
          </p>
          <ChannelChart closes={leader.metaSpark} channel={mc} height={54} />
          <p className="text-[10px] text-[var(--muted)] mt-1 font-mono">
            R² {mc.r2} · z {mc.z} · RS {leader.rs}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1">
            Stadio 2 · prezzo
          </p>
          {pc ? (
            <>
              <ChannelChart closes={leader.priceSpark} channel={pc} height={54} />
              <p className="text-[10px] text-[var(--muted)] mt-1 font-mono">
                R² {pc.r2} · z {pc.z} · banda {money(leader.channelLow)}–{money(leader.channelHigh)}
              </p>
            </>
          ) : (
            <p className="text-[10px] text-[var(--muted)]">Canale non calcolabile.</p>
          )}
        </div>
      </div>

      <span className="text-[10px] text-[var(--muted)] mt-auto pt-1">
        Apri il dettaglio per i grafici grandi →
      </span>
    </Link>
  );
}

/**
 * Cache di sessione dell'analisi, per chiave = parametri usati. Senza questa,
 * aprire il dettaglio di una card e tornare indietro costringe a rifare una
 * scansione da 80 titoli — il percorso che l'utente fa più spesso. Dura quanto
 * la scheda del browser: nessun rischio di mostrare dati di ieri.
 */
/**
 * Analisi e backtest vivono nello store condiviso (lib/analysisStore): restano
 * a schermo quando cambi pagina e un'analisi lanciata continua anche se navighi
 * altrove. Si tiene l'ULTIMA analisi eseguita, con i parametri usati: se nel
 * frattempo li cambi, la pagina lo segnala invece di far sparire i risultati.
 */
const ANALYSIS_KEY = "world:analyze";
const BACKTEST_KEY = "world:backtest";

function AnalysisPanel({ params }: { params: Params }) {
  const job = useJob<Analysis, { current: number; total: number; message: string }>(ANALYSIS_KEY);
  const data = job.result ?? null;
  const progress = job.progress ?? null;
  const running = job.status === "running";
  const error = job.status === "error" ? job.error ?? "Analisi fallita" : null;
  const ranWith = (job.meta?.qs as string | undefined) ?? null;
  const stale = data != null && ranWith != null && ranWith !== qs(params);
  const [filter, setFilter] = usePersistentState<"all" | "buy" | "strong">("world:analyze:filter", "strong");

  const run = useCallback(() => {
    runSseJob<Analysis>(ANALYSIS_KEY, `/api/world/analyze?${qs(params)}`, { qs: qs(params) });
  }, [params]);

  const shown = useMemo(() => {
    if (!data) return [];
    if (filter === "buy") return data.leaders.filter((l) => l.signal === "COMPRA");
    if (filter === "strong") return data.leaders.filter((l) => l.rank > 0);
    return data.leaders;
  }, [data, filter]);

  const counts = useMemo(() => {
    if (!data) return { buy: 0, strong: 0, all: 0 };
    return {
      buy: data.leaders.filter((l) => l.signal === "COMPRA").length,
      strong: data.leaders.filter((l) => l.rank > 0).length,
      all: data.leaders.length,
    };
  }, [data]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button className="btn-primary" onClick={run} disabled={running}>
          {running ? "Analisi in corso…" : "▶ Analizza"}
        </button>
        {data && (
          <span className="text-xs text-[var(--muted)]">
            {data.indexLabel} · benchmark {data.benchmark} · {new Date(data.analyzedAt).toLocaleString("it-IT")}
          </span>
        )}
      </div>

      {running && (
        <LoadingPanel
          label={progress ? `${progress.message} — ${progress.current}/${progress.total}` : "Scarico i dati…"}
        />
      )}

      {error && (
        <div className="glass rounded-2xl p-4 text-sm mb-4" style={{ color: "var(--negative)" }}>{error}</div>
      )}

      {stale && !running && (
        <div className="glass rounded-2xl p-3 mb-4 text-xs text-[var(--muted)]" style={{ borderLeft: "3px solid var(--warning)" }}>
          Stai guardando l&apos;analisi fatta con i parametri precedenti. Premi <strong>Analizza</strong> per
          aggiornarla con quelli nuovi.
        </div>
      )}

      {data && !running && (
        <>
          <div
            className="glass rounded-2xl p-3 mb-4 text-xs flex items-start gap-2"
            style={{ borderLeft: `3px solid ${data.regimeOk ? "var(--positive)" : "var(--warning)"}` }}
          >
            <span>{data.regimeOk ? "✅" : "⚠️"}</span>
            <span className="text-[var(--muted)]">{data.regimeNote}</span>
          </div>

          {data.exposure && (
            <div
              className="glass rounded-2xl p-3 mb-4 text-xs flex items-start gap-3 flex-wrap"
              style={{ borderLeft: `3px solid ${data.exposure.pct >= 100 ? "var(--positive)" : "var(--accent)"}` }}
            >
              <span className="font-mono text-base leading-none">{data.exposure.pct}%</span>
              <span className="text-[var(--muted)] flex-1 min-w-[16rem]">
                <strong className="text-[var(--foreground)]">Esposizione consigliata oggi.</strong>{" "}
                {data.exposure.note} È la protezione dai drawdown: decide quanto investire, non
                cosa comprare.
              </span>
            </div>
          )}

          <div className="flex gap-2 mb-4 flex-wrap">
            {([
              ["buy", `Da comprare (${counts.buy})`],
              ["strong", `Più forti del benchmark (${counts.strong})`],
              ["all", `Tutti (${counts.all})`],
            ] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`text-xs px-3 py-1.5 rounded-xl transition-colors ${
                  filter === k ? "bg-[var(--surface-2)] text-[var(--foreground)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}>
                {label}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="glass rounded-2xl p-6 text-center text-sm text-[var(--muted)]">
              Nessun titolo in questa categoria oggi. Non è un errore: quando nessun metatitolo è
              in canale ascendente pulito, la strategia sta ferma.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((l) => <LeaderCard key={l.ticker} leader={l} params={params} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Grafici del backtest ────────────────────────────────────────────────────

/** Curva equity (mark-to-market) contro il benchmark, e opzionalmente la versione senza protezione. */
function EquityChart({
  strategy, bench, base, compare,
}: {
  strategy: { date: string; equity: number }[];
  bench: { date: string; equity: number }[];
  base: number;
  compare?: { date: string; equity: number }[];
}) {
  if (strategy.length < 2) return null;
  const W = 720, H = 220, PAD = { t: 14, r: 14, b: 26, l: 62 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const all = [...strategy, ...bench, ...(compare ?? [])].map((p) => p.equity).concat(base);
  const min = Math.min(...all) * 0.98, max = Math.max(...all) * 1.02;
  const x = (i: number, n: number) => PAD.l + (i / Math.max(1, n - 1)) * iw;
  const y = (v: number) => PAD.t + ((max - v) / (max - min || 1)) * ih;
  const path = (pts: { equity: number }[]) => pts.map((p, i) => `${x(i, pts.length)},${y(p.equity)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Curva di equity">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = min + (max - min) * f;
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="0.5" />
              <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">
                {Math.round(v).toLocaleString("it-IT")}
              </text>
            </g>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(base)} y2={y(base)} stroke="var(--muted)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5" />
        <polyline points={path(bench)} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" />
        {compare && compare.length > 1 && (
          <polyline points={path(compare)} fill="none" stroke="var(--warning)" strokeWidth="1.5" opacity="0.75" strokeLinejoin="round" />
        )}
        <polyline points={path(strategy)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      {/* Legenda fuori dal disegno: dentro, finiva sopra i picchi della curva. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] mt-2 px-1">
        <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 bg-[var(--accent)]" />{compare ? "con protezione dai drawdown" : "strategia"}</span>
        {compare && <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 bg-[var(--warning)]" />senza protezione</span>}
        <span className="flex items-center gap-1.5 text-[var(--muted)]"><span className="inline-block w-4 border-t border-dashed border-[var(--muted)]" />benchmark</span>
      </div>
    </div>
  );
}

/** Serie di drawdown (%) dal massimo precedente. */
function drawdownSeries(eq: { date: string; equity: number }[]): { date: string; dd: number }[] {
  let peak = -Infinity;
  return eq.map((p) => {
    peak = Math.max(peak, p.equity);
    return { date: p.date, dd: peak > 0 ? ((p.equity - peak) / peak) * 100 : 0 };
  });
}

/**
 * Curva "sott'acqua": quanto si è sotto il massimo precedente, giorno per
 * giorno. È la vista diretta dei picchi che poi cadono — ogni avvallamento è
 * un drawdown, la profondità è quanto fa male, la larghezza quanto dura.
 */
function DrawdownChart({
  series,
}: {
  series: { label: string; color: string; eq: { date: string; equity: number }[] }[];
}) {
  const dds = series.map((s) => ({ ...s, dd: drawdownSeries(s.eq) }));
  const n = Math.max(...dds.map((d) => d.dd.length));
  if (n < 2) return null;
  const W = 720, H = 180, PAD = { t: 10, r: 14, b: 22, l: 52 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const worst = Math.min(...dds.flatMap((d) => d.dd.map((p) => p.dd)), -1);
  const lo = Math.floor(worst / 5) * 5;
  const x = (i: number, len: number) => PAD.l + (i / Math.max(1, len - 1)) * iw;
  const y = (v: number) => PAD.t + (v / lo) * ih;
  const ticks = Array.from({ length: Math.round(-lo / 5) + 1 }, (_, i) => -i * 5).filter((v, i, a) => a.length <= 7 || i % 2 === 0);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Curva di drawdown">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">{v}%</text>
          </g>
        ))}
        {dds.map((d, k) => (
          <g key={k}>
            <path
              d={`M ${x(0, d.dd.length)} ${y(0)} ` + d.dd.map((p, i) => `L ${x(i, d.dd.length)} ${y(p.dd)}`).join(" ") + ` L ${x(d.dd.length - 1, d.dd.length)} ${y(0)} Z`}
              fill={d.color}
              opacity={k === dds.length - 1 ? 0.22 : 0.12}
            />
            <polyline
              points={d.dd.map((p, i) => `${x(i, d.dd.length)},${y(p.dd)}`).join(" ")}
              fill="none" stroke={d.color} strokeWidth={k === dds.length - 1 ? 1.6 : 1.2}
            />
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] mt-2 px-1">
        {dds.map((d) => {
          const w = Math.min(...d.dd.map((p) => p.dd));
          return (
            <span key={d.label} className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5" style={{ background: d.color }} />
              {d.label}: peggiore <strong className="font-mono">{w.toFixed(1)}%</strong>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Passaggio 5: P&L REALIZZATO cumulato. A differenza dell'equity, questa curva
 * si muove solo quando una posizione si chiude — è la scala dei soldi
 * effettivamente incassati, senza il rumore delle posizioni ancora aperte.
 */
function RealizedChart({ points }: { points: { date: string; realized: number }[] }) {
  if (points.length < 2) return null;
  const W = 720, H = 180, PAD = { t: 14, r: 14, b: 26, l: 62 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const vals = points.map((p) => p.realized);
  const min = Math.min(0, ...vals) * 1.05, max = Math.max(0, ...vals) * 1.05;
  const x = (i: number) => PAD.l + (i / Math.max(1, points.length - 1)) * iw;
  const y = (v: number) => PAD.t + ((max - v) / (max - min || 1)) * ih;
  const last = vals[vals.length - 1];
  const color = last >= 0 ? "var(--positive)" : "var(--negative)";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="P&L realizzato cumulato">
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth="1" />
      <text x={PAD.l - 6} y={y(0) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">0</text>
      <text x={PAD.l - 6} y={y(max) + 8} textAnchor="end" fontSize="9" fill="var(--muted)">
        {Math.round(max).toLocaleString("it-IT")}
      </text>
      <path
        d={`M ${x(0)} ${y(0)} ` + points.map((p, i) => `L ${x(i)} ${y(p.realized)}`).join(" ") + ` L ${x(points.length - 1)} ${y(0)} Z`}
        fill={color} opacity="0.12"
      />
      <polyline points={points.map((p, i) => `${x(i)},${y(p.realized)}`).join(" ")} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

/**
 * Passaggio 4: P&L realizzato per titolo, a barre orizzontali.
 *
 * Mostra ENTRAMBE le code, non solo i vincitori: `rows` arriva ordinato per
 * P&L decrescente, quindi si prendono i 10 migliori E i 10 peggiori. Tagliare
 * ai primi 20 farebbe sparire le perdite e darebbe un'impressione falsa della
 * strategia — che in questo motore è concentratissima: un paio di nomi fanno
 * quasi tutto il risultato.
 */
function TickerBar({ row, maxAbs }: { row: TickerRow; maxAbs: number }) {
  const w = (Math.abs(row.realizedPnl) / maxAbs) * 50; // % di metà larghezza
  const pos = row.realizedPnl >= 0;
  return (
    <div
      className="flex items-center gap-2 text-xs"
      title={`${row.trades} trade · win rate ${row.winRate}% · durata media ${row.avgBarsHeld} barre · migliore ${row.bestPct}% · peggiore ${row.worstPct}%`}
    >
      <span className="w-14 shrink-0 font-mono text-[var(--muted)]">{row.ticker}</span>
      <div className="flex-1 flex items-center h-4 relative">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--border)]" />
        <div
          className="absolute h-2.5 rounded-sm"
          style={{
            background: pos ? "var(--positive)" : "var(--negative)",
            opacity: 0.75,
            left: pos ? "50%" : `${50 - w}%`,
            width: `${w}%`,
          }}
        />
      </div>
      <span className={`w-20 shrink-0 text-right font-mono ${pos ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
        {pos ? "+" : ""}{money(row.realizedPnl)}
      </span>
      <span className="w-10 shrink-0 text-right text-[var(--muted)] font-mono">{row.trades}tr</span>
    </div>
  );
}

function PerTickerChart({ rows }: { rows: TickerRow[] }) {
  const { top, bottom, hidden } = useMemo(() => {
    if (rows.length <= 20) return { top: rows, bottom: [] as TickerRow[], hidden: 0 };
    return { top: rows.slice(0, 10), bottom: rows.slice(-10), hidden: rows.length - 20 };
  }, [rows]);

  if (rows.length === 0) return null;
  const maxAbs = Math.max(...[...top, ...bottom].map((r) => Math.abs(r.realizedPnl)), 1);

  return (
    <div className="flex flex-col gap-1.5">
      {top.map((r) => <TickerBar key={r.ticker} row={r} maxAbs={maxAbs} />)}
      {hidden > 0 && (
        <div className="flex items-center gap-2 py-1 text-[10px] text-[var(--muted)]">
          <span className="flex-1 border-t border-dashed border-[var(--border)]" />
          <span>{hidden} titoli intermedi</span>
          <span className="flex-1 border-t border-dashed border-[var(--border)]" />
        </div>
      )}
      {bottom.map((r) => <TickerBar key={r.ticker} row={r} maxAbs={maxAbs} />)}
    </div>
  );
}

/**
 * Passaggio 2: la rotazione dell'insieme dei forti nel tempo. Ogni riga è un
 * titolo, ogni colonna uno scan: la cella è piena quando il titolo era fra i
 * più forti del benchmark. Si legge a colpo d'occhio chi entra, chi esce e chi
 * resta leader per tutto il periodo.
 */
function RotationChart({
  history,
}: {
  history: { date: string; strong: string[]; entered: string[]; exited: string[] }[];
}) {
  const { tickers, cells } = useMemo(() => {
    const presence = new Map<string, number>();
    for (const snap of history) for (const t of snap.strong) presence.set(t, (presence.get(t) ?? 0) + 1);
    // I 25 titoli più presenti: oltre, il grafico diventa illeggibile.
    const tickers = [...presence.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([t]) => t);
    const sets = history.map((s) => new Set(s.strong));
    const cells = tickers.map((t) => sets.map((s) => s.has(t)));
    return { tickers, cells };
  }, [history]);

  if (tickers.length === 0 || history.length === 0) return null;

  const cw = Math.max(2, Math.min(8, Math.floor(700 / history.length)));
  const rh = 14;
  const labelW = 52;
  const W = labelW + history.length * cw;
  const H = tickers.length * rh;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Rotazione dei leader nel tempo">
        {tickers.map((t, r) => (
          <g key={t}>
            <text x={labelW - 6} y={r * rh + rh - 4} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="monospace">
              {t}
            </text>
            {cells[r].map((on, c) =>
              on ? (
                <rect key={c} x={labelW + c * cw} y={r * rh + 2} width={Math.max(1, cw - 1)} height={rh - 5}
                  fill="var(--accent)" opacity="0.75" rx="1" />
              ) : null
            )}
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-[var(--muted)] mt-1 font-mono" style={{ paddingLeft: labelW }}>
        <span>{history[0].date}</span>
        <span>{history[history.length - 1].date}</span>
      </div>
    </div>
  );
}

/**
 * Registro cronologico delle compravendite del backtest. Di default mostra le
 * ultime 25 (le più recenti sono quelle che interessano di più), espandibile a
 * tutte; filtrabile per titolo perché la domanda tipica è "cosa ha fatto su X".
 */
function TradeLog({
  trades,
}: {
  trades: BacktestResult["trades"];
}) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");

  const tickers = useMemo(
    () => [...new Set(trades.map((t) => t.ticker))].sort(),
    [trades]
  );

  const rows = useMemo(() => {
    const filtered = filter ? trades.filter((t) => t.ticker === filter) : trades;
    // Dal più recente: in ordine di data di uscita.
    const sorted = [...filtered].sort((a, b) => b.exitDate.localeCompare(a.exitDate));
    return expanded ? sorted : sorted.slice(0, 25);
  }, [trades, filter, expanded]);

  const total = filter ? trades.filter((t) => t.ticker === filter).length : trades.length;
  if (trades.length === 0) return <p className="text-sm text-[var(--muted)]">Nessuna operazione.</p>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <select className="input text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Tutti i titoli ({trades.length} operazioni)</option>
          {tickers.map((t) => (
            <option key={t} value={t}>
              {t} ({trades.filter((x) => x.ticker === t).length})
            </option>
          ))}
        </select>
        <span className="text-xs text-[var(--muted)]">
          {rows.length} di {total} mostrate, dalla più recente
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs [&_th]:pr-4 [&_td]:pr-4 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
          <thead>
            <tr className="text-[var(--muted)] text-left">
              <th className="pb-2 font-medium">Titolo</th>
              <th className="pb-2 font-medium">Acquisto</th>
              <th className="pb-2 font-medium text-right">Prezzo</th>
              <th className="pb-2 font-medium">Vendita</th>
              <th className="pb-2 font-medium text-right">Prezzo</th>
              <th className="pb-2 font-medium text-right">Quantità</th>
              <th className="pb-2 font-medium text-right">P&amp;L</th>
              <th className="pb-2 font-medium text-right">Rend.</th>
              <th className="pb-2 font-medium text-right">Barre</th>
              <th className="pb-2 font-medium">Motivo</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((t, i) => (
              <tr key={`${t.ticker}-${t.entryDate}-${i}`} className="border-t border-[var(--border)]">
                <td className="py-1.5 font-semibold">{t.ticker}</td>
                <td className="py-1.5 text-[var(--positive)]">▲ {t.entryDate}</td>
                <td className="py-1.5 text-right">${t.entryPrice.toFixed(2)}</td>
                <td className="py-1.5 text-[var(--negative)]">▼ {t.exitDate}</td>
                <td className="py-1.5 text-right">${t.exitPrice.toFixed(2)}</td>
                <td className="py-1.5 text-right text-[var(--muted)]">{t.shares.toFixed(2)}</td>
                <td className={`py-1.5 text-right ${t.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                  {t.pnl >= 0 ? "+" : ""}{money(t.pnl)}
                </td>
                <td className={`py-1.5 text-right ${t.returnPct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                  {t.returnPct >= 0 ? "+" : ""}{t.returnPct}%
                </td>
                <td className="py-1.5 text-right text-[var(--muted)]">{t.barsHeld}</td>
                <td className="py-1.5 text-[var(--muted)] font-sans">{OUTCOME_LABELS[t.outcome] ?? t.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 25 && (
        <button className="btn-ghost text-xs mt-3" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Mostra solo le ultime 25" : `Mostra tutte le ${total} operazioni`}
        </button>
      )}
    </div>
  );
}

/**
 * Confronto fra la strategia con e senza protezione dai drawdown, simulate sugli
 * stessi dati e la stessa finestra. È la tabella che serve per decidere: quanto
 * rischio toglie la protezione, e quanto rendimento costa.
 */
function ComparisonPanel({ result }: { result: BacktestResult }) {
  const cmp = result.comparison!;
  const ulcer = (eq: { equity: number }[]) => {
    let peak = -Infinity, sum = 0;
    for (const p of eq) { peak = Math.max(peak, p.equity); const d = ((peak - p.equity) / peak) * 100; sum += d * d; }
    return Math.sqrt(sum / Math.max(1, eq.length));
  };
  const beats = (wf: BacktestResult["walkForward"]) =>
    wf ? wf.periods.filter((p) => p.summary.totalReturn > (benchReturnBetween(result.benchEquity, p.start, p.end) ?? Infinity)).length : null;

  const nFolds = result.walkForward?.periods.length ?? 5;
  /** dp = decimali; unit = suffisso della differenza (punti % o niente). */
  const rows: { label: string; hint: string; a: number | null; b: number | null; dp: number; unit: string; fmt: (v: number) => string; better: "low" | "high" }[] = [
    { label: "Max drawdown", hint: "La perdita peggiore dal massimo precedente", a: cmp.summary.maxDrawdown, b: result.summary.maxDrawdown, dp: 1, unit: " pt", fmt: (v) => `${v.toFixed(1)}%`, better: "low" },
    { label: "Ulcer index", hint: "Profondità E durata dei drawdown insieme: più basso = meno sofferenza", a: ulcer(cmp.equity), b: ulcer(result.equity), dp: 1, unit: "", fmt: (v) => v.toFixed(1), better: "low" },
    { label: "Rendimento totale", hint: "Sull'intera finestra", a: cmp.summary.totalReturn, b: result.summary.totalReturn, dp: 1, unit: " pt", fmt: (v) => `${v.toFixed(1)}%`, better: "high" },
    { label: "CAGR", hint: "Rendimento annuo composto", a: cmp.summary.cagr, b: result.summary.cagr, dp: 1, unit: " pt", fmt: (v) => `${v.toFixed(1)}%`, better: "high" },
    { label: "Calmar (CAGR ÷ max DD)", hint: "Rendimento per unità di drawdown: la misura che riassume il compromesso", a: cmp.summary.cagr / Math.max(0.1, cmp.summary.maxDrawdown), b: result.summary.cagr / Math.max(0.1, result.summary.maxDrawdown), dp: 2, unit: "", fmt: (v) => v.toFixed(2), better: "high" },
    { label: "Profit factor", hint: "Guadagni lordi ÷ perdite lorde", a: cmp.summary.profitFactor, b: result.summary.profitFactor, dp: 2, unit: "", fmt: (v) => v.toFixed(2), better: "high" },
    { label: "Peggior PF nei periodi", hint: "Il sotto-periodo peggiore del walk-forward", a: cmp.walkForward?.worstProfitFactor ?? null, b: result.walkForward?.worstProfitFactor ?? null, dp: 2, unit: "", fmt: (v) => v.toFixed(2), better: "high" },
    { label: "Periodi che battono il benchmark", hint: "Su quanti sotto-periodi del walk-forward", a: beats(cmp.walkForward), b: beats(result.walkForward), dp: 0, unit: "", fmt: (v) => `${v}/${nFolds}`, better: "high" },
  ];

  return (
    <section>
      <h3 className="text-sm font-semibold mb-1">Con e senza protezione dai drawdown</h3>
      <p className="text-xs text-[var(--muted)] mb-2 max-w-3xl">
        Stessi titoli, stessi segnali, stesse date di ingresso e uscita: cambia solo quanto si
        investe. Con la volatilità della strategia sopra il {result.options.volTarget}% annuo
        l&apos;esposizione si riduce in proporzione.
      </p>
      <p className="text-[11px] text-[var(--muted)] mb-2 max-w-3xl">
        I numeri di un singolo backtest cambiano anche molto spostando l&apos;inizio di un giorno,
        perché cambia quali titoli si comprano all&apos;avvio (soprattutto il peggior PF dei
        periodi). La riduzione del drawdown invece è stata verificata su tutte e 5 le fasi dello
        scan, su un periodo mai usato per tarare (2013-2021) e su un altro universo (Nasdaq 100):
        regge in tutti e 15 i casi.
      </p>
      <div className="glass rounded-2xl p-4 overflow-x-auto">
        <table className="w-full text-xs [&_th]:pr-4 [&_td]:pr-4 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
          <thead>
            <tr className="text-[var(--muted)] text-left">
              <th className="pb-2 font-medium">Metrica</th>
              <th className="pb-2 font-medium text-right">Senza protezione</th>
              <th className="pb-2 font-medium text-right">Con protezione</th>
              <th className="pb-2 font-medium text-right">Differenza</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r) => {
              const d = r.a != null && r.b != null ? r.b - r.a : null;
              const good = d == null || d === 0 ? null : r.better === "low" ? d < 0 : d > 0;
              return (
                <tr key={r.label} className="border-t border-[var(--border)]">
                  <td className="py-1.5 font-sans" title={r.hint}>{r.label}</td>
                  <td className="py-1.5 text-right text-[var(--muted)]">{r.a != null ? r.fmt(r.a) : "—"}</td>
                  <td className="py-1.5 text-right font-semibold">{r.b != null ? r.fmt(r.b) : "—"}</td>
                  <td className={`py-1.5 text-right ${good == null ? "text-[var(--muted)]" : good ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                    {d == null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(r.dp)}${r.unit}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Pannello 2 — Backtest ───────────────────────────────────────────────────

/**
 * Rendimento del benchmark fra due date, preso dalla stessa curva mostrata nel
 * grafico. Serve al walk-forward: per una strategia long-only il PF assoluto
 * di un fold in pieno bear è ingeneroso (in un mercato a -18% non può essere
 * alto), mentre il confronto col benchmark DELLO STESSO periodo dice se la
 * strategia ha fatto il suo mestiere.
 */
function benchReturnBetween(
  curve: { date: string; equity: number }[],
  start: string,
  end: string
): number | null {
  const first = curve.find((p) => p.date >= start);
  // L'ultimo punto dentro la finestra, non il primo fuori.
  let last: { date: string; equity: number } | undefined;
  for (const p of curve) {
    if (p.date > end) break;
    if (p.date >= start) last = p;
  }
  if (!first || !last || first.equity <= 0 || first.date === last.date) return null;
  return ((last.equity - first.equity) / first.equity) * 100;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className={`font-mono text-lg mt-0.5 ${tone === "pos" ? "text-[var(--positive)]" : tone === "neg" ? "text-[var(--negative)]" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function BacktestPanel({ params }: { params: Params }) {
  const job = useJob<BacktestResult>(BACKTEST_KEY);
  const result = job.result ?? null;
  const running = job.status === "running";
  const error = job.status === "error" ? job.error ?? "Backtest fallito" : null;
  const ranWith = (job.meta?.qs as string | undefined) ?? null;
  const stale = result != null && ranWith != null && ranWith !== qs(params);

  const run = useCallback(() => {
    const q = qs(params);
    runFetchJob<BacktestResult>(
      BACKTEST_KEY,
      async () => {
        const res = await fetch(`/api/world/backtest?${q}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Backtest fallito");
        return data as BacktestResult;
      },
      { qs: q }
    );
  }, [params]);

  const benchReturn = useMemo(() => {
    if (!result?.benchEquity.length) return null;
    const b = result.benchEquity;
    return ((b[b.length - 1].equity - b[0].equity) / b[0].equity) * 100;
  }, [result]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button className="btn-primary" onClick={run} disabled={running}>
          {running ? "Backtest in corso…" : "🧪 Avvia backtest"}
        </button>
        <span className="text-xs text-[var(--muted)]">
          {params.years} anni · uscita: {EXIT_LABELS[params.exitRule]}
        </span>
      </div>

      {running && <LoadingPanel label="Scarico lo storico e simulo barra per barra…" />}
      {error && <div className="glass rounded-2xl p-4 text-sm mb-4" style={{ color: "var(--negative)" }}>{error}</div>}

      {stale && !running && (
        <div className="glass rounded-2xl p-3 mb-4 text-xs text-[var(--muted)]" style={{ borderLeft: "3px solid var(--warning)" }}>
          Risultati del backtest con i parametri precedenti. Premi <strong>Avvia backtest</strong> per
          rifarlo con quelli nuovi.
        </div>
      )}

      {result && !running && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Rendimento totale" value={`${result.summary.totalReturn}%`}
              tone={result.summary.totalReturn >= 0 ? "pos" : "neg"} />
            <Stat label="Benchmark" value={benchReturn != null ? `${benchReturn.toFixed(1)}%` : "—"} />
            <Stat label="CAGR" value={`${result.summary.cagr}%`} />
            <Stat label="Max drawdown" value={`${result.summary.maxDrawdown}%`} tone="neg" />
            <Stat label="Trade" value={String(result.summary.trades)} />
            <Stat label="Win rate" value={`${result.summary.winRate}%`} />
            <Stat label="Profit factor" value={String(result.summary.profitFactor)} />
            <Stat label="Capitale finale" value={money(result.summary.finalEquity)} />
          </div>

          {benchReturn != null && (
            <div className="glass rounded-2xl p-3 text-xs text-[var(--muted)]">
              Delta contro il benchmark:{" "}
              <strong className={result.summary.totalReturn - benchReturn >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                {result.summary.totalReturn - benchReturn >= 0 ? "+" : ""}
                {(result.summary.totalReturn - benchReturn).toFixed(1)} punti
              </strong>{" "}
              su {params.years} anni. Il numero oscilla di ±40 punti al variare della finestra del
              metatitolo: leggilo come ordine di grandezza, non come previsione.
            </div>
          )}

          {result.comparison && (
            <ComparisonPanel result={result} />
          )}

          <section>
            <h3 className="text-sm font-semibold mb-2">Equity contro benchmark</h3>
            <div className="glass rounded-2xl p-4">
              <EquityChart
                strategy={result.equity}
                bench={result.benchEquity}
                base={10_000}
                compare={result.comparison?.equity}
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1">Drawdown nel tempo</h3>
            <p className="text-xs text-[var(--muted)] mb-2">
              Quanto si è sotto il massimo precedente, giorno per giorno: ogni avvallamento è un
              picco che poi cade. La profondità è quanto fa male, la larghezza quanto dura.
            </p>
            <div className="glass rounded-2xl p-4">
              <DrawdownChart
                series={[
                  { label: "benchmark", color: "var(--muted)", eq: result.benchEquity },
                  ...(result.comparison ? [{ label: "senza protezione", color: "var(--warning)", eq: result.comparison.equity }] : []),
                  { label: result.comparison ? "con protezione" : "strategia", color: "var(--accent)", eq: result.equity },
                ]}
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1">P&amp;L realizzato nel tempo</h3>
            <p className="text-xs text-[var(--muted)] mb-2">
              Si muove solo alla chiusura di una posizione: sono i soldi incassati, non il valore a mercato.
            </p>
            <div className="glass rounded-2xl p-4">
              <RealizedChart points={result.realizedCurve} />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1">P&amp;L realizzato per titolo</h3>
            <p className="text-xs text-[var(--muted)] mb-2">
              I 10 migliori e i 10 peggiori per contributo. Passa il mouse per trade, win rate e durata media.
            </p>
            <div className="glass rounded-2xl p-4">
              <PerTickerChart rows={result.perTicker} />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1">Storico delle operazioni</h3>
            <p className="text-xs text-[var(--muted)] mb-2">
              Ogni compravendita che la strategia avrebbe fatto, in ordine di data. È il registro
              da cui nascono la curva di equity e il P&amp;L: qui sopra vedi i totali, qui vedi
              i singoli segnali che li hanno prodotti.
            </p>
            <div className="glass rounded-2xl p-4">
              <TradeLog trades={result.trades} />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1">Rotazione dei leader</h3>
            <p className="text-xs text-[var(--muted)] mb-2">
              Ogni riga un titolo, ogni colonna uno scan: la cella è piena quando quel titolo era
              fra i più forti del benchmark. Le righe spezzate sono i titoli che entrano ed escono.
            </p>
            <div className="glass rounded-2xl p-4">
              <RotationChart history={result.rankingHistory} />
            </div>
          </section>

          {result.walkForward && (
            <section>
              <h3 className="text-sm font-semibold mb-1">Walk-forward</h3>
              <p className="text-xs text-[var(--muted)] mb-2">
                Periodi consecutivi, ognuno simulato con capitale fresco. Un edge vero regge in
                (quasi) ogni sotto-periodo — se sta in piedi solo sul totale, è fortuna.
              </p>
              <div className="glass rounded-2xl p-4 overflow-x-auto">
                <table className="w-full text-xs [&_th]:pr-4 [&_td]:pr-4 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
                  <thead>
                    <tr className="text-[var(--muted)] text-left">
                      <th className="pb-2 font-medium">Periodo</th>
                      <th className="pb-2 font-medium text-right">Strategia</th>
                      <th className="pb-2 font-medium text-right">Benchmark</th>
                      <th className="pb-2 font-medium text-right">Delta</th>
                      <th className="pb-2 font-medium text-right">PF</th>
                      <th className="pb-2 font-medium text-right">Trade</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {result.walkForward.periods.map((p) => {
                      const bench = benchReturnBetween(result.benchEquity, p.start, p.end);
                      const delta = bench != null ? p.summary.totalReturn - bench : null;
                      return (
                        <tr key={p.start} className="border-t border-[var(--border)]">
                          <td className="py-1.5">{p.start} → {p.end}</td>
                          <td className={`py-1.5 text-right ${p.summary.totalReturn >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                            {p.summary.totalReturn >= 0 ? "+" : ""}{p.summary.totalReturn}%
                          </td>
                          <td className="py-1.5 text-right text-[var(--muted)]">
                            {bench != null ? `${bench >= 0 ? "+" : ""}${bench.toFixed(1)}%` : "—"}
                          </td>
                          <td className={`py-1.5 text-right ${delta == null ? "" : delta >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                            {delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}` : "—"}
                          </td>
                          <td className="py-1.5 text-right">{p.summary.profitFactor}</td>
                          <td className="py-1.5 text-right">{p.summary.trades}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Pagina ──────────────────────────────────────────────────────────────────

export default function WorldMomentumPage() {
  // Scheda e parametri sopravvivono al cambio di pagina: devono corrispondere
  // all'analisi rimasta a schermo. L'unione coi default copre i parametri
  // aggiunti dopo che un valore era già stato salvato.
  const [tab, setTab] = usePersistentState<"analysis" | "backtest">("world:tab", "analysis");
  const [storedParams, setParams] = usePersistentState<Params>("world:params", DEFAULTS);
  const params = useMemo(() => ({ ...DEFAULTS, ...storedParams }), [storedParams]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight gradient-text">Momentum World</h1>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-3xl">
          Due stadi sul canale di regressione. Il <strong>metatitolo</strong> (titolo ÷ MSCI World)
          dice chi batte il benchmark; il canale sul <strong>prezzo</strong> dice quando entrare.
          Si esce quando il canale del metatitolo si rompe — cioè quando il titolo smette di essere
          più forte del mondo.
        </p>
      </header>

      <div className="flex gap-2">
        {([["analysis", "Analisi di oggi"], ["backtest", "Backtest"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`text-sm px-4 py-2 rounded-xl transition-colors ${
              tab === k ? "bg-[var(--surface-2)] text-[var(--foreground)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}>
            {label}
          </button>
        ))}
      </div>

      <ParamPanel params={params} setParams={setParams} disabled={false} />

      {tab === "analysis" ? <AnalysisPanel params={params} /> : <BacktestPanel params={params} />}

      <p className="text-[11px] text-[var(--muted)] leading-relaxed border-t border-[var(--border)] pt-4">
        I numeri del backtest vengono da una sola finestra di 5 anni, in larga parte rialzista, su un
        universo costruito con le liste di oggi (survivorship bias): sono indicativi, non attesi.
        Non è consulenza finanziaria.
      </p>
    </div>
  );
}
