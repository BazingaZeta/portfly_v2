"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Recommendation } from "@/lib/types";
import { SignalCard } from "@/components/SignalCard";
import { CATEGORIES, sectorFor, nameFor, type Category } from "@/lib/universe";
import { useI18n } from "@/components/I18nProvider";
import { RiskSettings } from "@/components/RiskSettings";
import type { TFunc } from "@/lib/i18n";

type SortKey = "score" | "upside" | "sentiment" | "change" | "ticker";

const SORT_OPTIONS: { key: SortKey; labelKey: string }[] = [
  { key: "score", labelKey: "sort.score" },
  { key: "upside", labelKey: "sort.upside" },
  { key: "sentiment", labelKey: "sort.sentiment" },
  { key: "change", labelKey: "sort.change" },
  { key: "ticker", labelKey: "sort.ticker" },
];

interface Progress {
  stage: string;
  current: number;
  total: number;
  message: string;
}

export default function Dashboard() {
  const { t } = useI18n();
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [scanDate, setScanDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [pricesAt, setPricesAt] = useState<Date | null>(null);
  const [autoScanning, setAutoScanning] = useState(false);
  const autoStarted = useRef(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("Tutte");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [regime, setRegime] = useState<{ regime: string; label: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recommendations", { cache: "no-store" });
      const data = await res.json();
      setRecs(data.recommendations ?? []);
      setScanDate(data.scanDate ?? null);
      setRegime(data.marketRegime ?? null);
      return data as {
        recommendations: Recommendation[];
        scanDate: string | null;
        lastScanAttempt: string | null;
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPrices = useCallback(async (tickers: string[]) => {
    if (tickers.length === 0) return;
    try {
      const res = await fetch(`/api/quotes?tickers=${tickers.join(",")}`, {
        cache: "no-store",
      });
      const data = await res.json();
      setPrices(data.prices ?? {});
      setPricesAt(new Date());
    } catch {
      /* keep last known prices */
    }
  }, []);

  useEffect(() => {
    load().then((data) => {
      refreshPrices((data.recommendations ?? []).map((x) => x.ticker));
      // Auto-scan: if today hasn't been scanned yet, run it automatically.
      const today = new Date().toISOString().slice(0, 10);
      if (!autoStarted.current && data.lastScanAttempt !== today) {
        autoStarted.current = true;
        setAutoScanning(true);
        runScan();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshPrices]);

  // Auto-refresh live prices every 30s while the page is open.
  useEffect(() => {
    if (recs.length === 0) return;
    const tickers = recs.map((r) => r.ticker);
    const id = setInterval(() => refreshPrices(tickers), 30_000);
    return () => clearInterval(id);
  }, [recs, refreshPrices]);

  function runScan() {
    setScanning(true);
    setError(null);
    setProgress({ stage: "fetch", current: 0, total: 1, message: "Avvio scan…" });

    const es = new EventSource("/api/scan");
    es.addEventListener("progress", (e) => {
      setProgress(JSON.parse((e as MessageEvent).data));
    });
    es.addEventListener("complete", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setProgress({
        stage: "done",
        current: 1,
        total: 1,
        message: `Completata: ${data.count} segnali`,
      });
      es.close();
      setScanning(false);
      setAutoScanning(false);
      load().then((d) => refreshPrices((d.recommendations ?? []).map((x) => x.ticker)));
    });
    es.addEventListener("error", (e) => {
      const msg = (e as MessageEvent).data
        ? JSON.parse((e as MessageEvent).data).message
        : "Connessione interrotta";
      setError(msg);
      setAutoScanning(false);
      es.close();
      setScanning(false);
    });
  }

  const pctDone = progress && progress.total ? (progress.current / progress.total) * 100 : 0;

  const avgScore = recs.length
    ? Math.round(recs.reduce((s, r) => s + r.score, 0) / recs.length)
    : 0;
  const topPick = recs[0];
  const positiveNews = recs.filter((r) => r.newsSentiment > 0.1).length;

  // Search + category filter + sorting (client-side over today's signals).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = recs.filter((r) => {
      const inCategory = category === "Tutte" || sectorFor(r.ticker) === category;
      const inQuery =
        !q ||
        r.ticker.toLowerCase().includes(q) ||
        nameFor(r.ticker).toLowerCase().includes(q);
      return inCategory && inQuery;
    });
    const change = (r: Recommendation) => {
      const cp = prices[r.ticker];
      return cp != null ? (cp - r.price) / r.price : -Infinity;
    };
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "upside":
          return (b.target - b.price) / b.price - (a.target - a.price) / a.price;
        case "sentiment":
          return b.newsSentiment - a.newsSentiment;
        case "change":
          return change(b) - change(a);
        case "ticker":
          return a.ticker.localeCompare(b.ticker);
        default:
          return b.score - a.score;
      }
    });
    return list;
  }, [recs, query, category, sortKey, prices]);

  return (
    <div className="max-w-4xl mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight gradient-text">{t("dash.title")}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {scanDate ? t("dash.lastScan", { date: scanDate }) : t("dash.noScan")}
            {pricesAt && (
              <span className="ml-2 inline-flex items-center gap-1.5 text-[var(--muted)]">
                ·
                <span className="live-dot inline-block size-2 rounded-full bg-[var(--positive)]" />
                {t("dash.live", { time: pricesAt.toLocaleTimeString() })}
              </span>
            )}
          </p>
        </div>
        <button onClick={runScan} disabled={scanning} className="btn-primary whitespace-nowrap">
          {scanning ? t("dash.scanning") : t("dash.scanBtn")}
        </button>
      </header>

      {autoScanning && (
        <div className="mb-4 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-3 text-sm text-[var(--accent)] flex items-center gap-2">
          <span className="live-dot inline-block size-2 rounded-full bg-[var(--accent)]" />
          {t("dash.autoScan")}
        </div>
      )}

      {regime && !loading && (
        <div
          className="mb-4 rounded-xl border p-3 text-sm flex items-center gap-2"
          style={{
            borderColor:
              regime.regime === "bull"
                ? "color-mix(in srgb, var(--positive) 40%, transparent)"
                : regime.regime === "bear"
                ? "color-mix(in srgb, var(--negative) 40%, transparent)"
                : "var(--border)",
            background:
              regime.regime === "bull"
                ? "color-mix(in srgb, var(--positive) 8%, transparent)"
                : regime.regime === "bear"
                ? "color-mix(in srgb, var(--negative) 8%, transparent)"
                : "var(--surface)",
          }}
        >
          <span className="text-[var(--muted)]">{t(`regime.${regime.regime}`)}</span>
        </div>
      )}

      {!loading && recs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatTile label={t("dash.statSignals")} value={String(recs.length)} accent="var(--accent)" />
          <StatTile label={t("dash.statAvgScore")} value={String(avgScore)} accent="var(--accent-2)" />
          <StatTile
            label={t("dash.statTopPick")}
            value={topPick ? topPick.ticker : "—"}
            sub={topPick ? t("dash.statScore", { n: topPick.score }) : undefined}
            accent="var(--positive)"
          />
          <StatTile
            label={t("dash.statPosNews")}
            value={String(positiveNews)}
            accent="var(--accent-3)"
          />
        </div>
      )}

      {scanning && progress && (
        <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-[var(--muted)]">{progress.message}</span>
            <span className="font-mono text-xs text-[var(--muted)]">
              {progress.stage === "news" ? t("dash.progressNews") : t("dash.progressAnalysis")}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${pctDone}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-[var(--negative)] bg-[var(--negative)]/10 p-4 text-sm text-[var(--negative)]">
          {t("dash.error", { msg: error })}
        </div>
      )}

      {!loading && recs.length > 0 && (
        <div className="mb-5">
          <RiskSettings />
        </div>
      )}

      {/* Controls: search, category, sort */}
      {!loading && recs.length > 0 && (
        <div className="mb-5 flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-sm">
              🔍
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("dash.searchPlaceholder")}
              className="input w-full"
              style={{ paddingLeft: "2.25rem" }}
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="input"
            aria-label="Categoria"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === "Tutte" ? t("dash.allCategories") : t(`cat.${c}`)}
              </option>
            ))}
          </select>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="input"
            aria-label="Ordina per"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {t("dash.sortPrefix", { label: t(o.labelKey) })}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-4">
                <div className="skeleton size-14 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-24" />
                  <div className="skeleton h-3 w-40" />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="skeleton h-8" />
                <div className="skeleton h-8" />
                <div className="skeleton h-8" />
              </div>
            </div>
          ))}
        </div>
      ) : recs.length === 0 ? (
        <EmptyState scanning={scanning} hasScan={!!scanDate} t={t} />
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--muted)]">
          {t("dash.noFilterResult", { category: category === "Tutte" ? t("dash.allCategories") : t(`cat.${category}`) })}
          {query ? t("dash.noFilterQuery", { query }) : ""}.
        </div>
      ) : (
        <>
          <p className="text-xs text-[var(--muted)] mb-3">
            {t("dash.count", { n: visible.length, total: recs.length })}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {visible.map((rec, i) => (
              <SignalCard
                key={rec.id}
                rec={rec}
                index={i}
                currentPrice={prices[rec.ticker]}
                onConfirmed={() => {}}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <span
        className="absolute left-0 top-0 h-full w-1"
        style={{ background: accent }}
      />
      <span
        className="absolute -right-6 -top-6 size-16 rounded-full blur-2xl opacity-30"
        style={{ background: accent }}
      />
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="text-xl font-bold font-mono mt-0.5" style={{ color: accent }}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

function EmptyState({ scanning, hasScan, t }: { scanning: boolean; hasScan: boolean; t: TFunc }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
      <p className="text-4xl mb-3">🔍</p>
      <p className="font-medium">
        {hasScan ? t("dash.emptyHasScanTitle") : t("dash.emptyNoScanTitle")}
      </p>
      <p className="text-sm text-[var(--muted)] mt-1 max-w-sm mx-auto">
        {hasScan
          ? t("dash.emptyHasScanDesc")
          : scanning
          ? t("dash.emptyScanning")
          : t("dash.emptyNoScanDesc")}
      </p>
    </div>
  );
}
