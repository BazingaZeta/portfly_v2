"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { money, pct } from "@/lib/format";
import { useI18n } from "@/components/I18nProvider";
import { useRisk } from "@/components/RiskProvider";
import { LogoBadge } from "@/components/LogoBadge";
import { ChannelChart } from "@/components/ChannelChart";
import { PortfolioEquityPanel } from "@/components/PortfolioEquityPanel";
import { useLivePrices, LivePrice, LiveBadge, applyLivePrices } from "@/components/LivePrice";
import type { MarketStatus } from "@/lib/marketHours";
import { positionSize } from "@/lib/risk";
import { INDICES } from "@/lib/indices";
import type { RegressionChannel } from "@/lib/regression";

interface Leader {
  ticker: string;
  name: string;
  price: number;
  ret20: number;
  contributionPct: number;
  channel: RegressionChannel;
  rsRising: boolean;
  rsSlopePctPerDay: number;
  signal: "BUY" | "WAIT" | "AVOID";
  zone: "lower" | "mid" | "upper";
  entry: number;
  stop: number;
  target: number;
  spark: number[];
}
interface BtSummary {
  trades: number; winRate: number; avgWin: number; avgLoss: number;
  profitFactor: number; expectancy: number; maxDrawdown: number;
  totalReturn: number; cagr: number; finalEquity: number;
}
interface IndexBacktest {
  summary: BtSummary;
  is: BtSummary;
  oos: BtSummary;
  splitDate: string;
  signalsTotal: number;
  signalsTaken: number;
  config: { accountSize: number; riskPct: number };
}
interface IndexPosition {
  indexKey: string;
  ticker: string;
  name: string;
  shares: number;
  avgCost: number;
  priceStale?: boolean;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  stop: number | null;
  target: number | null;
  stopHit: boolean;
  targetHit: boolean;
}
interface IndexTrade {
  ticker: string;
  name: string;
  action: string;
  shares: number;
  price: number;
  executedAt: string;
  realizedPnl: number | null;
}

export default function IndexTraderPage() {
  const { t } = useI18n();
  const [indexKey, setIndexKey] = useState("SP500");
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<IndexPosition[]>([]);
  const [trades, setTrades] = useState<IndexTrade[]>([]);
  const { accountSize, riskPct } = useRisk();
  const [bt, setBt] = useState<IndexBacktest | null>(null);
  const [btRunning, setBtRunning] = useState(false);
  const [btProgress, setBtProgress] = useState<string>("");

  const loadPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/index/trades", { cache: "no-store" });
      const data = await res.json();
      setPositions(data.positions ?? []);
      setTrades(data.trades ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // Deferito di un tick: setState sincrono nel corpo dell'effect causa render a cascata.
    const t = setTimeout(loadPositions, 0);
    const id = setInterval(loadPositions, 30_000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [loadPositions]);

  // Prezzi live ~5s: aggiorna prezzo e P&L delle posizioni senza ricaricare tutto.
  const { prices: livePrices, market } = useLivePrices(positions.map((p) => p.ticker));
  const livePositions = useMemo(
    () => applyLivePrices(positions, livePrices),
    [positions, livePrices],
  );

  function analyze() {
    setAnalyzing(true);
    setError(null);
    setLeaders(null);
    setProgress({ current: 0, total: 1, message: "…" });
    const es = new EventSource(`/api/index/analyze?index=${indexKey}`);
    es.addEventListener("progress", (e) => setProgress(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("complete", (e) => {
      setLeaders(JSON.parse((e as MessageEvent).data).leaders ?? []);
      es.close();
      setAnalyzing(false);
    });
    es.addEventListener("error", (e) => {
      setError((e as MessageEvent).data ? JSON.parse((e as MessageEvent).data).message : "Connessione interrotta");
      es.close();
      setAnalyzing(false);
    });
  }

  function runBt() {
    setBtRunning(true);
    setBt(null);
    setBtProgress("…");
    const qs = `index=${indexKey}&risk=${riskPct}&account=${accountSize}`;
    const es = new EventSource(`/api/index/backtest?${qs}`);
    es.addEventListener("progress", (e) => setBtProgress(JSON.parse((e as MessageEvent).data).message));
    es.addEventListener("complete", (e) => { setBt(JSON.parse((e as MessageEvent).data)); es.close(); setBtRunning(false); });
    es.addEventListener("error", () => { es.close(); setBtRunning(false); });
  }

  const pctDone = progress && progress.total ? (progress.current / progress.total) * 100 : 0;
  const buyable = leaders?.filter((l) => l.signal === "BUY") ?? [];
  const others = leaders?.filter((l) => l.signal !== "BUY") ?? [];

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">{t("idx.title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t("idx.subtitle")}</p>
      </header>

      <PortfolioEquityPanel strategy="index" />

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[var(--muted)]">{t("idx.index")}</span>
          <select value={indexKey} onChange={(e) => setIndexKey(e.target.value)} className="input">
            {INDICES.map((i) => (
              <option key={i.key} value={i.key}>{i.label}</option>
            ))}
          </select>
        </label>
        <button onClick={analyze} disabled={analyzing} className="btn-primary">
          {analyzing ? t("idx.analyzing") : t("idx.analyze")}
        </button>
        <button onClick={runBt} disabled={btRunning} className="btn-ghost border border-[var(--border)]">
          {btRunning ? t("idx.backtestRunning") : t("idx.backtestRun")}
        </button>
      </div>

      {btRunning && (
        <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
          {t("idx.backtestTitle")} — {btProgress}
        </div>
      )}
      {bt && <IndexBacktestPanel bt={bt} t={t} />}

      {analyzing && progress && (
        <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--muted)] mb-2">{progress.message}</p>
          <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
            <div className="h-full bg-[var(--accent)] transition-all duration-300" style={{ width: `${pctDone}%` }} />
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-[var(--negative)] bg-[var(--negative)]/10 p-4 text-sm text-[var(--negative)]">
          {error}
        </div>
      )}

      {/* Open positions (isolated) */}
      {positions.length > 0 && <PositionsPanel positions={livePositions} onChanged={loadPositions} market={market} t={t} />}

      {/* Closed trades & realized P&L (isolated to the Index Trader) */}
      <ClosedPanel trades={trades} t={t} />

      {!leaders && !analyzing && (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--muted)]">
          <p className="text-4xl mb-3">📊</p>
          {t("idx.empty")}
        </div>
      )}

      {leaders && (
        <>
          <div className="mb-4 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/8 p-3 text-sm text-[var(--warning)]">
            {t("idx.noEdge")}
          </div>
          <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">
            {t("idx.leaders")}
          </h2>
          {buyable.length === 0 && (
            <p className="text-sm text-[var(--muted)] mb-4">{t("idx.noLeaders")}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {buyable.map((l) => (
              <LeaderCard key={l.ticker} leader={l} indexKey={indexKey} onBought={loadPositions} t={t} />
            ))}
          </div>

          {/* Other leaders (driving the index but not a buy right now) */}
          {others.length > 0 && (
            <div className="mt-6 rounded-xl border border-[var(--border)] overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t("common.symbol")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("idx.contribution")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("idx.ret20")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("idx.r2")}</th>
                    <th className="px-3 py-2 text-center font-medium">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {others.map((l) => (
                    <tr key={l.ticker} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 font-mono">{l.ticker}</td>
                      <td className="px-3 py-2 text-right">{l.contributionPct}%</td>
                      <td className="px-3 py-2 text-right" style={{ color: l.ret20 >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(l.ret20)}</td>
                      <td className="px-3 py-2 text-right">{l.channel.r2}</td>
                      <td className="px-3 py-2 text-center">{l.channel.trend === "asc" ? "↗" : l.channel.trend === "desc" ? "↘" : "→"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LeaderCard({
  leader,
  indexKey,
  onBought,
  t,
}: {
  leader: Leader;
  indexKey: string;
  onBought: () => void;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  const { accountSize, riskPct } = useRisk();
  const size = positionSize(accountSize, riskPct, leader.entry, leader.stop);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function buy() {
    setSaving(true);
    try {
      const res = await fetch("/api/index/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          indexKey,
          ticker: leader.ticker,
          name: leader.name,
          action: "BUY",
          shares: size ? size.shares : 1,
          price: leader.entry,
          target: leader.target,
          stop: leader.stop,
        }),
      });
      if (res.ok) {
        setDone(true);
        onBought();
      }
    } finally {
      setSaving(false);
    }
  }

  const zoneLabel = t(leader.zone === "lower" ? "idx.zoneLower" : leader.zone === "upper" ? "idx.zoneUpper" : "idx.zoneMid");

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden card-hover">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <LogoBadge ticker={leader.ticker} size={26} />
          <span className="font-mono font-semibold text-lg">{leader.ticker}</span>
          <span className="text-sm text-[var(--muted)] truncate">{leader.name}</span>
          {leader.rsRising && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-medium">
              {t("idx.rs")}
            </span>
          )}
          <span className={`${leader.rsRising ? "" : "ml-auto"} text-xs px-2.5 py-0.5 rounded-full font-bold text-[#06121f]`}
            style={{ background: "linear-gradient(120deg, var(--positive), var(--accent-2))" }}>
            {t("idx.sigBUY")}
          </span>
        </div>

        {/* contribution + stats */}
        <div className="flex items-center gap-3 text-xs text-[var(--muted)] mb-2">
          <span>{t("idx.contribution")} <span className="text-[var(--accent-2)] font-mono">{leader.contributionPct}%</span></span>
          <span>·</span>
          <span>{t("idx.ret20")} <span className="font-mono" style={{ color: leader.ret20 >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(leader.ret20)}</span></span>
          <span>·</span>
          <span>R² <span className="font-mono">{leader.channel.r2}</span></span>
        </div>

        <ChannelChart closes={leader.spark} channel={leader.channel} />
        <p className="text-[10px] text-[var(--muted)] mt-1">{t("idx.channel")} · {zoneLabel}</p>

        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-[11px] uppercase text-[var(--muted)]">{t("card.entry")}</p>
            <p className="font-mono font-medium">{money(leader.entry)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-[var(--muted)]">{t("card.target")}</p>
            <p className="font-mono font-medium" style={{ color: "var(--positive)" }}>{money(leader.target)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-[var(--muted)]">{t("card.stop")}</p>
            <p className="font-mono font-medium" style={{ color: "var(--negative)" }}>{money(leader.stop)}</p>
          </div>
        </div>
        {size && (
          <p className="mt-2 text-xs text-[var(--accent-2)]">
            {t("card.sizing", { shares: size.shares, cost: money(size.cost), risk: money(size.dollarRisk) })}
          </p>
        )}
      </div>
      <div className="px-4 py-3 bg-[var(--surface-2)] border-t border-[var(--border)]">
        {done ? (
          <p className="text-sm text-[var(--positive)]">{t("card.bought")}</p>
        ) : (
          <button onClick={buy} disabled={saving} className="btn-primary">
            {saving ? t("common.saving") : t("idx.buy")}
          </button>
        )}
      </div>
    </div>
  );
}

function IndexBacktestPanel({
  bt,
  t,
}: {
  bt: IndexBacktest;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  const s = bt.summary;
  const o = bt.oos;
  const verdict =
    o.profitFactor >= 1.1 && o.expectancy > 0
      ? { key: "bt.verdictHold", color: "var(--positive)" }
      : o.profitFactor >= 1.0
      ? { key: "bt.verdictWeak", color: "var(--warning)" }
      : { key: "bt.verdictFail", color: "var(--negative)" };
  const pf = (x: number) => (x >= 999 ? "∞" : x.toFixed(2));
  const sign = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

  return (
    <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-medium mb-1">{t("idx.backtestTitle")}</h2>
      <p className="text-xs text-[var(--muted)] mb-3">{t("idx.backtestHint")}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Kpi label={t("bt.totalReturn")} value={sign(s.totalReturn)} tone={s.totalReturn >= 0 ? "pos" : "neg"} />
        <Kpi label={t("perf.winRate")} value={`${s.winRate}%`} accent="var(--accent-2)" />
        <Kpi label={t("bt.profitFactor")} value={pf(s.profitFactor)} tone={s.profitFactor >= 1 ? "pos" : "neg"} />
        <Kpi label={t("bt.maxDrawdown")} value={`-${s.maxDrawdown}%`} tone="neg" />
        <Kpi label={t("bt.cagr")} value={sign(s.cagr)} tone={s.cagr >= 0 ? "pos" : "neg"} />
        <Kpi label={t("bt.finalEquity")} value={money(s.finalEquity)} tone={s.finalEquity >= bt.config.accountSize ? "pos" : "neg"} />
        <Kpi label={t("bt.trades")} value={String(s.trades)} accent="var(--accent-3)" />
        <Kpi label="Expectancy (R)" value={s.expectancy.toFixed(3)} tone={s.expectancy >= 0 ? "pos" : "neg"} />
      </div>
      <p className="text-xs text-[var(--muted)] mb-3">
        {t("bt.coverage", { taken: bt.signalsTaken, total: bt.signalsTotal })}
      </p>
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
            {[
              { l: t("bt.profitFactor"), is: pf(bt.is.profitFactor), oos: pf(o.profitFactor) },
              { l: t("perf.winRate"), is: `${bt.is.winRate}%`, oos: `${o.winRate}%` },
              { l: t("bt.totalReturn"), is: sign(bt.is.totalReturn), oos: sign(o.totalReturn) },
              { l: "Expectancy (R)", is: bt.is.expectancy.toFixed(3), oos: o.expectancy.toFixed(3) },
              { l: t("bt.trades"), is: String(bt.is.trades), oos: String(o.trades) },
            ].map((r) => (
              <tr key={r.l} className="border-t border-[var(--border)]">
                <td className="px-3 py-2 text-[var(--muted)]">{r.l}</td>
                <td className="px-3 py-2 text-right font-mono">{r.is}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{r.oos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm font-medium" style={{ color: verdict.color }}>{t(verdict.key)}</p>
    </div>
  );
}

function Kpi({ label, value, tone, accent }: { label: string; value: string; tone?: "pos" | "neg"; accent?: string }) {
  const color = tone === "pos" ? "var(--positive)" : tone === "neg" ? "var(--negative)" : accent ?? "var(--foreground)";
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <span className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="text-lg font-bold font-mono mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}

function ClosedPanel({
  trades,
  t,
}: {
  trades: IndexTrade[];
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  const sells = trades.filter((tr) => tr.action === "SELL");
  if (sells.length === 0) return null;
  const realizedTotal = sells.reduce((s, tr) => s + (tr.realizedPnl ?? 0), 0);
  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">
        {t("idx.realizedTitle")}
      </h2>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-3 inline-flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-[var(--muted)]">{t("idx.realizedTotal")}</span>
        <span className="text-xl font-bold font-mono" style={{ color: realizedTotal >= 0 ? "var(--positive)" : "var(--negative)" }}>
          {money(realizedTotal)}
        </span>
      </div>
      <div className="rounded-xl border border-[var(--border)] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t("track.colDate")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("common.symbol")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("common.shares")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("track.sellPrice")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("perf.colPnl")}</th>
            </tr>
          </thead>
          <tbody>
            {sells.map((tr, i) => (
              <tr key={i} className="border-t border-[var(--border)]">
                <td className="px-3 py-2 text-[var(--muted)]">{new Date(tr.executedAt).toLocaleDateString()}</td>
                <td className="px-3 py-2"><span className="font-mono">{tr.ticker}</span> <span className="text-[var(--muted)] text-xs">{tr.name}</span></td>
                <td className="px-3 py-2 text-right">{tr.shares}</td>
                <td className="px-3 py-2 text-right">{money(tr.price)}</td>
                <td className="px-3 py-2 text-right font-mono" style={{ color: (tr.realizedPnl ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }}>
                  {tr.realizedPnl != null ? money(tr.realizedPnl) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PositionsPanel({
  positions,
  onChanged,
  market,
  t,
}: {
  positions: IndexPosition[];
  onChanged: () => void;
  market?: MarketStatus;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  async function sell(p: IndexPosition) {
    await fetch("/api/index/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ indexKey: p.indexKey, ticker: p.ticker, action: "SELL", shares: p.shares, price: p.currentPrice }),
    });
    onChanged();
  }

  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3 flex items-center gap-2">
        {t("idx.positions")}
        {market && <LiveBadge market={market} />}
      </h2>
      <div className="rounded-xl border border-[var(--border)] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t("common.symbol")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("common.shares")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("track.colAvgCost")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("common.price")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("card.stop")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("perf.colPnl")}</th>
              <th className="px-3 py-2 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.ticker} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <LogoBadge ticker={p.ticker} size={20} />
                    <span className="font-mono font-medium">{p.ticker}</span>
                    {p.stopHit && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--negative)]/15 text-[var(--negative)]">⛔ {t("card.stop")}</span>}
                    {p.targetHit && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--positive)]/15 text-[var(--positive)]">🎯 {t("card.target")}</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{p.shares}</td>
                <td className="px-3 py-2 text-right">{money(p.avgCost)}</td>
                <td className="px-3 py-2 text-right font-mono">{p.priceStale && <span title="Quote live non disponibile: mostrato il costo medio" className="text-[var(--warning)] mr-1">⚠</span>}<LivePrice price={p.currentPrice} format={money} /></td>
                <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--negative)" }}>{p.stop != null ? money(p.stop) : "—"}</td>
                <td className="px-3 py-2 text-right" style={{ color: p.unrealizedPnl >= 0 ? "var(--positive)" : "var(--negative)" }}>
                  {money(p.unrealizedPnl)} ({pct(p.unrealizedPnlPct)})
                </td>
                <td className="px-3 py-2 text-right">
                  <button className="btn-danger" onClick={() => sell(p)}>{t("track.sold")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
