"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Position, Trade } from "@/lib/types";
import { money, pct } from "@/lib/format";
import { computeAlerts, targetProgress, type PositionAlert } from "@/lib/alerts";
import { nameFor } from "@/lib/universe";
import { LogoBadge } from "@/components/LogoBadge";
import { Sparkline } from "@/components/Sparkline";
import { useI18n } from "@/components/I18nProvider";
import { useRisk } from "@/components/RiskProvider";
import { openRisk } from "@/lib/risk";
import type { ExitSignal } from "@/lib/exits";

export default function TrackPage() {
  const { t } = useI18n();
  const { accountSize } = useRisk();
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [sellFor, setSellFor] = useState<Position | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("default");
  const [exitSignals, setExitSignals] = useState<ExitSignal[]>([]);
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const notified = useRef<Set<string>>(new Set());

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch("/api/trades", { cache: "no-store" });
      const data = await res.json();
      setPositions(data.positions ?? []);
      setTrades(data.trades ?? []);
      setUpdatedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExits = useCallback(async () => {
    try {
      const res = await fetch("/api/exit-signals", { cache: "no-store" });
      const data = await res.json();
      setExitSignals(data.signals ?? []);
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(true), 0); // deferito: no setState sincrono nell'effect
    // Auto-refresh prices/P&L every 30s while the page is open.
    const id = setInterval(() => load(false), 30_000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [load]);

  useEffect(() => {
    const t = setTimeout(loadExits, 0);
    // Exit re-evaluation is heavier (candles + news) — refresh every 2 minutes.
    const id = setInterval(loadExits, 120_000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [loadExits]);

  // Fetch price sparklines once per distinct set of open tickers.
  const tickerKey = [...new Set(positions.map((p) => p.ticker))].sort().join(",");
  useEffect(() => {
    if (!tickerKey) return;
    fetch(`/api/sparkline?tickers=${tickerKey}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSparks(d.series ?? {}))
      .catch(() => {});
  }, [tickerKey]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (typeof Notification !== "undefined") setNotifPerm(Notification.permission);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const alerts = computeAlerts(positions);
  // Fire a desktop notification for each newly-triggered actionable signal
  // (target/stop hit, or a thesis-based exit signal).
  useEffect(() => {
    const notifiable: { key: string; body: string }[] = [
      ...alerts
        .filter((a) => a.type === "target" || a.type === "stop")
        .map((a) => ({ key: a.key, body: a.message })),
      ...exitSignals.map((e) => ({ key: `exit-${e.ticker}-${e.type}`, body: `${e.ticker}: ${e.message}` })),
    ];
    const active = new Set(notifiable.map((n) => n.key));
    for (const key of notified.current) {
      if (!active.has(key)) notified.current.delete(key);
    }
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const n of notifiable) {
      if (notified.current.has(n.key)) continue;
      notified.current.add(n.key);
      new Notification("Finance Bot — segnale di uscita", { body: n.body });
    }
  }, [alerts, exitSignals]);

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
  }

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalCost = positions.reduce((s, p) => s + p.costBasis, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0;
  const totalOpenRisk = positions.reduce((s, p) => s + openRisk(p.shares, p.currentPrice, p.stop), 0);
  const heatPct = accountSize > 0 ? (totalOpenRisk / accountSize) * 100 : 0;
  const heatColor = heatPct > 6 ? "var(--negative)" : heatPct > 3 ? "var(--warning)" : "var(--positive)";

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">{t("track.title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          {t("track.subtitle")}
          {updatedAt && (
            <span className="ml-1 inline-flex items-center gap-1.5">
              ·
              <span className="live-dot inline-block size-2 rounded-full bg-[var(--positive)]" />
              {t("track.liveUpdated", { time: updatedAt.toLocaleTimeString() })}
            </span>
          )}
        </p>
      </header>

      {/* Exit alerts */}
      {alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.map((a) => (
            <AlertBanner key={a.key} alert={a} onSell={() => {
              const pos = positions.find((p) => p.ticker === a.ticker);
              if (pos) setSellFor(pos);
            }} />
          ))}
        </div>
      )}

      {/* Thesis-based exit signals */}
      {exitSignals.length > 0 && (
        <div className="mb-6 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/8 p-4">
          <p className="text-xs font-medium text-[var(--warning)] uppercase tracking-wide mb-2">
            {t("track.exitSignalsHeader")}
          </p>
          <ul className="space-y-1.5">
            {exitSignals.map((e, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="font-mono font-medium shrink-0">{e.ticker}</span>
                <span style={{ color: e.tone === "negative" ? "var(--negative)" : "var(--warning)" }}>
                  {e.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Notifications opt-in */}
      {positions.length > 0 && notifPerm !== "granted" && (
        <button onClick={enableNotifications} className="btn-ghost mb-6 text-sm border border-[var(--border)]">
          {t("track.enableNotif")}
        </button>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <SummaryCard label={t("track.marketValue")} value={money(totalValue)} />
        <SummaryCard label={t("track.cost")} value={money(totalCost)} />
        <SummaryCard
          label={t("track.unrealizedPnl")}
          value={money(totalPnl)}
          sub={pct(totalPnlPct)}
          tone={totalPnl >= 0 ? "pos" : "neg"}
        />
      </div>

      {positions.length > 0 && (
        <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 flex items-center gap-3">
          <span className="text-xs uppercase tracking-wide text-[var(--muted)]">{t("track.heat")}</span>
          <span className="font-mono font-semibold" style={{ color: heatColor }}>
            {money(totalOpenRisk)}
          </span>
          <span className="text-xs text-[var(--muted)]">
            {t("track.heatHint", { pct: heatPct.toFixed(1) })}
          </span>
          <div className="ml-auto h-2 w-32 rounded-full bg-[var(--surface-2)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.min(heatPct * 8, 100)}%`, background: heatColor }} />
          </div>
        </div>
      )}

      <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">
        {t("track.openPositions")}
      </h2>
      {loading ? (
        <p className="text-[var(--muted)]">{t("common.loading")}</p>
      ) : positions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted)]">
          {t("track.noPositions")}
        </p>
      ) : (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden mb-8 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
              <tr>
                <Th>{t("common.symbol")}</Th>
                <Th right>{t("common.shares")}</Th>
                <Th right>{t("track.colAvgCost")}</Th>
                <Th right>{t("common.price")}</Th>
                <Th>{t("track.colTrend")}</Th>
                <Th>{t("track.colStopTarget")}</Th>
                <Th right>{t("perf.colPnl")}</Th>
                <Th right></Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <PositionRow key={p.ticker} p={p} spark={sparks[p.ticker]} onSell={() => setSellFor(p)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">
        {t("track.history")}
      </h2>
      {trades.length === 0 ? (
        <p className="text-[var(--muted)] text-sm">{t("track.noTrades")}</p>
      ) : (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
              <tr>
                <Th>{t("track.colDate")}</Th>
                <Th>{t("common.symbol")}</Th>
                <Th>{t("track.colType")}</Th>
                <Th right>{t("common.shares")}</Th>
                <Th right>{t("common.price")}</Th>
                <Th>{t("track.colStatus")}</Th>
                <Th>{t("common.notes")}</Th>
              </tr>
            </thead>
            <tbody>
              {trades.map((tr) => (
                <tr key={tr.id} className="border-t border-[var(--border)]">
                  <Td>{new Date(tr.executedAt).toLocaleDateString()}</Td>
                  <Td><span className="font-mono">{tr.ticker}</span></Td>
                  <Td>
                    <span style={{ color: tr.action === "BUY" ? "var(--positive)" : "var(--negative)" }}>
                      {tr.action}
                    </span>
                  </Td>
                  <Td right>{tr.shares}</Td>
                  <Td right>{money(tr.price)}</Td>
                  <Td>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--surface-2)]">
                      {tr.status === "open" ? t("track.statusOpen") : t("track.statusClosed")}
                    </span>
                  </Td>
                  <Td><span className="text-[var(--muted)]">{tr.notes ?? "—"}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sellFor && (
        <SellModal
          position={sellFor}
          onClose={() => setSellFor(null)}
          onDone={() => {
            setSellFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function SellModal({
  position,
  onClose,
  onDone,
}: {
  position: Position;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [price, setPrice] = useState(String(position.currentPrice));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Route sell to the correct endpoint based on the position source
  function sellEndpoint() {
    if (position.source === "momentum") return "/api/momentum/trades";
    if (position.source === "index") return "/api/index/trades";
    return "/api/trades";
  }

  async function submit() {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return;
    setSaving(true);
    try {
      await fetch(sellEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: position.ticker,
          action: "SELL",
          shares: position.shares,
          price: p,
          notes: notes || null,
          indexKey: position.indexKey?.replace("MOMENTUM_", "") ?? "",
        }),
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const realized = (Number(price) - position.avgCost) * position.shares;

  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold mb-1">
          {t("track.sell")} <span className="font-mono">{position.ticker}</span>
          {nameFor(position.ticker) !== position.ticker && (
            <span className="text-[var(--muted)] font-normal"> · {nameFor(position.ticker)}</span>
          )}
        </h3>
        <p className="text-sm text-[var(--muted)] mb-4">
          {t("track.posSummary", { shares: position.shares, cost: money(position.avgCost) })}
        </p>
        <label className="flex flex-col gap-1 mb-3">
          <span className="text-xs uppercase text-[var(--muted)]">{t("track.sellPrice")}</span>
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="input" />
        </label>
        <label className="flex flex-col gap-1 mb-4">
          <span className="text-xs uppercase text-[var(--muted)]">{t("common.notes")}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" placeholder={t("common.optional")} />
        </label>
        <p className="text-sm mb-4">
          {t("track.estRealized")}{" "}
          <span style={{ color: realized >= 0 ? "var(--positive)" : "var(--negative)" }}>
            {money(realized)}
          </span>
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-ghost">{t("common.cancel")}</button>
          <button onClick={submit} disabled={saving} className="btn-primary">
            {saving ? t("common.saving") : t("track.confirmSell")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AlertBanner({ alert, onSell }: { alert: PositionAlert; onSell: () => void }) {
  const { t } = useI18n();
  const color =
    alert.tone === "positive"
      ? "var(--positive)"
      : alert.tone === "negative"
      ? "var(--negative)"
      : "var(--warning)";
  const icon = alert.type === "target" ? "🎯" : alert.type === "stop" ? "⛔" : "⚠️";
  const actionable = alert.type === "target" || alert.type === "stop";
  return (
    <div
      className="animate-in rounded-xl border p-3 flex items-center gap-3"
      style={{ borderColor: color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      <span className="text-lg">{icon}</span>
      <span className="text-sm flex-1" style={{ color }}>
        {alert.message}
      </span>
      {actionable && (
        <button className="btn-danger" onClick={onSell}>
          {t("track.sell")}
        </button>
      )}
    </div>
  );
}

function PositionRow({ p, spark, onSell }: { p: Position; spark?: number[]; onSell: () => void }) {
  const { t } = useI18n();
  const prev = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const before = prev.current;
    if (before != null && p.currentPrice !== before) {
      setFlash(p.currentPrice > before ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 900);
      prev.current = p.currentPrice;
      return () => clearTimeout(t);
    }
    prev.current = p.currentPrice;
  }, [p.currentPrice]);

  const flashCls = flash === "up" ? "flash-up" : flash === "down" ? "flash-down" : "";
  const progress = targetProgress(p);
  const targetHit = p.target != null && p.currentPrice >= p.target;
  const stopHit = p.stop != null && p.currentPrice <= p.stop;

  return (
    <tr className="border-t border-[var(--border)]">
      <Td>
        <div className="flex items-center gap-2">
          <LogoBadge ticker={p.ticker} size={22} />
          <span className="font-mono font-medium">{p.ticker}</span>
          {(p.name ?? nameFor(p.ticker)) !== p.ticker && (
            <span className="text-xs text-[var(--muted)] hidden sm:inline">{p.name ?? nameFor(p.ticker)}</span>
          )}
          {/* Source badge */}
          {p.source !== "main" && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              p.source === "momentum"
                ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                : "bg-[var(--warning)]/15 text-[var(--warning)]"
            }`}>
              {p.source === "momentum" ? "⚡ Momentum" : "🎯 Index"}
            </span>
          )}
          {targetHit && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--positive)]/15 text-[var(--positive)] font-medium">
              🎯 {t("card.target")}
            </span>
          )}
          {stopHit && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--negative)]/15 text-[var(--negative)] font-medium">
              ⛔ {t("card.stop")}
            </span>
          )}
        </div>
      </Td>
      <Td right>{p.shares}</Td>
      <Td right>{money(p.avgCost)}</Td>
      <Td right>
        {p.priceStale ? (
          <span
            className="rounded px-1 text-[var(--warning)]"
            title="Quote live non disponibile: mostrato il costo medio, P&L non affidabile"
          >
            ⚠ {money(p.currentPrice)}
          </span>
        ) : (
          <span className={`rounded px-1 ${flashCls}`}>
            {money(p.currentPrice)}
            {flash && <span className="ml-1 text-xs">{flash === "up" ? "▲" : "▼"}</span>}
          </span>
        )}
      </Td>
      <Td>
        {spark && spark.length > 1 ? (
          <Sparkline
            values={spark}
            live={p.currentPrice}
            width={96}
            height={32}
            refs={[{ value: p.avgCost, color: "var(--muted)", dashed: true }]}
          />
        ) : (
          <span className="text-xs text-[var(--muted)]">—</span>
        )}
      </Td>
      <Td>
        {progress == null ? (
          <span className="text-xs text-[var(--muted)]">—</span>
        ) : (
          <div className="w-32">
            <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden relative">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progress * 100}%`,
                  background: "linear-gradient(90deg, var(--negative), var(--warning), var(--positive))",
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-[var(--muted)] mt-0.5 font-mono">
              <span>{money(p.stop!)}</span>
              <span>{money(p.target!)}</span>
            </div>
          </div>
        )}
      </Td>
      <Td right>
        <span style={{ color: p.unrealizedPnl >= 0 ? "var(--positive)" : "var(--negative)" }}>
          {money(p.unrealizedPnl)} ({pct(p.unrealizedPnlPct)})
        </span>
      </Td>
      <Td right>
        <button className="btn-danger" onClick={onSell}>
          {t("track.sold")}
        </button>
      </Td>
    </tr>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
}) {
  const color = tone === "pos" ? "var(--positive)" : tone === "neg" ? "var(--negative)" : "var(--foreground)";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="text-lg font-semibold font-mono mt-1" style={{ color }}>{value}</p>
      {sub && <p className="text-sm font-mono" style={{ color }}>{sub}</p>}
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
function Td({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <td className={`px-3 py-2 ${right ? "text-right" : "text-left"}`}>{children}</td>;
}
