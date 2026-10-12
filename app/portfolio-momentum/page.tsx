"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { money } from "@/lib/format";
import { LoadingPanel } from "@/components/Loading";
import { MomentumSellModal } from "@/components/MomentumSellModal";
import { PortfolioEquityPanel } from "@/components/PortfolioEquityPanel";
import { ChannelChart } from "@/components/ChannelChart";
import { useLivePrices, LivePrice, LiveBadge, applyLivePrices } from "@/components/LivePrice";
import type { MarketStatus } from "@/lib/marketHours";
import type { RegressionChannel } from "@/lib/regression";

interface Position {
  indexKey: string;
  ticker: string;
  name: string;
  shares: number;
  avgCost: number;
  priceStale?: boolean;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  stop: number | null;
  target: number | null;
  stopHit: boolean;
  targetHit: boolean;
  buyDate?: string;
  postBuySpark?: number[];
  postBuyChannel?: RegressionChannel | null;
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

// ─── Positions Panel ──────────────────────────────────────────────────────────

function PositionsPanel({
  positions,
  onChanged,
  market,
}: {
  positions: Position[];
  onChanged: () => void;
  market?: MarketStatus;
}) {
  const [selling, setSelling] = useState<Position | null>(null);

  if (positions.length === 0) {
    return (
      <section className="mb-6 rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--muted)]">
        <p className="text-4xl mb-3">⚡</p>
        <p className="font-medium mb-1">Nessuna posizione aperta</p>
        <p className="text-sm">Compra un titolo dalla pagina Momentum RS per vederlo qui.</p>
      </section>
    );
  }

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);

  return (
    <>
      {selling && (
        <MomentumSellModal
          position={selling}
          onClose={() => setSelling(null)}
          onDone={onChanged}
        />
      )}

      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide flex items-center gap-2">
            ⚡ Posizioni aperte (Momentum RS)
            {market && <LiveBadge market={market} />}
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
                  <th className="text-center px-4 py-2">Trend dal buy</th>
                  <th className="text-right px-4 py-2">Stop → Target</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const ch = p.postBuyChannel;
                  const trendColor = ch
                    ? ch.trend === "asc" ? "var(--positive)" : ch.trend === "desc" ? "var(--negative)" : "var(--muted)"
                    : "var(--muted)";
                  return (
                  <tr key={p.ticker} className={`border-b border-[var(--border)] last:border-0 ${p.stopHit ? "bg-[var(--negative)]/5" : p.targetHit ? "bg-[var(--positive)]/5" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{p.ticker}</div>
                      <div className="text-[11px] text-[var(--muted)] truncate max-w-[120px]">{p.name}</div>
                      {p.stopHit && <span className="text-[10px] text-[var(--negative)] font-medium">⛔ Stop colpito</span>}
                      {p.targetHit && <span className="text-[10px] text-[var(--positive)] font-medium">🎯 Target raggiunto</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{p.shares}</td>
                    <td className="px-4 py-3 text-right font-mono">{money(p.avgCost)}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {p.priceStale && <span title="Quote live non disponibile: mostrato il costo medio" className="text-[var(--warning)] mr-1">⚠</span>}
                      <LivePrice price={p.currentPrice} format={money} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className={`font-mono font-semibold ${p.unrealizedPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                        {p.unrealizedPnl >= 0 ? "+" : ""}{money(p.unrealizedPnl)}
                      </div>
                      <div className={`text-xs font-mono ${p.unrealizedPnlPct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                        {p.unrealizedPnlPct >= 0 ? "+" : ""}{p.unrealizedPnlPct.toFixed(2)}%
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {ch && p.postBuySpark && p.postBuySpark.length >= 10 ? (
                        <div className="w-[150px] mx-auto" title="Prezzo e canale di regressione (±2σ) dal giorno dell'acquisto">
                          <ChannelChart closes={p.postBuySpark} channel={ch} width={150} height={46} />
                          <div className="text-[9px] font-mono mt-0.5 text-center" style={{ color: trendColor }}>
                            {ch.trend === "asc" ? "↗ trend su" : ch.trend === "desc" ? "↘ trend giù" : "→ laterale"}
                            <span className="text-[var(--muted)]"> · R² {(ch.r2 * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[10px] text-[var(--muted)] text-center w-[150px] mx-auto">
                          poche barre dal buy
                        </div>
                      )}
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
                  );
                })}
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

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function PortfolioMomentumPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<MomentumTrade[]>([]);
  const [totalPnl, setTotalPnl] = useState(0);
  const [winRate, setWinRate] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false); // primo fetch completato: prima mostra lo spinner, non l'empty state

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
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Primo load deferito di un tick: setState sincrono nel corpo dell'effect
    // causa render a cascata (regola react-hooks). Struttura posizioni/trade
    // ricaricata ogni 30s; i prezzi live arrivano dal polling più frequente.
    const t = setTimeout(loadPortfolio, 0);
    const id = setInterval(loadPortfolio, 30_000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [loadPortfolio]);

  // Prezzi live ~5s: aggiorna prezzo e P&L delle posizioni senza ricaricare tutto.
  const { prices: livePrices, market } = useLivePrices(positions.map((p) => p.ticker));
  const livePositions = useMemo(
    () => applyLivePrices(positions, livePrices),
    [positions, livePrices],
  );

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">⚡ Portfolio Momentum RS</h1>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
          Posizioni e performance della strategia Momentum RS (forza relativa contro l&apos;indice).
        </p>
      </header>

      <PortfolioEquityPanel strategy="momentum" />

      {!loaded ? (
        <LoadingPanel label="Carico il portafoglio…" />
      ) : (
        <>
          <PositionsPanel positions={livePositions} onChanged={loadPortfolio} market={market} />
          <PerformancePanel trades={trades} totalPnl={totalPnl} winRate={winRate} />
          <TradeHistoryPanel trades={trades} />
        </>
      )}

    </div>
  );
}
