"use client";

import { useCallback, useEffect, useState } from "react";
import { money, pct, relativeTime } from "@/lib/format";
import { useI18n } from "@/components/I18nProvider";

// Pannello autopilot riutilizzabile, parametrizzato per "traccia": due bot
// indipendenti (main = azioni/rotazione, crypto = Crypto Trend), ciascuno col
// suo conto simulato. La traccia crypto è dedicata alla strategia crypto_trend
// (nessun selettore); la main mantiene rotation/dual_momentum.

type Track = "main" | "crypto";

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
type StrategyKey = "dual_momentum" | "rotation" | "crypto_trend";
interface StrategyInfo {
  strategy: StrategyKey;
  label: string;
  rotation: { bull: string; defensive: string; smaPeriod: number };
  crypto?: { assets: string[]; smaPeriod: number; hysteresisPct: number };
}
interface KillInfo { paused: boolean; maxDdPct: number; peakEquity: number | null; telegram: boolean; }
interface Snapshot { state: State; strategy?: StrategyInfo; market?: { open: boolean; state: string; asOf: string | null }; log: LogEntry[]; trades: Trade[]; equity: { date: string; equity: number }[]; kill?: KillInfo; }
interface Backtest {
  cagr: number; totalReturn: number; maxDrawdown: number; benchCagr: number;
  benchMaxDrawdown: number; years: number; equity: { date: string; equity: number; bench: number }[];
  benchLabel?: string;
}

const KIND_COLOR: Record<string, string> = {
  run: "var(--accent)", analysis: "var(--muted)", decision: "var(--accent-2)",
  trade: "var(--positive)", start: "var(--accent-3)",
};

export function AutopilotPanel({ track, heading, subtitle }: { track: Track; heading: string; subtitle: string }) {
  const { t } = useI18n();
  const isCrypto = track === "crypto";
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bt, setBt] = useState<Backtest | null>(null);
  const [btRunning, setBtRunning] = useState(false);
  const [cycleMsg, setCycleMsg] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<StrategyKey>(isCrypto ? "crypto_trend" : "rotation");

  const load = useCallback(async () => {
    const res = await fetch(`/api/autopilot?track=${track}`, { cache: "no-store" });
    const data = await res.json();
    setSnap(data);
    setLoading(false);
  }, [track]);

  useEffect(() => {
    // Deferito di un tick: setState sincrono nel corpo dell'effect causa render a cascata.
    const timer = setTimeout(() => {
      load();
      runBacktest(); // show the strategy chart immediately (live equity needs several days)
    }, 0);
    const id = setInterval(load, 60_000); // refresh P&L while open
    return () => { clearTimeout(timer); clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function act(action: string, force = false) {
    setBusy(true);
    setCycleMsg(null);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "start" ? { action, force, track, strategy } : { action, force, track }),
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

  async function runBacktest(which?: StrategyKey) {
    setBtRunning(true);
    try {
      const strat = isCrypto ? "crypto_trend" : (which ?? snap?.strategy?.strategy ?? strategy);
      if (strat === "rotation" || strat === "crypto_trend") {
        const url = strat === "rotation"
          ? "/api/rotation/backtest?years=5"
          : "/api/crypto/backtest?folds=5";
        const res = await fetch(url, { cache: "no-store" });
        const r = await res.json();
        if (res.ok) {
          // rotation → spyEquity/spyCagr ; crypto_trend → benchEquity/benchCagr (BTC)
          const benchCurve = (r.benchEquity ?? r.spyEquity) as { date: string; equity: number }[];
          const bench = new Map<string, number>(benchCurve.map((p) => [p.date, p.equity]));
          setBt({
            cagr: r.cagr, totalReturn: r.totalReturn, maxDrawdown: r.maxDrawdown,
            benchCagr: r.benchCagr ?? r.spyCagr,
            benchMaxDrawdown: r.benchMaxDrawdown ?? r.spyMaxDrawdown,
            years: r.years,
            benchLabel: strat === "crypto_trend" ? "Bitcoin (buy&hold)" : "S&P 500",
            equity: (r.equity as { date: string; equity: number }[]).map((p) => ({
              date: p.date, equity: p.equity, bench: bench.get(p.date) ?? p.equity,
            })),
          });
        }
      } else {
        const res = await fetch("/api/autopilot/backtest", { cache: "no-store" });
        setBt({ ...(await res.json()), benchLabel: "S&P 500" });
      }
    } finally {
      setBtRunning(false);
    }
  }

  const st = snap?.state;
  const running = st?.running;
  // Heartbeat lato UI: bot avviato ma ultimo ciclo più vecchio di 36h → il cron
  // è probabilmente fermo (stessa soglia di lib/heartbeat).
  const staleHours =
    running && st?.lastRun ? (Date.now() - new Date(st.lastRun).getTime()) / 3_600_000 : 0;
  const heartbeatStale = staleHours > 36;

  return (
    <div className="max-w-4xl mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight gradient-text">{heading}</h1>
          <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">{subtitle}</p>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          {!running ? (
            <>
              {!isCrypto && (
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase text-[var(--muted)]">{t("auto.strategy")}</span>
                  <select
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value as StrategyKey)}
                    className="input text-sm"
                    disabled={busy}
                  >
                    <option value="rotation">{t("auto.strategyRotation")}</option>
                    <option value="dual_momentum">{t("auto.strategyDual")}</option>
                  </select>
                </label>
              )}
              <button onClick={() => act("start")} disabled={busy} className="btn-primary whitespace-nowrap">
                {busy ? t("auto.running") : t("auto.start")}
              </button>
            </>
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
      {heartbeatStale && (
        <div className="mb-3 rounded-xl border border-[var(--warning)]/50 bg-[var(--warning)]/10 p-3 text-sm text-[var(--warning)] flex flex-wrap items-center justify-between gap-3">
          <span>
            ⚠️ <strong>Bot fermo</strong>: nessun ciclo da {Math.round(staleHours)}h (atteso ~24h).
            Il cron potrebbe non girare — esegui un ciclo ora e controlla CRON_SECRET su Vercel.
          </span>
          <button onClick={() => act("run")} disabled={busy} className="btn-primary text-xs px-3 py-1.5 shrink-0">
            ▶ Esegui ciclo ora
          </button>
        </div>
      )}
      {running && snap?.kill?.paused && (
        <div className="mb-3 rounded-xl border border-[var(--negative)]/50 bg-[var(--negative)]/10 p-3 text-sm text-[var(--negative)] flex flex-wrap items-center justify-between gap-3">
          <span>
            ⛔ <strong>Kill-switch attivo</strong>: il drawdown ha superato il {snap.kill.maxDdPct}% dal
            picco — il bot è in pausa e non opera. Riprendendo, il picco riparte dall&apos;equity attuale.
          </span>
          <button onClick={() => act("resume")} disabled={busy} className="btn-primary text-xs px-3 py-1.5 shrink-0">
            ▶ Riprendi
          </button>
        </div>
      )}
      {running && (
        <div className="mb-3 rounded-xl border border-[var(--positive)]/40 bg-[var(--positive)]/8 p-3 text-xs text-[var(--positive)]">
          {t("auto.schedulerDaily")}
          {snap?.strategy && (
            <span className="block mt-1 font-medium">
              {t("auto.activeStrategy", { s: snap.strategy.label })}
            </span>
          )}
          {snap?.kill && !snap.kill.paused && (
            <span className="block mt-1 text-[var(--muted)]">
              🛡️ Kill-switch: pausa automatica oltre il {snap.kill.maxDdPct}% di drawdown dal picco ·{" "}
              {snap.kill.telegram ? "🔔 notifiche Telegram attive" : "🔕 Telegram non configurato (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)"}
            </span>
          )}
        </div>
      )}
      {running && !isCrypto && (
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
          <div className="stagger grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Kpi label={t("auto.equity")} value={money(st.equity)} accent="var(--accent)" />
            <Kpi label={t("auto.pnl")} value={`${money(st.totalPnl)} (${pct(st.totalPnlPct)})`} tone={st.totalPnl >= 0 ? "pos" : "neg"} />
            <Kpi label={t("auto.cash")} value={money(st.cash)} accent="var(--accent-2)" />
            <Kpi label={t("auto.positions")} value={String(st.positions.length)} sub={st.lastRun ? t("auto.lastRun", { t: relativeTime(st.lastRun, t) }) : undefined} accent="var(--accent-3)" />
          </div>

          {snap!.market && !isCrypto && (
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
          <h2 className="text-sm font-medium">{isCrypto ? t("crypto.backtestHeading") : t("auto.btTitle")}</h2>
          <button onClick={() => runBacktest()} disabled={btRunning} className="btn-ghost text-xs border border-[var(--border)]">
            {btRunning ? t("auto.btRunning") : t("auto.btRun")}
          </button>
        </div>
        {bt && bt.years > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label={t("auto.stratCagr")} value={pct(bt.cagr)} tone={bt.cagr >= 0 ? "pos" : "neg"} />
              <Kpi label={t("auto.stratDD")} value={`-${bt.maxDrawdown}%`} tone="neg" />
              <Kpi label={isCrypto ? t("crypto.btcCagr") : t("auto.benchCagr")} value={pct(bt.benchCagr)} accent="var(--muted)" />
              <Kpi label={isCrypto ? t("crypto.btcDD") : t("auto.benchDD")} value={`-${bt.benchMaxDrawdown}%`} accent="var(--muted)" />
            </div>
            {bt.equity.length > 1 && (
              <div className="mt-4">
                <Spark data={bt.equity.map((e) => e.equity)} baseline={10000} data2={bt.equity.map((e) => e.bench)} />
                <p className="text-[10px] text-[var(--muted)] mt-1">— strategia · — {bt.benchLabel ?? "S&P 500"} · {bt.years} anni</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone, accent }: { label: string; value: string; sub?: string; tone?: "pos" | "neg"; accent?: string }) {
  const color = tone === "pos" ? "var(--positive)" : tone === "neg" ? "var(--negative)" : accent ?? "var(--foreground)";
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <span className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="text-lg font-bold font-mono mt-0.5" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--muted)] mt-0.5">{sub}</p>}
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
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible" style={{ height: h }}>
      <line x1={pad} x2={w - pad} y1={y(baseline)} y2={y(baseline)} stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
      {data2 && <path d={path(data2)} fill="none" stroke="var(--muted)" strokeWidth="1.4" opacity="0.7" />}
      <path d={path(data)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
