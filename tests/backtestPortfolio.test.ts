import { test } from "node:test";
import assert from "node:assert/strict";
import { backtestPortfolio, type BtTrade } from "../lib/backtestPortfolio";

const T = (p: Partial<BtTrade> & Pick<BtTrade, "ticker" | "entryDate" | "entryPrice" | "shares">): BtTrade => ({
  exitDate: "2024-12-31", exitPrice: p.entryPrice, pnl: 0, outcome: "channel_break", ...p,
});

test("portafoglio: lotti, vendite parziali, posizione aperta e liquidità residua", () => {
  const trades: BtTrade[] = [
    // AAA: comprate 10 a 100, venduta 3 a 110 (riduzione), 7 ancora aperte a fine test.
    T({ ticker: "AAA", entryDate: "2024-01-02", entryPrice: 100, shares: 3, exitDate: "2024-02-01", exitPrice: 110, pnl: 30, outcome: "trim" }),
    T({ ticker: "AAA", entryDate: "2024-01-02", entryPrice: 100, shares: 7, exitDate: "2024-12-31", exitPrice: 119.9, pnl: 139.3, outcome: "end_of_test" }),
    // BBB: comprate 20 a 50, vendute a 45: chiusa in perdita.
    T({ ticker: "BBB", entryDate: "2024-03-01", entryPrice: 50, shares: 20, exitDate: "2024-04-01", exitPrice: 45, pnl: -100 }),
  ];
  const p = backtestPortfolio(trades, { AAA: { close: 120, prevClose: 118 }, BBB: { close: 48, prevClose: 48 } }, { AAA: "Alfa" }, 10_000);

  // Registro: 2 acquisti + 2 vendite, in ordine di data, con la cassa che segue.
  assert.deepEqual(p.ledger.map((r) => `${r.date} ${r.side} ${r.ticker}`), [
    "2024-01-02 ACQUISTO AAA", "2024-02-01 VENDITA AAA", "2024-03-01 ACQUISTO BBB", "2024-04-01 VENDITA BBB",
  ]);
  assert.equal(p.ledger[0].amount, -1000);
  assert.equal(p.ledger[0].cash, 9000);
  assert.equal(p.ledger[1].cash, 9330);
  assert.equal(p.ledger[2].cash, 8330);
  assert.equal(p.ledger[3].cash, 9230);
  assert.equal(p.totals.cash, 9230);

  const aaa = p.rows.find((r) => r.ticker === "AAA")!;
  assert.equal(aaa.status, "APERTA");
  assert.equal(aaa.name, "Alfa");
  assert.equal(aaa.shares, 7);
  assert.equal(aaa.avgCost, 100);
  assert.equal(aaa.value, 840);
  assert.equal(aaa.realizedPnl, 30);
  assert.equal(aaa.openPnl, 140);       // 7 × (120 − 100), al prezzo di fine test
  assert.equal(aaa.totalPnl, 170);
  assert.equal(aaa.dayPct, +((2 / 118) * 100).toFixed(2));

  const bbb = p.rows.find((r) => r.ticker === "BBB")!;
  assert.equal(bbb.status, "CHIUSA");
  assert.equal(bbb.shares, 0);
  assert.equal(bbb.realizedPnl, -100);
  assert.equal(bbb.openPnl, 0);

  // Le aperte vengono prima.
  assert.equal(p.rows[0].ticker, "AAA");
  // Conti che devono quadrare: capitale finale = iniziale + P&L totale.
  assert.equal(p.totals.equity, 10_000 + p.totals.totalPnl);
  assert.equal(p.totals.equity, p.totals.cash + p.totals.value);
  assert.equal(p.totals.openPositions, 1);
});

import { marketParams, autoBenchmark } from "../lib/worldMomentum";

test("marketParams: benchmark automatico per indice, SMA valida, default validati", () => {
  assert.equal(autoBenchmark("NDX"), "QQQ");
  assert.equal(autoBenchmark("DJIA"), "DIA");
  assert.equal(autoBenchmark("SP500"), "SPY");
  assert.deepEqual(marketParams(new URLSearchParams("index=NDX&benchmark=AUTO&regimeSma=150")), { benchmark: "QQQ", regimeSma: 150 });
  assert.deepEqual(marketParams(new URLSearchParams("benchmark=dia")), { benchmark: "DIA", regimeSma: 200 });
  // Valori sconosciuti o fuori scala tornano ai default validati.
  assert.deepEqual(marketParams(new URLSearchParams("benchmark=XYZ&regimeSma=5000")), { benchmark: "URTH", regimeSma: 200 });
  assert.deepEqual(marketParams(new URLSearchParams("")), { benchmark: "URTH", regimeSma: 200 });
});
