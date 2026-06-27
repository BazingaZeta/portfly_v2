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

export default function PerformancePage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [closed, setClosed] = useState<ClosedTrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/performance", { cache: "no-store" });
        const data = await res.json();
        setSummary(data.summary ?? null);
        setClosed(data.closed ?? []);
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
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <table className="w-full text-sm">
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
