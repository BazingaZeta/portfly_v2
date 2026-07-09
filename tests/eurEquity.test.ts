/**
 * Test deterministici sulla conversione EUR della curva di equity (pura).
 * EURUSD = dollari per 1 euro → valore EUR = valore USD / cambio.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { convertSeriesToEur, type EquitySeries } from "../lib/portfolioEquity";

function series(points: Partial<EquitySeries["points"][number]>[]): EquitySeries {
  return {
    points: points.map((p, i) => ({
      date: p.date ?? `2024-01-0${i + 1}`,
      value: p.value ?? 0,
      invested: p.invested ?? 0,
      drawdownPct: p.drawdownPct ?? 0,
      bench: p.bench ?? null,
    })),
    summary: null,
  };
}

test("cambio costante: tutti i valori divisi per il tasso", () => {
  const usd = series([
    { date: "2024-01-01", value: 1250, invested: 1250, bench: 2500 },
    { date: "2024-01-02", value: 1500, invested: 1250, bench: 2750 },
  ]);
  const fx = [{ date: "2024-01-01", close: 1.25 }];
  const eur = convertSeriesToEur(usd, fx);
  assert.equal(eur.points[0].value, 1000);   // 1250 / 1.25
  assert.equal(eur.points[1].value, 1200);   // 1500 / 1.25
  assert.equal(eur.points[0].invested, 1000);
  assert.equal(eur.points[1].bench, 2200);   // 2750 / 1.25
  assert.equal(eur.summary!.totalReturnPct, 20); // (1200−1000)/1000
});

test("EUR si apprezza: portafoglio piatto in USD perde in EUR (drawdown FX)", () => {
  const usd = series([
    { date: "2024-01-01", value: 1000, invested: 1000 },
    { date: "2024-01-02", value: 1000, invested: 1000 },
  ]);
  const fx = [
    { date: "2024-01-01", close: 1.0 },
    { date: "2024-01-02", close: 1.25 }, // l'euro si rafforza del 25%
  ];
  const eur = convertSeriesToEur(usd, fx);
  assert.equal(eur.points[0].value, 1000);
  assert.equal(eur.points[1].value, 800); // 1000 / 1.25
  // Il drawdown in EUR esiste anche se in USD la curva è piatta.
  assert.equal(eur.points[1].drawdownPct, 20);
  assert.equal(eur.summary!.maxDrawdownPct, 20);
  assert.equal(eur.summary!.totalReturnPct, -20);
});

test("contributi convertiti al cambio del giorno in cui avvengono", () => {
  const usd = series([
    { date: "2024-01-01", value: 1000, invested: 1000 }, // cambio 1.0 → 1000€
    { date: "2024-01-02", value: 2250, invested: 2250 }, // +1250$ a cambio 1.25 → +1000€
  ]);
  const fx = [
    { date: "2024-01-01", close: 1.0 },
    { date: "2024-01-02", close: 1.25 },
  ];
  const eur = convertSeriesToEur(usd, fx);
  // Versati 2000€ reali, non 2250/1.25 = 1800€.
  assert.equal(eur.points[1].invested, 2000);
  assert.equal(eur.points[1].value, 1800); // 2250 / 1.25
  assert.equal(eur.summary!.totalReturnPct, -10); // (1800−2000)/2000
});

test("giorni senza barra FX: carry-forward dell'ultimo cambio noto", () => {
  const usd = series([
    { date: "2024-01-01", value: 1250, invested: 1250 },
    { date: "2024-01-02", value: 1250, invested: 1250 }, // weekend FX: nessuna barra
  ]);
  const fx = [{ date: "2024-01-01", close: 1.25 }];
  const eur = convertSeriesToEur(usd, fx);
  assert.equal(eur.points[1].value, 1000);
});

test("serie FX vuota → serie vuota (il chiamante nasconde il toggle)", () => {
  const usd = series([{ date: "2024-01-01", value: 1000, invested: 1000 }]);
  const eur = convertSeriesToEur(usd, []);
  assert.equal(eur.points.length, 0);
  assert.equal(eur.summary, null);
});
