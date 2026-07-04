"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/format";

// ─── Types (mirror /api/rotation payloads) ────────────────────────────────────

interface RotationStatus {
  config: { bull: string; defensive: string; smaPeriod: number };
  asOf: string;
  regime: "bull" | "bear";
  holding: string;
  holdingName: string;
  spyClose: number;
  sma: number;
  distancePct: number;
  daysInRegime: number;
  lastCross: string | null;
  spark: { date: string; close: number; sma: number }[];
}

interface WfPeriod {
  start: string; end: string;
  strategyReturn: number; spyReturn: number; maxDrawdown: number;
}

interface BtResult {
  config: { bull: string; defensive: string; smaPeriod: number };
  startDate: string; endDate: string; years: number;
  totalReturn: number; cagr: number; maxDrawdown: number; sharpe: number;
  switches: number; timeInvestedPct: number;
  spyTotalReturn: number; spyCagr: number; spyMaxDrawdown: number;
  equity: { date: string; equity: number }[];
  spyEquity: { date: string; equity: number }[];
  perYear: { year: string; strategy: number; spy: number }[];
  walkForward?: { periods: WfPeriod[]; beatSpyPeriods: number; positivePeriods: number };
}

const BULL_OPTIONS = [
  { value: "SSO", label: "SSO — S&P 500 leva 2× (consigliato)" },
  { value: "QQQ", label: "QQQ — Nasdaq 100 (conservativo)" },
  { value: "TQQQ", label: "TQQQ — Nasdaq leva 3× (aggressivo)" },
  { value: "SPY", label: "SPY — solo timing, senza leva" },
];
const DEF_OPTIONS = [
  { value: "BIL", label: "BIL — T-bill 1-3 mesi" },
  { value: "CASH", label: "Cash" },
];

// ─── Signal / SMA chart ───────────────────────────────────────────────────────

function SignalChart({ spark }: { spark: RotationStatus["spark"] }) {
  if (spark.length < 2) return null;
  const W = 600, H = 160;
  const PAD = { top: 10, right: 12, bottom: 22, left: 48 };
  const all = spark.flatMap((p) => [p.close, p.sma]);
  const mn = Math.min(...all) * 0.995;
  const mx = Math.max(...all) * 1.005;
  const toX = (i: number) => PAD.left + (i / (spark.length - 1)) * (W - PAD.left - PAD.right);
  const toY = (v: number) => PAD.top + ((mx - v) / (mx - mn)) * (H - PAD.top - PAD.bottom);
  const line = (get: (p: RotationStatus["spark"][number]) => number) =>
    spark.map((p, i) => `${toX(i)},${toY(get(p))}`).join(" ");
  const labels = [0, Math.floor(spark.length / 2), spark.length - 1];
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, minWidth: 300 }}>
        <polyline points={line((p) => p.sma)} fill="none" stroke="var(--warning)" strokeWidth="1.6" strokeDasharray="5,4" />
        <polyline points={line((p) => p.close)} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
        {labels.map((i) => (
          <text key={i} x={toX(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted)">
            {spark[i].date.slice(0, 7)}
          </text>
        ))}
        <line x1={PAD.left} y1={H - 6} x2={PAD.left + 16} y2={H - 6} stroke="var(--accent)" strokeWidth="2" />
        <text x={PAD.left + 20} y={H - 3} fontSize="9" fill="var(--accent)">SPY</text>
        <line x1={PAD.left + 60} y1={H - 6} x2={PAD.left + 76} y2={H - 6} stroke="var(--warning)" strokeWidth="2" strokeDasharray="4,3" />
        <text x={PAD.left + 80} y={H - 3} fontSize="9" fill="var(--warning)">SMA</text>
      </svg>
    </div>
  );
}

// ─── Equity chart ─────────────────────────────────────────────────────────────

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
  const W = 600, H = 200;
  const PAD = { top: 16, right: 16, bottom: 28, left: 56 };
  const all = [...strategy.map((p) => p.equity), ...spy.map((p) => p.equity), accountSize];
  const mn = Math.min(...all) * 0.995;
  const mx = Math.max(...all) * 1.005;
  const toX = (i: number, n: number) => PAD.left + (i / (n - 1)) * (W - PAD.left - PAD.right);
  const toY = (v: number) => PAD.top + ((mx - v) / (mx - mn)) * (H - PAD.top - PAD.bottom);
  const poly = (pts: { equity: number }[], color: string, dashed = false) => (
    <polyline
      points={pts.map((p, i) => `${toX(i, pts.length)},${toY(p.equity)}`).join(" ")}
      fill="none" stroke={color} strokeWidth="1.8"
      strokeDasharray={dashed ? "5,4" : undefined}
      strokeLinecap="round" strokeLinejoin="round"
    />
  );
  const ticks = Array.from({ length: 5 }, (_, i) => mn + ((mx - mn) * i) / 4);
  const labels = [0, Math.floor(strategy.length / 2), strategy.length - 1];
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, minWidth: 300 }}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.left - 4} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="var(--muted)">
              {v >= 10000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`}
            </text>
          </g>
        ))}
        <line x1={PAD.left} y1={toY(accountSize)} x2={W - PAD.right} y2={toY(accountSize)} stroke="var(--muted)" strokeWidth="0.8" strokeDasharray="3,3" />
        {poly(spy, "var(--warning)", true)}
        {poly(strategy, "var(--accent)")}
        {labels.map((i) => (
          <text key={i} x={toX(i, strategy.length)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted)">
            {strategy[i].date.slice(0, 7)}
          </text>
        ))}
        <line x1={PAD.left} y1={H - 6} x2={PAD.left + 16} y2={H - 6} stroke="var(--accent)" strokeWidth="2" />
        <text x={PAD.left + 20} y={H - 3} fontSize="9" fill="var(--accent)">Strategia</text>
        <line x1={PAD.left + 72} y1={H - 6} x2={PAD.left + 88} y2={H - 6} stroke="var(--warning)" strokeWidth="2" strokeDasharray="4,3" />
        <text x={PAD.left + 92} y={H - 3} fontSize="9" fill="var(--warning)">SPY B&H</text>
      </svg>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RotationPage() {
  const [bull, setBull] = useState("SSO");
  const [def, setDef] = useState("BIL");
  const [sma, setSma] = useState("200");

  const [status, setStatus] = useState<RotationStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true); // caricamento iniziale on-mount

  const [years, setYears] = useState("5");
  const [folds, setFolds] = useState("4");
  const [account, setAccount] = useState("10000");
  const [bt, setBt] = useState<BtResult | null>(null);
  const [btErr, setBtErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Nessun setState sincrono qui dentro: lo spinner viene acceso dal chiamante
  // (stato iniziale true per il mount, onClick per gli aggiornamenti manuali).
  const loadStatus = useCallback(async (b: string, d: string, s: string) => {
    try {
      const res = await fetch(`/api/rotation/analyze?bull=${b}&def=${d}&sma=${s}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      setStatus(data);
      setStatusErr(null);
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : "Errore");
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // Caricamento iniziale: setState solo dentro le callback della promise
  // (la regola react-hooks vieta chiamate sincrone a funzioni con setState).
  useEffect(() => {
    fetch(`/api/rotation/analyze?bull=SSO&def=BIL&sma=200`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Errore");
        setStatus(data);
        setStatusErr(null);
      })
      .catch((e) => setStatusErr(e instanceof Error ? e.message : "Errore"))
      .finally(() => setLoadingStatus(false));
  }, []);

  async function runBacktest() {
    setRunning(true);
    setBtErr(null);
    setBt(null);
    try {
      const qs = `bull=${bull}&def=${def}&sma=${sma}&years=${years}&folds=${folds}&account=${account}`;
      const res = await fetch(`/api/rotation/backtest?${qs}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      setBt(data);
    } catch (e) {
      setBtErr(e instanceof Error ? e.message : "Errore");
    } finally {
      setRunning(false);
    }
  }

  const isBull = status?.regime === "bull";

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">🔄 Rotazione a leva</h1>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
          &quot;Leverage for the Long Run&quot; (Gayed, 2016): quando SPY chiude sopra la sua media a{" "}
          {sma} giorni sei investito al 100% nell&apos;asset a leva; quando chiude sotto, sei in T-bill.
          Una regola sola, ~5 switch l&apos;anno. La leva genera l&apos;extra-rendimento, il filtro la rende
          sopravvivibile evitando chop e crash.
        </p>
      </header>

      {/* Config */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[var(--muted)]">Asset rialzista</span>
          <select value={bull} onChange={(e) => setBull(e.target.value)} className="input" disabled={loadingStatus || running}>
            {BULL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[var(--muted)]">Asset difensivo</span>
          <select value={def} onChange={(e) => setDef(e.target.value)} className="input" disabled={loadingStatus || running}>
            {DEF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[var(--muted)]">SMA (giorni)</span>
          <select value={sma} onChange={(e) => setSma(e.target.value)} className="input" disabled={loadingStatus || running}>
            <option value="150">150</option>
            <option value="200">200 (standard)</option>
            <option value="250">250</option>
          </select>
        </label>
        <button
          onClick={() => { setLoadingStatus(true); loadStatus(bull, def, sma); }}
          disabled={loadingStatus}
          className="btn-primary"
        >
          {loadingStatus ? "Aggiorno…" : "🔍 Aggiorna segnale"}
        </button>
      </div>

      {statusErr && (
        <div className="mb-6 rounded-xl border border-[var(--negative)] bg-[var(--negative)]/10 p-4 text-sm text-[var(--negative)]">
          {statusErr}
        </div>
      )}

      {/* Current signal */}
      {status && (
        <div className={`rounded-xl border p-5 mb-6 ${isBull ? "border-[var(--positive)]/40 bg-[var(--positive)]/5" : "border-[var(--warning)]/40 bg-[var(--warning)]/5"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[10px] uppercase text-[var(--muted)] mb-1">Segnale al {status.asOf}</p>
              <p className="text-2xl font-bold">
                {isBull ? "📈 INVESTITO" : "🛡️ DIFENSIVO"}
                <span className="ml-2 text-lg font-mono">{status.holding}</span>
                <span className="ml-2 text-sm text-[var(--muted)] font-normal">{status.holdingName}</span>
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-[10px] uppercase text-[var(--muted)]">SPY vs SMA{status.config.smaPeriod}</p>
                <p className={`font-mono font-bold ${status.distancePct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                  {status.distancePct >= 0 ? "+" : ""}{status.distancePct}%
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-[var(--muted)]">Nel regime da</p>
                <p className="font-mono font-bold">{status.daysInRegime} barre</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-[var(--muted)]">Ultimo incrocio</p>
                <p className="font-mono font-bold">{status.lastCross ?? "—"}</p>
              </div>
            </div>
          </div>
          <SignalChart spark={status.spark} />
          {Math.abs(status.distancePct) < 2 && (
            <p className="mt-3 text-xs text-[var(--warning)]">
              ⚠️ SPY è a meno del 2% dalla SMA{status.config.smaPeriod}: zona whipsaw, possibili switch ravvicinati.
            </p>
          )}
        </div>
      )}

      {/* Risk notes */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6 text-xs text-[var(--muted)] space-y-1">
        <p className="font-medium text-[var(--foreground)]">Rischi da conoscere prima di usarla</p>
        <p>• <strong>Whipsaw</strong>: nei laterali attorno alla SMA accumuli piccoli switch in perdita (anni tipo 2011/2015 sottoperformano).</p>
        <p>• <strong>Gap risk</strong>: il segnale è al close — un crash overnight lo subisci a leva piena.</p>
        <p>• <strong>TQQQ</strong> è un tilt tech con leva 3×: drawdown attesi &gt;35% anche col filtro. Da satellite, non da core.</p>
        <p>• La validazione locale copre ~4-5 anni; l&apos;evidenza lunga (1928-2020) è nel paper di Gayed, non riproducibile con i dati Yahoo.</p>
      </div>

      {/* Backtest */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-4">🧪 Backtest</h2>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Anni di storia</span>
            <select value={years} onChange={(e) => setYears(e.target.value)} className="input" disabled={running}>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5 (max, include 2022)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Walk-forward (periodi)</span>
            <select value={folds} onChange={(e) => setFolds(e.target.value)} className="input" disabled={running}>
              <option value="0">off</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted)]">Capitale ($)</span>
            <input type="number" min="1000" step="1000" value={account} onChange={(e) => setAccount(e.target.value)} className="input" disabled={running} />
          </label>
          <button onClick={runBacktest} disabled={running} className="btn-primary">
            {running ? "Backtest in corso…" : "🧪 Avvia backtest"}
          </button>
        </div>

        {btErr && (
          <div className="mb-4 rounded-xl border border-[var(--negative)] bg-[var(--negative)]/10 p-3 text-sm text-[var(--negative)]">
            {btErr}
          </div>
        )}

        {bt && (
          <>
            <div className="mb-4 text-xs text-[var(--muted)] rounded-lg bg-[var(--surface)] border border-[var(--border)] p-3">
              {bt.startDate} → {bt.endDate} ({bt.years} anni) · {bt.switches} switch ·{" "}
              {bt.timeInvestedPct}% del tempo investito in {bt.config.bull} · slippage sugli switch incluso
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: "Strategia — totale", value: bt.totalReturn, suffix: "%", colored: true },
                { label: "SPY B&H — totale", value: bt.spyTotalReturn, suffix: "%", colored: true },
                { label: "CAGR", value: bt.cagr, suffix: "%", colored: true },
                { label: "CAGR SPY", value: bt.spyCagr, suffix: "%", colored: true },
              ].map((m) => (
                <div key={m.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-[10px] uppercase text-[var(--muted)] mb-1">{m.label}</p>
                  <p className={`text-xl font-bold font-mono ${m.value >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                    {m.value >= 0 ? "+" : ""}{m.value}{m.suffix}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: "Max DD strategia", value: `-${bt.maxDrawdown}%` },
                { label: "Max DD SPY", value: `-${bt.spyMaxDrawdown}%` },
                { label: "Sharpe (giornaliero)", value: String(bt.sharpe) },
                { label: "Capitale finale", value: money(bt.equity[bt.equity.length - 1]?.equity ?? 0) },
              ].map((m) => (
                <div key={m.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-[10px] uppercase text-[var(--muted)] mb-1">{m.label}</p>
                  <p className="text-lg font-bold font-mono">{m.value}</p>
                </div>
              ))}
            </div>

            {/* Per-year table */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6">
              <p className="text-sm font-medium mb-3">📅 Rendimento per anno</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted)]">
                      <th className="text-left px-2 py-1.5">Anno</th>
                      <th className="text-right px-2 py-1.5">Strategia</th>
                      <th className="text-right px-2 py-1.5">SPY B&H</th>
                      <th className="text-right px-2 py-1.5">Differenza</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bt.perYear.map((y) => (
                      <tr key={y.year} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-2 py-1.5 font-mono">{y.year}</td>
                        <td className={`px-2 py-1.5 text-right font-mono font-semibold ${y.strategy >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                          {y.strategy >= 0 ? "+" : ""}{y.strategy}%
                        </td>
                        <td className={`px-2 py-1.5 text-right font-mono ${y.spy >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                          {y.spy >= 0 ? "+" : ""}{y.spy}%
                        </td>
                        <td className={`px-2 py-1.5 text-right font-mono ${y.strategy - y.spy >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                          {y.strategy - y.spy >= 0 ? "+" : ""}{(y.strategy - y.spy).toFixed(1)}pt
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Walk-forward */}
            {bt.walkForward && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6">
                <p className="text-sm font-medium mb-1">🔁 Walk-forward — tenuta per periodo</p>
                <p className="text-[11px] text-[var(--muted)] mb-3">
                  Batte SPY in {bt.walkForward.beatSpyPeriods}/{bt.walkForward.periods.length} periodi ·
                  positiva in {bt.walkForward.positivePeriods}/{bt.walkForward.periods.length}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted)]">
                        <th className="text-left px-2 py-1.5">Periodo</th>
                        <th className="text-right px-2 py-1.5">Strategia</th>
                        <th className="text-right px-2 py-1.5">SPY</th>
                        <th className="text-right px-2 py-1.5">Max DD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bt.walkForward.periods.map((p, i) => (
                        <tr key={i} className="border-b border-[var(--border)] last:border-0">
                          <td className="px-2 py-1.5 font-mono text-[var(--muted)]">{p.start} → {p.end}</td>
                          <td className={`px-2 py-1.5 text-right font-mono font-semibold ${p.strategyReturn >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                            {p.strategyReturn >= 0 ? "+" : ""}{p.strategyReturn}%
                          </td>
                          <td className={`px-2 py-1.5 text-right font-mono ${p.spyReturn >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                            {p.spyReturn >= 0 ? "+" : ""}{p.spyReturn}%
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-[var(--negative)]">-{p.maxDrawdown}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-4">
              <p className="text-sm font-medium mb-3">📈 Equity curve — Strategia vs SPY buy & hold</p>
              <EquityChart strategy={bt.equity} spy={bt.spyEquity} accountSize={Number(account) || 10000} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
