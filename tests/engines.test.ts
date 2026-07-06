/**
 * Test deterministici sulle unità pure dei motori. Nessuna rete: fixture
 * sintetiche. Una regressione qui = la matematica di base è cambiata.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { sma, ema, rsi, atr, computeIndicators } from "../lib/indicators";
import { regressionChannel } from "../lib/regression";
import { evaluateTechnical } from "../lib/scanner";
import { positionSize, openRisk } from "../lib/risk";
import { scoreSentiment, aggregateSentiment } from "../lib/news";
import { walkForwardStats, type WalkForwardPeriod, type BacktestSummary } from "../lib/backtest";
import { investedSeries, rotationDecision, normalizeRotationConfig } from "../lib/leverageRotation";
import { computeExitSignals } from "../lib/exits";
import type { Candle, NewsItem } from "../lib/types";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Candele sintetiche da una serie di close (open=close prec., range ±0.5%). */
function candlesFrom(closes: number[], startDate = new Date("2024-01-01")): Candle[] {
  return closes.map((c, i) => {
    const d = new Date(startDate.getTime() + i * 86_400_000);
    const open = i > 0 ? closes[i - 1] : c;
    return {
      date: d.toISOString().slice(0, 10),
      open,
      high: Math.max(open, c) * 1.005,
      low: Math.min(open, c) * 0.995,
      close: c,
      volume: 1_000_000,
    };
  });
}

const linear = (n: number, start: number, step: number) =>
  Array.from({ length: n }, (_, i) => start + i * step);

// ─── Indicators ───────────────────────────────────────────────────────────────

test("sma: media aritmetica delle ultime N", () => {
  assert.equal(sma([1, 2, 3, 4, 5], 3), 4); // (3+4+5)/3
  assert.ok(isNaN(sma([1, 2], 3)));
});

test("ema: converge al valore su serie costante", () => {
  const v = ema(new Array(50).fill(10), 9);
  assert.ok(Math.abs(v - 10) < 1e-9);
});

test("rsi: 100 su serie solo rialzista, <50 su serie ribassista", () => {
  assert.equal(rsi(linear(30, 100, 1), 14), 100);
  assert.ok(rsi(linear(30, 100, -1), 14) < 50);
});

test("atr: range costante → ATR = range", () => {
  // ogni barra: high-low = 2, nessun gap → TR = 2 costante
  const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: 100, high: 101, low: 99, close: 100, volume: 1,
  }));
  assert.ok(Math.abs(atr(candles, 14) - 2) < 1e-9);
});

test("computeIndicators: null con meno di 55 barre, coerente sopra", () => {
  assert.equal(computeIndicators(candlesFrom(linear(50, 100, 0.5))), null);
  const ind = computeIndicators(candlesFrom(linear(120, 100, 0.5)));
  assert.ok(ind);
  assert.ok(ind!.price > ind!.sma50); // trend rialzista costruito
  assert.ok(ind!.emaFast > ind!.emaSlow);
});

// ─── Regression channel ───────────────────────────────────────────────────────

test("regressionChannel: retta perfetta → r2=1, trend asc, z=0", () => {
  const ch = regressionChannel(linear(40, 100, 1), 2)!;
  assert.equal(ch.r2, 1);
  assert.equal(ch.trend, "asc");
  assert.ok(Math.abs(ch.slope - 1) < 1e-9);
  assert.ok(Math.abs(ch.z) < 1e-6);
});

test("regressionChannel: serie piatta rumorosa → non asc", () => {
  const noisy = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 1 : -1));
  const ch = regressionChannel(noisy, 2)!;
  assert.notEqual(ch.trend, "asc");
});

// ─── Scanner scoring ──────────────────────────────────────────────────────────

test("evaluateTechnical: setup forte somma i pesi attesi", () => {
  const res = evaluateTechnical({
    price: 110, rsi: 60, emaFast: 109, emaSlow: 105, sma50: 100,
    roc: 5, volume: 2e6, avgVolume: 1e6, volumeRatio: 2,
    atr: 2, atrPct: 0.018, high52w: 112, low52w: 80,
  })!;
  // ABOVE_SMA50(15) + EMA_BULLISH(15) + RSI_MOMENTUM(15) + ROC(12) + VOLUME_SPIKE(14) + NEAR_52W(12) = 83
  assert.equal(res.score, 83);
});

test("evaluateTechnical: RSI ipercomprato penalizza", () => {
  const res = evaluateTechnical({
    price: 110, rsi: 80, emaFast: 109, emaSlow: 105, sma50: 100,
    roc: 5, volume: 1e6, avgVolume: 1e6, volumeRatio: 1,
    atr: 2, atrPct: 0.018, high52w: 150, low52w: 80,
  })!;
  assert.ok(res.reasons.some((r) => r.code === "RSI_OVERBOUGHT" && r.weight < 0));
});

// ─── Risk sizing ──────────────────────────────────────────────────────────────

test("positionSize: rischio fisso e cap di cassa", () => {
  const p = positionSize(10_000, 1, 100, 95)!; // rischio 100$, 5$/azione → 20 azioni
  assert.equal(p.shares, 20);
  assert.equal(p.dollarRisk, 100);
  assert.equal(p.capped, false);
  const capped = positionSize(1_000, 10, 100, 99)!; // 100$/1$ = 100 azioni ma costa 10k > 1k
  assert.equal(capped.capped, true);
  assert.ok(capped.cost <= 1_000);
});

test("openRisk: mai negativo", () => {
  assert.equal(openRisk(10, 100, 110), 0); // stop sopra il prezzo → rischio 0
  assert.equal(openRisk(10, 100, 95), 50);
});

// ─── Sentiment lexicon ────────────────────────────────────────────────────────

test("scoreSentiment: negazione inverte la polarità", () => {
  assert.ok(scoreSentiment("Company reports strong growth") > 0);
  assert.ok(scoreSentiment("Results are not strong this quarter") < 0);
});

test('scoreSentiment: "rate cut" è positivo, "dividend cut" negativo', () => {
  assert.ok(scoreSentiment("Fed rate cut boosts markets") > 0);
  assert.ok(scoreSentiment("Company announces dividend cut") < 0);
});

test("aggregateSentiment: recency pesa di più le notizie fresche", () => {
  const now = Date.now();
  const items: NewsItem[] = [
    { title: "a", link: "", source: "", tickers: [], publishedAt: new Date(now).toISOString(), sentiment: 1 },
    { title: "b", link: "", source: "", tickers: [], publishedAt: new Date(now - 10 * 86_400_000).toISOString(), sentiment: -1 },
  ];
  assert.ok(aggregateSentiment(items) > 0);
});

// ─── Walk-forward stats ───────────────────────────────────────────────────────

function summaryWith(expectancy: number, profitFactor: number): BacktestSummary {
  return {
    trades: 50, wins: 25, losses: 25, winRate: 50, avgWin: 1, avgLoss: -1,
    profitFactor, expectancy, maxDrawdown: 10, totalReturn: 5, cagr: 5,
    finalEquity: 10500, byOutcome: { target: 20, stop: 20, time: 10 },
  };
}

test("walkForwardStats: mediana, worst PF e periodi positivi", () => {
  const periods: WalkForwardPeriod[] = [
    { start: "a", end: "b", summary: summaryWith(0.1, 1.2) },
    { start: "b", end: "c", summary: summaryWith(-0.05, 0.9) },
    { start: "c", end: "d", summary: summaryWith(0.3, 1.5) },
  ];
  const wf = walkForwardStats(periods);
  assert.equal(wf.medianExpectancy, 0.1);
  assert.equal(wf.worstProfitFactor, 0.9);
  assert.equal(wf.positivePeriods, 2);
});

// ─── Rotazione: isteresi ──────────────────────────────────────────────────────

test("investedSeries: dentro la banda lo stato non cambia", () => {
  // 220 barre a 100 (SMA→100), poi oscillazione ±1% (dentro banda 2%), poi -5%.
  const closes = [...new Array(220).fill(100), 101, 99, 101, 99, 95, 94];
  const inv = investedSeries(closes, 200, 2);
  // a 100 esatto non supera SMA×1.02 → mai entrato
  assert.equal(inv[219], false);
  // serve > +2% per entrare
  const closes2 = [...new Array(220).fill(100), 103, 101, 99, 100.5, 97.9, 97];
  const inv2 = investedSeries(closes2, 200, 2);
  assert.equal(inv2[220], true);  // 103 > 102 → entra
  assert.equal(inv2[223], true);  // 99/100.5 dentro banda → resta
  assert.equal(inv2[225], false); // sotto SMA×0.98 → esce
});

test("rotationDecision: dati insufficienti → difensivo; uptrend → bull", () => {
  const cfg = normalizeRotationConfig({});
  const short = rotationDecision(candlesFrom(linear(50, 100, 1)), cfg);
  assert.deepEqual(Object.keys(short.targets), ["BIL"]);
  const up = rotationDecision(candlesFrom(linear(260, 100, 0.5)), cfg);
  assert.deepEqual(Object.keys(up.targets), ["SSO"]);
});

// ─── Exit signals ─────────────────────────────────────────────────────────────

test("computeExitSignals: trailing stop scatta dopo un ritracciamento dal picco", () => {
  // sale fino a 150 poi ritraccia sotto picco − 1.5×ATR
  const closes = [...linear(80, 100, 1), ...linear(20, 179, -3)];
  const candles = candlesFrom(closes);
  const signals = computeExitSignals({
    ticker: "TEST",
    entryDate: candles[60].date,
    entryPrice: 140,
    currentPrice: closes[closes.length - 1],
    candles,
    news: [],
  });
  assert.ok(signals.some((s) => s.type === "trailing"));
  assert.ok(signals.some((s) => s.type === "momentum")); // EMA9 < EMA21 dopo il crollo
});
