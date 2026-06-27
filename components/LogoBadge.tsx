"use client";

import { useState } from "react";
import { domainFor } from "@/lib/universe";

// Deterministic accent color from the ticker (for the monogram fallback).
function colorFromTicker(ticker: string): string {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) {
    hash = ticker.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 42%)`;
}

export function LogoBadge({ ticker, size = 28 }: { ticker: string; size?: number }) {
  // Try several logo CDNs in order; fall back to a colored monogram.
  const domain = domainFor(ticker);
  const sources = [
    `https://financialmodelingprep.com/image-stock/${ticker}.png`,
    `https://assets.parqet.com/logos/symbol/${ticker}?format=png`,
    domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null,
  ].filter((s): s is string => s !== null);

  const [idx, setIdx] = useState(0);
  const src = idx < sources.length ? sources[idx] : null;

  return (
    <span
      className="shrink-0 grid place-items-center rounded-lg overflow-hidden border border-[var(--border)]"
      style={{
        width: size,
        height: size,
        background: src ? "#fff" : colorFromTicker(ticker),
      }}
      title={ticker}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={ticker}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setIdx((i) => i + 1)}
          style={{ objectFit: "contain", padding: size * 0.1, width: "100%", height: "100%" }}
        />
      ) : (
        <span className="font-bold text-white" style={{ fontSize: size * 0.36 }}>
          {ticker.slice(0, 2)}
        </span>
      )}
    </span>
  );
}
