"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";
import { useRisk } from "@/components/RiskProvider";
import { positionSize } from "@/lib/risk";
import { INDICES } from "@/lib/indices";
import { MomentumSellModal } from "@/components/MomentumSellModal";
import { ChannelChart } from "@/components/ChannelChart";
import type { RegressionChannel } from "@/lib/regression";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RsScore {
  rs30d: number | null;
  rs90d: number | null;
  rs180d: number | null;
  composite: number;
}

interface MomentumLeader {
  ticker: string;
  name: string;
  price: number;
  metaValue: number;
  rsScore: RsScore;
  metaChannel: RegressionChannel;
  priceChannel: RegressionChannel | null;
  signal: "BUY" | "WAIT" | "AVOID";
  zone: "lower" | "mid" | "upper";
  entry: number;
  stop: number;
  target: number;
  spark: number[];
  metaSpark: number[];
}

/** Posizione aperta nel portafoglio Momentum (da GET /api/momentum/trades). */
interface HeldPosition {
  indexKey: string;
  ticker: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  stop: number | null;
  target: number | null;
  stopHit: boolean;
  targetHit: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function MiniSparkline({ data, height = 40 }: { data: number[]; height?: number }) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data);
  const mx = Math.max(...data);
  const range = mx - mn || 1;
  const w = 80;
  const h = height;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / range) * h}`)
    .join(" ");
  const last = data[data.length - 1];
  const first = data[0];
  const rising = last >= first;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke={rising ? "var(--positive)" : "var(--negative)"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RsBadge({ value, label }: { value: number | null; label: string }) {
  if (value == null) return <span className="text-[10px] text-[var(--muted)]">—</span>;
  const color = value > 0 ? "var(--positive)" : "var(--negative)";
  return (
    <span className="flex flex-col items-center">
      <span className="text-[10px] text-[var(--muted)]">{label}</span>
      <span className="text-xs font-mono font-bold" style={{ color }}>
        {value > 0 ? "+" : ""}{value.toFixed(1)}%
      </span>
    </span>
  );
}

function SignalBadge({ signal }: { signal: "BUY" | "WAIT" | "AVOID" }) {
  const styles: Record<string, string> = {
    BUY: "bg-[var(--positive)]/15 text-[var(--positive)] border-[var(--positive)]/30",
    WAIT: "bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30",
    AVOID: "bg-[var(--negative)]/15 text-[var(--negative)] border-[var(--negative)]/30",
  };
  const labels: Record<string, string> = { BUY: "COMPRA", WAIT: "ATTENDI", AVOID: "EVITA" };
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${styles[signal]}`}>
      {labels[signal]}
    </span>
  );
}

function ZoneBadge({ zone }: { zone: "lower" | "mid" | "upper" }) {
  const styles: Record<string, string> = {
    lower: "text-[var(--positive)]",
    mid: "text-[var(--muted)]",
    upper: "text-[var(--warning)]",
  };
  const labels: Record<string, string> = { lower: "↓ bassa", mid: "◆ media", upper: "↑ alta" };
  return <span className={`text-xs ${styles[zone]}`}>{labels[zone]}</span>;
}

/** Stato sintetico del canale sotto il grafico: z (posizione nel canale) + R². */
function ChannelState({ channel }: { channel: RegressionChannel }) {
  // z basso = vicino alla banda bassa (punto d'ingresso favorevole nella
  // strategia), z alto = ipercomprato dentro il canale.
  const zColor =
    channel.z <= 0.5 ? "var(--positive)" : channel.z <= 1.5 ? "var(--warning)" : "var(--negative)";
  const trendColor =
    channel.trend === "asc" ? "var(--positive)" : channel.trend === "desc" ? "var(--negative)" : "var(--muted)";
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono mt-0.5">
      <span style={{ color: trendColor }}>
        {channel.trend === "asc" ? "↗" : channel.trend === "desc" ? "↘" : "→"}
      </span>
      <span style={{ color: zColor }}>z {channel.z >= 0 ? "+" : ""}{channel.z.toFixed(2)}</span>
      <span className="text-[var(--muted)]">R² {(channel.r2 * 100).toFixed(0)}%</span>
      <span className="text-[var(--muted)]">{channel.slopePctPerDay >= 0 ? "+" : ""}{channel.slopePctPerDay.toFixed(2)}%/g</span>
    </div>
  );
}

// ─── Buy Modal ────────────────────────────────────────────────────────────────

function BuyModal({
  leader,
  indexKey,
  onClose,
  onDone,
}: {
  leader: MomentumLeader;
  indexKey: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { accountSize, riskPct } = useRisk();
  const suggested = positionSize(accountSize, riskPct, leader.entry, leader.stop);
  const [shares, setShares] = useState(String(suggested?.shares ?? 1));
  // Il prezzo di esecuzione parte dall'ULTIMO prezzo di mercato (live via
  // /api/quotes → Finnhub), non dalla chiusura giornaliera usata dall'analisi:
  // comprare alla chiusura stantia faceva risultare un P&L diverso da zero
  // appena aperta la posizione. Editabile; si congela se l'utente lo modifica.
  const [price, setPrice] = useState(String(leader.entry));
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const priceEdited = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/quotes?tickers=${leader.ticker}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = d?.prices?.[leader.ticker];
        if (alive && typeof p === "number" && p > 0) {
          setLivePrice(p);
          if (!priceEdited.current) setPrice(String(p));
        }
      })
      .catch(() => { /* offline: resta la chiusura dell'analisi, editabile */ });
    return () => { alive = false; };
  }, [leader.ticker]);

  const estCost = Number(shares) * Number(price);
  const estRisk = Number(shares) * (Number(price) - leader.stop);

  async function submit() {
    const s = Number(shares);
    const p = Number(price);
    if (!s || !p || s <= 0 || p <= 0) { setError("Shares e prezzo devono essere > 0"); return; }
    setSaving(true);
    setError(null);
    try {
      // Riancoraggio al prezzo di esecuzione: preserva le distanze % del canale
      // (stop sotto l'entry, target sopra) rispetto alla chiusura d'analisi, così
      // comprando a un prezzo diverso la posizione non nasce già "stoppata".
      const stopPct = leader.entry > 0 ? (leader.entry - leader.stop) / leader.entry : 0;
      const targetPct = leader.entry > 0 ? (leader.target - leader.entry) / leader.entry : 0;
      const stop = stopPct > 0 ? +(p * (1 - stopPct)).toFixed(2) : leader.stop;
      const target = targetPct > 0 ? +(p * (1 + targetPct)).toFixed(2) : leader.target;
      const res = await fetch("/api/momentum/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "BUY",
          indexKey,
          ticker: leader.ticker,
          name: leader.name,
          shares: s,
          price: p,
          stop,
          target,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Errore"); }
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="glass rounded-2xl border border-[var(--border)] p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[var(--foreground)]">
            Compra {leader.ticker}
            <span className="ml-1 text-sm text-[var(--muted)]">{leader.name}</span>
          </h3>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)] text-lg leading-none">✕</button>
        </div>

        <div className="mb-4 rounded-lg bg-[var(--surface-2)] p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-[var(--muted)]">RS Score</span><span className="font-mono font-bold text-[var(--positive)]">{leader.rsScore.composite > 0 ? "+" : ""}{leader.rsScore.composite.toFixed(1)}%</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Zona metatitolo</span><ZoneBadge zone={leader.zone} /></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Stop</span><span className="font-mono text-[var(--negative)]">{money(leader.stop)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Target</span><span className="font-mono text-[var(--positive)]">{money(leader.target)}</span></div>
          <div className="flex justify-between text-[var(--muted)]">
            <span>Rischio/trade ({riskPct}%)</span>
            <span className="font-mono">{money(accountSize * riskPct / 100)}</span>
          </div>
        </div>

        <label className="block mb-3">
          <span className="text-[10px] uppercase text-[var(--muted)] mb-1 block">Azioni</span>
          <input
            type="number"
            min="0"
            step="1"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            className="input w-full"
          />
        </label>

        <label className="block mb-4">
          <span className="text-[10px] uppercase text-[var(--muted)] mb-1 block">Prezzo eseguito</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => { setPrice(e.target.value); priceEdited.current = true; }}
            className="input w-full"
          />
          <span className="text-[10px] text-[var(--muted)] mt-1 block">
            {livePrice != null
              ? `Mercato ora: ${money(livePrice)} (live) · chiusura analisi ${money(leader.entry)}`
              : `Chiusura analisi: ${money(leader.entry)} — recupero prezzo live…`}
          </span>
        </label>

        <div className="mb-4 rounded-lg bg-[var(--surface-2)] p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-[var(--muted)]">Costo totale</span><span className="font-mono">{money(estCost)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Rischio stimato</span><span className="font-mono text-[var(--negative)]">{money(Math.max(0, estRisk))}</span></div>
        </div>

        {error && <p className="text-xs text-[var(--negative)] mb-3">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1">Annulla</button>
          <button onClick={submit} disabled={saving} className="btn-primary flex-1">
            {saving ? "Salvo…" : "✓ Conferma acquisto"}
          </button>
        </div>
      </div>
    </div>
  );
}
// ─── Leader Card ──────────────────────────────────────────────────────────────

function LeaderCard({
  leader,
  indexKey,
  held,
  onTrade,
}: {
  leader: MomentumLeader;
  indexKey: string;
  held?: HeldPosition;
  onTrade: () => void;
}) {
  const [buying, setBuying] = useState(false);
  const [selling, setSelling] = useState(false);
  const upside = leader.target > 0 ? ((leader.target - leader.entry) / leader.entry) * 100 : 0;
  const downside = leader.stop > 0 ? ((leader.entry - leader.stop) / leader.entry) * 100 : 0;
  const rr = downside > 0 ? upside / downside : 0;

  // Segnale per chi POSSIEDE il titolo: la regola di uscita della strategia è
  // la rottura del canale del metatitolo (trend non più ascendente), più lo
  // stop registrato sulla posizione. Il BUY/WAIT/AVOID vale solo per chi entra.
  const trendBroken = leader.metaChannel.trend !== "asc";
  const heldSignal: "HOLD" | "SELL" | null = held
    ? held.stopHit || trendBroken ? "SELL" : "HOLD"
    : null;
  const sellReason = held
    ? held.stopHit
      ? `⛔ Stop toccato (${held.stop != null ? money(held.stop) : "—"}).`
      : trendBroken
      ? "📉 Canale del metatitolo non più ascendente — rottura trend, regola di uscita della strategia."
      : null
    : null;

  const borderCls = held
    ? heldSignal === "SELL"
      ? "border-[var(--negative)]/50"
      : "border-[var(--accent)]/50"
    : leader.signal === "BUY"
    ? "border-[var(--positive)]/40"
    : leader.signal === "WAIT"
    ? "border-[var(--warning)]/30"
    : "border-[var(--border)]";

  return (
    <>
      {buying && (
        <BuyModal
          leader={leader}
          indexKey={indexKey}
          onClose={() => setBuying(false)}
          onDone={onTrade}
        />
      )}
      {selling && held && (
        <MomentumSellModal
          position={held}
          onClose={() => setSelling(false)}
          onDone={onTrade}
        />
      )}
      <div className={`card-hover rounded-xl border bg-[var(--surface)] p-4 flex flex-col gap-3 ${borderCls}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-base">{leader.ticker}</span>
              {held ? (
                <>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold border bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30">
                    💼 IN PORTAFOGLIO
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-md text-xs font-bold border ${
                      heldSignal === "SELL"
                        ? "bg-[var(--negative)]/15 text-[var(--negative)] border-[var(--negative)]/30"
                        : "bg-[var(--positive)]/15 text-[var(--positive)] border-[var(--positive)]/30"
                    }`}
                  >
                    {heldSignal === "SELL" ? "VENDI" : "MANTIENI"}
                  </span>
                </>
              ) : (
                <SignalBadge signal={leader.signal} />
              )}
            </div>
            <div className="text-xs text-[var(--muted)] truncate">{leader.name}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono font-bold">{money(leader.price)}</div>
            <div className="text-xs text-[var(--muted)]">
              <ZoneBadge zone={leader.zone} />
            </div>
          </div>
        </div>

        {/* Holdings — quanto ne teniamo e come sta andando */}
        {held && (
          <div className="rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/5 p-2.5 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">
                {held.shares} azioni @ {money(held.avgCost)}
              </span>
              <span className="font-mono">{money(held.marketValue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">P&L</span>
              <span className={`font-mono font-semibold ${held.unrealizedPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                {held.unrealizedPnl >= 0 ? "+" : ""}{money(held.unrealizedPnl)} ({held.unrealizedPnlPct >= 0 ? "+" : ""}{held.unrealizedPnlPct}%)
              </span>
            </div>
            {(held.stop != null || held.target != null) && (
              <div className="flex justify-between text-[var(--muted)]">
                <span>Stop → Target</span>
                <span className="font-mono">
                  <span className="text-[var(--negative)]">{held.stop != null ? money(held.stop) : "—"}</span>
                  {" → "}
                  <span className="text-[var(--positive)]">{held.target != null ? money(held.target) : "—"}</span>
                </span>
              </div>
            )}
            {sellReason && <p className="text-[var(--negative)] font-medium">{sellReason}</p>}
            {heldSignal === "HOLD" && held.targetHit && (
              <p className="text-[var(--warning)] font-medium">🎯 Target raggiunto — valuta la presa di profitto.</p>
            )}
            {heldSignal === "HOLD" && !held.targetHit && (
              <p className="text-[var(--positive)]">📈 Canale del metatitolo ancora ascendente: la tesi regge.</p>
            )}
          </div>
        )}

        {/* RS scores */}
        <div className="grid grid-cols-4 gap-2 rounded-lg bg-[var(--surface-2)] p-2">
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-[var(--muted)]">RS Score</span>
            <span
              className={`text-sm font-bold font-mono ${
                leader.rsScore.composite >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
              }`}
            >
              {leader.rsScore.composite >= 0 ? "+" : ""}{leader.rsScore.composite.toFixed(1)}%
            </span>
          </div>
          <RsBadge value={leader.rsScore.rs30d} label="30gg" />
          <RsBadge value={leader.rsScore.rs90d} label="90gg" />
          <RsBadge value={leader.rsScore.rs180d} label="180gg" />
        </div>

        {/* Canali di regressione: prezzo (40gg, da cui stop/target) e metatitolo
            (60gg, da cui il segnale). Bande a ±2σ, stato z/R² sotto ogni grafico.
            NB: ogni canale è fittato sulla propria finestra — le serie passate
            al grafico devono avere la stessa lunghezza del fit. */}
        <div className="grid grid-cols-1 gap-2">
          <div>
            <div className="text-[10px] text-[var(--muted)] mb-1">Canale prezzo (40gg) — stop/target</div>
            {leader.priceChannel ? (
              <>
                <ChannelChart closes={leader.spark.slice(-leader.priceChannel.n)} channel={leader.priceChannel} height={56} />
                <ChannelState channel={leader.priceChannel} />
              </>
            ) : (
              <MiniSparkline data={leader.spark} height={36} />
            )}
          </div>
          <div>
            <div className="text-[10px] text-[var(--muted)] mb-1">Canale metatitolo vs SPY (60gg) — segnale</div>
            <ChannelChart closes={leader.metaSpark.slice(-leader.metaChannel.n)} channel={leader.metaChannel} height={56} />
            <ChannelState channel={leader.metaChannel} />
          </div>
        </div>

        {/* Entry / stop / target */}
        <div className="grid grid-cols-3 gap-2 text-xs text-center border-t border-[var(--border)] pt-3">
          <div>
            <div className="text-[var(--muted)]">Entry</div>
            <div className="font-mono font-semibold">{money(leader.entry)}</div>
          </div>
          <div>
            <div className="text-[var(--muted)] text-[var(--negative)]">Stop</div>
            <div className="font-mono font-semibold text-[var(--negative)]">{money(leader.stop)}</div>
            <div className="text-[10px] text-[var(--muted)]">−{downside.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-[var(--muted)] text-[var(--positive)]">Target</div>
            <div className="font-mono font-semibold text-[var(--positive)]">{money(leader.target)}</div>
            <div className="text-[10px] text-[var(--muted)]">+{upside.toFixed(1)}%</div>
          </div>
        </div>

        {/* R/R + azione: Vendi per i posseduti, Compra per i BUY nuovi */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <span className="text-xs text-[var(--muted)]">
            R/R: <span className="font-mono text-[var(--foreground)]">{rr.toFixed(2)}</span>
          </span>
          {held ? (
            <button
              onClick={() => setSelling(true)}
              className={
                heldSignal === "SELL"
                  ? "btn-primary text-xs px-3 py-1.5 !bg-none !bg-[var(--negative)] !text-white"
                  : "btn-ghost text-xs px-3 py-1.5 border border-[var(--border)]"
              }
            >
              Vendi →
            </button>
          ) : (
            leader.signal === "BUY" && (
              <button onClick={() => setBuying(true)} className="btn-primary text-xs px-3 py-1.5">
                Compra →
              </button>
            )
          )}
        </div>
      </div>
    </>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function MomentumPage() {
  const [indexKey, setIndexKey] = useState("SP500");
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [leaders, setLeaders] = useState<MomentumLeader[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "BUY" | "WAIT" | "AVOID" | "HELD">("all");
  const [heldBy, setHeldBy] = useState<Record<string, HeldPosition>>({});

  // Posizioni Momentum aperte: servono per trasformare le card dei titoli già
  // posseduti da COMPRA a MANTIENI/VENDI. Ricaricate dopo ogni trade.
  const loadPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/momentum/trades", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, HeldPosition> = {};
      for (const p of (data.positions ?? []) as HeldPosition[]) map[p.ticker] = p;
      setHeldBy(map);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // Deferito di un tick: setState sincrono nel corpo dell'effect causa render a cascata.
    const t = setTimeout(loadPositions, 0);
    const id = setInterval(loadPositions, 30_000); // P&L live sulle card possedute
    return () => { clearTimeout(t); clearInterval(id); };
  }, [loadPositions]);

  function analyze() {
    setAnalyzing(true);
    setError(null);
    setLeaders(null);
    setProgress({ current: 0, total: 1, message: "Connessione…" });

    const es = new EventSource(`/api/momentum/analyze?index=${indexKey}`);
    es.addEventListener("progress", (e) => setProgress(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("complete", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setLeaders(data.leaders ?? []);
      es.close();
      setAnalyzing(false);
      setProgress(null);
    });
    es.addEventListener("error", (e) => {
      setError((e as MessageEvent).data ? JSON.parse((e as MessageEvent).data).message : "Connessione interrotta");
      es.close();
      setAnalyzing(false);
    });
  }

  const pctDone = progress && progress.total ? (progress.current / progress.total) * 100 : 0;

  const filtered = leaders
    ? filter === "all"
      ? leaders
      : filter === "HELD"
      ? leaders.filter((l) => heldBy[l.ticker])
      : leaders.filter((l) => l.signal === filter)
    : null;

  const buyCount = leaders?.filter((l) => l.signal === "BUY" && !heldBy[l.ticker]).length ?? 0;
  const waitCount = leaders?.filter((l) => l.signal === "WAIT").length ?? 0;
  const heldCount = leaders?.filter((l) => heldBy[l.ticker]).length ?? 0;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">⚡ Momentum RS</h1>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
          Calcola il metatitolo (stock÷SPY) per ogni costituente dell&apos;indice e applica canali di regressione
          sul rapporto. Segnale <strong>COMPRA</strong> quando il metatitolo è in trend ascendente vicino alla
          banda bassa — il titolo sta guidando il benchmark e si trova in un punto di forza relativa favorevole.
        </p>
      </header>

      {/* Control bar */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[var(--muted)]">Indice</span>
          <select
            value={indexKey}
            onChange={(e) => setIndexKey(e.target.value)}
            className="input"
            disabled={analyzing}
          >
            {INDICES.map((i) => (
              <option key={i.key} value={i.key}>{i.label}</option>
            ))}
          </select>
        </label>
        <button onClick={analyze} disabled={analyzing} className="btn-primary">
          {analyzing ? "Analisi in corso…" : "▶ Analizza"}
        </button>
        {leaders && (
          <div className="flex gap-1 ml-auto">
            {(["all", "HELD", "BUY", "WAIT", "AVOID"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                  filter === f
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)]"
                }`}
              >
                {f === "all" ? `Tutti (${leaders.length})` : f === "HELD" ? `💼 Posseduti (${heldCount})` : f === "BUY" ? `COMPRA (${buyCount})` : f === "WAIT" ? `ATTENDI (${waitCount})` : "EVITA"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Progress */}
      {analyzing && progress && (
        <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--muted)] mb-2">
            Calcolo metatitoli — {progress.message}
          </p>
          <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] transition-all duration-300"
              style={{ width: `${pctDone}%` }}
            />
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-1.5">
            {progress.current} / {progress.total} titoli
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-xl border border-[var(--negative)] bg-[var(--negative)]/10 p-4 text-sm text-[var(--negative)]">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!leaders && !analyzing && (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--muted)]">
          <p className="text-5xl mb-3">⚡</p>
          <p className="font-medium mb-2">Analisi metatitolo (Momentum RS)</p>
          <p className="text-sm max-w-sm mx-auto">
            Scegli un indice e premi Analizza. Il sistema calcola il rapporto stock/SPY per ogni titolo,
            applica canali di regressione sul metatitolo e li classifica per forza relativa composita.
          </p>
        </div>
      )}

      {/* Results grid */}
      {filtered && (
        <>
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted)]">
              Nessun titolo corrisponde al filtro selezionato.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide">
                  {filter === "all"
                    ? "Classifica per forza relativa"
                    : filter === "HELD"
                    ? "Le tue posizioni nella scan"
                    : `Filtro: ${filter === "BUY" ? "COMPRA" : filter === "WAIT" ? "ATTENDI" : "EVITA"}`}
                </h2>
                <span className="text-xs text-[var(--muted)]">
                  {filtered.length} titoli · benchmark: {INDICES.find((i) => i.key === indexKey)?.proxy}
                </span>
              </div>
              <div className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((l) => (
                  <LeaderCard key={l.ticker} leader={l} indexKey={indexKey} held={heldBy[l.ticker]} onTrade={loadPositions} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
