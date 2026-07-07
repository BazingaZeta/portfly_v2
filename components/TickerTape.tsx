"use client";

import { useEffect, useState } from "react";
import type { TickerItem } from "@/lib/tickerTape";

// Nastro "Wall Street" scorrevole in cima all'app: indici, mega-cap e crypto.
// Poll leggero di /api/ticker; il marquee è puro CSS (transform → GPU-friendly)
// e si mette in pausa al passaggio del mouse. Le crypto si muovono 24/7, quindi
// pollamo sempre ma con calma (20s) per non stressare l'upstream.

const POLL_MS = 20_000;

function fmtPrice(n: number): string {
  const opts: Intl.NumberFormatOptions =
    n >= 1000 ? { maximumFractionDigits: 0 } : n >= 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 4 };
  return n.toLocaleString("en-US", opts);
}

function Item({ it }: { it: TickerItem }) {
  const up = it.changePct >= 0;
  return (
    <span className="tape-item">
      <span className="tape-label">{it.label}</span>
      <span className="tape-price">{fmtPrice(it.price)}</span>
      <span className={up ? "tape-up" : "tape-down"}>
        {up ? "▲" : "▼"} {Math.abs(it.changePct).toFixed(2)}%
      </span>
    </span>
  );
}

export function TickerTape() {
  const [items, setItems] = useState<TickerItem[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/ticker", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        // Aggiorno solo con dati non vuoti: così `items` conserva sempre l'ultimo
        // nastro valido anche se un poll fallisce (nessun bisogno di un ref).
        if (alive && Array.isArray(data.items) && data.items.length) {
          setItems(data.items);
        }
      } catch {
        /* rete instabile: teniamo l'ultimo nastro noto (items resta invariato) */
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Prima del primo dato: barra vuota d'altezza fissa (niente layout shift).
  const data = items;

  return (
    <div className="tape glass" role="marquee" aria-label="Dati di mercato in tempo reale">
      {data.length > 0 && (
        <div className="tape-track">
          {/* Due copie identiche → loop senza salti (translateX -50%). */}
          <div className="tape-group">
            {data.map((it) => (
              <Item key={it.symbol} it={it} />
            ))}
          </div>
          <div className="tape-group" aria-hidden="true">
            {data.map((it) => (
              <Item key={`dup-${it.symbol}`} it={it} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
