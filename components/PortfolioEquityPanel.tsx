"use client";

import { useEffect, useMemo, useState } from "react";
import { EquityChart, type Currency } from "./EquityChart";
import { Spinner } from "./Loading";
import { convertSeriesToEur, type EquityPoint, type EquitySummary, type FxPoint } from "@/lib/portfolioEquity";

interface StrategyEquity {
  key: string;
  label: string;
  points: EquityPoint[];
  summary: EquitySummary | null;
}

// Pannello autonomo: recupera /api/portfolio/equity (tutte le strategie) e
// mostra la curva di andamento del portafoglio richiesto. Da inserire in cima
// alle pagine dei singoli portafogli. Toggle €/$: gli asset sono in USD ma
// l'investitore è EUR-based — la vista EUR converte al cambio storico as-of.
export function PortfolioEquityPanel({ strategy }: { strategy: string }) {
  const [data, setData] = useState<StrategyEquity | null>(null);
  const [fx, setFx] = useState<FxPoint[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [currency, setCurrency] = useState<Currency>("USD");

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/portfolio/equity", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const found = (json.strategies as StrategyEquity[])?.find((s) => s.key === strategy) ?? null;
        if (alive) {
          setData(found);
          setFx((json.eurusd as FxPoint[]) ?? []);
        }
      } catch {
        /* la curva è opzionale: in errore mostriamo l'empty state */
      } finally {
        if (alive) setLoaded(true);
      }
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [strategy]);

  // Conversione EUR (pura, memoizzata). Se la serie FX manca, il toggle sparisce.
  const eurSeries = useMemo(
    () => (data && fx.length > 0 ? convertSeriesToEur({ points: data.points, summary: data.summary }, fx) : null),
    [data, fx],
  );

  if (!loaded) {
    return (
      <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 flex items-center justify-center h-40">
        <Spinner />
      </section>
    );
  }

  if (!data || data.points.length < 2 || !data.summary) {
    return (
      <section className="mb-6 rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted)]">
        <p className="text-sm">
          Andamento non ancora disponibile — serve almeno qualche giorno di storico dopo il primo acquisto.
        </p>
      </section>
    );
  }

  const showEur = currency === "EUR" && eurSeries?.summary != null;
  const shown = showEur ? eurSeries! : { points: data.points, summary: data.summary };
  // Effetto cambio: differenza tra rendimento in EUR e in USD (punti percentuali).
  const fxDeltaPt =
    showEur && eurSeries!.summary && data.summary
      ? +(eurSeries!.summary.totalReturnPct - data.summary.totalReturnPct).toFixed(1)
      : null;

  return (
    <section className="mb-6">
      <EquityChart
        points={shown.points}
        summary={shown.summary}
        label={data.label}
        currency={showEur ? "EUR" : "USD"}
        onCurrencyChange={eurSeries?.summary ? setCurrency : undefined}
        fxDeltaPt={fxDeltaPt}
      />
    </section>
  );
}
