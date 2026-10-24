"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { runFetchJob, runSseJob, useJob, usePersistentState } from "@/lib/analysisStore";
import { ChannelChart } from "@/components/ChannelChart";
import { LoadingPanel } from "@/components/Loading";
import { LivePrice, useLivePrices } from "@/components/LivePrice";
import { WorldBuyModal, useMomentumHoldings, type MomentumHolding } from "@/components/WorldBuyModal";
import { ZoomableLines, type DateRange, type ZoomLine } from "@/components/ZoomableLines";
import { backtestPortfolio } from "@/lib/backtestPortfolio";
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
  anchoredNow?: { price: AnchoredState; meta: AnchoredState };
  lastDate: string;
  prevClose: number;
  chg1m: number | null;
  chg3m: number | null;
}

interface AnchoredState {
  dir: "up" | "down" | "flat";
  from: string;
  confirmedAt: string;
  cause: string;
  age: number;
  lower: number | null;
  upper: number | null;
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
  endPrices: Record<string, { close: number; prevClose: number }>;
  names: Record<string, string>;
  rankingHistory: { date: string; strong: string[]; entered: string[]; exited: string[] }[];
  walkForward?: {
    periods: { start: string; end: string; summary: { totalReturn: number; profitFactor: number; trades: number; maxDrawdown: number } }[];
    worstProfitFactor: number;
    positivePeriods: number;
  };
  /** L'altra strategia (finestra mobile ↔ canali ancorati), sugli stessi dati. */
  comparison?: {
    kind: "other_strategy";
    channelMode: ChannelMode;
    label: string;
    summary: BacktestResult["summary"];
    equity: { date: string; equity: number }[];
    walkForward?: BacktestResult["walkForward"];
  };
  /** La strategia selezionata senza protezione dai drawdown. */
  protection?: {
    summary: BacktestResult["summary"];
    equity: { date: string; equity: number }[];
    walkForward?: BacktestResult["walkForward"];
  };
  options: {
    benchmark: string; exitRule: string; maxPositions: number; metaWindow: number; volTarget: number;
    channelMode: ChannelMode; anchoredExit: string;
  };
  tickersTested: number;
}

// ─── Parametri condivisi fra i due pannelli ──────────────────────────────────

type ChannelMode = "rolling" | "anchored";

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
  /** Come si costruiscono i canali: finestra mobile (attuale) o ancorati (metodo di Antonio). */
  channelMode: ChannelMode;
  /** Canali ancorati: quale rottura chiude la posizione. */
  anchoredExit: string;
  /** Benchmark del metatitolo, del regime e del confronto: un ticker o "AUTO" (segue l'indice). */
  benchmark: string;
  /** Giorni della media mobile del filtro di regime. */
  regimeSma: number;
}

/** Benchmark selezionabili. "AUTO" sceglie quello dell'indice analizzato. */
const BENCHMARK_OPTIONS: Record<string, string> = {
  URTH: "MSCI World (validato)",
  AUTO: "Automatico — segue l'indice",
  SPY: "S&P 500",
  QQQ: "Nasdaq 100",
  DIA: "Dow Jones 30",
};
const BENCHMARK_NAMES: Record<string, string> = { URTH: "MSCI World", SPY: "S&P 500", QQQ: "Nasdaq 100", DIA: "Dow Jones 30" };
/** Il benchmark effettivo, come lo risolve il server per "AUTO". */
function effectiveBenchmark(p: Params): string {
  if (p.benchmark !== "AUTO") return p.benchmark;
  return p.index === "NDX" ? "QQQ" : p.index === "DJIA" ? "DIA" : "SPY";
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
  channelMode: "rolling",
  anchoredExit: "meta",
  benchmark: "URTH",
  regimeSma: 200,
};

/** Perché si è chiusa una riga del registro: vedi WorldExitKind nel motore. */
const OUTCOME_LABELS: Record<string, string> = {
  channel_break: "rottura del canale",
  trim: "riduzione esposizione (parziale)",
  stop: "stop",
  trail: "trailing stop",
  regime: "regime negativo",
  time: "time stop",
  end_of_test: "aperta a fine test",
};

/**
 * Uscite dei canali ancorati. L'ordine è quello dell'A/B: la prima è l'unica
 * che ha battuto la strategia precedente sul periodo di taratura.
 */
const ANCHORED_EXIT_LABELS: Record<string, string> = {
  meta: "Rottura del canale del metatitolo (consigliata)",
  price: "Rottura del canale del prezzo (regola alla lettera)",
  price_weekly: "Rottura del prezzo, se anche il settimanale non sale",
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
    channelMode: p.channelMode,
    anchoredExit: p.anchoredExit,
    benchmark: p.benchmark,
    regimeSma: String(p.regimeSma),
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
      <div className="flex flex-col gap-2 mb-4">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Costruzione dei canali</span>
        <div className="flex gap-2 flex-wrap">
          {([
            ["rolling", "Finestra mobile — strategia attuale"],
            ["anchored", "Canali ancorati — metodo Antonio"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => set("channelMode", k)}
              disabled={disabled}
              className={`text-xs px-3 py-1.5 rounded-xl border transition-colors ${
                params.channelMode === k
                  ? "bg-[var(--surface-2)] text-[var(--foreground)] border-[var(--accent)]"
                  : "text-[var(--muted)] border-[var(--border)] hover:text-[var(--foreground)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[var(--muted)] max-w-3xl">
          {params.channelMode === "anchored"
            ? "Ogni canale nasce alla rottura confermata (2 chiusure) della banda opposta del canale precedente, parte dal minimo o massimo precedente e muore alla rottura. Si compra all'inizio di un canale rialzista del prezzo, su titoli il cui metatitolo è a sua volta in canale rialzista. Il backtest lo confronta con la strategia attuale sugli stessi dati."
            : "Canale sempre sulle ultime N barre: si compra nella metà bassa di un canale ascendente, si vende alla rottura del canale del metatitolo. È la strategia validata e in uso."}
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Indice</span>
          <select className="input" value={params.index} onChange={(e) => set("index", e.target.value)}>
            {INDICES.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
          </select>
        </label>
        {params.channelMode === "rolling" && (
          <>
            <NumField label="Finestra metatitolo" value={params.metaWindow} min={20} max={150}
              hint="Barre del canale sul metatitolo (stadio 1). Più lunga = segnale più lento, posizioni tenute più a lungo." onChange={(v) => set("metaWindow", v)} />
            <NumField label="R² minimo" value={params.minMetaR2} step={0.1} min={0} max={1}
              hint="Quanto deve essere pulito il trend del metatitolo per considerarlo un canale." onChange={(v) => set("minMetaR2", v)} />
          </>
        )}
        <NumField label="Quanti forti" value={params.strongTopN} min={5} max={60}
          hint="Quanti titoli tenere nell'insieme dei forti (stadio 1)." onChange={(v) => set("strongTopN", v)} />
        {params.channelMode === "rolling" && (
          <>
            <NumField label="Finestra prezzo" value={params.priceWindow} min={20} max={120}
              hint="Barre del canale sul prezzo grezzo (stadio 2, il timing)." onChange={(v) => set("priceWindow", v)} />
            <NumField label="z massimo entrata" value={params.entryMaxZ} step={0.5} min={-2} max={2}
              hint="Quanto in basso nel canale deve stare il prezzo per comprare. 0 = metà bassa." onChange={(v) => set("entryMaxZ", v)} />
          </>
        )}
        <NumField label="Posizioni max" value={params.maxPositions} min={1} max={15}
          hint="Quante posizioni contemporanee. Meno posizioni = più concentrazione." onChange={(v) => set("maxPositions", v)} />
        <NumField label="Volatilità obiettivo %" value={params.volTarget} step={5} min={0} max={60}
          hint="Riduzione del drawdown: quando la volatilità realizzata della strategia supera questo valore, si investe meno in proporzione. 0 = spento (strategia senza protezione)." onChange={(v) => set("volTarget", v)} />
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Regola di uscita</span>
          {params.channelMode === "anchored" ? (
            <select className="input" value={params.anchoredExit} onChange={(e) => set("anchoredExit", e.target.value)}>
              {Object.entries(ANCHORED_EXIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          ) : (
            <select className="input" value={params.exitRule} onChange={(e) => set("exitRule", e.target.value)}>
              {Object.entries(EXIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]"
            title="Il benchmark decide tre cose: il metatitolo (titolo ÷ benchmark), il filtro di regime e la linea di confronto. La strategia è stata validata con l'MSCI World.">
            Benchmark
          </span>
          <select className="input" value={params.benchmark} onChange={(e) => set("benchmark", e.target.value)}>
            {Object.entries(BENCHMARK_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="text-[10px] text-[var(--muted)]">
            {params.benchmark === "AUTO"
              ? `Con ${INDICES.find((i) => i.key === params.index)?.label ?? params.index}: ${BENCHMARK_NAMES[effectiveBenchmark(params)]} (${effectiveBenchmark(params)}).`
              : `Metatitolo = titolo ÷ ${BENCHMARK_NAMES[params.benchmark]} (${params.benchmark}).`}
          </span>
        </label>
        <NumField label="Media mobile regime (giorni)" value={params.regimeSma} step={10} min={10} max={400}
          hint="Filtro di regime: niente nuove entrate quando il benchmark è sotto la sua media mobile di questi giorni. 200 è il valore validato."
          onChange={(v) => set("regimeSma", Math.round(v))} />
      </div>
      <label className="flex items-center gap-2 mt-3 text-xs text-[var(--muted)]">
        <input type="checkbox" checked={params.useRegime} onChange={(e) => set("useRegime", e.target.checked)} />
        Filtro di regime: nessuna nuova entrata mentre {BENCHMARK_NAMES[effectiveBenchmark(params)]} è sotto la media mobile a {params.regimeSma} giorni
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

/** Data di oggi a New York: decide se l'ultima barra è la seduta in corso. */
function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function pct(v: number | null | undefined, dp = 1): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
}

function toneOf(v: number | null | undefined): string {
  if (v == null || !isFinite(v) || v === 0) return "text-[var(--muted)]";
  return v > 0 ? "text-[var(--positive)]" : "text-[var(--negative)]";
}

function MiniStat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-2)] px-2.5 py-2 min-w-0" title={hint}>
      <p className="text-[9px] uppercase tracking-wider text-[var(--muted)] truncate">{label}</p>
      <p className={`font-mono text-sm mt-0.5 truncate ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

/** Pillola dello stato di un canale ancorato: direzione e da quante sedute. */
function ChannelPill({ label, st }: { label: string; st: AnchoredState }) {
  const color = st.dir === "up" ? "var(--positive)" : st.dir === "down" ? "var(--negative)" : "var(--muted)";
  const dir = st.dir === "up" ? "rialzista" : st.dir === "down" ? "ribassista" : "laterale";
  return (
    <div className="rounded-xl bg-[var(--surface-2)] p-2.5 min-w-0" style={{ borderLeft: `3px solid ${color}` }}>
      <p className="text-[9px] uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className="text-xs mt-0.5" style={{ color }}>
        {st.dir === "up" ? "▲" : st.dir === "down" ? "▼" : "▬"} {dir}
      </p>
      <p className="text-[10px] text-[var(--muted)] font-mono mt-0.5">
        da {st.age} sedute · {st.from}
      </p>
    </div>
  );
}

function LeaderCard({
  leader, params, livePrice, marketOpen, held, onBuy,
}: {
  leader: Leader; params: Params; livePrice?: number; marketOpen: boolean;
  held?: MomentumHolding; onBuy: () => void;
}) {
  const mc = leader.metaChannel;
  const pc = leader.priceChannel;
  const price = livePrice && livePrice > 0 ? livePrice : leader.price;
  // Variazione del giorno: contro la chiusura di ieri. Se l'ultima barra
  // dell'analisi è già la seduta di oggi, "ieri" è la barra prima.
  const ref = leader.lastDate === todayET() ? leader.prevClose : leader.price;
  const dayChg = ref > 0 ? ((price - ref) / ref) * 100 : null;

  // Canali ancorati: la banda inferiore del canale del prezzo è dove il canale
  // si rompe. Con la finestra mobile invece non è un livello di uscita (si esce
  // sul metatitolo, e si compra proprio nella parte bassa): lì si mostra solo
  // l'intervallo del canale.
  const lower = leader.anchoredNow ? leader.anchoredNow.price.lower : null;
  const toLower = lower != null && lower > 0 ? ((price - lower) / price) * 100 : null;

  return (
    // Tutta la card apre il dettaglio (link steso sotto il contenuto), ma i
    // pulsanti in fondo restano cliccabili per conto loro: un <button> dentro un
    // <a> non è HTML valido e il clic finirebbe comunque sul link.
    <div className={`group relative glass rounded-2xl p-4 flex flex-col gap-3 border transition-all duration-150 hover:border-[var(--accent)] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30 ${held ? "border-[var(--accent)]/40" : "border-transparent"}`}>
      <Link
        href={`/world-momentum/${encodeURIComponent(leader.ticker)}?${qs(params)}`}
        className="absolute inset-0 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        title={`Apri l'analisi completa di ${leader.ticker}: canali, grafici e segnali storici`}
        aria-label={`Apri l'analisi completa di ${leader.ticker}`}
      />
      <div className="contents pointer-events-none [&>*]:pointer-events-none">
      {/* Intestazione: chi è, forza, segnale */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-base group-hover:text-[var(--accent)] transition-colors">{leader.ticker}</span>
            {leader.rank > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] text-[var(--muted)]">
                #{leader.rank} per forza
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--muted)] truncate">{leader.name}</p>
        </div>
        <SignalBadge signal={leader.signal} />
      </div>

      {/* Prezzo */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-[var(--muted)] flex items-center gap-1.5">
            {livePrice ? (
              <>
                <span
                  className={`inline-block size-1.5 rounded-full ${marketOpen ? "live-dot" : ""}`}
                  style={{ background: marketOpen ? "var(--positive)" : "var(--muted)" }}
                />
                {marketOpen ? "prezzo live" : "ultimo prezzo"}
              </>
            ) : (
              "chiusura"
            )}
          </p>
          <p className="font-mono text-2xl leading-tight">
            <LivePrice price={price} format={(n) => money(n)} />
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-wider text-[var(--muted)]">oggi</p>
          <p className={`font-mono text-sm ${toneOf(dayChg)}`}>{pct(dayChg, 2)}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="1 mese" value={pct(leader.chg1m)} tone={toneOf(leader.chg1m)} />
        <MiniStat label="3 mesi" value={pct(leader.chg3m)} tone={toneOf(leader.chg3m)} />
        <MiniStat label="Forza rel." value={leader.rs.toFixed(1)} tone={toneOf(leader.rs)}
          hint="Rendimento composito del titolo contro il benchmark (30/90/180 giorni pesati): è il criterio della classifica." />
      </div>

      {leader.anchoredNow ? (
        <div className="grid grid-cols-2 gap-2">
          <ChannelPill label="Metatitolo ÷ benchmark" st={leader.anchoredNow.meta} />
          <ChannelPill label="Prezzo" st={leader.anchoredNow.price} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-[var(--muted)] mb-1">Metatitolo ÷ benchmark</p>
            <ChannelChart closes={leader.metaSpark} channel={mc} height={48} />
            <p className="text-[10px] text-[var(--muted)] mt-1 font-mono">R² {mc.r2} · z {mc.z}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wider text-[var(--muted)] mb-1">Prezzo</p>
            {pc ? (
              <>
                <ChannelChart closes={leader.priceSpark} channel={pc} height={48} />
                <p className="text-[10px] text-[var(--muted)] mt-1 font-mono">R² {pc.r2} · z {pc.z}</p>
              </>
            ) : (
              <p className="text-[10px] text-[var(--muted)]">Canale non calcolabile.</p>
            )}
          </div>
        </div>
      )}

      {lower != null && (
        <div className="flex items-center justify-between gap-2 text-[11px] rounded-xl border border-[var(--border)] px-2.5 py-1.5"
          title="La banda inferiore del canale del prezzo: una chiusura sotto questo livello rompe il canale.">
          <span className="text-[var(--muted)]">Banda inferiore del canale</span>
          <span className="font-mono">
            {money(lower)}{" "}
            {toLower != null && toLower < 0 ? (
              // Sotto la banda: è una rottura in corso, che conta solo se resta
              // tale per le chiusure di conferma.
              <span className="text-[var(--negative)] font-sans">· prezzo sotto la banda, rottura da confermare</span>
            ) : (
              <span className={toLower != null && toLower < 3 ? "text-[var(--warning)]" : "text-[var(--muted)]"}>
                ({toLower != null ? `margine ${toLower.toFixed(1)}%` : "—"})
              </span>
            )}
          </span>
        </div>
      )}

      {!leader.anchoredNow && pc && (
        <div className="flex items-center justify-between gap-2 text-[11px] rounded-xl border border-[var(--border)] px-2.5 py-1.5"
          title="Bande a ±2σ del canale del prezzo sulle ultime barre: si compra nella metà bassa.">
          <span className="text-[var(--muted)]">Canale del prezzo</span>
          <span className="font-mono">{money(leader.channelLow)} – {money(leader.channelHigh)}</span>
        </div>
      )}

      <p className="text-xs text-[var(--muted)] leading-snug">{leader.reason}</p>

      {held && (
        <div className="rounded-xl border border-[var(--accent)]/30 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-2.5 py-2 text-[11px] flex items-center justify-between gap-2">
          <span>
            💼 <strong>In portafoglio</strong>{" "}
            <span className="text-[var(--muted)] font-mono">{held.shares} az. @ {money(held.avgCost)}</span>
          </span>
          <span className={`font-mono ${held.unrealizedPnlPct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
            {held.unrealizedPnlPct >= 0 ? "+" : ""}{held.unrealizedPnlPct}%
          </span>
        </div>
      )}
      </div>

      {/* Azioni: sopra il link della card, quindi cliccabili da sole */}
      <div className="relative z-10 mt-auto grid grid-cols-2 gap-2">
        {held ? (
          <Link
            href="/portfolio-momentum"
            className="inline-flex items-center justify-center gap-1 rounded-xl py-2 text-xs font-medium border border-[var(--accent)]/50 text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors"
            title="Le posizioni si vendono da Portfolio Momentum"
          >
            Vendi in Portfolio →
          </Link>
        ) : (
          <button
            onClick={onBuy}
            className={`inline-flex items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold transition-colors ${
              leader.signal === "COMPRA"
                ? "bg-[var(--positive)] text-white hover:brightness-110"
                : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]"
            }`}
            title={leader.signal === "COMPRA" ? `Compra ${leader.ticker}` : `Il segnale è ${leader.signal}: puoi comprare lo stesso, contro la strategia`}
          >
            {leader.signal === "COMPRA" ? `Compra ${leader.ticker}` : "Compra comunque"}
          </button>
        )}
        {/* Link vero: la riga dei pulsanti sta sopra il link della card, quindi
            un'etichetta qui non farebbe passare il clic a nessuno. */}
        <Link
          href={`/world-momentum/${encodeURIComponent(leader.ticker)}?${qs(params)}`}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium bg-[var(--surface-2)] text-[var(--foreground)] group-hover:bg-[var(--accent)] group-hover:text-white transition-colors"
        >
          Analisi completa
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </Link>
      </div>
    </div>
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
  const { holdings, reload: reloadHoldings } = useMomentumHoldings();
  const [buying, setBuying] = useState<Leader | null>(null);
  const [bought, setBought] = useState<string | null>(null);

  const run = useCallback(() => {
    runSseJob<Analysis>(ANALYSIS_KEY, `/api/world/analyze?${qs(params)}`, { qs: qs(params) });
  }, [params]);

  const shown = useMemo(() => {
    if (!data) return [];
    if (filter === "buy") return data.leaders.filter((l) => l.signal === "COMPRA");
    if (filter === "strong") return data.leaders.filter((l) => l.rank > 0);
    return data.leaders;
  }, [data, filter]);

  // Prezzi live solo per le card a schermo: con la quota Finnhub a pagamento un
  // aggiornamento ogni 30 secondi per qualche decina di titoli è ampiamente
  // dentro i limiti, e fuori orario si legge una volta sola (useLivePrices).
  const liveTickers = useMemo(() => (running ? [] : shown.map((l) => l.ticker)), [shown, running]);
  const { prices: live, market } = useLivePrices(liveTickers, 30_000);

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

          {bought && (
            <div className="glass rounded-2xl p-3 mb-4 text-xs flex items-center justify-between gap-3 flex-wrap" style={{ borderLeft: "3px solid var(--positive)" }}>
              <span>
                ✓ <strong>{bought}</strong> comprato: è in Portfolio Momentum, con l&apos;etichetta Momentum World.
              </span>
              <span className="flex items-center gap-3">
                <Link href="/portfolio-momentum" className="text-[var(--accent)] hover:underline">Vai al portafoglio →</Link>
                <button className="text-[var(--muted)] hover:text-[var(--foreground)]" onClick={() => setBought(null)} aria-label="Chiudi">✕</button>
              </span>
            </div>
          )}

          {shown.length === 0 ? (
            <div className="glass rounded-2xl p-6 text-center text-sm text-[var(--muted)]">
              Nessun titolo in questa categoria oggi. Non è un errore: quando nessun metatitolo è
              in canale ascendente pulito, la strategia sta ferma.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((l) => (
                <LeaderCard
                  key={l.ticker} leader={l} params={params} livePrice={live[l.ticker]} marketOpen={market.open}
                  held={holdings[l.ticker]} onBuy={() => setBuying(l)}
                />
              ))}
            </div>
          )}

          {buying && (
            <WorldBuyModal
              target={{
                ticker: buying.ticker,
                name: buying.name,
                price: live[buying.ticker] ?? buying.price,
                signal: buying.signal,
                reason: buying.reason,
                stop: buying.anchoredNow?.price.lower ?? null,
              }}
              indexKey={params.index}
              maxPositions={params.maxPositions}
              exposurePct={data.exposure?.pct ?? 100}
              strategyLabel={params.channelMode === "anchored" ? "metodo Antonio" : "strategia attuale"}
              onClose={() => setBuying(null)}
              onDone={() => { setBought(buying.ticker); reloadHoldings(); }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Grafici del backtest ────────────────────────────────────────────────────

/** Curva equity (mark-to-market) contro il benchmark, e opzionalmente la versione senza protezione. */
/** Serie di drawdown (%) dal massimo precedente. */
function drawdownSeries(eq: { date: string; equity: number }[]): { date: string; dd: number }[] {
  let peak = -Infinity;
  return eq.map((p) => {
    peak = Math.max(peak, p.equity);
    return { date: p.date, dd: peak > 0 ? ((p.equity - peak) / peak) * 100 : 0 };
  });
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


/** Minuscola solo sulla prima lettera: "Metodo Antonio" → "metodo Antonio". */
const lcFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** Una strategia simulata: quanto serve alle tabelle e ai grafici di confronto. */
interface SimRun {
  summary: BacktestResult["summary"];
  equity: { date: string; equity: number }[];
  walkForward?: BacktestResult["walkForward"];
}

/**
 * Le due strategie del backtest, sempre nello stesso ordine — strategia
 * attuale (finestra mobile) e metodo Antonio (canali ancorati) — qualunque
 * delle due sia selezionata nei parametri.
 */
function strategyPair(result: BacktestResult): { attuale: SimRun; antonio: SimRun } | null {
  if (!result.comparison) return null;
  const main: SimRun = { summary: result.summary, equity: result.equity, walkForward: result.walkForward };
  const other: SimRun = result.comparison;
  return result.options.channelMode === "anchored" ? { attuale: other, antonio: main } : { attuale: main, antonio: other };
}

/** Tabella di confronto fra due simulazioni sugli stessi dati: metrica per metrica, con la differenza. */
function CompareTable({
  result, a, b, aLabel, bLabel,
}: {
  result: BacktestResult; a: SimRun; b: SimRun; aLabel: string; bLabel: string;
}) {
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
    { label: "Rendimento totale", hint: "Sull'intera finestra", a: a.summary.totalReturn, b: b.summary.totalReturn, dp: 1, unit: " pt", fmt: (v) => `${v.toFixed(1)}%`, better: "high" },
    { label: "CAGR", hint: "Rendimento annuo composto", a: a.summary.cagr, b: b.summary.cagr, dp: 1, unit: " pt", fmt: (v) => `${v.toFixed(1)}%`, better: "high" },
    { label: "Max drawdown", hint: "La perdita peggiore dal massimo precedente", a: a.summary.maxDrawdown, b: b.summary.maxDrawdown, dp: 1, unit: " pt", fmt: (v) => `${v.toFixed(1)}%`, better: "low" },
    { label: "Ulcer index", hint: "Profondità E durata dei drawdown insieme: più basso = meno sofferenza", a: ulcer(a.equity), b: ulcer(b.equity), dp: 1, unit: "", fmt: (v) => v.toFixed(1), better: "low" },
    { label: "Calmar (CAGR ÷ max DD)", hint: "Rendimento per unità di drawdown: la misura che riassume il compromesso", a: a.summary.cagr / Math.max(0.1, a.summary.maxDrawdown), b: b.summary.cagr / Math.max(0.1, b.summary.maxDrawdown), dp: 2, unit: "", fmt: (v) => v.toFixed(2), better: "high" },
    { label: "Profit factor", hint: "Guadagni lordi ÷ perdite lorde", a: a.summary.profitFactor, b: b.summary.profitFactor, dp: 2, unit: "", fmt: (v) => v.toFixed(2), better: "high" },
    { label: "Trade", hint: "Operazioni chiuse nel periodo", a: a.summary.trades, b: b.summary.trades, dp: 0, unit: "", fmt: (v) => String(v), better: "high" },
    { label: "Peggior PF nei periodi", hint: "Il sotto-periodo peggiore del walk-forward", a: a.walkForward?.worstProfitFactor ?? null, b: b.walkForward?.worstProfitFactor ?? null, dp: 2, unit: "", fmt: (v) => v.toFixed(2), better: "high" },
    { label: "Periodi che battono il benchmark", hint: "Su quanti sotto-periodi del walk-forward", a: beats(a.walkForward), b: beats(b.walkForward), dp: 0, unit: "", fmt: (v) => `${v}/${nFolds}`, better: "high" },
  ];
  return (
    <div className="glass rounded-2xl p-4 overflow-x-auto">
      <table className="w-full text-xs [&_th]:pr-4 [&_td]:pr-4 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
        <thead>
          <tr className="text-[var(--muted)] text-left">
            <th className="pb-2 font-medium">Metrica</th>
            <th className="pb-2 font-medium text-right">{aLabel}</th>
            <th className="pb-2 font-medium text-right">{bLabel}</th>
            <th className="pb-2 font-medium text-right">Differenza</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => {
            const d = r.a != null && r.b != null ? r.b - r.a : null;
            // Il numero di trade non è "meglio" né "peggio": niente colore.
            const good = d == null || d === 0 || r.label === "Trade" ? null : r.better === "low" ? d < 0 : d > 0;
            return (
              <tr key={r.label} className="border-t border-[var(--border)]">
                <td className="py-1.5 font-sans" title={r.hint}>{r.label}</td>
                <td className="py-1.5 text-right">{r.a != null ? r.fmt(r.a) : "—"}</td>
                <td className="py-1.5 text-right">{r.b != null ? r.fmt(r.b) : "—"}</td>
                <td className={`py-1.5 text-right ${good == null ? "text-[var(--muted)]" : good ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                  {d == null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(r.dp)}${r.unit}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[11px] text-[var(--muted)] mt-2">Differenza = {lcFirst(bLabel)} meno {lcFirst(aLabel)}: verde se {lcFirst(bLabel)} fa meglio.</p>
    </div>
  );
}

/** Strategia attuale contro metodo Antonio: sempre, qualunque sia selezionata. */
function ComparisonPanel({ result }: { result: BacktestResult }) {
  const pair = strategyPair(result)!;
  const selected = result.options.channelMode === "anchored" ? "metodo Antonio" : "strategia attuale";
  return (
    <section>
      <h3 className="text-sm font-semibold mb-1">Strategia attuale contro metodo Antonio</h3>
      <p className="text-xs text-[var(--muted)] mb-2 max-w-3xl">
        Le due strategie sugli stessi dati, la stessa finestra e la stessa protezione dai drawdown:
        cambia solo come si costruiscono i canali, e quindi quando si entra e si esce. Il resto della
        pagina (riepilogo del portafoglio, operazioni) è della strategia selezionata: {selected}.
      </p>
      <p className="text-[11px] text-[var(--muted)] mb-2 max-w-3xl">
        Un singolo backtest cambia anche molto spostando l&apos;inizio di un giorno. Nella validazione su
        5 fasi di partenza (mediane) il metodo Antonio con uscita sul metatitolo ha reso di più in tutti e
        tre i test (2021-26 S&amp;P 500 +194% contro +140%; 2013-21 +781% contro +460%; Nasdaq 100
        +210% contro +159%), ma sul Nasdaq con drawdown 34,2% contro 24,3%.
      </p>
      <CompareTable result={result} a={pair.attuale} b={pair.antonio} aLabel="Strategia attuale" bLabel="Metodo Antonio" />
    </section>
  );
}

/** La strategia selezionata con e senza protezione dai drawdown. */
function ProtectionPanel({ result }: { result: BacktestResult }) {
  const main: SimRun = { summary: result.summary, equity: result.equity, walkForward: result.walkForward };
  return (
    <section>
      <h3 className="text-sm font-semibold mb-1">Con e senza protezione dai drawdown</h3>
      <p className="text-xs text-[var(--muted)] mb-2 max-w-3xl">
        La strategia selezionata, con gli stessi titoli e le stesse date di ingresso e uscita: cambia
        solo quanto si investe. Con la volatilità della strategia sopra il {result.options.volTarget}%
        annuo l&apos;esposizione si riduce in proporzione.
      </p>
      <CompareTable result={result} a={result.protection!} b={main} aLabel="Senza protezione" bLabel="Con protezione" />
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

/**
 * I tre grafici del backtest (equity, drawdown, P&L realizzato) con zoom e
 * cursore condivisi: si trascina su uno qualsiasi per ingrandire un periodo,
 * e gli altri seguono. Sopra, il rendimento di ogni linea nel periodo scelto.
 */
function BacktestCharts({ result }: { result: BacktestResult }) {
  const [range, setRange] = useState<DateRange>(null);
  const [hover, setHover] = useState<string | null>(null);

  // Sempre le due strategie: strategia attuale (arancio) e metodo Antonio (blu).
  const pair = useMemo(() => strategyPair(result), [result]);
  const benchName = BENCHMARK_NAMES[result.options.benchmark] ?? "benchmark";
  const toLine = (eq: { date: string; equity: number }[]) => eq.map((p) => ({ date: p.date, value: p.equity }));
  const ddLine = (eq: { date: string; equity: number }[]) => drawdownSeries(eq).map((p) => ({ date: p.date, value: p.dd }));

  const equityLines: ZoomLine[] = useMemo(() => [
    { label: benchName, color: "var(--muted)", points: toLine(result.benchEquity), dashed: true },
    ...(pair
      ? [
          { label: "strategia attuale", color: "var(--warning)", points: toLine(pair.attuale.equity), strong: true },
          { label: "metodo Antonio", color: "var(--accent)", points: toLine(pair.antonio.equity), strong: true },
        ]
      : [{ label: "strategia", color: "var(--accent)", points: toLine(result.equity), strong: true }]),
  ], [result, pair, benchName]);
  const ddLines: ZoomLine[] = useMemo(() => [
    { label: benchName, color: "var(--muted)", points: ddLine(result.benchEquity), fill: true },
    ...(pair
      ? [
          { label: "strategia attuale", color: "var(--warning)", points: ddLine(pair.attuale.equity), fill: true },
          { label: "metodo Antonio", color: "var(--accent)", points: ddLine(pair.antonio.equity), fill: true, strong: true },
        ]
      : [{ label: "strategia", color: "var(--accent)", points: ddLine(result.equity), fill: true, strong: true }]),
  ], [result, pair, benchName]);
  const realizedLines: ZoomLine[] = useMemo(() => {
    const last = result.realizedCurve[result.realizedCurve.length - 1]?.realized ?? 0;
    return [{
      label: "P&L realizzato", color: last >= 0 ? "var(--positive)" : "var(--negative)",
      points: result.realizedCurve.map((p) => ({ date: p.date, value: p.realized })), fill: true, strong: true,
    }];
  }, [result]);

  const dates = useMemo(() => result.equity.map((p) => p.date), [result]);
  const presets = [
    { key: "3M", bars: 63 }, { key: "6M", bars: 126 }, { key: "1A", bars: 252 }, { key: "2A", bars: 504 },
  ].filter((p) => p.bars < dates.length);
  const from = range?.from ?? dates[0];
  const to = range?.to ?? dates[dates.length - 1];

  // Rendimento di ogni curva di equity fra l'inizio e la fine del periodo scelto.
  const periodReturns = equityLines.map((l) => {
    const a = l.points.find((p) => p.date >= from);
    let b: { date: string; value: number } | undefined;
    for (const p of l.points) { if (p.date > to) break; b = p; }
    return { label: l.label, color: l.color, pct: a && b && a.value > 0 ? ((b.value - a.value) / a.value) * 100 : null };
  }).reverse();

  const money0 = (v: number) => `$${Math.round(v).toLocaleString("it-IT")}`;

  return (
    <div className="flex flex-col gap-5">
      {/* Barra del periodo: comanda tutti e tre i grafici. Sticky, così resta a portata mentre scorri. */}
      <div className="sticky top-10 z-20 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-lg shadow-black/30 p-3 flex items-center gap-x-4 gap-y-2 flex-wrap">
        <div className="flex gap-1">
          {presets.map((p) => {
            const f = dates[dates.length - p.bars];
            const active = range?.from === f && range?.to === dates[dates.length - 1];
            return (
              <button key={p.key} onClick={() => setRange({ from: f, to: dates[dates.length - 1] })}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${active ? "bg-[var(--surface-2)] text-[var(--foreground)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}>
                {p.key}
              </button>
            );
          })}
          <button onClick={() => setRange(null)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${!range ? "bg-[var(--surface-2)] text-[var(--foreground)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}>
            Tutto
          </button>
        </div>
        <span className="text-[11px] font-mono text-[var(--muted)]">{from} → {to}</span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {periodReturns.map((r) => (
            <span key={r.label} className="flex items-center gap-1.5">
              <span className="inline-block w-3" style={{ borderTop: `2px solid ${r.color}` }} />
              <span className="text-[var(--muted)]">{r.label}</span>
              <span className={`font-mono ${r.pct == null ? "" : r.pct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                {r.pct == null ? "—" : `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}%`}
              </span>
            </span>
          ))}
        </span>
        <span className="text-[11px] text-[var(--muted)] ml-auto">Trascina su un grafico per ingrandire · doppio clic per tornare a tutto</span>
      </div>

      <section>
        <h3 className="text-sm font-semibold mb-2">Equity contro benchmark</h3>
        <div className="glass rounded-2xl p-4">
          <ZoomableLines lines={equityLines} range={range} onRange={setRange} hoverDate={hover} onHover={setHover}
            formatY={money0} baseline={10_000} height={280} />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-1">Drawdown nel tempo</h3>
        <p className="text-xs text-[var(--muted)] mb-2">
          Quanto si è sotto il massimo precedente, giorno per giorno: ogni avvallamento è un
          picco che poi cade. La profondità è quanto fa male, la larghezza quanto dura.
        </p>
        <div className="glass rounded-2xl p-4">
          <ZoomableLines lines={ddLines} range={range} onRange={setRange} hoverDate={hover} onHover={setHover}
            formatY={(v) => `${v.toFixed(1)}%`} zeroTop height={220} />
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] mt-1 px-1 text-[var(--muted)]">
            {ddLines.map((l) => {
              const w = Math.min(...l.points.map((p) => p.value));
              return <span key={l.label}>{l.label}: peggiore di sempre <strong className="font-mono text-[var(--foreground)]">{w.toFixed(1)}%</strong></span>;
            })}
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-1">P&amp;L realizzato nel tempo</h3>
        <p className="text-xs text-[var(--muted)] mb-2">
          Si muove solo alla chiusura di una posizione: sono i soldi incassati, non il valore a mercato.
        </p>
        <div className="glass rounded-2xl p-4">
          <ZoomableLines lines={realizedLines} range={range} onRange={setRange} hoverDate={hover} onHover={setHover}
            formatY={money0} baseline={0} height={200} />
        </div>
      </section>
    </div>
  );
}

/**
 * Walk-forward: periodi consecutivi, ognuno con capitale fresco. Con un termine
 * di paragone (strategia precedente, o la stessa senza protezione) le due
 * strategie stanno affiancate periodo per periodo: si vede DOVE vince l'una e
 * dove l'altra, non solo il totale.
 */
function WalkForwardPanel({ result }: { result: BacktestResult }) {
  // Colonne sempre nello stesso ordine: strategia attuale, poi metodo Antonio.
  const pair = strategyPair(result);
  const wf = (pair ? pair.antonio.walkForward : result.walkForward)!;
  const cmpWf = pair?.attuale.walkForward;
  const mainLabel = cmpWf ? "Metodo Antonio" : "Strategia";
  const cmpLabel = "Strategia attuale";
  const pct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
  const tone = (v: number | null) => (v == null ? "" : v >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]");

  const rows = wf.periods.map((p, k) => {
    const c = cmpWf?.periods[k];
    const bench = benchReturnBetween(result.benchEquity, p.start, p.end);
    const winner = c ? (p.summary.totalReturn > c.summary.totalReturn ? "main" : p.summary.totalReturn < c.summary.totalReturn ? "cmp" : null) : null;
    return { p, c, bench, winner };
  });
  const winsMain = rows.filter((r) => r.winner === "main").length;
  const winsCmp = rows.filter((r) => r.winner === "cmp").length;
  const beats = (get: (r: (typeof rows)[number]) => number | undefined) =>
    rows.filter((r) => r.bench != null && get(r) != null && get(r)! > r.bench).length;

  return (
    <section>
      <h3 className="text-sm font-semibold mb-1">Walk-forward{cmpWf ? ": le due strategie periodo per periodo" : ""}</h3>
      <p className="text-xs text-[var(--muted)] mb-2 max-w-3xl">
        Periodi consecutivi, ognuno simulato con capitale fresco. Un edge vero regge in (quasi)
        ogni sotto-periodo: se sta in piedi solo sul totale, è fortuna.
      </p>
      {cmpWf && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs mb-2">
          <span>Periodi vinti: <strong>{lcFirst(mainLabel)} {winsMain}</strong> · {lcFirst(cmpLabel)} {winsCmp} su {rows.length}</span>
          <span className="text-[var(--muted)]">
            Battono {BENCHMARK_NAMES[result.options.benchmark] ?? result.options.benchmark}: {lcFirst(mainLabel)} {beats((r) => r.p.summary.totalReturn)}/{rows.length},{" "}
            {lcFirst(cmpLabel)} {beats((r) => r.c?.summary.totalReturn)}/{rows.length}
          </span>
        </div>
      )}
      <div className="glass rounded-2xl p-4 overflow-x-auto">
        <table className="w-full text-xs [&_th]:pr-4 [&_td]:pr-4 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
          <thead>
            <tr className="text-[var(--muted)] text-left">
              <th className="pb-2 font-medium" rowSpan={cmpWf ? 2 : 1}>Periodo</th>
              {cmpWf && <th className="pb-1 font-medium text-center border-b border-[var(--border)]" colSpan={3}>{cmpLabel}</th>}
              <th className="pb-1 font-medium text-center border-b border-[var(--border)]" colSpan={cmpWf ? 3 : 4}>{mainLabel}</th>
              <th className="pb-2 font-medium text-right" rowSpan={cmpWf ? 2 : 1}>
                {BENCHMARK_NAMES[result.options.benchmark] ?? "Benchmark"}
              </th>
              {cmpWf && <th className="pb-2 font-medium text-right" rowSpan={2}>Meglio</th>}
            </tr>
            <tr className="text-[var(--muted)] text-left">
              {[...(cmpWf ? [0] : []), 1].map((k) => (
                <Fragment key={k}>
                  <th className="pb-2 pt-1 font-medium text-right">Rend.</th>
                  <th className="pb-2 pt-1 font-medium text-right">Max DD</th>
                  <th className="pb-2 pt-1 font-medium text-right">PF</th>
                </Fragment>
              ))}
              {!cmpWf && <th className="pb-2 pt-1 font-medium text-right">Trade</th>}
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map(({ p, c, bench, winner }) => (
              <tr key={p.start} className="border-t border-[var(--border)]">
                <td className="py-1.5">{p.start} → {p.end}</td>
                {c && (
                  <>
                    <td className={`py-1.5 text-right ${tone(c.summary.totalReturn)} ${winner === "cmp" ? "font-semibold" : ""}`}>{pct(c.summary.totalReturn)}</td>
                    <td className="py-1.5 text-right text-[var(--muted)]">{c.summary.maxDrawdown != null ? `${c.summary.maxDrawdown}%` : "—"}</td>
                    <td className="py-1.5 text-right text-[var(--muted)]">{c.summary.profitFactor}</td>
                  </>
                )}
                <td className={`py-1.5 text-right ${tone(p.summary.totalReturn)} ${winner === "main" ? "font-semibold" : ""}`}>{pct(p.summary.totalReturn)}</td>
                <td className="py-1.5 text-right text-[var(--muted)]">{p.summary.maxDrawdown != null ? `${p.summary.maxDrawdown}%` : "—"}</td>
                <td className="py-1.5 text-right text-[var(--muted)]">{p.summary.profitFactor}</td>
                {!c && <td className="py-1.5 text-right">{p.summary.trades}</td>}
                <td className="py-1.5 text-right text-[var(--muted)]">{pct(bench)}</td>
                {cmpWf && (
                  <td className="py-1.5 text-right font-sans">
                    {winner === "main" ? <span className="text-[var(--accent)]">{mainLabel}</span>
                      : winner === "cmp" ? <span className="text-[var(--warning)]">{cmpLabel}</span> : "pari"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Sotto il mezzo centesimo è zero: un portafoglio tutto investito non deve mostrare "−$0,01".
const usd = (v: number) => {
  const x = Math.abs(v) < 0.005 ? 0 : v;
  return `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const pnlTone = (v: number | null) => (v == null || v === 0 ? "text-[var(--muted)]" : v > 0 ? "text-[var(--positive)]" : "text-[var(--negative)]");

/**
 * Il portafoglio del backtest nel formato del riepilogo di Antonio: una riga
 * per titolo (aperto o chiuso) con P&L realizzato e non realizzato, totali e
 * liquidità, e sotto il registro operazioni con la liquidità residua dopo
 * ogni riga. Lo stato è quello dell'ultimo giorno del backtest.
 */
function BacktestPortfolioPanel({ result }: { result: BacktestResult }) {
  const initial = (result.options as { accountSize?: number }).accountSize ?? 10_000;
  const pf = useMemo(
    () => backtestPortfolio(result.trades, result.endPrices ?? {}, result.names ?? {}, initial),
    [result, initial]
  );
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [ledgerTicker, setLedgerTicker] = useState("");
  const [ledgerAll, setLedgerAll] = useState(false);
  const last = result.equity[result.equity.length - 1]?.date ?? "";

  const rows = onlyOpen ? pf.rows.filter((r) => r.status === "APERTA") : pf.rows;
  const ledger = useMemo(() => {
    const l = ledgerTicker ? pf.ledger.filter((r) => r.ticker === ledgerTicker) : pf.ledger;
    const recent = [...l].reverse();
    return ledgerAll ? recent : recent.slice(0, 30);
  }, [pf, ledgerTicker, ledgerAll]);
  const ledgerTotal = ledgerTicker ? pf.ledger.filter((r) => r.ticker === ledgerTicker).length : pf.ledger.length;
  const t = pf.totals;

  return (
    <>
      <section>
        <h3 className="text-sm font-semibold mb-1">Riepilogo per titolo: posizioni aperte e P&amp;L realizzato e non realizzato</h3>
        <p className="text-xs text-[var(--muted)] mb-2 max-w-3xl">
          Il portafoglio simulato com&apos;è all&apos;ultimo giorno del backtest ({last}). P&amp;L realizzato:
          somma di tutte le vendite di quel titolo nel tempo. P&amp;L aperto: plus o minus sulla quantità
          ancora detenuta, rispetto al costo medio, alla chiusura dell&apos;ultimo giorno.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          <Stat label="Valore titoli" value={usd(t.value)} />
          <Stat label="Liquidità" value={usd(t.cash)} />
          <Stat label="Capitale totale" value={usd(t.equity)} tone={t.equity >= t.initial ? "pos" : "neg"} />
          <Stat label="P&L realizzato" value={usd(t.realizedPnl)} tone={t.realizedPnl >= 0 ? "pos" : "neg"} />
          <Stat label="P&L aperto" value={usd(t.openPnl)} tone={t.openPnl >= 0 ? "pos" : "neg"} />
        </div>

        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-3 flex-wrap text-xs">
            <label className="flex items-center gap-2 text-[var(--muted)]">
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
              Solo posizioni aperte ({t.openPositions})
            </label>
            <span className="text-[var(--muted)]">{rows.length} titoli · capitale iniziale {usd(t.initial)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs [&_th]:pr-3 [&_td]:pr-3 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0 whitespace-nowrap">
              <thead>
                <tr className="text-[var(--muted)] text-left">
                  <th className="pb-2 font-medium">Titolo</th>
                  <th className="pb-2 font-medium text-right">Qtà</th>
                  <th className="pb-2 font-medium text-right">Costo medio</th>
                  <th className="pb-2 font-medium text-right">Prezzo</th>
                  <th className="pb-2 font-medium text-right">Valore</th>
                  <th className="pb-2 font-medium text-right" title="Somma dei P&L di tutte le vendite di questo titolo">P&amp;L realizzato</th>
                  <th className="pb-2 font-medium text-right" title="Plus/minus sulla quantità ancora detenuta">P&amp;L aperto</th>
                  <th className="pb-2 font-medium text-right">P&amp;L totale</th>
                  <th className="pb-2 font-medium text-center">Stato</th>
                  <th className="pb-2 font-medium text-right" title="Peso sul capitale totale">% portaf.</th>
                  <th className="pb-2 font-medium text-right" title="Variazione dell'ultimo giorno">% giorno</th>
                  <th className="pb-2 font-medium text-right" title="Controvalore d'acquisto della quantità in portafoglio">Investito</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {rows.map((r) => (
                  <tr key={r.ticker} className={`border-t border-[var(--border)] ${r.status === "APERTA" ? "" : "opacity-75"}`}>
                    <td className="py-1.5">
                      <span className="font-semibold">{r.ticker}</span>{" "}
                      <span className="font-sans text-[var(--muted)]">{r.name}</span>
                    </td>
                    <td className="py-1.5 text-right">{r.shares ? r.shares.toLocaleString("it-IT", { maximumFractionDigits: 2 }) : "0"}</td>
                    <td className="py-1.5 text-right">{r.shares ? usd(r.avgCost) : "—"}</td>
                    <td className="py-1.5 text-right">{usd(r.price)}</td>
                    <td className="py-1.5 text-right">{r.value ? usd(r.value) : "—"}</td>
                    <td className={`py-1.5 text-right ${pnlTone(r.realizedPnl)}`}>{r.realizedPnl ? usd(r.realizedPnl) : "0"}</td>
                    <td className={`py-1.5 text-right ${pnlTone(r.openPnl)}`}>
                      {r.status === "APERTA" ? <>{usd(r.openPnl)}{r.openPct != null && <span className="text-[10px]"> ({r.openPct >= 0 ? "+" : ""}{r.openPct.toFixed(1)}%)</span>}</> : "0"}
                    </td>
                    <td className={`py-1.5 text-right font-semibold ${pnlTone(r.totalPnl)}`}>{usd(r.totalPnl)}</td>
                    <td className="py-1.5 text-center font-sans">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.status === "APERTA" ? "bg-[var(--positive)]/15 text-[var(--positive)]" : "bg-[var(--surface-2)] text-[var(--muted)]"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">{r.status === "APERTA" ? `${r.weightPct.toFixed(1)}%` : "—"}</td>
                    <td className={`py-1.5 text-right ${pnlTone(r.dayPct)}`}>{r.dayPct != null ? `${r.dayPct >= 0 ? "+" : ""}${r.dayPct.toFixed(2)}%` : "—"}</td>
                    <td className="py-1.5 text-right">{r.invested ? usd(r.invested) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-mono">
                <tr className="border-t-2 border-[var(--border)] font-semibold">
                  <td className="pt-2 font-sans">Totale titoli</td>
                  <td colSpan={3} />
                  <td className="pt-2 text-right">{usd(t.value)}</td>
                  <td className={`pt-2 text-right ${pnlTone(t.realizedPnl)}`}>{usd(t.realizedPnl)}</td>
                  <td className={`pt-2 text-right ${pnlTone(t.openPnl)}`}>{usd(t.openPnl)}</td>
                  <td className={`pt-2 text-right ${pnlTone(t.totalPnl)}`}>{usd(t.totalPnl)}</td>
                  <td className="pt-2 text-center font-sans text-[10px] text-[var(--muted)]">{t.openPositions} aperte</td>
                  <td className="pt-2 text-right">{t.equity > 0 ? `${((t.value / t.equity) * 100).toFixed(1)}%` : "—"}</td>
                  <td />
                  <td className="pt-2 text-right">{usd(t.invested)}</td>
                </tr>
                <tr className="text-[var(--muted)]">
                  <td className="pt-1 font-sans">Liquidità</td>
                  <td colSpan={3} />
                  <td className="pt-1 text-right">{usd(t.cash)}</td>
                  <td colSpan={4} />
                  <td className="pt-1 text-right">{t.equity > 0 ? `${((t.cash / t.equity) * 100).toFixed(1)}%` : "—"}</td>
                  <td colSpan={2} />
                </tr>
                <tr className="font-semibold">
                  <td className="pt-1 font-sans">Capitale totale</td>
                  <td colSpan={3} />
                  <td className="pt-1 text-right">{usd(t.equity)}</td>
                  <td colSpan={2} />
                  <td className={`pt-1 text-right ${pnlTone(t.equity - t.initial)}`}>
                    {t.initial > 0 ? `${t.equity >= t.initial ? "+" : ""}${(((t.equity - t.initial) / t.initial) * 100).toFixed(1)}%` : ""}
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-1">Registro operazioni</h3>
        <p className="text-xs text-[var(--muted)] mb-2 max-w-3xl">
          Ogni acquisto e vendita del portafoglio simulato, con la liquidità che resta dopo ogni riga.
          Si parte da {usd(t.initial)}; le vendite parziali sono le riduzioni della protezione dai drawdown.
          Le posizioni ancora aperte non compaiono come vendite.
        </p>
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <select className="input text-xs" value={ledgerTicker} onChange={(e) => setLedgerTicker(e.target.value)}>
              <option value="">Tutti i titoli ({pf.ledger.length} operazioni)</option>
              {pf.rows.map((r) => r.ticker).sort().map((tk) => (
                <option key={tk} value={tk}>{tk} ({pf.ledger.filter((x) => x.ticker === tk).length})</option>
              ))}
            </select>
            <span className="text-xs text-[var(--muted)]">{ledger.length} di {ledgerTotal} mostrate, dalla più recente</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs [&_th]:pr-3 [&_td]:pr-3 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0 whitespace-nowrap">
              <thead>
                <tr className="text-[var(--muted)] text-left">
                  <th className="pb-2 font-medium">N.</th>
                  <th className="pb-2 font-medium">Data</th>
                  <th className="pb-2 font-medium">Titolo</th>
                  <th className="pb-2 font-medium">Operazione</th>
                  <th className="pb-2 font-medium text-right">Qtà</th>
                  <th className="pb-2 font-medium text-right">Prezzo</th>
                  <th className="pb-2 font-medium text-right">Controvalore</th>
                  <th className="pb-2 font-medium text-right">P&amp;L</th>
                  <th className="pb-2 font-medium text-right">Liquidità residua</th>
                  <th className="pb-2 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {ledger.map((r) => (
                  <tr key={r.n} className="border-t border-[var(--border)]">
                    <td className="py-1.5 text-[var(--muted)]">{r.n}</td>
                    <td className="py-1.5">{r.date}</td>
                    <td className="py-1.5 font-semibold">{r.ticker}</td>
                    <td className={`py-1.5 font-sans ${r.side === "ACQUISTO" ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                      {r.side === "ACQUISTO" ? "▲ acquisto" : "▼ vendita"}
                    </td>
                    <td className="py-1.5 text-right">{r.shares.toLocaleString("it-IT", { maximumFractionDigits: 2 })}</td>
                    <td className="py-1.5 text-right">{usd(r.price)}</td>
                    <td className={`py-1.5 text-right ${r.amount < 0 ? "text-[var(--negative)]" : "text-[var(--positive)]"}`}>{usd(r.amount)}</td>
                    <td className={`py-1.5 text-right ${pnlTone(r.pnl ?? null)}`}>{r.pnl != null ? usd(r.pnl) : ""}</td>
                    <td className="py-1.5 text-right">{usd(r.cash)}</td>
                    <td className="py-1.5 font-sans text-[var(--muted)]">{r.outcome ? OUTCOME_LABELS[r.outcome] ?? r.outcome : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ledgerTotal > 30 && (
            <button className="btn-ghost text-xs mt-3" onClick={() => setLedgerAll((v) => !v)}>
              {ledgerAll ? "Mostra solo le ultime 30" : `Mostra tutte le ${ledgerTotal} operazioni`}
            </button>
          )}
        </div>
      </section>
    </>
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
          {params.years} anni · uscita:{" "}
          {params.channelMode === "anchored" ? ANCHORED_EXIT_LABELS[params.anchoredExit] : EXIT_LABELS[params.exitRule]}
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

          {result.comparison && <ComparisonPanel result={result} />}

          <BacktestCharts result={result} />

          {result.protection && <ProtectionPanel result={result} />}

          <section>
            <h3 className="text-sm font-semibold mb-1">P&amp;L realizzato per titolo</h3>
            <p className="text-xs text-[var(--muted)] mb-2">
              I 10 migliori e i 10 peggiori per contributo. Passa il mouse per trade, win rate e durata media.
            </p>
            <div className="glass rounded-2xl p-4">
              <PerTickerChart rows={result.perTicker} />
            </div>
          </section>

          <BacktestPortfolioPanel result={result} />

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

          {result.walkForward && <WalkForwardPanel result={result} />}
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
          Due stadi sul canale di regressione. Il <strong>metatitolo</strong> (titolo ÷ benchmark, di default MSCI World)
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
