import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributeByTicker,
  channelDetail,
  replayTickerSignals,
  atrSeries,
  initialStop,
  stopHit,
  trailStop,
  regimeMap,
  returnCorrelation,
  targetExposure,
  realizedVol,
  resolveWorldOptions,
  EXIT_RULE_LABELS,
  WORLD_BENCHMARK,
  WORLD_BENCHMARK_INCEPTION,
  type WorldTrade,
} from "../lib/worldMomentum";

function trade(p: Partial<WorldTrade> & { ticker: string; pnl: number; returnPct: number }): WorldTrade {
  return {
    entryDate: "2024-01-02",
    entryPrice: 100,
    exitDate: "2024-02-02",
    exitPrice: 100 + p.returnPct,
    shares: 1,
    barsHeld: 20,
    outcome: "channel_break",
    ...p,
  };
}

// ─── Attribuzione per titolo (passaggio 4) ───────────────────────────────────

test("attributeByTicker: aggrega i trade per ticker", () => {
  const rows = attributeByTicker([
    trade({ ticker: "AAPL", pnl: 100, returnPct: 10 }),
    trade({ ticker: "AAPL", pnl: -40, returnPct: -4 }),
    trade({ ticker: "MSFT", pnl: 60, returnPct: 6 }),
  ]);
  assert.equal(rows.length, 2);
  const aapl = rows.find((r) => r.ticker === "AAPL")!;
  assert.equal(aapl.trades, 2);
  assert.equal(aapl.wins, 1);
  assert.equal(aapl.winRate, 50);
  assert.equal(aapl.realizedPnl, 60);
  assert.equal(aapl.avgReturnPct, 3);
  assert.equal(aapl.bestPct, 10);
  assert.equal(aapl.worstPct, -4);
});

test("attributeByTicker: ordina per P&L realizzato decrescente", () => {
  const rows = attributeByTicker([
    trade({ ticker: "LOW", pnl: 10, returnPct: 1 }),
    trade({ ticker: "HIGH", pnl: 900, returnPct: 90 }),
    trade({ ticker: "MID", pnl: 300, returnPct: 30 }),
  ]);
  assert.deepEqual(rows.map((r) => r.ticker), ["HIGH", "MID", "LOW"]);
});

test("attributeByTicker: un trade in pari conta come perdita, non come vittoria", () => {
  // pnl === 0 non è una vittoria: la soglia è > 0, coerente con buildSummary.
  const [row] = attributeByTicker([trade({ ticker: "FLAT", pnl: 0, returnPct: 0 })]);
  assert.equal(row.wins, 0);
  assert.equal(row.winRate, 0);
});

test("attributeByTicker: nessun trade → nessuna riga", () => {
  assert.deepEqual(attributeByTicker([]), []);
});

test("attributeByTicker: media delle barre tenute", () => {
  const [row] = attributeByTicker([
    trade({ ticker: "X", pnl: 1, returnPct: 1, barsHeld: 10 }),
    trade({ ticker: "X", pnl: 1, returnPct: 1, barsHeld: 21 }),
  ]);
  assert.equal(row.avgBarsHeld, 15.5);
});

// ─── Risoluzione delle opzioni ───────────────────────────────────────────────

test("resolveWorldOptions: default documentati", () => {
  const o = resolveWorldOptions({ indexKey: "SP500", startDate: "2021-01-01", endDate: "2026-01-01" });
  assert.equal(o.benchmark, WORLD_BENCHMARK);
  assert.equal(o.metaWindow, 60);
  assert.equal(o.priceWindow, 40);
  assert.equal(o.entryMaxZ, 0);
  assert.equal(o.useRegime, true);
  assert.equal(o.regimeSma, 200);
  // Default adottato dopo il confronto delle tre uscite: vedi l'intestazione
  // del modulo. price_band (la lettura letterale) perdeva denaro.
  assert.equal(o.exitRule, "meta_break");
  // Protezione dai drawdown adottata dopo la validazione: volatility targeting.
  assert.equal(o.volTarget, 20);
  assert.equal(o.volWindow, 42);
  // Le opzioni scartate restano spente di default.
  assert.equal(o.stopAtr, 0);
  assert.equal(o.stopPct, 0);
  assert.equal(o.trailAtr, 0);
  assert.equal(o.trailPct, 0);
  assert.equal(o.maxWeight, 0);
  assert.equal(o.maxCorr, 0);
  assert.equal(o.regimeExit, false);
  // I pesi RS devono sommare a 1, altrimenti il composito non è una media.
  assert.equal(+(o.w30 + o.w90 + o.w180).toFixed(6), 1);
});

test("resolveWorldOptions: i valori espliciti vincono sui default", () => {
  const o = resolveWorldOptions({
    indexKey: "NDX", startDate: "2022-01-01", endDate: "2026-01-01",
    metaWindow: 90, exitRule: "meta_break", useRegime: false, maxPositions: 3,
  });
  assert.equal(o.metaWindow, 90);
  assert.equal(o.exitRule, "meta_break");
  assert.equal(o.useRegime, false);
  assert.equal(o.maxPositions, 3);
});

test("resolveWorldOptions: uno zero esplicito non viene sostituito dal default", () => {
  // Trappola classica di `??` con gli 0: entryMaxZ 0 e maxHoldBars 0 sono
  // valori legittimi (metà bassa del canale / nessun time-stop).
  const o = resolveWorldOptions({
    indexKey: "SP500", startDate: "2021-01-01", endDate: "2026-01-01",
    entryMaxZ: 0, maxHoldBars: 0, slippageBps: 0,
  });
  assert.equal(o.entryMaxZ, 0);
  assert.equal(o.maxHoldBars, 0);
  assert.equal(o.slippageBps, 0);
});

// ─── Coerenza delle varianti di uscita ───────────────────────────────────────

test("ogni regola di uscita ha un'etichetta leggibile", () => {
  for (const rule of ["price_band", "channel_flat", "meta_break"] as const) {
    assert.equal(typeof EXIT_RULE_LABELS[rule], "string");
    assert.ok(EXIT_RULE_LABELS[rule].length > 0);
  }
});

test("l'inizio storico del benchmark è una data valida e nel passato", () => {
  const t = new Date(WORLD_BENCHMARK_INCEPTION).getTime();
  assert.ok(Number.isFinite(t));
  assert.ok(t < Date.now());
});

// ─── Dettaglio del canale (pagina per titolo) ────────────────────────────────

/** Date fittizie consecutive, sufficienti per indicizzare la finestra. */
function fakeDates(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `2024-01-${String(i + 1).padStart(2, "0")}`);
}

test("channelDetail: su una retta perfetta il fit coincide col valore e z è 0", () => {
  const n = 40;
  const series = Array.from({ length: n }, (_, i) => 100 + i); // y = 100 + x
  const d = channelDetail(fakeDates(n), series, n - 1, 20)!;
  assert.ok(d);
  assert.equal(d.points.length, 20);
  assert.equal(d.channel.r2, 1);
  for (const p of d.points) {
    assert.ok(Math.abs(p.value - p.fit) < 1e-6, `fit dovrebbe coincidere: ${p.value} vs ${p.fit}`);
    assert.equal(p.z, 0);
    // Senza residui le bande collassano sulla retta.
    assert.ok(Math.abs(p.upper - p.lower) < 1e-6);
  }
});

test("channelDetail: la finestra termina sull'ultima barra richiesta", () => {
  const n = 50;
  const dates = fakeDates(n);
  const series = Array.from({ length: n }, (_, i) => 10 + Math.sin(i) );
  const d = channelDetail(dates, series, n - 1, 15)!;
  assert.equal(d.window, 15);
  assert.equal(d.points.length, 15);
  assert.equal(d.to, dates[n - 1]);
  assert.equal(d.from, dates[n - 15]);
});

test("channelDetail: z è lo scarto dal fit in unità di sigma", () => {
  const n = 30;
  // Retta con un solo punto spostato: il suo z deve essere il più grande.
  const series = Array.from({ length: n }, (_, i) => 50 + 2 * i);
  series[n - 1] += 10;
  const d = channelDetail(fakeDates(n), series, n - 1, 20)!;
  const last = d.points[d.points.length - 1];
  const recomputed = (last.value - last.fit) / d.channel.stdev;
  assert.ok(Math.abs(recomputed - last.z) < 0.01, `z incoerente: ${recomputed} vs ${last.z}`);
  assert.ok(last.z > 0, "il punto spinto in alto deve avere z positivo");
});

test("channelDetail: bande a ±k sigma dal fit", () => {
  const n = 40;
  const series = Array.from({ length: n }, (_, i) => 20 + i * 0.5 + (i % 3));
  const k = 2;
  const d = channelDetail(fakeDates(n), series, n - 1, 25, k)!;
  assert.equal(d.k, k);
  for (const p of d.points) {
    assert.ok(Math.abs(p.upper - (p.fit + k * d.channel.stdev)) < 1e-5);
    assert.ok(Math.abs(p.lower - (p.fit - k * d.channel.stdev)) < 1e-5);
  }
});

test("channelDetail: finestra più lunga dei dati disponibili → null", () => {
  const n = 20;
  const series = Array.from({ length: n }, (_, i) => i);
  assert.equal(channelDetail(fakeDates(n), series, n - 1, 50), null);
});

test("channelDetail: un NaN dentro la finestra la invalida", () => {
  const n = 40;
  const series = Array.from({ length: n }, (_, i) => 100 + i);
  series[10] = NaN; // buco nel metatitolo (data senza benchmark)
  // Finestra 35 (barre 5-39): contiene il buco → niente canale.
  assert.equal(channelDetail(fakeDates(n), series, n - 1, 35), null);
  // Finestra 20 (barre 20-39): il buco resta fuori → canale regolare.
  assert.ok(channelDetail(fakeDates(n), series, n - 1, 20) !== null);
});

test("channelDetail: sotto le 10 barre non c'è canale", () => {
  // Vincolo di regressionChannel: con pochi punti il fit non è significativo.
  const n = 30;
  const series = Array.from({ length: n }, (_, i) => 5 + i);
  assert.equal(channelDetail(fakeDates(n), series, n - 1, 9), null);
  assert.ok(channelDetail(fakeDates(n), series, n - 1, 10) !== null);
});

// ─── Replay dei segnali su un titolo ─────────────────────────────────────────

/**
 * Serie sintetica: prezzo e metatitolo salgono in modo pulito per `up` barre,
 * poi il metatitolo gira in discesa. Così si sa in anticipo dove la regola
 * deve entrare e dove deve uscire.
 */
function makeSeries(total: number, up: number) {
  const dates: string[] = [];
  const closes: number[] = [];
  const opens: number[] = [];
  const meta: number[] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + i * 86_400_000);
    dates.push(d.toISOString().slice(0, 10));
    closes.push(100 + i * 0.5);
    opens.push(100 + i * 0.5 - 0.1);
    // Metatitolo: sale fino a `up`, poi scende con la stessa pendenza.
    meta.push(i <= up ? 1 + i * 0.002 : 1 + up * 0.002 - (i - up) * 0.002);
  }
  return { dates, closes, opens, meta, regimeOk: new Map<string, boolean>() };
}

const baseOpts = () =>
  resolveWorldOptions({
    indexKey: "SP500", startDate: "2024-01-01", endDate: "2025-01-01",
    metaWindow: 20, priceWindow: 20, minMetaR2: 0.5, minPriceR2: 0.5,
    entryMaxZ: 2, scanFreq: 5, useRegime: false,
  });

test("replayTickerSignals: entra in trend pulito ed esce quando il metatitolo gira", () => {
  const series = makeSeries(200, 100);
  const signals = replayTickerSignals(series, { ...baseOpts(), exitRule: "meta_break" }, 40);
  assert.ok(signals.length >= 1, "deve produrre almeno un segnale");
  const first = signals[0];
  // Entrata nella fase di salita del metatitolo…
  assert.ok(first.entryDate < series.dates[100], `entrata troppo tardi: ${first.entryDate}`);
  // …e uscita dopo l'inversione, non prima.
  assert.ok(first.exitDate != null && first.exitDate > series.dates[100], `uscita troppo presto: ${first.exitDate}`);
  assert.match(first.exitReason, /benchmark/);
});

test("replayTickerSignals: esegue all'apertura della barra DOPO il segnale", () => {
  const series = makeSeries(160, 120);
  const signals = replayTickerSignals(series, { ...baseOpts(), exitRule: "meta_break" }, 40);
  const entryIdx = series.dates.indexOf(signals[0].entryDate);
  assert.ok(entryIdx > 0);
  // Il prezzo pagato è l'apertura di quella barra, non la sua chiusura:
  // comprare al close di una barra di cui si usa il close per decidere
  // sarebbe guardare il futuro.
  assert.equal(signals[0].entryPrice, +series.opens[entryIdx].toFixed(2));
  // E la barra del segnale è una barra di scan.
  assert.equal((entryIdx - 1) % baseOpts().scanFreq, 0);
});

test("replayTickerSignals: il time stop chiude la posizione", () => {
  const series = makeSeries(200, 190); // metatitolo sempre in salita: solo il time stop può chiudere
  const signals = replayTickerSignals(
    series,
    { ...baseOpts(), exitRule: "meta_break", maxHoldBars: 10 },
    40
  );
  const closed = signals.filter((s) => s.exitDate != null);
  assert.ok(closed.length > 0);
  assert.equal(closed[0].barsHeld, 10);
  assert.equal(closed[0].exitReason, "time stop");
});

test("replayTickerSignals: una posizione ancora aperta è segnalata come tale", () => {
  const series = makeSeries(120, 119); // non gira mai: resta dentro
  const signals = replayTickerSignals(series, { ...baseOpts(), exitRule: "meta_break" }, 40);
  const last = signals[signals.length - 1];
  assert.equal(last.exitDate, null);
  assert.equal(last.exitPrice, null);
  assert.equal(last.returnPct, null);
  assert.match(last.exitReason, /aperta/);
});

test("replayTickerSignals: i periodi non si sovrappongono", () => {
  const series = makeSeries(300, 150);
  const signals = replayTickerSignals(series, { ...baseOpts(), exitRule: "meta_break", maxHoldBars: 15 }, 40);
  for (let i = 1; i < signals.length; i++) {
    const prevExit = signals[i - 1].exitDate;
    assert.ok(prevExit != null, "solo l'ultimo segnale può essere aperto");
    assert.ok(signals[i].entryDate > prevExit!, `sovrapposizione fra ${prevExit} e ${signals[i].entryDate}`);
  }
});

test("replayTickerSignals: il filtro di regime blocca le entrate", () => {
  const series = makeSeries(200, 190);
  const bear = new Map(series.dates.map((d) => [d, false] as const));
  const withRegime = replayTickerSignals(
    { ...series, regimeOk: bear },
    { ...baseOpts(), exitRule: "meta_break", useRegime: true },
    40
  );
  assert.equal(withRegime.length, 0, "con regime negativo non si entra mai");
  // Stesso scenario senza filtro: i segnali ci sono.
  const without = replayTickerSignals(series, { ...baseOpts(), exitRule: "meta_break", useRegime: false }, 40);
  assert.ok(without.length > 0);
});

// ─── Gestione del rischio ────────────────────────────────────────────────────

const riskOpts = (o: Partial<Parameters<typeof resolveWorldOptions>[0]> = {}) =>
  resolveWorldOptions({ indexKey: "SP500", startDate: "2024-01-01", endDate: "2025-01-01", ...o });

test("atrSeries: su barre identiche l'ATR è l'escursione costante", () => {
  const c = Array.from({ length: 30 }, () => ({ high: 11, low: 9, close: 10 }));
  const a = atrSeries(c, 14);
  assert.ok(Number.isNaN(a[13]), "nel warm-up non c'è ATR");
  assert.equal(a[14], 2);
  assert.equal(a[29], 2);
});

test("atrSeries: tiene conto dei gap (true range, non solo high-low)", () => {
  const c = Array.from({ length: 20 }, (_, i) =>
    i < 15 ? { high: 10.5, low: 9.5, close: 10 } : { high: 20.5, low: 19.5, close: 20 });
  const a = atrSeries(c, 14);
  // La barra 15 arriva a 20 dopo un close a 10: true range = 20,5 − 10, non 1.
  assert.ok(a[15] > a[14] + 0.5, `il gap deve far salire l'ATR: ${a[14]} → ${a[15]}`);
});

test("initialStop: vince la regola più stretta", () => {
  const r = initialStop(100, 2, riskOpts({ stopAtr: 3, stopPct: 10 }));
  // 3 × ATR = 94, 10% = 90 → vale 94
  assert.equal(r.stop, 94);
  assert.equal(r.initial, 94);
  assert.equal(r.highSince, 100);
});

test("initialStop: senza regole non c'è stop", () => {
  const r = initialStop(100, 2, riskOpts());
  assert.equal(r.stop, -Infinity);
  assert.equal(stopHit({ open: 1, low: 0.5 }, r), null);
});

test("stopHit: gap sotto lo stop → si esce all'apertura, non allo stop", () => {
  const r = { initial: 90, stop: 90, highSince: 100 };
  assert.deepEqual(stopHit({ open: 85, low: 80 }, r), { price: 85, kind: "stop" });
});

test("stopHit: minimo che buca lo stop → si esce allo stop", () => {
  const r = { initial: 90, stop: 90, highSince: 100 };
  assert.deepEqual(stopHit({ open: 95, low: 89 }, r), { price: 90, kind: "stop" });
  assert.equal(stopHit({ open: 95, low: 91 }, r), null);
});

test("stopHit: uno stop sopra l'iniziale è un trailing", () => {
  const r = { initial: 90, stop: 110, highSince: 125 };
  assert.equal(stopHit({ open: 112, low: 108 }, r)?.kind, "trail");
});

test("trailStop: lo stop sale col massimo e non scende mai", () => {
  const o = riskOpts({ trailPct: 10 });
  const r = initialStop(100, 2, o); // nessuno stop iniziale, solo trailing
  trailStop(r, { high: 120 }, 2, o);
  assert.equal(r.stop, 108);
  trailStop(r, { high: 110 }, 2, o); // massimo più basso: lo stop resta dov'è
  assert.equal(r.stop, 108);
  assert.equal(r.highSince, 120);
});

test("trailStop in ATR usa l'ATR corrente, non quello d'ingresso", () => {
  const o = riskOpts({ trailAtr: 2 });
  const r = initialStop(100, 1, o);
  trailStop(r, { high: 400 }, 20, o); // il titolo è quadruplicato e oscilla di più
  assert.equal(r.stop, 360); // 400 − 2 × 20, non 400 − 2 × 1
});

// ─── Regime con isteresi ─────────────────────────────────────────────────────

test("regimeMap: con h = 0 è semplicemente close > SMA", () => {
  const closes = [...Array(5).fill(100), 90, 110, 99];
  const m = regimeMap(closes.map((c, i) => ({ date: `d${i}`, close: c })), { regimeSma: 5, regimeHysteresisPct: 0 });
  assert.equal(m.get("d4"), false); // close == SMA: non è sopra
  assert.equal(m.get("d5"), false);
  assert.equal(m.get("d6"), true);
});

test("regimeMap: l'isteresi ignora le oscillazioni dentro la banda", () => {
  // Banda ±5% attorno alla SMA: si esce sotto SMA×0,95, si rientra sopra SMA×1,05.
  const closes = [...Array(10).fill(100), 106, 98, 97, 101, 90, 99, 104, 112];
  const m = regimeMap(closes.map((c, i) => ({ date: `d${i}`, close: c })), { regimeSma: 10, regimeHysteresisPct: 5 });
  const at = (i: number) => m.get(`d${i}`);
  assert.equal(at(10), true);   // 106 > SMA
  assert.equal(at(11), true);   // 98: dentro la banda, resta positivo
  assert.equal(at(12), true);   // 97: ancora dentro
  assert.equal(at(14), false);  // 90: sotto la banda → negativo
  assert.equal(at(16), false);  // 104: dentro la banda, resta negativo
  assert.equal(at(17), true);   // 112: sopra la banda → positivo
});

// ─── Correlazione ────────────────────────────────────────────────────────────

function series(closes: number[]) {
  const candles = closes.map((close, i) => ({
    date: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    close,
  }));
  return { candles, dateIdx: new Map(candles.map((c, i) => [c.date, i])) };
}

test("returnCorrelation: un titolo è perfettamente correlato con se stesso", () => {
  const a = series(Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1));
  assert.ok(Math.abs(returnCorrelation(a, a, 79) - 1) < 1e-9);
});

test("returnCorrelation: rendimenti speculari → correlazione −1", () => {
  const up = Array.from({ length: 80 }, (_, i) => 100 * Math.exp(0.01 * Math.sin(i)));
  const down = Array.from({ length: 80 }, (_, i) => 100 * Math.exp(-0.01 * Math.sin(i)));
  const r = returnCorrelation(series(up), series(down), 79);
  assert.ok(r < -0.99, `atteso ≈ −1, ottenuto ${r}`);
});

test("returnCorrelation: troppo pochi punti non bloccano (ritorna 0)", () => {
  const a = series([100, 101, 102, 103, 104]);
  assert.equal(returnCorrelation(a, a, 4), 0);
});

// ─── Volatility targeting ────────────────────────────────────────────────────

function equityFromReturns(rets: number[]) {
  let e = 10_000;
  return [{ equity: e }, ...rets.map((r) => ({ equity: (e *= 1 + r) }))];
}

test("realizedVol: serie piatta → volatilità nulla", () => {
  assert.equal(realizedVol(equityFromReturns(Array(60).fill(0)), 42), 0);
});

test("realizedVol: poca storia → null", () => {
  assert.equal(realizedVol(equityFromReturns(Array(10).fill(0.01)), 42), null);
});

test("targetExposure: volatilità sotto l'obiettivo → esposizione piena, mai leva", () => {
  // ±0,3% al giorno ≈ 4,8% annuo, molto sotto il 20%
  const eq = equityFromReturns(Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.003 : -0.003)));
  assert.equal(targetExposure(eq, { volTarget: 20, volWindow: 42, minExposure: 0.25 }), 1);
});

test("targetExposure: volatilità doppia dell'obiettivo → circa metà esposizione", () => {
  // ±2,52% al giorno: volatilità annua ≈ 40%
  const eq = equityFromReturns(Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.0252 : -0.0252)));
  const vol = realizedVol(eq, 42)!;
  const e = targetExposure(eq, { volTarget: 20, volWindow: 42, minExposure: 0.25 });
  assert.ok(Math.abs(e - 20 / vol) < 1e-9);
  assert.ok(e > 0.45 && e < 0.55, `atteso ≈ 0,5, ottenuto ${e}`);
});

test("targetExposure: nel panico non scende sotto il minimo", () => {
  const eq = equityFromReturns(Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.08 : -0.08)));
  assert.equal(targetExposure(eq, { volTarget: 20, volWindow: 42, minExposure: 0.25 }), 0.25);
});

test("targetExposure: con volTarget 0 non riduce mai", () => {
  const eq = equityFromReturns(Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.08 : -0.08)));
  assert.equal(targetExposure(eq, { volTarget: 0, volWindow: 42, minExposure: 0.25 }), 1);
});
