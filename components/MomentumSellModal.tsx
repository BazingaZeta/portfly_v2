"use client";

// Modal di vendita per le posizioni Momentum RS — condiviso tra la pagina
// Portfolio Momentum e le card della scan (/momentum). Chiude TUTTE le buy
// aperte del ticker via POST /api/momentum/trades (action SELL).

import { useState } from "react";
import { money } from "@/lib/format";

export interface SellablePosition {
  indexKey: string;
  ticker: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  unrealizedPnl: number;
  stopHit?: boolean;
  targetHit?: boolean;
}

export function MomentumSellModal({
  position,
  onClose,
  onDone,
}: {
  position: SellablePosition;
  onClose: () => void;
  onDone: () => void;
}) {
  const [price, setPrice] = useState(String(position.currentPrice));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estPnl = (Number(price) - position.avgCost) * position.shares;

  async function submit() {
    const p = Number(price);
    if (!p || p <= 0) { setError("Prezzo deve essere > 0"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/momentum/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SELL",
          indexKey: position.indexKey.replace("MOMENTUM_", ""),
          ticker: position.ticker,
          shares: position.shares,
          price: p,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Errore"); }
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="glass rounded-2xl border border-[var(--border)] p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Vendi {position.ticker}</h3>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)] text-lg leading-none">✕</button>
        </div>

        <div className="mb-4 rounded-lg bg-[var(--surface-2)] p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-[var(--muted)]">Azioni</span><span className="font-mono">{position.shares}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Costo medio</span><span className="font-mono">{money(position.avgCost)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">P&L non realizzato</span>
            <span className={`font-mono ${position.unrealizedPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
              {position.unrealizedPnl >= 0 ? "+" : ""}{money(position.unrealizedPnl)}
            </span>
          </div>
          {position.stopHit && <p className="text-[var(--negative)] font-medium">⛔ Stop colpito — considera di uscire</p>}
          {position.targetHit && <p className="text-[var(--positive)] font-medium">🎯 Target raggiunto — considera di prendere profitto</p>}
        </div>

        <label className="block mb-4">
          <span className="text-[10px] uppercase text-[var(--muted)] mb-1 block">Prezzo di vendita</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input w-full"
          />
        </label>

        <div className="mb-4 rounded-lg bg-[var(--surface-2)] p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">P&L stimato:</span>
            <span className={`font-mono font-bold ${estPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
              {estPnl >= 0 ? "+" : ""}{money(estPnl)}
            </span>
          </div>
        </div>

        {error && <p className="text-xs text-[var(--negative)] mb-3">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1">Annulla</button>
          <button onClick={submit} disabled={saving} className="btn-primary flex-1">
            {saving ? "Salvo…" : "✓ Conferma vendita"}
          </button>
        </div>
      </div>
    </div>
  );
}
