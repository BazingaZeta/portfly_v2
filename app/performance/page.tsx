"use client";

import { useEffect, useState } from "react";
import { money, pct } from "@/lib/format";
import { useI18n } from "@/components/I18nProvider";

interface ClosedTrade {
  id: number;
  ticker: string;
  shares: number;
  price: number;
  executedAt: string;
  realized: number;
  returnPct: number;
}

interface Summary {
  count: number;
  totalRealized: number;
  wins: number;
  losses: number;
  winRate: number;
  avgReturn: number;
  best: ClosedTrade | null;
  worst: ClosedTrade | null;
}

interface RealizedStats {
  count: number;
  winRate: number | null;
  profitFactor: number | null;
  totalRealized: number;
}
interface RealityCheck {
  sentiment: { realized: RealizedStats; ref: { pf: number; winRate: number; note: string } };
  momentum: { realized: RealizedStats; ref: { pf: number; winRate: number; note: string } };
  autopilot: {
    days: number;
    strategyReturn: number;
    spyReturn: number | null;
    maxDrawdown: number;
    startedAt: string | null;
  } | null;
  sentimentHistoryDays: number;
  sentimentAbReady: boolean;
}

export default function PerformancePage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [closed, setClosed] = useState<ClosedTrade[]>([]);
  const [reality, setReality] = useState<RealityCheck | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/performance", { cache: "no-store" });
        const data = await res.json();
        setSummary(data.summary ?? null);
        setClosed(data.closed ?? []);
        setReality(data.realityCheck ?? null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">{t("perf.title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t("perf.subtitle")}</p>
      </header>

      {!loading && reality && <RealityCheckSection r={reality} />}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-20 rounded-xl" />
          ))}
        </div>
      ) : !summary || summary.count === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
          <p className="text-4xl mb-3">📈</p>
          <p className="font-medium">{t("perf.emptyTitle")}</p>
          <p className="text-sm text-[var(--muted)] mt-1">{t("perf.emptyDesc")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Kpi
              label={t("perf.realizedPnl")}
              value={money(summary.totalRealized)}
              tone={summary.totalRealized >= 0 ? "pos" : "neg"}
            />
            <Kpi label={t("perf.winRate")} value={`${summary.winRate}%`} accent="var(--accent-2)" />
            <Kpi
              label={t("perf.avgReturn")}
              value={pct(summary.avgReturn)}
              tone={summary.avgReturn >= 0 ? "pos" : "neg"}
            />
            <Kpi
              label={t("perf.closedTrades")}
              value={String(summary.count)}
              sub={`${summary.wins}W · ${summary.losses}L`}
              accent="var(--accent-3)"
            />
          </div>

          {(summary.best || summary.worst) && (
            <div className="grid grid-cols-2 gap-3 mb-8">
              {summary.best && (
                <HighlightCard label={t("perf.bestTrade")} trade={summary.best} tone="pos" />
              )}
              {summary.worst && summary.worst.id !== summary.best?.id && (
                <HighlightCard label={t("perf.worstTrade")} trade={summary.worst} tone="neg" />
              )}
            </div>
          )}

          <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">
            {t("perf.closedTrades")}
          </h2>
          <div className="rounded-xl border border-[var(--border)] overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("track.colDate")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("common.symbol")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("common.shares")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("perf.colSellPrice")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("perf.colPnl")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("perf.colReturn")}</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((c) => (
                  <tr key={c.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">{new Date(c.executedAt).toLocaleDateString("it-IT")}</td>
                    <td className="px-3 py-2 font-mono">{c.ticker}</td>
                    <td className="px-3 py-2 text-right">{c.shares}</td>
                    <td className="px-3 py-2 text-right">{money(c.price)}</td>
                    <td className="px-3 py-2 text-right" style={{ color: c.realized >= 0 ? "var(--positive)" : "var(--negative)" }}>
                      {money(c.realized)}
                    </td>
                    <td className="px-3 py-2 text-right" style={{ color: c.returnPct >= 0 ? "var(--positive)" : "var(--negative)" }}>
                      {pct(c.returnPct)}
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

function Kpi({
  label,
  value,
  sub,
  tone,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
  accent?: string;
}) {
  const color = tone === "pos" ? "var(--positive)" : tone === "neg" ? "var(--negative)" : accent ?? "var(--foreground)";
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <span className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
      <span className="absolute -right-6 -top-6 size-16 rounded-full blur-2xl opacity-25" style={{ background: color }} />
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="text-xl font-bold font-mono mt-0.5" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--muted)] font-mono">{sub}</p>}
    </div>
  );
}

function HighlightCard({ label, trade, tone }: { label: string; trade: ClosedTrade; tone: "pos" | "neg" }) {
  const color = tone === "pos" ? "var(--positive)" : "var(--negative)";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="font-mono font-semibold mt-1">{trade.ticker}</p>
      <p className="font-mono text-sm" style={{ color }}>
        {money(trade.realized)} ({pct(trade.returnPct)})
      </p>
    </div>
  );
}

// ─── Reality check: realizzato vs backtest ────────────────────────────────────
// L'unico vero out-of-sample sono i trade reali e il paper trading dell'autopilot.
// Questa sezione li confronta con i riferimenti dei backtest walk-forward: se
// divergono a lungo, o il mercato è cambiato o il backtest era ottimista.

function RealityRow({
  label,
  realized,
  ref: reference,
}: {
  label: string;
  realized: { count: number; winRate: number | null; profitFactor: number | null; totalRealized: number };
  ref: { pf: number; winRate: number; note: string };
}) {
  const enough = realized.count >= 20;
  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className="px-3 py-2 font-medium">{label}</td>
      <td className="px-3 py-2 text-right font-mono">{realized.count}</td>
      <td className="px-3 py-2 text-right font-mono">
        {realized.winRate != null ? `${realized.winRate}%` : "—"}
        <span className="text-[var(--muted)]"> / {reference.winRate}%</span>
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {realized.profitFactor != null ? realized.profitFactor : "—"}
        <span className="text-[var(--muted)]"> / {reference.pf}</span>
      </td>
      <td className={`px-3 py-2 text-right font-mono ${realized.totalRealized >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
        {money(realized.totalRealized)}
      </td>
      <td className="px-3 py-2 text-[10px] text-[var(--muted)]">
        {enough ? reference.note : `campione piccolo (${realized.count} trade): serve pazienza, non conclusioni`}
      </td>
    </tr>
  );
}

function RealityCheckSection({ r }: { r: RealityCheck }) {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-1">
        🔬 Reality check — realizzato vs backtest
      </h2>
      <p className="text-[11px] text-[var(--muted)] mb-3 max-w-2xl">
        I trade reali e il paper trading sono l&apos;unico vero out-of-sample. Formato:
        <span className="font-mono"> reale / atteso dal backtest</span>. I riferimenti hanno
        survivorship bias: un realizzato un po&apos; sotto è normale.
      </p>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden overflow-x-auto mb-3">
        <table className="w-full text-xs min-w-[560px]">
          <thead className="bg-[var(--surface-2)] text-[10px] uppercase text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 text-left">Strategia</th>
              <th className="px-3 py-2 text-right">Trade chiusi</th>
              <th className="px-3 py-2 text-right">Win% (reale/att.)</th>
              <th className="px-3 py-2 text-right">PF (reale/att.)</th>
              <th className="px-3 py-2 text-right">P&L</th>
              <th className="px-3 py-2 text-left">Nota</th>
            </tr>
          </thead>
          <tbody>
            <RealityRow label="📊 Sentiment (manuale)" realized={r.sentiment.realized} ref={r.sentiment.ref} />
            <RealityRow label="⚡ Momentum RS" realized={r.momentum.realized} ref={r.momentum.ref} />
          </tbody>
        </table>
      </div>

      {r.autopilot && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 mb-3 text-xs flex flex-wrap gap-x-6 gap-y-1">
          <span className="font-medium">🤖 Autopilot (paper)</span>
          <span>
            dal {r.autopilot.startedAt?.slice(0, 10) ?? "?"} ({r.autopilot.days} snapshot):{" "}
            <span className={`font-mono font-semibold ${r.autopilot.strategyReturn >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
              {r.autopilot.strategyReturn >= 0 ? "+" : ""}{r.autopilot.strategyReturn}%
            </span>
            {r.autopilot.spyReturn != null && (
              <span className="text-[var(--muted)]"> vs SPY {r.autopilot.spyReturn >= 0 ? "+" : ""}{r.autopilot.spyReturn}%</span>
            )}
          </span>
          <span className="text-[var(--muted)]">max DD <span className="font-mono">-{r.autopilot.maxDrawdown}%</span></span>
        </div>
      )}

      <div
        className={`rounded-xl border p-3 text-xs ${
          r.sentimentAbReady
            ? "border-[var(--positive)]/40 bg-[var(--positive)]/8 text-[var(--positive)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
        }`}
      >
        {r.sentimentAbReady ? (
          <>✅ <strong>Storico sentiment pronto per la validazione A/B</strong>: {r.sentimentHistoryDays} giorni di scan registrati (≥60). Si può misurare se il layer news (+/−18/22 punti) aggiunge valore reale al segnale tecnico.</>
        ) : (
          <>🧪 Storico sentiment per la validazione A/B del layer news: <span className="font-mono">{r.sentimentHistoryDays}/60</span> giorni di scan raccolti. Ogni scan giornaliera aggiunge dati.</>
        )}
      </div>
    </section>
  );
}
