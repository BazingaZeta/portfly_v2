import { test } from "node:test";
import assert from "node:assert/strict";
import { replayTickerSignals, resolveWorldOptions, scanPhase, tickerEquity, type TickerSignal } from "../lib/worldMomentum";

function dates(n: number, start = "2024-01-01"): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

test("scanPhase: avanza di uno per ogni giorno feriale, il weekend non conta", () => {
  assert.equal(scanPhase("1970-01-05"), 0);
  assert.equal(scanPhase("1970-01-09"), 4); // venerdì
  assert.equal(scanPhase("1970-01-12"), 5); // lunedì dopo
  const ds = dates(30, "2026-03-02");
  for (let i = 1; i < ds.length; i++) assert.equal(scanPhase(ds[i]) - scanPhase(ds[i - 1]), 1);
});

test("replay: le stesse date di entrata qualunque sia l'inizio dello storico scaricato", () => {
  const n = 600;
  const ds = dates(n, "2022-01-03");
  const closes = ds.map((_, i) => 100 + 20 * Math.sin(i / 25) + i * 0.15);
  const meta = closes.map((c, i) => c / (100 + i * 0.05));
  const o = resolveWorldOptions({ indexKey: "SP500", startDate: "2024-01-01", endDate: "2024-12-31", useRegime: false });
  const full = replayTickerSignals({ dates: ds, closes, opens: closes, meta, regimeOk: new Map() }, o, 300);
  // Stessa serie con 37 barre in meno all'inizio: il replay parte dalla stessa data.
  const cut = 37;
  const trimmed = replayTickerSignals(
    { dates: ds.slice(cut), closes: closes.slice(cut), opens: closes.slice(cut), meta: meta.slice(cut), regimeOk: new Map() },
    o,
    300 - cut
  );
  assert.ok(full.length > 0);
  assert.deepEqual(trimmed.map((s) => s.entryDate), full.map((s) => s.entryDate));
});

test("replay: la posizione aperta porta prezzo e P&L all'ultima chiusura", () => {
  const n = 400;
  const ds = dates(n);
  const closes = ds.map((_, i) => 100 + i * 0.4 + Math.sin(i) * 0.3);
  const meta = closes.map((c, i) => c / (100 + i * 0.1));
  const o = resolveWorldOptions({
    indexKey: "SP500", startDate: "2024-01-01", endDate: "2024-12-31",
    useRegime: false, channelMode: "anchored", anchoredExit: "price",
  });
  const sig = replayTickerSignals({ dates: ds, closes, opens: closes, meta, regimeOk: new Map() }, o, 250);
  const open = sig.find((s) => s.exitDate == null);
  assert.ok(open, "un trend che non si rompe lascia la posizione aperta");
  assert.equal(open!.lastPrice, +closes[n - 1].toFixed(2));
  assert.equal(open!.openReturnPct, +(((closes[n - 1] - open!.entryPrice) / open!.entryPrice) * 100).toFixed(2));
});

test("tickerEquity: capitale investito solo in posizione, drawdown marcato a mercato", () => {
  const ds = dates(10);
  const closes = [100, 100, 110, 99, 120, 120, 120, 130, 130, 130];
  const sig: TickerSignal[] = [
    { entryDate: ds[1], entryPrice: 100, exitDate: ds[4], exitPrice: 120, returnPct: 20, barsHeld: 3, exitReason: "x" },
    { entryDate: ds[6], entryPrice: 120, exitDate: null, exitPrice: null, returnPct: null, barsHeld: 3, exitReason: "aperta", lastPrice: 130, openReturnPct: 8.33 },
  ];
  const { equity, stats } = tickerEquity({ dates: ds, closes }, sig, 0, 1000, 0);
  assert.equal(equity[0].equity, 1000);            // in cassa
  assert.equal(equity[2].equity, 1100);            // +10% a mercato
  assert.equal(equity[4].equity, 1200);            // uscita a 120
  assert.equal(equity[5].equity, 1200);            // in cassa, fermo
  assert.ok(Math.abs(equity[9].equity - 1300) < 1e-6); // aperta, valutata a 130
  assert.equal(stats.totalReturn, 30);
  assert.equal(stats.maxDrawdown, 10);             // 1100 → 990
  assert.equal(stats.trades, 2);
  assert.equal(stats.closedTrades, 1);
  assert.equal(stats.winRate, 100);
  assert.equal(stats.timeInMarketPct, 70);         // in posizione a fine seduta: 1,2,3 e 6,7,8,9 = 7 su 10
});
