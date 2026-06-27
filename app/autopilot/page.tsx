"use client";

import { useCallback, useEffect, useState } from "react";
import { money, pct, relativeTime } from "@/lib/format";
import { useI18n } from "@/components/I18nProvider";

interface Position {
  ticker: string; name: string; shares: number; avgCost: number; price: number;
  value: number; pnl: number; pnlPct: number; weight: number;
}
interface State {
  running: boolean; cash: number; initialCapital: number; equity: number;
  totalPnl: number; totalPnlPct: number; startedAt: string | null; lastRun: string | null;
  positions: Position[];
}
interface LogEntry { ts: string; runId: string; kind: string; message: string; }
interface Trade { ticker: string; action: string; shares: number; price: number; executedAt: string; reason: string | null; }
interface Snapshot { state: State; market?: { open: boolean; state: string; asOf: string | null }; log: LogEntry[]; trades: Trade[]; equity: { date: string; equity: number }[]; }
interface Backtest {
  cagr: number; totalReturn: number; maxDrawdown: number; benchCagr: number;
  benchMaxDrawdown: number; years: number; equity: { date: string; equity: number; bench: number }[];
}

const KIND_COLOR: Record<string, string> = {
  run: "var(--accent)", analysis: "var(--muted)", decision: "var(--accent-2)",
  trade: "var(--positive)", start: "var(--accent-3)",
};

export default function AutopilotPage() {
  const { t } = useI18n();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bt, setBt] = useState<Backtest | null>(null);
  const [btRunning, setBtRunning] = useState(false);
  const [cycleMsg, setCycleMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/autopilot", { cache: "no-store" });
    const data = await res.json();
    setSnap(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    runBacktest(); // show the strategy chart immediately (live equity needs several days)
    const id = setInterval(load, 60_000); // refresh P&L while open
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function act(action: string, force = false) {
    setBusy(true);
    setCycleMsg(null);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, force }),
      });
      const data = await res.json();
      if (data.reset) { load(); return; }
      setSnap(data);
      if (action === "run" || action === "start") {
        const time = new Date(data.ranAt ?? Date.now()).toLocaleTimeString();
        setCycleMsg(t("auto.cycleDone", {
          t: time,
          outcome: data.rebalanced ? t("auto.outRebalanced") : t("auto.outNoRebalance"),
        }));
      }
    } finally {
      setBusy(false);
    }
  }

  async function runBacktest() {
    setBtRunning(true);
    try {
      const res = await fetch("/api/autopilot/backtest", { cache: "no-store" });
      setBt(await res.json());
    } finally {
      setBtRunning(false);
    }
  }

  const st = snap?.state;
  const running = st?.running;

  return (
    <div className="max-w-4xl mx-auto">
      <header className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight gradient-text">{t("auto.title")}</h1>
          <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">{t("auto.subtitle")}</p>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          {!running ? (
            <button onClick={() => act("start")} disabled={busy} className="btn-primary whitespace-nowrap">
              {busy ? t("auto.running") : t("auto.start")}
            </button>
          ) : (
            <>
              <button onClick={() => act("run")} disabled={busy} className="btn-primary whitespace-nowrap">
                {busy ? t("auto.running") : `▶ ${t("auto.run")}`}
              </button>
              <button onClick={() => act("run", true)} disabled={busy} className="btn-ghost text-xs border border-[var(--border)]">
                {t("auto.forceRebalance")}
              </button>
              <button onClick={() => act("reset")} disabled={busy} className="btn-ghost text-xs">
                {t("auto.reset")}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="mb-3 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/8 p-3 text-xs text-[var(--warning)]">
        {t("auto.disclaimer")}
      </div>
      {running && (
        <div className="mb-3 rounded-xl border border-[var(--positive)]/40 bg-[var(--positive)]/8 p-3 text-xs text-[var(--positive)]">
          {t("auto.schedulerOn", { min: 10 })}
        </div>
      )}
      {running && (
        <p className="mb-3 text-xs text-[var(--muted)]">{t("auto.howItWorks")}</p>
      )}
      {cycleMsg && (
        <div className="mb-4 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-3 text-sm text-[var(--accent)]">
          {cycleMsg}
        </div>
      )}

      {loading ? (
        <p className="text-[var(--muted)]">{t("common.loading")}</p>
      ) : !running ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--muted)]">
          <p className="text-4xl mb-3">🤖</p>
          {t("auto.notStarted")}
        </div>
      ) : st ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Kpi label={t("auto.equity")} value={money(st.equity)} accent="var(--accent)" />
            <Kpi label={t("auto.pnl")} value={`${money(st.totalPnl)} (${pct(st.totalPnlPct)})`} tone={st.totalPnl >= 0 ? "pos" : "neg"} />
            <Kpi label={t("auto.cash")} value={money(st.cash)} accent="var(--accent-2)" />
            <Kpi label={t("auto.positions")} value={String(st.positions.length)} sub={st.lastRun ? t("auto.lastRun", { t: relativeTime(st.lastRun, t) }) : undefined} accent="var(--accent-3)" />
          </div>

          {snap!.market && (
            <p className="-mt-2 mb-5 text-xs" style={{ color: snap!.market.open ? "var(--positive)" : "var(--muted)" }}>
              {snap!.market.open ? t("auto.marketOpen") : t("auto.marketClosed")}
            </p>
          )}

          {/* Equity curve (paper) */}
          {snap!.equity.length > 1 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-5">
              <p className="text-sm font-medium mb-2">{t("auto.equity")}</p>
              <Spark data={snap!.equity.map((e) => e.equity)} baseline={st.initialCapital} />
            </div>
          )}

          {/* Positions */}
          <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">{t("auto.positions")}</h2>
          {st.positions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-[var(--muted)] mb-6">{t("auto.noPositions")}</p>
          ) : (
            <div className="rounded-xl border border-[var(--border)] overflow-hidden mb-6 overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t("common.symbol")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("auto.weight")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("common.price")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("track.marketValue")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("perf.colPnl")}</th>
                  </tr>
                </thead>
                <tbody>
                  {st.positions.map((p) => (
                    <tr key={p.ticker} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2"><span className="font-mono font-medium">{p.ticker}</span> <span className="text-[var(--muted)] text-xs">{p.name}</span></td>
                      <td className="px-3 py-2 text-right font-mono">{p.weight}%</td>
                      <td className="px-3 py-2 text-right">{money(p.price)}</td>
                      <td className="px-3 py-2 text-right">{money(p.value)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: p.pnl >= 0 ? "var(--positive)" : "var(--negative)" }}>{money(p.pnl)} ({pct(p.pnlPct)})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Bot trades (concrete proof of what it executed) */}
          <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">{t("auto.trades")}</h2>
          {snap!.trades.length === 0 ? (
            <p className="text-[var(--muted)] text-sm mb-6">{t("auto.tradesEmpty")}</p>
          ) : (
            <div className="rounded-xl border border-[var(--border)] overflow-hidden mb-6 overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t("track.colDate")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("common.symbol")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("track.colType")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("common.shares")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("common.price")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("auto.colReason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {snap!.trades.map((tr, i) => (
                    <tr key={i} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 text-[var(--muted)]">{new Date(tr.executedAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 font-mono">{tr.ticker}</td>
                      <td className="px-3 py-2" style={{ color: tr.action === "BUY" ? "var(--positive)" : "var(--negative)" }}>{tr.action}</td>
                      <td className="px-3 py-2 text-right">{tr.shares}</td>
                      <td className="px-3 py-2 text-right">{money(tr.price)}</td>
                      <td className="px-3 py-2 text-[var(--muted)] text-xs">{tr.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Data flow & decisions log */}
          <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">{t("auto.flow")}</h2>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 mb-6 max-h-80 overflow-y-auto space-y-1 font-mono text-xs">
            {snap!.log.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-[var(--muted)] shrink-0">{l.ts.slice(11, 19)}</span>
                <span className="shrink-0" style={{ color: KIND_COLOR[l.kind] ?? "var(--muted)" }}>[{l.kind}]</span>
                <span>{l.message}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* Strategy backtest */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">{t("auto.btTitle")}</h2>
          <button onClick={runBacktest} disabled={btRunning} className="btn-ghost text-xs border border-[var(--border)]">
            {btRunning ? t("auto.btRunning") : t("auto.btRun")}
          </button>
        </div>
        {bt && bt.years > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label={t("auto.stratCagr")} value={pct(bt.cagr)} tone={bt.cagr >= 0 ? "pos" : "neg"} />
              <Kpi label={t("auto.stratDD")} value={`-${bt.maxDrawdown}%`} tone="neg" />
              <Kpi label={t("auto.benchCagr")} value={pct(bt.benchCagr)} accent="var(--muted)" />
              <Kpi label={t("auto.benchDD")} value={`-${bt.benchMaxDrawdown}%`} accent="var(--muted)" />
            </div>
            {bt.equity.length > 1 && (
              <div className="mt-4">
                <Spark data={bt.equity.map((e) => e.equity)} baseline={10000} data2={bt.equity.map((e) => e.bench)} />
                <p className="text-[10px] text-[var(--muted)] mt-1">— strategia · — S&amp;P 500 · {bt.years} anni</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Spark({ data, baseline, data2 }: { data: number[]; baseline: number; data2?: number[] }) {
  const w = 720, h = 160, pad = 6;
  const all = [...data, ...(data2 ?? []), baseline];
  const min = Math.min(...all), max = Math.max(...all), range = max - min || 1;
  const x = (i: number, n: number) => pad + (i / (n - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad);
  const path = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i, arr.length).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const up = data[data.length - 1] >= baseline;
  const color = up ? "var(--positive)" : "var(--negative)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 160 }}>
      <line x1={pad} x2={w - pad} y1={y(baseline)} y2={y(baseline)} stroke="var(--border)" strokeDasharray="4 4" />
      {data2 && <path d={path(data2)} fill="none" stroke="var(--muted)" strokeWidth="1.4" opacity="0.7" />}
      <path d={path(data)} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function Kpi({ label, value, sub, tone, accent }: { label: string; value: string; sub?: string; tone?: "pos" | "neg"; accent?: string }) {
  const color = tone === "pos" ? "var(--positive)" : tone === "neg" ? "var(--negative)" : accent ?? "var(--foreground)";
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <span className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="text-lg font-bold font-mono mt-0.5" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--muted)]">{sub}</p>}
    </div>
  );
}
