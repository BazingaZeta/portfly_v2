/**
 * Test deterministici sulla strategia Crypto Trend. Fixture sintetiche, nessuna
 * rete (le funzioni pure di decisione/normalizzazione). Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cryptoTrendDecision,
  normalizeCryptoTrendConfig,
  DEFAULT_CRYPTO_TREND,
  type CryptoTrendConfig,
} from "../lib/cryptoTrend";
import type { Candle } from "../lib/types";

function candles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: close, high: close, low: close, close, volume: 1000, adjClose: close,
  }));
}

const UP = candles([1, 2, 3, 4, 5, 6]);     // close(6) > SMA3(5) → sopra trend
const DOWN = candles([6, 5, 4, 3, 2, 1]);   // close(1) < SMA3(2) → sotto trend
const cfg: CryptoTrendConfig = { assets: ["BTC-USD", "ETH-USD"], smaPeriod: 3, hysteresisPct: 0 };

test("tiene solo l'asset sopra trend, l'altro va in cash", () => {
  const d = cryptoTrendDecision({ "BTC-USD": UP, "ETH-USD": DOWN }, cfg);
  assert.deepEqual(d.targets, { "BTC-USD": 0.5 });
  assert.equal(d.cashWeight, 0.5);
});

test("entrambe sopra trend → 100% investito equal-weight", () => {
  const d = cryptoTrendDecision({ "BTC-USD": UP, "ETH-USD": UP }, cfg);
  assert.deepEqual(d.targets, { "BTC-USD": 0.5, "ETH-USD": 0.5 });
  assert.equal(d.cashWeight, 0);
});

test("entrambe sotto trend → 100% cash (difensivo)", () => {
  const d = cryptoTrendDecision({ "BTC-USD": DOWN, "ETH-USD": DOWN }, cfg);
  assert.deepEqual(d.targets, {});
  assert.equal(d.cashWeight, 1);
});

test("dati insufficienti su un asset → quello resta in cash", () => {
  const d = cryptoTrendDecision({ "BTC-USD": UP, "ETH-USD": candles([1, 2]) }, cfg);
  assert.deepEqual(d.targets, { "BTC-USD": 0.5 });
  assert.equal(d.cashWeight, 0.5);
});

test("normalize: NaN e valori fuori range ricadono su default / clamp", () => {
  // Number(undefined) → NaN: non deve propagarsi (bug tipico con ?? ).
  const n1 = normalizeCryptoTrendConfig({ smaPeriod: NaN, hysteresisPct: NaN });
  assert.equal(n1.smaPeriod, DEFAULT_CRYPTO_TREND.smaPeriod);
  assert.equal(n1.hysteresisPct, DEFAULT_CRYPTO_TREND.hysteresisPct);

  const n2 = normalizeCryptoTrendConfig({ smaPeriod: 500, hysteresisPct: 50 });
  assert.equal(n2.smaPeriod, 300); // clamp max
  assert.equal(n2.hysteresisPct, 10); // clamp max

  // assets non validi → default; assets validi → filtrati e dedotti.
  assert.deepEqual(normalizeCryptoTrendConfig({ assets: ["FOO", "BAR"] }).assets, DEFAULT_CRYPTO_TREND.assets);
  assert.deepEqual(normalizeCryptoTrendConfig({ assets: ["BTC-USD", "BTC-USD"] }).assets, ["BTC-USD"]);
});
