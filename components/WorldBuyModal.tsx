"use client";

// Acquisto da Momentum World. La posizione finisce nel portafoglio Momentum
// (POST /api/momentum/trades, lo stesso di Momentum RS) con indice
// "WORLD_<indice>", così Portfolio Momentum la mostra insieme alle altre, sa
// da dove arriva, e la vende con il suo modal di sempre.

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";
import { useRisk } from "@/components/RiskProvider";

export interface WorldBuyTarget {
  ticker: string;
  name: string;
  /** Chiusura usata dall'analisi: punto di partenza finché non arriva il prezzo live. */
  price: number;
  signal: "COMPRA" | "ATTENDI" | "DEBOLE";
  reason: string;
  /**
   * Livello di rottura del canale del prezzo (canali ancorati), salvato come
   * stop della posizione: Portfolio Momentum segnala quando viene toccato.
   * Null con la finestra mobile, dove l'uscita è sul metatitolo e non c'è un
   * livello di prezzo.
   */
  stop: number | null;
}

export function WorldBuyModal({
  target,
  indexKey,
  maxPositions,
  exposurePct,
  strategyLabel,
  onClose,
  onDone,
}: {
  target: WorldBuyTarget;
  indexKey: string;
  maxPositions: number;
  /** Esposizione consigliata dalla protezione dai drawdown (100 = piena). */
  exposurePct: number;
  strategyLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { accountSize } = useRisk();
  // Quantità della strategia: un posto su `maxPositions`, ridotto quando la
  // volatilità della strategia è sopra l'obiettivo.
  const slot = (accountSize / Math.max(1, maxPositions)) * (Math.min(100, Math.max(0, exposurePct)) / 100);
  const [price, setPrice] = useState(String(target.price));
  const [shares, setShares] = useState(String(Math.max(1, Math.floor(slot / target.price))));
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const priceEdited = useRef(false);
  const sharesEdited = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prezzo di esecuzione dal mercato (live via /api/quotes), non dalla chiusura
  // dell'analisi: comprare a un prezzo stantio fa nascere la posizione con un
  // P&L già diverso da zero. Resta modificabile.
  useEffect(() => {
    let alive = true;
    fetch(`/api/quotes?tickers=${target.ticker}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = d?.prices?.[target.ticker];
        if (!alive || typeof p !== "number" || p <= 0) return;
        setLivePrice(p);
        if (!priceEdited.current) setPrice(String(p));
        if (!sharesEdited.current) setShares(String(Math.max(1, Math.floor(slot / p))));
      })
      .catch(() => { /* offline: resta la chiusura dell'analisi, modificabile */ });
    return () => { alive = false; };
  }, [target.ticker, slot]);

  const s = Number(shares);
  const p = Number(price);
  const cost = s * p;
  const stopPct = target.stop != null && p > 0 ? ((p - target.stop) / p) * 100 : null;

  async function submit() {
    if (!s || !p || s <= 0 || p <= 0) { setError("Azioni e prezzo devono essere maggiori di zero"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/momentum/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "BUY",
          indexKey: `WORLD_${indexKey}`,
          ticker: target.ticker,
          name: target.name,
          shares: s,
          price: p,
          // Uno stop sopra il prezzo d'acquisto risulterebbe già "colpito": in
          // quel caso (prezzo sotto la banda) non lo si salva.
          stop: target.stop != null && target.stop < p ? +target.stop.toFixed(2) : null,
          target: null,
          notes: `Momentum World · ${strategyLabel}`,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Errore"); }
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  const warn = target.signal !== "COMPRA";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="glass rounded-2xl border border-[var(--border)] p-6 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Compra ${target.ticker}`}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">
            Compra {target.ticker}
            <span className="ml-1 text-sm text-[var(--muted)] font-normal">{target.name}</span>
          </h3>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)] text-lg leading-none" aria-label="Chiudi">✕</button>
        </div>

        <div
          className="mb-4 rounded-lg p-3 text-xs"
          style={{
            background: "var(--surface-2)",
            borderLeft: `3px solid ${warn ? "var(--warning)" : "var(--positive)"}`,
          }}
        >
          <p className="font-semibold" style={{ color: warn ? "var(--warning)" : "var(--positive)" }}>
            Segnale di oggi: {target.signal}
          </p>
          <p className="text-[var(--muted)] mt-0.5">{target.reason}</p>
          {warn && (
            <p className="text-[var(--warning)] mt-1">
              La strategia oggi non comprerebbe questo titolo: stai andando contro il segnale.
            </p>
          )}
        </div>

        <label className="block mb-3">
          <span className="text-[10px] uppercase text-[var(--muted)] mb-1 block">Azioni</span>
          <input
            type="number" min="0" step="1" value={shares} className="input w-full"
            onChange={(e) => { setShares(e.target.value); sharesEdited.current = true; }}
          />
          <span className="text-[10px] text-[var(--muted)] mt-1 block">
            Quantità della strategia: 1/{maxPositions} del capitale ({money(accountSize)})
            {exposurePct < 100 ? `, ridotta al ${exposurePct}% dalla protezione dai drawdown` : ""} ≈ {money(slot)}.
          </span>
        </label>

        <label className="block mb-4">
          <span className="text-[10px] uppercase text-[var(--muted)] mb-1 block">Prezzo eseguito</span>
          <input
            type="number" min="0" step="0.01" value={price} className="input w-full"
            onChange={(e) => { setPrice(e.target.value); priceEdited.current = true; }}
          />
          <span className="text-[10px] text-[var(--muted)] mt-1 block">
            {livePrice != null
              ? `Mercato ora: ${money(livePrice)} · chiusura analisi ${money(target.price)}`
              : `Chiusura analisi: ${money(target.price)} — recupero il prezzo live…`}
          </span>
        </label>

        <div className="mb-4 rounded-lg bg-[var(--surface-2)] p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Costo totale</span>
            <span className="font-mono">{money(cost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Peso sul capitale</span>
            <span className="font-mono">{accountSize > 0 ? ((cost / accountSize) * 100).toFixed(1) : "—"}%</span>
          </div>
          {target.stop != null ? (
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Livello di uscita (banda inferiore)</span>
              <span className="font-mono text-[var(--negative)]">
                {money(target.stop)}{stopPct != null ? ` (${stopPct >= 0 ? "−" : "+"}${Math.abs(stopPct).toFixed(1)}%)` : ""}
              </span>
            </div>
          ) : (
            <div className="flex justify-between gap-3">
              <span className="text-[var(--muted)]">Uscita</span>
              <span className="text-right">alla rottura del canale del metatitolo, nessun livello di prezzo</span>
            </div>
          )}
          <p className="text-[10px] text-[var(--muted)] pt-1">
            Finisce in Portfolio Momentum con l&apos;etichetta Momentum World: da lì la vendi.
          </p>
        </div>

        {error && <p className="text-xs text-[var(--negative)] mb-3">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1">Annulla</button>
          <button onClick={submit} disabled={saving} className="btn-primary flex-1">
            {saving ? "Salvo…" : "✓ Conferma acquisto"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Posizione aperta nel portafoglio Momentum, quanto basta alle card. */
export interface MomentumHolding {
  indexKey: string;
  ticker: string;
  shares: number;
  avgCost: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

/**
 * Le posizioni aperte del portafoglio Momentum (da GET /api/momentum/trades),
 * per ticker. `reload` va chiamato dopo un acquisto.
 */
export function useMomentumHoldings(): { holdings: Record<string, MomentumHolding>; reload: () => void } {
  const [holdings, setHoldings] = useState<Record<string, MomentumHolding>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/momentum/trades", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.positions) return;
        const map: Record<string, MomentumHolding> = {};
        for (const p of d.positions as MomentumHolding[]) map[p.ticker] = p;
        setHoldings(map);
      })
      .catch(() => { /* senza portafoglio le card mostrano solo "Compra" */ });
    return () => { alive = false; };
  }, [tick]);
  return { holdings, reload: () => setTick((t) => t + 1) };
}
