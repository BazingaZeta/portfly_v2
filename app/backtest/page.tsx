"use client";

import { useState } from "react";
import { pct, money } from "@/lib/format";
import { useI18n } from "@/components/I18nProvider";
import { useRisk } from "@/components/RiskProvider";
import { RiskSettings } from "@/components/RiskSettings";

interface Trade {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  returnPct: number;
  bars: number;
  outcome: "target" | "stop" | "time";
}
interface Summary {
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
interface Result {
  summary: Summary;
  equity: { date: string; equity: number }[];
  is: Summary;
  oos: Summary;
  oosEquity: { date: string; equity: number }[];
  splitDate: string;
  trades: Trade[];
  config: {
    lookbackDays: number; scoreThreshold: number; maxHoldDays: number; useRegime: boolean;
    riskPct: number; accountSize: number; maxConcurrent: number; slippageBps: number;
  };
  tickersTested: number;
  signalsTotal: number;
  signalsTaken: number;
}

export default function BacktestPage() {
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
  const [result, setResult] = useState<Result | null>(null);
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
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">{t("bt.title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t("bt.subtitle")}</p>
      </header>

      <div className="mb-4">
        <RiskSettings />
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6 grid sm:grid-cols-3 gap-4 items-end">
        <Control label={t("bt.thresholdLabel", { n: threshold })}>
          <input type="range" min={45} max={85} value={threshold} onChange={(e) => setThreshold(+e.target.value)} className="w-full" />
        </Control>
        <Control label={t("bt.holdLabel", { n: maxHold })}>
          <input type="range" min={3} max={30} value={maxHold} onChange={(e) => setMaxHold(+e.target.value)} className="w-full" />
        </Control>
        <Control label={t("bt.lookbackLabel", { n: Math.round((lookback / 252) * 10) / 10 })}>
          <input type="range" min={126} max={1008} step={126} value={lookback} onChange={(e) => setLookback(+e.target.value)} className="w-full" />
        </Control>
        <Control label={t("bt.maxConcurrent")}>
          <input type="number" min={1} max={50} value={maxConcurrent} onChange={(e) => setMaxConcurrent(+e.target.value)} className="input w-full" />
        </Control>
        <Control label={t("bt.slippage")}>
          <input type="number" min={0} max={50} value={slippage} onChange={(e) => setSlippage(+e.target.value)} className="input w-full" />
        </Control>
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
            <Kpi label={t("bt.totalReturn")} value={pct(s.totalReturn)} tone={s.totalReturn >= 0 ? "pos" : "neg"} />
            <Kpi label={t("perf.winRate")} value={`${s.winRate}%`} accent="var(--accent-2)" />
            <Kpi label={t("bt.profitFactor")} value={s.profitFactor >= 999 ? "∞" : s.profitFactor.toFixed(2)} tone={s.profitFactor >= 1 ? "pos" : "neg"} />
            <Kpi label={t("bt.maxDrawdown")} value={`-${s.maxDrawdown}%`} tone="neg" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Kpi label={t("bt.cagr")} value={pct(s.cagr)} tone={s.cagr >= 0 ? "pos" : "neg"} />
            <Kpi label={t("bt.finalEquity")} value={money(s.finalEquity)} tone={s.finalEquity >= result.config.accountSize ? "pos" : "neg"} />
            <Kpi label={t("bt.avgWin")} value={pct(s.avgWin)} tone="pos" />
            <Kpi label={t("bt.avgLoss")} value={pct(s.avgLoss)} tone="neg" />
          </div>

          <EquityCurve
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

          <ValidationPanel is={result.is} oos={result.oos} splitDate={result.splitDate} t={t} />


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
                {result.trades.slice(0, 100).map((t, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-mono">{t.ticker}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{t.entryDate}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{t.exitDate}</td>
                    <td className="px-3 py-2 text-right">{t.bars}</td>
                    <td className="px-3 py-2 text-center">
                      {t.outcome === "target" ? "🎯" : t.outcome === "stop" ? "⛔" : "⏱"}
                    </td>
                    <td className="px-3 py-2 text-right" style={{ color: t.returnPct >= 0 ? "var(--positive)" : "var(--negative)" }}>
                      {pct(t.returnPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ValidationPanel({
  is,
  oos,
  splitDate,
  t,
}: {
  is: Summary;
  oos: Summary;
  splitDate: string;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  // Verdict: does the held-out (OOS) period still show an edge?
  const verdict =
    oos.profitFactor >= 1.1 && oos.expectancy > 0
      ? { key: "bt.verdictHold", color: "var(--positive)" }
      : oos.profitFactor >= 1.0
      ? { key: "bt.verdictWeak", color: "var(--warning)" }
      : { key: "bt.verdictFail", color: "var(--negative)" };

  const rows: { label: string; is: string; oos: string; better: "high" }[] = [
    { label: t("bt.profitFactor"), is: fmtPf(is.profitFactor), oos: fmtPf(oos.profitFactor), better: "high" },
    { label: t("perf.winRate"), is: `${is.winRate}%`, oos: `${oos.winRate}%`, better: "high" },
    { label: t("bt.totalReturn"), is: pct(is.totalReturn), oos: pct(oos.totalReturn), better: "high" },
    { label: t("bt.maxDrawdown"), is: `-${is.maxDrawdown}%`, oos: `-${oos.maxDrawdown}%`, better: "high" },
    { label: "Expectancy (R)", is: is.expectancy.toFixed(3), oos: oos.expectancy.toFixed(3), better: "high" },
    { label: t("bt.trades"), is: String(is.trades), oos: String(oos.trades), better: "high" },
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

function EquityCurve({
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

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)] mb-1">{label}</p>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, tone, accent }: { label: string; value: string; sub?: string; tone?: "pos" | "neg"; accent?: string }) {
  const color = tone === "pos" ? "var(--positive)" : tone === "neg" ? "var(--negative)" : accent ?? "var(--foreground)";
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <span className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="text-xl font-bold font-mono mt-0.5" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--muted)]">{sub}</p>}
    </div>
  );
}
