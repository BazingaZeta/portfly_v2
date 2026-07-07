"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/I18nProvider";
import { LivePrice } from "@/components/LivePrice";
import { Sparkline } from "@/components/Sparkline";

const DASHBOARD = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "BNB-USD", "DOGE-USD"];
const NAMES: Record<string, string> = {
  "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum", "SOL-USD": "Solana",
  "XRP-USD": "XRP", "BNB-USD": "BNB", "DOGE-USD": "Dogecoin",
};

interface AssetStatus {
  asset: string; name: string; price: number; sma: number; distancePct: number;
  regime: "bull" | "bear"; daysInRegime: number; weight: number;
  spark: { date: string; close: number; sma: number }[];
}
interface Signal {
  config: { smaPeriod: number; hysteresisPct: number; assets: string[] };
  holdingLabel: string; cashWeight: number; assets: AssetStatus[];
}
interface Bt {
  cagr: number; maxDrawdown: number; benchCagr: number; benchMaxDrawdown: number;
  years: number;
  walkForward?: { periods: unknown[]; beatBenchPeriods: number; positivePeriods: number };
}

function fmtPrice(n: number): string {
  const opts: Intl.NumberFormatOptions =
    n >= 1000 ? { maximumFractionDigits: 0 } : n >= 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 4 };
  return "$" + n.toLocaleString("en-US", opts);
}

export default function CryptoPage() {
  const { t } = useI18n();
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [spark, setSpark] = useState<Record<string, number[]>>({});
  const [signal, setSignal] = useState<Signal | null>(null);
  const [bt, setBt] = useState<Bt | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  // Prezzi live 24/7 (nessun gating a orario di mercato: le crypto non chiudono).
  const pollPrices = useCallback(async () => {
    try {
      const res = await fetch(`/api/quotes?tickers=${DASHBOARD.join(",")}`, { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        if (d.prices) setPrices(d.prices as Record<string, number>);
      }
    } catch { /* mantieni ultimi prezzi */ }
  }, []);

  useEffect(() => {
    // Deferito di un tick per evitare render a cascata (pattern del repo).
    const t0 = setTimeout(async () => {
      pollPrices();
      try {
        const [spRes, sigRes] = await Promise.all([
          fetch(`/api/sparkline?tickers=${DASHBOARD.join(",")}&days=90`, { cache: "no-store" }),
          fetch("/api/crypto/analyze", { cache: "no-store" }),
        ]);
        if (spRes.ok) setSpark((await spRes.json()).series ?? {});
        if (sigRes.ok) setSignal(await sigRes.json());
        else setErr(true);
      } catch { setErr(true); }
      setLoading(false);
      // Backtest più lento: caricato dopo, non blocca la dashboard.
      try {
        const btRes = await fetch("/api/crypto/backtest?folds=5", { cache: "no-store" });
        if (btRes.ok) setBt(await btRes.json());
      } catch { /* opzionale */ }
    }, 0);
    const id = setInterval(pollPrices, 15_000);
    return () => { clearTimeout(t0); clearInterval(id); };
  }, [pollPrices]);

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-5">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">{t("crypto.title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">{t("crypto.subtitle")}</p>
      </header>

      {/* ─── Dashboard maggiori crypto ─── */}
      <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">{t("crypto.marketHeading")}</h2>
      {loading ? (
        <div className="grid place-items-center py-12"><div className="spinner" /></div>
      ) : (
        <div className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
          {DASHBOARD.map((sym) => {
            const series = spark[sym] ?? [];
            const live = prices[sym] ?? series[series.length - 1] ?? 0;
            const prevClose = series.length >= 2 ? series[series.length - 2] : live;
            const chg = prevClose ? ((live - prevClose) / prevClose) * 100 : 0;
            const up = chg >= 0;
            return (
              <div key={sym} className="card-hover rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{NAMES[sym]}</p>
                    <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] font-mono">{sym.replace("-USD", "")}</p>
                  </div>
                  <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded" style={{ color: up ? "var(--positive)" : "var(--negative)", background: `color-mix(in srgb, var(--${up ? "positive" : "negative"}) 12%, transparent)` }}>
                    {up ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%
                  </span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <LivePrice price={live} format={fmtPrice} className="text-lg font-bold font-mono" />
                  <Sparkline values={series} live={live} width={110} height={38} color={up ? "var(--positive)" : "var(--negative)"} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Strategia Crypto Trend ─── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-bold">{t("crypto.strategyHeading")}</h2>
            <p className="text-xs text-[var(--muted)] mt-1 max-w-xl">{t("crypto.strategyDesc")}</p>
          </div>
          <Link href="/autopilot" className="btn-primary text-sm whitespace-nowrap self-start">
            {t("crypto.launchCta")}
          </Link>
        </div>

        {err ? (
          <p className="text-sm text-[var(--negative)]">{t("crypto.loadError")}</p>
        ) : !signal ? (
          <div className="grid place-items-center py-8"><div className="spinner" /></div>
        ) : (
          <>
            <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/8 p-3 mb-4">
              <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{t("crypto.holds")}</span>
              <p className="text-base font-bold font-mono mt-0.5" style={{ color: "var(--accent)" }}>{signal.holdingLabel}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {signal.assets.map((a) => {
                const bull = a.regime === "bull";
                return (
                  <div key={a.asset} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-semibold">{a.name}</span>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ color: bull ? "var(--positive)" : "var(--negative)", background: `color-mix(in srgb, var(--${bull ? "positive" : "negative"}) 14%, transparent)` }}>
                        {bull ? `▲ ${t("crypto.regimeBull")}` : `▼ ${t("crypto.regimeBear")}`}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--muted)] font-mono">
                      {fmtPrice(a.price)} · SMA{signal.config.smaPeriod} {fmtPrice(a.sma)} ({a.distancePct >= 0 ? "+" : ""}{a.distancePct}%)
                    </p>
                    <p className="text-[10px] text-[var(--muted)] mt-0.5">
                      {t("crypto.daysInRegime", { n: String(a.daysInRegime) })} · {Math.round(a.weight * 100)}%
                    </p>
                    <div className="mt-2">
                      <Sparkline
                        values={a.spark.map((s) => s.close)}
                        width={280}
                        height={44}
                        color={bull ? "var(--positive)" : "var(--negative)"}
                        refs={[{ value: a.sma, color: "var(--muted)", dashed: true }]}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ─── Backtest ─── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 mb-4">
        <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide mb-3">{t("crypto.backtestHeading")}</h2>
        {!bt ? (
          <div className="grid place-items-center py-6"><div className="spinner" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label={t("crypto.stratCagr")} value={`${bt.cagr >= 0 ? "+" : ""}${bt.cagr}%`} tone={bt.cagr >= 0 ? "pos" : "neg"} />
              <Kpi label={t("crypto.stratDD")} value={`-${bt.maxDrawdown}%`} tone="neg" />
              <Kpi label={t("crypto.btcCagr")} value={`${bt.benchCagr >= 0 ? "+" : ""}${bt.benchCagr}%`} accent="var(--muted)" />
              <Kpi label={t("crypto.btcDD")} value={`-${bt.benchMaxDrawdown}%`} accent="var(--muted)" />
            </div>
            {bt.walkForward && (
              <p className="text-xs text-[var(--muted)] mt-3">
                {t("crypto.wf", {
                  beat: String(bt.walkForward.beatBenchPeriods),
                  pos: String(bt.walkForward.positivePeriods),
                  n: String(bt.walkForward.periods.length),
                })} · {bt.years}y
              </p>
            )}
          </>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--muted)]">{t("crypto.disclaimer")}</p>
    </div>
  );
}

function Kpi({ label, value, tone, accent }: { label: string; value: string; tone?: "pos" | "neg"; accent?: string }) {
  const color = tone === "pos" ? "var(--positive)" : tone === "neg" ? "var(--negative)" : accent ?? "var(--foreground)";
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
      <span className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="text-lg font-bold font-mono mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}
