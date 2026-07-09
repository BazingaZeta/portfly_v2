"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Position } from "@/lib/types";
import { useI18n } from "@/components/I18nProvider";
import { useRisk } from "@/components/RiskProvider";
import { RiskSettings } from "@/components/RiskSettings";
import { LoadingPanel } from "@/components/Loading";
import { PortfolioEquityPanel } from "@/components/PortfolioEquityPanel";
import { useLivePrices, LivePrice, LiveBadge, applyLivePrices } from "@/components/LivePrice";
import type { MarketStatus } from "@/lib/marketHours";
import type { TFunc } from "@/lib/i18n";
import { money, pct } from "@/lib/format";

// ─── Sell Modal ─────────────────────────────────────────────────────────────────

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
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SELL",
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

// ─── Positions Panel ────────────────────────────────────────────────────────────

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
        <p className="text-4xl mb-3">💼</p>
        <p className="font-medium mb-1">Nessuna posizione aperta</p>
        <p className="text-sm">Compra un titolo dalla pagina Sentiment Analysis per vederlo qui.</p>
      </section>
    );
  }

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);

  return (
    <>
      {selling && (
        <SellModal position={selling} onClose={() => setSelling(null)} onDone={onChanged} />
      )}

      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide flex items-center gap-2">
            💼 Posizioni aperte
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
                  <th className="text-right px-4 py-2">Stop → Target</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  // Uno stop valido (long) sta sotto il costo medio, un target sopra:
                  // livelli stantii/invertiti non contano come colpiti.
                  const stopHit = p.stop != null && p.stop < p.avgCost && p.currentPrice <= p.stop;
                  const targetHit = p.target != null && p.target > p.avgCost && p.currentPrice >= p.target;
                  return (
                    <tr key={p.ticker} className={`border-b border-[var(--border)] last:border-0 ${stopHit ? "bg-[var(--negative)]/5" : targetHit ? "bg-[var(--positive)]/5" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{p.ticker}</div>
                        <div className="text-[11px] text-[var(--muted)] truncate max-w-[120px]">{p.name}</div>
                        {stopHit && <span className="text-[10px] text-[var(--negative)] font-medium">⛔ Stop colpito</span>}
                        {targetHit && <span className="text-[10px] text-[var(--positive)] font-medium">🎯 Target raggiunto</span>}
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

// ─── Performance + Trade History ────────────────────────────────────────────────

interface PerfSummary {
  count: number;
  totalRealized: number;
  wins: number;
  losses: number;
  winRate: number;
  avgReturn: number;
}

interface ClosedTrade {
  id: number;
  ticker: string;
  shares: number;
  price: number;
  executedAt: string;
  realized: number;
  returnPct: number;
}

function PerformancePanel({ summary }: { summary: PerfSummary | null }) {
  if (!summary || summary.count === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">
        📈 Performance
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "P&L realizzato", value: summary.totalRealized, isMoney: true, colored: true },
          { label: "Win rate", value: `${summary.winRate}%`, isMoney: false },
          { label: "Trade chiusi", value: summary.count, isMoney: false },
          { label: "Rendimento medio", value: summary.avgReturn, isMoney: false, isPct: true, colored: true },
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
                : stat.isPct && typeof stat.value === "number"
                ? pct(stat.value)
                : stat.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TradeHistoryPanel({ closed }: { closed: ClosedTrade[] }) {
  const relevant = closed.slice(0, 50);
  if (relevant.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">
        📋 Storico operazioni
      </h2>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted)]">
                <th className="text-left px-4 py-2">Data</th>
                <th className="text-left px-4 py-2">Titolo</th>
                <th className="text-right px-4 py-2">Azioni</th>
                <th className="text-right px-4 py-2">Prezzo</th>
                <th className="text-right px-4 py-2">Rendimento</th>
                <th className="text-right px-4 py-2">P&L</th>
              </tr>
            </thead>
            <tbody>
              {relevant.map((t) => (
                <tr key={t.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2.5 text-xs text-[var(--muted)]">
                    {new Date(t.executedAt).toLocaleDateString("it-IT")}
                  </td>
                  <td className="px-4 py-2.5 font-semibold">{t.ticker}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{t.shares}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{money(t.price)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs" style={{ color: t.returnPct >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    {t.returnPct >= 0 ? "+" : ""}{t.returnPct.toFixed(2)}%
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={`font-mono text-xs font-semibold ${
                        t.realized >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
                      }`}
                    >
                      {t.realized >= 0 ? "+" : ""}{money(t.realized)}
                    </span>
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

// ─── Backtest Panel ─────────────────────────────────────────────────────────────

interface BtTrade {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  returnPct: number;
  bars: number;
  outcome: "target" | "stop" | "time";
}
interface BtSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgReturn: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  totalReturn: number;
  cagr: number;
  finalEquity: number;
  byOutcome: { target: number; stop: number; time: number };
}
interface BtResult {
  summary: BtSummary;
  equity: { date: string; equity: number }[];
  is: BtSummary;
  oos: BtSummary;
  oosEquity: { date: string; equity: number }[];
  splitDate: string;
  trades: BtTrade[];
  config: {
    lookbackDays: number; scoreThreshold: number; maxHoldDays: number; useRegime: boolean;
    riskPct: number; accountSize: number; maxConcurrent: number; slippageBps: number;
  };
  tickersTested: number;
  signalsTotal: number;
  signalsTaken: number;
}

function BacktestPanel() {
  const { t } = useI18n();
  const { accountSize, riskPct } = useRisk();
  const [threshold, setThreshold] = useState(60);
  const [maxHold, setMaxHold] = useState(10);
  const [lookback, setLookback] = useState(504);
  const [useRegime, setUseRegime] = useState(true);
  const [maxConcurrent, setMaxConcurrent] = useState(10);
  const [slippage, setSlippage] = useState(5);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [result, setResult] = useState<BtResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress({ current: 0, total: 1, message: "Avvio…" });
    const qs = `lookback=${lookback}&threshold=${threshold}&maxHold=${maxHold}&regime=${useRegime ? 1 : 0}&risk=${riskPct}&account=${accountSize}&maxc=${maxConcurrent}&slip=${slippage}`;
    const es = new EventSource(`/api/backtest?${qs}`);
    es.addEventListener("progress", (e) => setProgress(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("complete", (e) => {
      setResult(JSON.parse((e as MessageEvent).data));
      es.close();
      setRunning(false);
    });
    es.addEventListener("error", (e) => {
      setError((e as MessageEvent).data ? JSON.parse((e as MessageEvent).data).message : "Connessione interrotta");
      es.close();
      setRunning(false);
    });
  }

  const pctDone = progress && progress.total ? (progress.current / progress.total) * 100 : 0;
  const s = result?.summary;

  return (
    <section className="mb-8">
      <div className="mb-4">
        <RiskSettings />
      </div>
      <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">
        🧪 {t("bt.title")}
      </h2>

      {/* Controls */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6 grid sm:grid-cols-3 gap-4 items-end">
        <BtControl label={t("bt.thresholdLabel", { n: threshold })}>
          <input type="range" min={45} max={85} value={threshold} onChange={(e) => setThreshold(+e.target.value)} className="w-full" />
        </BtControl>
        <BtControl label={t("bt.holdLabel", { n: maxHold })}>
          <input type="range" min={3} max={30} value={maxHold} onChange={(e) => setMaxHold(+e.target.value)} className="w-full" />
        </BtControl>
        <BtControl label={t("bt.lookbackLabel", { n: Math.round((lookback / 252) * 10) / 10 })}>
          <input type="range" min={126} max={1008} step={126} value={lookback} onChange={(e) => setLookback(+e.target.value)} className="w-full" />
        </BtControl>
        <BtControl label={t("bt.maxConcurrent")}>
          <input type="number" min={1} max={50} value={maxConcurrent} onChange={(e) => setMaxConcurrent(+e.target.value)} className="input w-full" />
        </BtControl>
        <BtControl label={t("bt.slippage")}>
          <input type="number" min={0} max={50} value={slippage} onChange={(e) => setSlippage(+e.target.value)} className="input w-full" />
        </BtControl>
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useRegime} onChange={(e) => setUseRegime(e.target.checked)} />
            {t("bt.regimeFilter")}
          </label>
          <button onClick={run} disabled={running} className="btn-primary">
            {running ? t("bt.running") : t("bt.run")}
          </button>
        </div>
      </div>

      {running && progress && (
        <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--muted)] mb-2">{progress.message}</p>
          <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
            <div className="h-full bg-[var(--accent)] transition-all duration-300" style={{ width: `${pctDone}%` }} />
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-[var(--negative)] bg-[var(--negative)]/10 p-4 text-sm text-[var(--negative)]">
          {t("bt.error", { msg: error })}
        </div>
      )}

      {!result && !running && (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--muted)]">
          <p className="text-4xl mb-3">🧪</p>
          {t("bt.emptyDesc")}
        </div>
      )}

      {s && result && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <BtKpi label={t("bt.totalReturn")} value={pct(s.totalReturn)} tone={s.totalReturn >= 0 ? "pos" : "neg"} />
            <BtKpi label={t("perf.winRate")} value={`${s.winRate}%`} accent="var(--accent-2)" />
            <BtKpi label={t("bt.profitFactor")} value={s.profitFactor >= 999 ? "∞" : s.profitFactor.toFixed(2)} tone={s.profitFactor >= 1 ? "pos" : "neg"} />
            <BtKpi label={t("bt.maxDrawdown")} value={`-${s.maxDrawdown}%`} tone="neg" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <BtKpi label={t("bt.cagr")} value={pct(s.cagr)} tone={s.cagr >= 0 ? "pos" : "neg"} />
            <BtKpi label={t("bt.finalEquity")} value={money(s.finalEquity)} tone={s.finalEquity >= result.config.accountSize ? "pos" : "neg"} />
            <BtKpi label={t("bt.avgWin")} value={pct(s.avgWin)} tone="pos" />
            <BtKpi label={t("bt.avgLoss")} value={pct(s.avgLoss)} tone="neg" />
          </div>

          <BtEquityCurve
            data={result.equity}
            title={t("bt.equityTitleRisk", { pct: result.config.riskPct, account: money(result.config.accountSize) })}
            baseline={result.config.accountSize}
          />

          <p className="text-xs text-[var(--muted)] mt-4 mb-1">
            {t("bt.coverage", { taken: result.signalsTaken, total: result.signalsTotal })}
          </p>
          <p className="text-xs text-[var(--muted)] mb-6">
            {t("bt.outcomes", { target: s.byOutcome.target, stop: s.byOutcome.stop, time: s.byOutcome.time })}{" "}
            {t("bt.config", {
              threshold: result.config.scoreThreshold,
              hold: result.config.maxHoldDays,
              regime: result.config.useRegime ? t("bt.configWith") : t("bt.configWithout"),
            })}
          </p>

          <BtValidationPanel is={result.is} oos={result.oos} splitDate={result.splitDate} t={t} />

          <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">
            {t("bt.tradesTitle")}
          </h2>
          <div className="rounded-xl border border-[var(--border)] overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("common.symbol")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("bt.colEntry")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("bt.colExit")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("bt.colDays")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("bt.colOutcome")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("perf.colReturn")}</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.slice(0, 100).map((tr, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-mono">{tr.ticker}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{tr.entryDate}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{tr.exitDate}</td>
                    <td className="px-3 py-2 text-right">{tr.bars}</td>
                    <td className="px-3 py-2 text-center">
                      {tr.outcome === "target" ? "🎯" : tr.outcome === "stop" ? "⛔" : "⏱"}
                    </td>
                    <td className="px-3 py-2 text-right" style={{ color: tr.returnPct >= 0 ? "var(--positive)" : "var(--negative)" }}>
                      {pct(tr.returnPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function BtValidationPanel({
  is,
  oos,
  splitDate,
  t,
}: {
  is: BtSummary;
  oos: BtSummary;
  splitDate: string;
  t: TFunc;
}) {
  const verdict =
    oos.profitFactor >= 1.1 && oos.expectancy > 0
      ? { key: "bt.verdictHold", color: "var(--positive)" }
      : oos.profitFactor >= 1.0
      ? { key: "bt.verdictWeak", color: "var(--warning)" }
      : { key: "bt.verdictFail", color: "var(--negative)" };

  const rows: { label: string; is: string; oos: string }[] = [
    { label: t("bt.profitFactor"), is: fmtPf(is.profitFactor), oos: fmtPf(oos.profitFactor) },
    { label: t("perf.winRate"), is: `${is.winRate}%`, oos: `${oos.winRate}%` },
    { label: t("bt.totalReturn"), is: pct(is.totalReturn), oos: pct(oos.totalReturn) },
    { label: t("bt.maxDrawdown"), is: `-${is.maxDrawdown}%`, oos: `-${oos.maxDrawdown}%` },
    { label: "Expectancy (R)", is: is.expectancy.toFixed(3), oos: oos.expectancy.toFixed(3) },
    { label: t("bt.trades"), is: String(is.trades), oos: String(oos.trades) },
  ];

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 my-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-medium">{t("bt.validation")}</h2>
        <span className="text-xs text-[var(--muted)]">{t("bt.splitInfo", { date: splitDate })}</span>
      </div>
      <p className="text-xs text-[var(--muted)] mb-3">{t("bt.validationHint")}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[var(--muted)] text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t("bt.metric")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("bt.inSample")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("bt.outSample")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-[var(--border)]">
                <td className="px-3 py-2 text-[var(--muted)]">{r.label}</td>
                <td className="px-3 py-2 text-right font-mono">{r.is}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{r.oos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm font-medium" style={{ color: verdict.color }}>
        {t(verdict.key)}
      </p>
    </div>
  );
}

function fmtPf(pf: number): string {
  return pf >= 999 ? "∞" : pf.toFixed(2);
}

function BtEquityCurve({
  data,
  title,
  baseline,
}: {
  data: { date: string; equity: number }[];
  title: string;
  baseline: number;
}) {
  if (data.length < 2) return null;
  const w = 720;
  const h = 200;
  const pad = 8;
  const vals = data.map((d) => d.equity);
  const min = Math.min(...vals, baseline);
  const max = Math.max(...vals, baseline);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad);
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d.equity).toFixed(1)}`).join(" ");
  const baselineY = y(baseline);
  const last = data[data.length - 1].equity;
  const up = last >= baseline;
  const color = up ? "var(--positive)" : "var(--negative)";

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="font-mono text-sm" style={{ color }}>{last.toLocaleString()}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 200 }}>
        <line x1={pad} y1={baselineY} x2={w - pad} y2={baselineY} stroke="var(--border)" strokeDasharray="4 4" />
        <path d={`${path} L ${x(data.length - 1)} ${h - pad} L ${x(0)} ${h - pad} Z`} fill={color} opacity="0.1" />
        <path d={path} fill="none" stroke={color} strokeWidth="2" />
      </svg>
    </div>
  );
}

function BtControl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)] mb-1">{label}</p>
      {children}
    </div>
  );
}

function BtKpi({ label, value, sub, tone, accent }: { label: string; value: string; sub?: string; tone?: "pos" | "neg"; accent?: string }) {
  const color = tone === "pos" ? "var(--positive)" : tone === "neg" ? "var(--negative)" : accent ?? "var(--foreground)";
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <span className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
      <p className="text-[11px] uppercase tracking-wide text-[var(--foreground)]">{label}</p>
      <p className="text-xl font-bold font-mono mt-0.5" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function PortfolioSentimentPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [perfSummary, setPerfSummary] = useState<PerfSummary | null>(null);
  const [perfClosed, setPerfClosed] = useState<ClosedTrade[]>([]);
  const [loaded, setLoaded] = useState(false); // primo fetch completato: prima mostra lo spinner, non l'empty state

  const loadPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/trades", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const all = (data.positions ?? []) as Position[];
      setPositions(all.filter((p) => p.source === "main"));
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadPerformance = useCallback(async () => {
    try {
      const res = await fetch("/api/performance", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setPerfSummary(data.summary ?? null);
      setPerfClosed(data.closed ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // Deferito di un tick: setState sincrono nel corpo dell'effect causa render a cascata.
    const t = setTimeout(() => {
      loadPortfolio();
      loadPerformance();
    }, 0);
    const id = setInterval(loadPortfolio, 30_000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [loadPortfolio, loadPerformance]);

  // Prezzi live ~5s: aggiorna prezzo e P&L delle posizioni senza ricaricare tutto.
  const { prices: livePrices, market } = useLivePrices(positions.map((p) => p.ticker));
  const livePositions = useMemo(
    () => applyLivePrices(positions, livePrices),
    [positions, livePrices],
  );

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">💼 Portfolio Sentiment Analysis</h1>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
          Posizioni, performance e backtest della strategia Sentiment Analysis (analisi tecnica + sentiment notizie).
        </p>
      </header>

      <PortfolioEquityPanel strategy="sentiment" />

      {!loaded ? (
        <LoadingPanel label="Carico il portafoglio…" />
      ) : (
        <>
          <PositionsPanel positions={livePositions} onChanged={() => { loadPortfolio(); loadPerformance(); }} market={market} />
          <PerformancePanel summary={perfSummary} />
          <TradeHistoryPanel closed={perfClosed} />
        </>
      )}
      <BacktestPanel />
    </div>
  );
}
