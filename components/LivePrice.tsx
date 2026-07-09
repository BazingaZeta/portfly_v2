"use client";

import { useEffect, useRef, useState } from "react";
import {
  usMarketStatus,
  nextMarketOpen,
  nextMarketClose,
  userTimeZone,
  type MarketStatus,
} from "@/lib/marketHours";

// Prezzi live per i portafogli: polling frequente di /api/quotes (che usa le
// quote real-time di Finnhub quando configurato, con fallback Yahoo). La chiave
// Finnhub resta lato server. Frequenza di default 5s: quasi-live rispettando i
// rate limit del free tier (60 chiamate/min) con portafogli di pochi titoli.
//
// Il polling gira SOLO quando il mercato USA è in sessione regolare: fuori orario
// (notte/weekend europei, mercato chiuso) i prezzi sono fermi, quindi evitiamo
// chiamate a vuoto e non mostriamo un falso "live".

/** Stato del mercato USA, ricalcolato periodicamente lato client. */
export function useMarketStatus(refreshMs = 30_000): MarketStatus {
  const [status, setStatus] = useState<MarketStatus>(() => usMarketStatus());
  useEffect(() => {
    const id = setInterval(() => setStatus(usMarketStatus()), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs]);
  return status;
}

/**
 * Poll /api/quotes per un set di ticker; ritorna prezzi, ora dell'ultima lettura
 * e stato del mercato. Fa sempre una lettura iniziale (ultimo prezzo / chiusura),
 * poi effettua il polling solo a mercato aperto.
 */
export function useLivePrices(tickers: string[], intervalMs = 5000) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [at, setAt] = useState<Date | null>(null);
  const market = useMarketStatus();
  const open = market.open;
  // Chiave stabile: evita di ricreare il polling a ogni render se il set è uguale.
  const key = [...new Set(tickers)].sort().join(",");

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/quotes?tickers=${key}`, { cache: "no-store" });
        if (!res.ok) return; // 401/errore: teniamo gli ultimi prezzi noti
        const data = await res.json();
        if (alive && data.prices) {
          setPrices(data.prices as Record<string, number>);
          setAt(new Date());
        }
      } catch {
        /* rete instabile: manteniamo l'ultimo valore */
      }
    };
    tick(); // lettura iniziale (anche a mercato chiuso: mostra l'ultima chiusura)
    if (!open) return () => { alive = false; }; // niente polling fuori orario
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key, intervalMs, open]);

  return { prices, at, market };
}

/**
 * Indicatore di stato del mercato: pallino + etichetta (live / chiuso / …), più
 * l'orario di apertura/chiusura tradotto nel fuso locale RILEVATO dell'utente.
 * L'orario locale è calcolato solo dopo il mount (client-only) per evitare
 * mismatch di hydration: il server non conosce il fuso del browser.
 */
export function LiveBadge({ market }: { market: MarketStatus }) {
  const [hint, setHint] = useState<{ text: string; tz: string } | null>(null);

  useEffect(() => {
    const tz = userTimeZone();
    const now = new Date();
    const target = market.open ? nextMarketClose(now) : nextMarketOpen(now);
    let next: { text: string; tz: string } | null = null;
    if (target) {
      const time = target.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: tz });
      const sameDay =
        target.toLocaleDateString([], { timeZone: tz }) === now.toLocaleDateString([], { timeZone: tz });
      const dayPrefix = sameDay ? "" : target.toLocaleDateString([], { weekday: "short", timeZone: tz }) + " ";
      next = { text: `${market.open ? "chiude" : "apre"} ${dayPrefix}${time}`, tz };
    }
    // Deferito (setTimeout-0): evita setState sincrono nel corpo dell'effect.
    const id = setTimeout(() => setHint(next), 0);
    return () => clearTimeout(id);
  }, [market.open, market.session]);

  const color =
    market.session === "regular"
      ? "var(--positive)"
      : market.session === "closed"
      ? "var(--muted)"
      : "var(--warning)"; // pre-market / after-hours

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] normal-case font-normal"
      style={{ color }}
      title={`Mercato USA · ${market.etTime} ET${hint ? ` · orari nel tuo fuso (${hint.tz})` : ""}`}
    >
      <span
        className={`inline-block size-1.5 rounded-full ${market.open ? "live-dot" : ""}`}
        style={{ background: color }}
      />
      {market.label}
      {hint && <span className="text-[var(--muted)]">· {hint.text}</span>}
    </span>
  );
}

/**
 * Prezzo che lampeggia con un alone verde/rosso quando cambia: verde se sale,
 * rosso se scende. L'alone sfuma via in ~1s senza spostare il layout.
 */
export function LivePrice({
  price,
  format = (n) => n.toFixed(2),
  className = "",
}: {
  price: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const prev = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const p = prev.current;
    if (p != null && price !== p) {
      setFlash(price > p ? "up" : "down");
      const timer = setTimeout(() => setFlash(null), 1000);
      prev.current = price;
      return () => clearTimeout(timer);
    }
    prev.current = price;
  }, [price]);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1 -mx-1 ${
        flash === "up" ? "glow-up" : flash === "down" ? "glow-down" : ""
      } ${className}`}
    >
      {format(price)}
      {flash && (
        <span
          className="arrow-pop text-[0.7em]"
          style={{ color: flash === "up" ? "var(--positive)" : "var(--negative)" }}
        >
          {flash === "up" ? "▲" : "▼"}
        </span>
      )}
    </span>
  );
}

/** Campi minimi di una posizione per applicare un prezzo live. */
export interface Priceable {
  ticker: string;
  shares: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  stop?: number | null;
  target?: number | null;
}

/**
 * Rimappa un elenco di posizioni sui prezzi live, ricalcolando valore di mercato
 * e P&L. Il cost basis si deriva da `marketValue − unrealizedPnl`, quindi
 * funziona con qualunque forma di posizione senza dipendere dai campi extra.
 * I ticker senza prezzo live restano invariati.
 */
export function applyLivePrices<T extends Priceable>(
  positions: T[],
  prices: Record<string, number>,
): T[] {
  return positions.map((p) => {
    const lp = prices[p.ticker];
    if (lp == null || lp <= 0) return p;
    const costBasis = p.marketValue - p.unrealizedPnl;
    const marketValue = p.shares * lp;
    const unrealizedPnl = marketValue - costBasis;
    // Entry medio dal cost basis: uno stop valido (long) sta sotto l'entry, un
    // target sopra. Livelli stantii/invertiti non contano come colpiti.
    const entry = p.shares > 0 ? costBasis / p.shares : 0;
    return {
      ...p,
      currentPrice: +lp.toFixed(2),
      marketValue: +marketValue.toFixed(2),
      unrealizedPnl: +unrealizedPnl.toFixed(2),
      unrealizedPnlPct: costBasis ? +((unrealizedPnl / costBasis) * 100).toFixed(2) : 0,
      stopHit: p.stop != null && p.stop < entry && lp <= p.stop,
      targetHit: p.target != null && p.target > entry && lp >= p.target,
      priceStale: false,
    } as T;
  });
}
