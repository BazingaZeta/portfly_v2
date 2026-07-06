"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/format";
import { useI18n } from "@/components/I18nProvider";
import { useRisk } from "@/components/RiskProvider";
import { INDICES } from "@/lib/indices";
import { LoadingPanel } from "@/components/Loading";

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
                    <td className="px-4 py-3 text-right font-mono">{p.priceStale && <span title="Quote live non disponibile: mostrato il costo medio" className="text-[var(--warning)] mr-1">⚠</span>}{money(p.currentPrice)}</td>
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
interface WfPeriod { start: string; end: string; summary: BtSummary; }
interface WfReport {
  periods: WfPeriod[];
  medianExpectancy: number;
  worstProfitFactor: number;
  positivePeriods: number;
}
interface BtResult {
  summary: BtSummary;
  equity: { date: string; equity: number }[];
  spyEquity: { date: string; equity: number }[];
  sharpe: number; calmar: number;
  walkForward?: WfReport;
  trades: BtTrade[];
  signalsTotal: number; signalsTaken: number; tickersTested: number;
  options: { accountSize: number; [k: string]: unknown };
}

function BacktestPanel({ indexKey }: { indexKey: string }) {
  const { t } = useI18n();
  const { accountSize, riskPct } = useRisk();

  // Lazy init: niente chiamate impure nel corpo del render.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [startDate, setStartDate] = useState(() =>
    new Date(Date.now() - 2 * 365.25 * 86_400_000).toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState(today);
  const [account, setAccount] = useState(String(accountSize));
  const [risk, setRisk] = useState(String(riskPct));
  // Default = config v3 validata walk-forward (ogni fold PF ≥ 1, 2021-2026).
  const [maxHold, setMaxHold] = useState("120");  // time-stop lungo: col trailing si cavalca il winner
  const [maxPositions, setMaxPositions] = useState("5");
  const [topN, setTopN] = useState("5");           // top-N per scan
  const [scanFreq, setScanFreq] = useState("10"); // scan every N bars
  const [stopAtr, setStopAtr] = useState("2.5");
  const [targetAtr, setTargetAtr] = useState("3");
  const [minR2, setMinR2] = useState("0.7");
  const [maxZ, setMaxZ] = useState("0.5"); // "off" = nessun gate z
  const [stopMode, setStopMode] = useState<"channel" | "atr">("channel");
  const [useRegime, setUseRegime] = useState(true);
  const [folds, setFolds] = useState("5");
  const [trail, setTrail] = useState("3");   // trailing chandelier (× ATR), "off" = target fisso
  const [trendExit, setTrendExit] = useState(true);
  const [sizing, setSizing] = useState<"risk" | "equal">("equal");
  const [w30, setW30] = useState("0.2");
  const [w90, setW90] = useState("0.5");
  const [w180, setW180] = useState("0.3");

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
      r2: minR2,
      maxZ, // "off" → nessun gate z
      stopMode,
      regime: useRegime ? "1" : "0",
      folds,
      w30,
      w90,
      w180,
      trail,
      trendExit: trendExit ? "1" : "0",
      sizing,
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
          Simula la strategia metatitolo su un intervallo personalizzato (storico ~5 anni, bear 2022
          incluso). Default = <strong>config v3 validata walk-forward</strong> (ogni sotto-periodo
          2021-2026 con PF ≥ 1): canale meta pulito R² ≥ 0.7 + z ≤ 0.5, regime SPY &gt; SMA200,
          trailing 3 × ATR con uscita su rottura del trend (niente target fisso), equal weight.
          Equity marcata a mercato ogni giorno, slippage 5 bps anche sugli stop.
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
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Stop/target da</span>
            <select value={stopMode} onChange={(e) => setStopMode(e.target.value as "channel" | "atr")} className="input text-sm" disabled={running}>
              <option value="channel">Canale prezzo (live)</option>
              <option value="atr">ATR</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Gate z metatitolo</span>
            <select value={maxZ} onChange={(e) => setMaxZ(e.target.value)} className="input text-sm" disabled={running}>
              <option value="0.5">z ≤ 0.5 (live)</option>
              <option value="1">z ≤ 1.0</option>
              <option value="1.5">z ≤ 1.5</option>
              <option value="off">off (nessun gate)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">R² minimo canale</span>
            <input type="number" min="0" max="0.95" step="0.05" value={minR2} onChange={(e) => setMinR2(e.target.value)} className="input text-sm" disabled={running} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Walk-forward (periodi)</span>
            <select value={folds} onChange={(e) => setFolds(e.target.value)} className="input text-sm" disabled={running}>
              <option value="0">off</option>
              <option value="3">3</option>
              <option value="5">5</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm self-end pb-2">
            <input type="checkbox" checked={useRegime} onChange={(e) => setUseRegime(e.target.checked)} disabled={running} />
            <span className="text-xs">Regime (SPY &gt; SMA200)</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Trailing stop (× ATR)</span>
            <select value={trail} onChange={(e) => setTrail(e.target.value)} className="input text-sm" disabled={running}>
              <option value="off">off (target fisso)</option>
              <option value="2.5">2.5</option>
              <option value="3">3 (cavalca il winner)</option>
              <option value="4">4 (largo)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm self-end pb-2">
            <input type="checkbox" checked={trendExit} onChange={(e) => setTrendExit(e.target.checked)} disabled={running} />
            <span className="text-xs">Esci se il trend meta si rompe</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Sizing posizioni</span>
            <select value={sizing} onChange={(e) => setSizing(e.target.value as "risk" | "equal")} className="input text-sm" disabled={running}>
              <option value="risk">Rischio fisso (× ATR)</option>
              <option value="equal">Equal weight (capitale/N)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Peso RS 30 barre</span>
            <input type="number" min="0" max="1" step="0.05" value={w30} onChange={(e) => setW30(e.target.value)} className="input text-sm" disabled={running} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Peso RS 90 barre</span>
            <input type="number" min="0" max="1" step="0.05" value={w90} onChange={(e) => setW90(e.target.value)} className="input text-sm" disabled={running} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Peso RS 180 barre</span>
            <input type="number" min="0" max="1" step="0.05" value={w180} onChange={(e) => setW180(e.target.value)} className="input text-sm" disabled={running} />
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

          {/* Walk-forward robustness */}
          {result.walkForward && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6">
              <p className="text-sm font-medium mb-1">🔁 Walk-forward — tenuta per periodo</p>
              <p className="text-[11px] text-[var(--muted)] mb-3">
                Ogni periodo è simulato con capitale fresco: un edge vero regge in (quasi) tutti i
                periodi, non solo sul totale.
              </p>
              <div className="grid grid-cols-3 gap-3 mb-3">
                {[
                  { label: "Mediana expectancy", value: `${result.walkForward.medianExpectancy >= 0 ? "+" : ""}${result.walkForward.medianExpectancy}R`, good: result.walkForward.medianExpectancy > 0 },
                  { label: "Peggior Profit Factor", value: String(result.walkForward.worstProfitFactor), good: result.walkForward.worstProfitFactor >= 0.9 },
                  { label: "Periodi positivi", value: `${result.walkForward.positivePeriods}/${result.walkForward.periods.length}`, good: result.walkForward.positivePeriods >= Math.ceil(result.walkForward.periods.length * 0.6) },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg bg-[var(--surface-2)] p-2 text-center">
                    <p className="text-[10px] uppercase text-[var(--muted)]">{m.label}</p>
                    <p className={`text-base font-bold font-mono ${m.good ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{m.value}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted)]">
                      <th className="text-left px-2 py-1.5">Periodo</th>
                      <th className="text-right px-2 py-1.5">Trade</th>
                      <th className="text-right px-2 py-1.5">PF</th>
                      <th className="text-right px-2 py-1.5">Exp (R)</th>
                      <th className="text-right px-2 py-1.5">Max DD</th>
                      <th className="text-right px-2 py-1.5">Rendimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.walkForward.periods.map((p, i) => (
                      <tr key={i} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-2 py-1.5 font-mono text-[var(--muted)]">{p.start} → {p.end}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{p.summary.trades}</td>
                        <td className={`px-2 py-1.5 text-right font-mono font-semibold ${p.summary.profitFactor >= 1 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{p.summary.profitFactor}</td>
                        <td className={`px-2 py-1.5 text-right font-mono ${p.summary.expectancy >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{p.summary.expectancy >= 0 ? "+" : ""}{p.summary.expectancy}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-[var(--negative)]">-{p.summary.maxDrawdown}%</td>
                        <td className={`px-2 py-1.5 text-right font-mono ${p.summary.totalReturn >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{p.summary.totalReturn >= 0 ? "+" : ""}{p.summary.totalReturn}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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



// ─── Page ───────────────────────────────────────────────────────────────────────

export default function PortfolioMomentumPage() {
  const [indexKey, setIndexKey] = useState("SP500");
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
    // causa render a cascata (regola react-hooks).
    const t = setTimeout(loadPortfolio, 0);
    const id = setInterval(loadPortfolio, 30_000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [loadPortfolio]);

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">⚡ Portfolio Momentum RS</h1>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
          Posizioni, performance e backtest della strategia Momentum RS (forza relativa contro l&apos;indice).
        </p>
      </header>

      {!loaded ? (
        <LoadingPanel label="Carico il portafoglio…" />
      ) : (
        <>
          <PositionsPanel positions={positions} onChanged={loadPortfolio} />
          <PerformancePanel trades={trades} totalPnl={totalPnl} winRate={winRate} />
          <TradeHistoryPanel trades={trades} />
        </>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6 flex items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[var(--muted)]">Indice per il backtest</span>
          <select
            value={indexKey}
            onChange={(e) => setIndexKey(e.target.value)}
            className="input"
          >
            {INDICES.map((i) => (
              <option key={i.key} value={i.key}>{i.label}</option>
            ))}
          </select>
        </label>
      </div>

      <BacktestPanel indexKey={indexKey} />
    </div>
  );
}
