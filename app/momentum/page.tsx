"use client";

import { useCallback, useEffect, useState } from "react";
import { money, pct } from "@/lib/format";
import { useI18n } from "@/components/I18nProvider";
import { useRisk } from "@/components/RiskProvider";
import { positionSize } from "@/lib/risk";
import { INDICES } from "@/lib/indices";
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

interface Position {
  indexKey: string;
  ticker: string;
  name: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  stop: number | null;
  target: number | null;
  stopHit: boolean;
  targetHit: boolean;
}

interface MomentumTrade {
  id: number;
  ticker: string;
  name: string;
  action: string;
  shares: number;
  price: number;
  executedAt: string;
  realizedPnl: number | null;
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
  const [price, setPrice] = useState(String(leader.entry));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estCost = Number(shares) * Number(price);
  const estRisk = Number(shares) * (Number(price) - leader.stop);

  async function submit() {
    const s = Number(shares);
    const p = Number(price);
    if (!s || !p || s <= 0 || p <= 0) { setError("Shares e prezzo devono essere > 0"); return; }
    setSaving(true);
    setError(null);
    try {
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
          stop: leader.stop,
          target: leader.target,
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
            onChange={(e) => setPrice(e.target.value)}
            className="input w-full"
          />
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

// ─── Sell Modal ───────────────────────────────────────────────────────────────

function SellModal({
  position,
  onClose,
  onDone,
}: {
  position: Position;
  onClose: () => void;
  onDone: () => void;
}) {
  const [price, setPrice] = useState(String(position.currentPrice));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estPnl = (Number(price) - position.avgCost) * position.shares;

  async function submit() {
    const p = Number(price);
    if (!p || p <= 0) { setError("Prezzo deve essere > 0"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/momentum/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SELL",
          indexKey: position.indexKey.replace("MOMENTUM_", ""),
          ticker: position.ticker,
          shares: position.shares,
          price: p,
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
          <h3 className="font-semibold">Vendi {position.ticker}</h3>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)] text-lg leading-none">✕</button>
        </div>

        <div className="mb-4 rounded-lg bg-[var(--surface-2)] p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-[var(--muted)]">Azioni</span><span className="font-mono">{position.shares}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Costo medio</span><span className="font-mono">{money(position.avgCost)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">P&L non realizzato</span>
            <span className={`font-mono ${position.unrealizedPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
              {position.unrealizedPnl >= 0 ? "+" : ""}{money(position.unrealizedPnl)}
            </span>
          </div>
          {position.stopHit && <p className="text-[var(--negative)] font-medium">⛔ Stop colpito — considera di uscire</p>}
          {position.targetHit && <p className="text-[var(--positive)] font-medium">🎯 Target raggiunto — considera di prendere profitto</p>}
        </div>

        <label className="block mb-4">
          <span className="text-[10px] uppercase text-[var(--muted)] mb-1 block">Prezzo di vendita</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input w-full"
          />
        </label>

        <div className="mb-4 rounded-lg bg-[var(--surface-2)] p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">P&L stimato:</span>
            <span className={`font-mono font-bold ${estPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
              {estPnl >= 0 ? "+" : ""}{money(estPnl)}
            </span>
          </div>
        </div>

        {error && <p className="text-xs text-[var(--negative)] mb-3">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1">Annulla</button>
          <button onClick={submit} disabled={saving} className="btn-primary flex-1">
            {saving ? "Salvo…" : "✓ Conferma vendita"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Positions Panel ──────────────────────────────────────────────────────────

function PositionsPanel({
  positions,
  onChanged,
}: {
  positions: Position[];
  onChanged: () => void;
}) {
  const [selling, setSelling] = useState<Position | null>(null);

  if (positions.length === 0) return null;

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);

  return (
    <>
      {selling && (
        <SellModal
          position={selling}
          onClose={() => setSelling(null)}
          onDone={onChanged}
        />
      )}

      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide">
            ⚡ Posizioni aperte (Momentum RS)
          </h2>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-[var(--muted)]">Totale: <span className="font-mono text-[var(--foreground)]">{money(totalValue)}</span></span>
            <span className={totalPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
              {totalPnl >= 0 ? "+" : ""}{money(totalPnl)} P&L
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted)]">
                  <th className="text-left px-4 py-2">Titolo</th>
                  <th className="text-right px-4 py-2">Azioni</th>
                  <th className="text-right px-4 py-2">Costo medio</th>
                  <th className="text-right px-4 py-2">Prezzo</th>
                  <th className="text-right px-4 py-2">P&L</th>
                  <th className="text-right px-4 py-2">Stop → Target</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.ticker} className={`border-b border-[var(--border)] last:border-0 ${p.stopHit ? "bg-[var(--negative)]/5" : p.targetHit ? "bg-[var(--positive)]/5" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{p.ticker}</div>
                      <div className="text-[11px] text-[var(--muted)] truncate max-w-[120px]">{p.name}</div>
                      {p.stopHit && <span className="text-[10px] text-[var(--negative)] font-medium">⛔ Stop colpito</span>}
                      {p.targetHit && <span className="text-[10px] text-[var(--positive)] font-medium">🎯 Target raggiunto</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{p.shares}</td>
                    <td className="px-4 py-3 text-right font-mono">{money(p.avgCost)}</td>
                    <td className="px-4 py-3 text-right font-mono">{money(p.currentPrice)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className={`font-mono font-semibold ${p.unrealizedPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                        {p.unrealizedPnl >= 0 ? "+" : ""}{money(p.unrealizedPnl)}
                      </div>
                      <div className={`text-xs font-mono ${p.unrealizedPnlPct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                        {p.unrealizedPnlPct >= 0 ? "+" : ""}{p.unrealizedPnlPct.toFixed(2)}%
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono text-[var(--muted)]">
                      {p.stop != null ? money(p.stop) : "—"} → {p.target != null ? money(p.target) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelling(p)}
                        className="btn-ghost text-xs px-2 py-1 border border-[var(--border)]"
                      >
                        Vendi
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

// ─── Performance Summary ──────────────────────────────────────────────────────

function PerformancePanel({
  trades,
  totalPnl,
  winRate,
}: {
  trades: MomentumTrade[];
  totalPnl: number;
  winRate: number | null;
}) {
  const closed = trades.filter((t) => t.action === "SELL" && t.realizedPnl != null);
  if (closed.length === 0) return null;

  const wins = closed.filter((t) => (t.realizedPnl ?? 0) > 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.realizedPnl ?? 0), 0) / wins.length : 0;
  const losses = closed.filter((t) => (t.realizedPnl ?? 0) <= 0);
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.realizedPnl ?? 0), 0) / losses.length : 0;

  return (
    <section className="mb-6">
      <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">
        📈 Performance (Momentum RS)
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "P&L realizzato", value: totalPnl, isMoney: true, colored: true },
          { label: "Win rate", value: winRate != null ? winRate.toFixed(1) + "%" : "—", isMoney: false },
          { label: "Trade chiusi", value: closed.length, isMoney: false },
          { label: "Media vincita", value: avgWin, isMoney: true, colored: true },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-[10px] uppercase text-[var(--muted)] mb-1">{stat.label}</p>
            <p
              className={`text-xl font-bold font-mono ${
                stat.colored
                  ? (typeof stat.value === "number" && stat.value >= 0)
                    ? "text-[var(--positive)]"
                    : "text-[var(--negative)]"
                  : "text-[var(--foreground)]"
              }`}
            >
              {stat.isMoney && typeof stat.value === "number"
                ? (stat.value >= 0 ? "+" : "") + money(stat.value)
                : stat.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Trade History ────────────────────────────────────────────────────────────

function TradeHistoryPanel({ trades }: { trades: MomentumTrade[] }) {
  const relevant = trades.slice(0, 50);
  if (relevant.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">
        📋 Storico operazioni (Momentum RS)
      </h2>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted)]">
                <th className="text-left px-4 py-2">Data</th>
                <th className="text-left px-4 py-2">Titolo</th>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-right px-4 py-2">Azioni</th>
                <th className="text-right px-4 py-2">Prezzo</th>
                <th className="text-right px-4 py-2">P&L</th>
              </tr>
            </thead>
            <tbody>
              {relevant.map((t) => (
                <tr key={t.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2.5 text-xs text-[var(--muted)]">
                    {new Date(t.executedAt).toLocaleDateString("it-IT")}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold">{t.ticker}</span>
                    <span className="ml-1 text-xs text-[var(--muted)] hidden sm:inline">{t.name}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        t.action === "BUY"
                          ? "bg-[var(--positive)]/15 text-[var(--positive)]"
                          : "bg-[var(--negative)]/15 text-[var(--negative)]"
                      }`}
                    >
                      {t.action === "BUY" ? "COMPRA" : "VENDI"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{t.shares}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{money(t.price)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {t.realizedPnl != null ? (
                      <span
                        className={`font-mono text-xs font-semibold ${
                          t.realizedPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
                        }`}
                      >
                        {t.realizedPnl >= 0 ? "+" : ""}{money(t.realizedPnl)}
                      </span>
                    ) : (
                      <span className="text-[var(--muted)] text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ─── Leader Card ──────────────────────────────────────────────────────────────

function LeaderCard({
  leader,
  indexKey,
  onTrade,
}: {
  leader: MomentumLeader;
  indexKey: string;
  onTrade: () => void;
}) {
  const [buying, setBuying] = useState(false);
  const upside = leader.target > 0 ? ((leader.target - leader.entry) / leader.entry) * 100 : 0;
  const downside = leader.stop > 0 ? ((leader.entry - leader.stop) / leader.entry) * 100 : 0;
  const rr = downside > 0 ? upside / downside : 0;

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
      <div
        className={`rounded-xl border bg-[var(--surface)] p-4 flex flex-col gap-3 ${
          leader.signal === "BUY"
            ? "border-[var(--positive)]/40"
            : leader.signal === "WAIT"
            ? "border-[var(--warning)]/30"
            : "border-[var(--border)]"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-base">{leader.ticker}</span>
              <SignalBadge signal={leader.signal} />
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

        {/* Meta-channel info */}
        <div className="grid grid-cols-3 gap-2 text-xs text-center">
          <div className="rounded-lg bg-[var(--surface-2)] p-2">
            <div className="text-[var(--muted)] mb-0.5">Metatitolo</div>
            <div className="font-mono font-semibold">{leader.metaValue.toFixed(4)}</div>
          </div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2">
            <div className="text-[var(--muted)] mb-0.5">Trend meta</div>
            <div className={`font-semibold ${leader.metaChannel.trend === "asc" ? "text-[var(--positive)]" : leader.metaChannel.trend === "desc" ? "text-[var(--negative)]" : "text-[var(--muted)]"}`}>
              {leader.metaChannel.trend === "asc" ? "↗ asc" : leader.metaChannel.trend === "desc" ? "↘ disc" : "→ flat"}
            </div>
          </div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2">
            <div className="text-[var(--muted)] mb-0.5">R² meta</div>
            <div className="font-mono font-semibold">{(leader.metaChannel.r2 * 100).toFixed(0)}%</div>
          </div>
        </div>

        {/* Sparklines */}
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <div className="text-[10px] text-[var(--muted)] mb-1">Prezzo (60gg)</div>
            <MiniSparkline data={leader.spark} height={36} />
          </div>
          <div className="flex-1">
            <div className="text-[10px] text-[var(--muted)] mb-1">Metatitolo vs SPY</div>
            <MiniSparkline data={leader.metaSpark} height={36} />
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

        {/* R/R and buy button */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <span className="text-xs text-[var(--muted)]">
            R/R: <span className="font-mono text-[var(--foreground)]">{rr.toFixed(2)}</span>
          </span>
          {leader.signal === "BUY" && (
            <button onClick={() => setBuying(true)} className="btn-primary text-xs px-3 py-1.5">
              Compra →
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Equity Chart (SVG) ───────────────────────────────────────────────────────

function EquityChart({
  strategy,
  spy,
  accountSize,
}: {
  strategy: { date: string; equity: number }[];
  spy: { date: string; equity: number }[];
  accountSize: number;
}) {
  if (strategy.length < 2) return null;

  const W = 600;
  const H = 200;
  const PAD = { top: 16, right: 16, bottom: 28, left: 56 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const allEquity = [...strategy.map((p) => p.equity), ...spy.map((p) => p.equity), accountSize];
  const minE = Math.min(...allEquity) * 0.995;
  const maxE = Math.max(...allEquity) * 1.005;

  function toX(i: number, total: number) { return PAD.left + (i / (total - 1)) * innerW; }
  function toY(v: number) { return PAD.top + ((maxE - v) / (maxE - minE)) * innerH; }

  function polyline(pts: { date: string; equity: number }[], color: string, dashed = false) {
    const d = pts.map((p, i) => `${toX(i, pts.length)},${toY(p.equity)}`).join(" ");
    return (
      <polyline
        points={d}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeDasharray={dashed ? "5,4" : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  // Drawdown fill under strategy curve
  const ddPath = strategy
    .map((p, i) => {
      const x = toX(i, strategy.length);
      const y = toY(p.equity);
      const yBase = toY(Math.max(p.equity, Math.max(...strategy.slice(0, i + 1).map((q) => q.equity))));
      return i === 0 ? `M${x},${yBase} L${x},${y}` : `L${x},${yBase} L${x},${y}`;
    })
    .join(" ");

  // Y-axis ticks
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => minE + ((maxE - minE) * i) / ticks);

  // X-axis labels (start / mid / end)
  const xLabels = [
    { i: 0, label: strategy[0].date.slice(0, 7) },
    { i: Math.floor(strategy.length / 2), label: strategy[Math.floor(strategy.length / 2)]?.date.slice(0, 7) ?? "" },
    { i: strategy.length - 1, label: strategy[strategy.length - 1].date.slice(0, 7) },
  ];

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, minWidth: 300 }}>
        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.left - 4} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="var(--muted)">
              {v >= 10000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`}
            </text>
          </g>
        ))}
        {/* Baseline */}
        <line x1={PAD.left} y1={toY(accountSize)} x2={W - PAD.right} y2={toY(accountSize)} stroke="var(--muted)" strokeWidth="0.8" strokeDasharray="3,3" />
        {/* SPY */}
        {spy.length > 1 && polyline(spy, "var(--warning)", true)}
        {/* Strategy */}
        {polyline(strategy, "var(--accent)")}
        {/* X labels */}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={toX(i, strategy.length)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted)">
            {label}
          </text>
        ))}
        {/* Legend */}
        <line x1={PAD.left} y1={H - 6} x2={PAD.left + 16} y2={H - 6} stroke="var(--accent)" strokeWidth="2" />
        <text x={PAD.left + 20} y={H - 3} fontSize="9" fill="var(--accent)">Strategia</text>
        <line x1={PAD.left + 72} y1={H - 6} x2={PAD.left + 88} y2={H - 6} stroke="var(--warning)" strokeWidth="2" strokeDasharray="4,3" />
        <text x={PAD.left + 92} y={H - 3} fontSize="9" fill="var(--warning)">SPY B&H</text>
      </svg>
    </div>
  );
}

// ─── Backtest Panel ───────────────────────────────────────────────────────────

interface BtSummary {
  trades: number; wins: number; losses: number; winRate: number;
  avgWin: number; avgLoss: number; profitFactor: number; expectancy: number;
  maxDrawdown: number; totalReturn: number; cagr: number; finalEquity: number;
  byOutcome: { target: number; stop: number; time: number };
}
interface BtTrade {
  ticker: string; entryDate: string; entryPrice: number;
  exitDate: string; exitPrice: number; pnl: number; returnPct: number; outcome: string;
}
interface BtResult {
  summary: BtSummary;
  equity: { date: string; equity: number }[];
  spyEquity: { date: string; equity: number }[];
  sharpe: number; calmar: number;
  trades: BtTrade[];
  signalsTotal: number; signalsTaken: number; tickersTested: number;
  options: { accountSize: number; [k: string]: unknown };
}

function BacktestPanel({ indexKey }: { indexKey: string }) {
  const { t } = useI18n();
  const { accountSize, riskPct } = useRisk();

  const today = new Date().toISOString().slice(0, 10);
  const twoYearsAgo = new Date(Date.now() - 2 * 365.25 * 86_400_000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(twoYearsAgo);
  const [endDate, setEndDate] = useState(today);
  const [account, setAccount] = useState(String(accountSize));
  const [risk, setRisk] = useState(String(riskPct));
  const [maxHold, setMaxHold] = useState("20");   // max hold bars
  const [maxPositions, setMaxPositions] = useState("5");
  const [topN, setTopN] = useState("5");           // top-N per scan
  const [scanFreq, setScanFreq] = useState("5");  // scan every N bars (5 = weekly)
  const [stopAtr, setStopAtr] = useState("2");
  const [targetAtr, setTargetAtr] = useState("3");

  const [running, setBtRunning] = useState(false);
  const [btProgress, setBtProgress] = useState("");
  const [result, setResult] = useState<BtResult | null>(null);
  const [btError, setBtError] = useState<string | null>(null);

  function runBt() {
    setBtRunning(true);
    setBtError(null);
    setResult(null);
    setBtProgress("Connessione…");

    const qs = new URLSearchParams({
      index: indexKey,
      start: startDate,
      end: endDate,
      account,
      risk,
      hold: maxHold,
      maxpos: maxPositions,
      topN,
      freq: scanFreq,
      stopAtr,
      targetAtr,
    }).toString();

    const es = new EventSource(`/api/momentum/backtest?${qs}`);
    es.addEventListener("progress", (e) => setBtProgress(JSON.parse((e as MessageEvent).data).message ?? "…"));
    es.addEventListener("complete", (e) => {
      setResult(JSON.parse((e as MessageEvent).data));
      es.close();
      setBtRunning(false);
    });
    es.addEventListener("error", (e) => {
      setBtError((e as MessageEvent).data ? JSON.parse((e as MessageEvent).data).message : "Errore");
      es.close();
      setBtRunning(false);
    });
  }

  const s = result?.summary;

  const spyFinalEquity = result?.spyEquity.length
    ? result.spyEquity[result.spyEquity.length - 1].equity
    : null;
  const spyReturn = spyFinalEquity && result
    ? (((spyFinalEquity - result.options.accountSize) / result.options.accountSize) * 100).toFixed(1)
    : null;

  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide">
          🧪 Backtest Momentum RS
        </h2>
      </div>

      {/* Config */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-4">
        <p className="text-xs text-[var(--muted)] mb-4">
          Simula la strategia metatitolo su un intervallo personalizzato.
          Stop/target dal canale di regressione, slippage 5bps, 1 posizione per ticker.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Data inizio</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input text-sm" disabled={running} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Data fine</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input text-sm" disabled={running} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Capitale ($)</span>
            <input type="number" min="1000" step="1000" value={account} onChange={(e) => setAccount(e.target.value)} className="input text-sm" disabled={running} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Rischio/trade %</span>
            <input type="number" min="0.1" max="5" step="0.1" value={risk} onChange={(e) => setRisk(e.target.value)} className="input text-sm" disabled={running} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Max posizioni</span>
            <input type="number" min="1" max="20" step="1" value={maxPositions} onChange={(e) => setMaxPositions(e.target.value)} className="input text-sm" disabled={running} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Top-N per scansione</span>
            <input type="number" min="1" max="15" step="1" value={topN} onChange={(e) => setTopN(e.target.value)} className="input text-sm" disabled={running} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Scansione (barre)</span>
            <select value={scanFreq} onChange={(e) => setScanFreq(e.target.value)} className="input text-sm" disabled={running}>
              <option value="1">1 (giornaliera)</option>
              <option value="5">5 (settimanale)</option>
              <option value="10">10 (bisettimanale)</option>
              <option value="21">21 (mensile)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Max hold (barre)</span>
            <input type="number" min="5" max="120" step="5" value={maxHold} onChange={(e) => setMaxHold(e.target.value)} className="input text-sm" disabled={running} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Stop (× ATR)</span>
            <input type="number" min="0.5" max="5" step="0.5" value={stopAtr} onChange={(e) => setStopAtr(e.target.value)} className="input text-sm" disabled={running} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Target (× ATR)</span>
            <input type="number" min="1" max="8" step="0.5" value={targetAtr} onChange={(e) => setTargetAtr(e.target.value)} className="input text-sm" disabled={running} />
          </label>
        </div>

        <button onClick={runBt} disabled={running} className="btn-primary">
          {running ? "Backtest in corso…" : "🧪 Avvia backtest"}
        </button>
      </div>

      {/* Progress */}
      {running && (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
          ⏳ {btProgress}
        </div>
      )}

      {/* Error */}
      {btError && (
        <div className="mb-4 rounded-xl border border-[var(--negative)] bg-[var(--negative)]/10 p-3 text-sm text-[var(--negative)]">
          {btError}
        </div>
      )}

      {/* Results */}
      {result && s && (
        <>
          {/* Coverage */}
          <div className="mb-4 text-xs text-[var(--muted)] rounded-lg bg-[var(--surface)] border border-[var(--border)] p-3">
            <span className="font-medium text-[var(--foreground)]">{result.tickersTested}</span> titoli testati ·{" "}
            <span className="font-medium text-[var(--foreground)]">{result.signalsTaken}</span> trade eseguiti su{" "}
            <span className="font-medium">{result.signalsTotal}</span> segnali ·{" "}
            🎯 {s.byOutcome.target} target · ⛔ {s.byOutcome.stop} stop · ⏱ {s.byOutcome.time} a tempo
          </div>

          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: "Rendimento totale", value: s.totalReturn, suffix: "%", colored: true, bold: true },
              { label: "SPY buy & hold", value: spyReturn ? parseFloat(spyReturn) : null, suffix: "%", colored: true },
              { label: "CAGR", value: s.cagr, suffix: "%", colored: true },
              { label: "Capitale finale", value: s.finalEquity, prefix: "$", isMoney: true },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-[10px] uppercase text-[var(--muted)] mb-1">{m.label}</p>
                <p className={`text-xl font-bold font-mono ${
                  m.colored && m.value != null
                    ? m.value >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
                    : "text-[var(--foreground)]"
                }`}>
                  {m.value == null ? "—"
                    : m.isMoney ? `$${m.value.toLocaleString()}`
                    : `${m.value >= 0 && m.colored ? "+" : ""}${m.value}${m.suffix ?? ""}`}
                </p>
              </div>
            ))}
          </div>

          {/* Risk metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Sharpe Ratio", value: result.sharpe, note: "> 1 buono, > 2 eccellente" },
              { label: "Calmar Ratio", value: result.calmar, note: "CAGR / Max DD" },
              { label: "Max Drawdown", value: `-${s.maxDrawdown}%`, note: "dal picco" },
              { label: "Profit Factor", value: s.profitFactor, note: "> 1.5 = buon edge" },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-[10px] uppercase text-[var(--muted)] mb-1">{m.label}</p>
                <p className="text-xl font-bold font-mono text-[var(--foreground)]">{m.value}</p>
                <p className="text-[10px] text-[var(--muted)] mt-0.5">{m.note}</p>
              </div>
            ))}
          </div>

          {/* Trade stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Win rate", value: `${s.winRate}%` },
              { label: "Expectancy (R)", value: s.expectancy },
              { label: "Media vincita", value: `+${s.avgWin}%` },
              { label: "Media perdita", value: `${s.avgLoss}%` },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-[10px] uppercase text-[var(--muted)] mb-1">{m.label}</p>
                <p className="text-lg font-bold font-mono text-[var(--foreground)]">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Equity chart */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6">
            <p className="text-sm font-medium mb-3">📈 Equity curve — Strategia vs S&P 500 buy & hold</p>
            <EquityChart
              strategy={result.equity}
              spy={result.spyEquity}
              accountSize={result.options.accountSize}
            />
          </div>

          {/* Trade log */}
          {result.trades.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <p className="text-sm font-medium">📋 Ultime operazioni simulate (max 200)</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted)]">
                      <th className="text-left px-3 py-2">Ticker</th>
                      <th className="text-left px-3 py-2">Entrata</th>
                      <th className="text-left px-3 py-2">Uscita</th>
                      <th className="text-right px-3 py-2">Giorni</th>
                      <th className="text-right px-3 py-2">Rendimento</th>
                      <th className="text-right px-3 py-2">P&L</th>
                      <th className="text-center px-3 py-2">Esito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.trades].reverse().slice(0, 100).map((tr, i) => {
                      const days = Math.round(
                        (new Date(tr.exitDate).getTime() - new Date(tr.entryDate).getTime()) / 86_400_000
                      );
                      return (
                        <tr key={i} className="border-b border-[var(--border)] last:border-0">
                          <td className="px-3 py-2 font-semibold">{tr.ticker}</td>
                          <td className="px-3 py-2 text-[var(--muted)]">{tr.entryDate}</td>
                          <td className="px-3 py-2 text-[var(--muted)]">{tr.exitDate}</td>
                          <td className="px-3 py-2 text-right font-mono">{days}</td>
                          <td className={`px-3 py-2 text-right font-mono font-semibold ${tr.returnPct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                            {tr.returnPct >= 0 ? "+" : ""}{tr.returnPct.toFixed(2)}%
                          </td>
                          <td className={`px-3 py-2 text-right font-mono ${tr.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                            {tr.pnl >= 0 ? "+" : ""}{money(tr.pnl)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              tr.outcome === "target" ? "bg-[var(--positive)]/15 text-[var(--positive)]"
                              : tr.outcome === "stop" ? "bg-[var(--negative)]/15 text-[var(--negative)]"
                              : "bg-[var(--muted)]/15 text-[var(--muted)]"
                            }`}>
                              {tr.outcome === "target" ? "🎯" : tr.outcome === "stop" ? "⛔" : "⏱"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}



export default function MomentumPage() {
  const { t } = useI18n();
  const [indexKey, setIndexKey] = useState("SP500");
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [leaders, setLeaders] = useState<MomentumLeader[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "BUY" | "WAIT" | "AVOID">("all");

  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<MomentumTrade[]>([]);
  const [totalPnl, setTotalPnl] = useState(0);
  const [winRate, setWinRate] = useState<number | null>(null);

  const loadPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/momentum/trades", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setPositions(data.positions ?? []);
      setTrades(data.trades ?? []);
      setTotalPnl(data.totalPnl ?? 0);
      setWinRate(data.winRate ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadPortfolio();
    const id = setInterval(loadPortfolio, 30_000);
    return () => clearInterval(id);
  }, [loadPortfolio]);

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
      : leaders.filter((l) => l.signal === filter)
    : null;

  const buyCount = leaders?.filter((l) => l.signal === "BUY").length ?? 0;
  const waitCount = leaders?.filter((l) => l.signal === "WAIT").length ?? 0;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">⚡ Momentum RS</h1>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
          Calcola il metatitolo (stock÷SPY) per ogni costituente dell'indice e applica canali di regressione
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
            {(["all", "BUY", "WAIT", "AVOID"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                  filter === f
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)]"
                }`}
              >
                {f === "all" ? `Tutti (${leaders.length})` : f === "BUY" ? `COMPRA (${buyCount})` : f === "WAIT" ? `ATTENDI (${waitCount})` : "EVITA"}
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

      {/* Open positions */}
      <PositionsPanel positions={positions} onChanged={loadPortfolio} />

      {/* Performance summary */}
      <PerformancePanel trades={trades} totalPnl={totalPnl} winRate={winRate} />

      {/* Trade history */}
      <TradeHistoryPanel trades={trades} />

      {/* Backtest */}
      <BacktestPanel indexKey={indexKey} />

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
                  {filter === "all" ? "Classifica per forza relativa" : `Filtro: ${filter}`}
                </h2>
                <span className="text-xs text-[var(--muted)]">
                  {filtered.length} titoli · benchmark: {INDICES.find((i) => i.key === indexKey)?.proxy}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((l) => (
                  <LeaderCard key={l.ticker} leader={l} indexKey={indexKey} onTrade={loadPortfolio} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
