/**
 * Test deterministici sul replay dell'equity di portafoglio. Fixture sintetiche,
 * nessuna rete. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { replayEquity, type ReplayTrade } from "../lib/portfolioEquity";
import type { Candle } from "../lib/types";

/** Candele da coppie [data, close]; OHLV riempiti in modo coerente. */
function candles(pairs: [string, number][]): Candle[] {
  return pairs.map(([date, close]) => ({
    date,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
    adjClose: close,
  }));
}

// Benchmark piatto: fa da calendario di borsa e da SPY invariato (return 0).
const flatSpy = candles([
  ["2024-01-01", 400],
  ["2024-01-02", 400],
  ["2024-01-03", 400],
  ["2024-01-04", 400],
  ["2024-01-05", 400],
]);

test("BUY singolo: crescita, drawdown e carry-forward", () => {
  const trades: ReplayTrade[] = [
    { ticker: "AAA", action: "BUY", shares: 10, price: 100, executedAt: "2024-01-01T15:00:00Z" },
  ];
  // AAA manca il 05: deve fare carry-forward dell'ultima chiusura (120).
  const aaa = candles([
    ["2024-01-01", 100],
    ["2024-01-02", 110],
    ["2024-01-03", 90],
    ["2024-01-04", 120],
  ]);

  const { points, summary } = replayEquity(trades, { AAA: aaa }, flatSpy);

  assert.equal(points.length, 5);
  assert.deepEqual(points.map((p) => p.value), [1000, 1100, 900, 1200, 1200]);
  // drawdown dal picco 1100 al 900 = 18.18%
  assert.equal(points[2].drawdownPct, 18.18);
  assert.equal(summary?.maxDrawdownPct, 18.18);
  // profitto netto 200 su 1000 versati
  assert.equal(summary?.totalReturnPct, 20);
  assert.equal(summary?.benchReturnPct, 0);
  // baseline versato costante
  assert.ok(points.every((p) => p.invested === 1000));
});

test("SELL totale: l'equity resta continua (proventi in cassa)", () => {
  const trades: ReplayTrade[] = [
    { ticker: "AAA", action: "BUY", shares: 10, price: 100, executedAt: "2024-01-01T15:00:00Z" },
    { ticker: "AAA", action: "SELL", shares: 10, price: 120, executedAt: "2024-01-04T15:00:00Z" },
  ];
  const aaa = candles([
    ["2024-01-01", 100],
    ["2024-01-02", 110],
    ["2024-01-03", 130],
    ["2024-01-04", 120],
  ]);

  const { points, summary } = replayEquity(trades, { AAA: aaa }, flatSpy);

  // Dopo la vendita l'equity = cassa 1200, non crolla a zero.
  assert.equal(points[3].value, 1200);
  assert.equal(points[4].value, 1200);
  assert.equal(summary?.currentValue, 1200);
  assert.equal(summary?.totalReturnPct, 20);
});

test("nessun trade → serie vuota", () => {
  const { points, summary } = replayEquity([], {}, flatSpy);
  assert.equal(points.length, 0);
  assert.equal(summary, null);
});

test("benchmark batte il portafoglio: benchReturnPct riflette SPY", () => {
  const trades: ReplayTrade[] = [
    { ticker: "AAA", action: "BUY", shares: 1, price: 100, executedAt: "2024-01-01T15:00:00Z" },
  ];
  const aaa = candles([
    ["2024-01-01", 100],
    ["2024-01-04", 100],
  ]);
  const spy = candles([
    ["2024-01-01", 400],
    ["2024-01-04", 440], // +10%
  ]);
  const { summary } = replayEquity(trades, { AAA: aaa }, spy);
  assert.equal(summary?.totalReturnPct, 0);
  assert.equal(summary?.benchReturnPct, 10);
});
