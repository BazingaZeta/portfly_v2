"use client";

import { useEffect, useState } from "react";
import { EquityChart } from "./EquityChart";
import { Spinner } from "./Loading";
import type { EquityPoint, EquitySummary } from "@/lib/portfolioEquity";

interface StrategyEquity {
  key: string;
  label: string;
  points: EquityPoint[];
  summary: EquitySummary | null;
}

// Pannello autonomo: recupera /api/portfolio/equity (tutte le strategie) e
// mostra la curva di andamento del portafoglio richiesto. Da inserire in cima
// alle pagine dei singoli portafogli.
export function PortfolioEquityPanel({ strategy }: { strategy: string }) {
  const [data, setData] = useState<StrategyEquity | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/portfolio/equity", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const found = (json.strategies as StrategyEquity[])?.find((s) => s.key === strategy) ?? null;
        if (alive) setData(found);
      } catch {
        /* la curva è opzionale: in errore mostriamo l'empty state */
      } finally {
        if (alive) setLoaded(true);
      }
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [strategy]);

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

  return (
    <section className="mb-6">
      <EquityChart points={data.points} summary={data.summary} label={data.label} />
    </section>
  );
}
