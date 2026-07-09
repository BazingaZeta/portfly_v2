// Ricostruzione della curva di equity di un portafoglio per **replay** dei
// trade contro le chiusure storiche giornaliere. Non serve nessuno snapshot
// persistito: le tabelle trade sono già un event log (ticker, azioni, prezzo,
// timestamp), quindi il valore di ogni giorno passato è calcolabile a posteriori.
//
// Logica pura e senza I/O: le candele vengono passate dal chiamante (che le
// prende da lib/marketData con cache). Così è testabile in isolamento.

import type { Candle } from "./types";

/** Forma minima comune a Trade e IndexTrade, sufficiente per il replay. */
export interface ReplayTrade {
  ticker: string;
  action: "BUY" | "SELL";
  shares: number;
  price: number;
  executedAt: string; // ISO
}

export interface EquityPoint {
  date: string; // yyyy-mm-dd
  value: number; // equity = cassa (proventi delle vendite) + valore holding aperti
  invested: number; // capitale versato cumulato (contributi esterni)
  drawdownPct: number; // calo % dal picco (>= 0)
  bench: number | null; // SPY normalizzato allo startValue del portafoglio
}

export interface EquitySummary {
  startValue: number;
  currentValue: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  benchReturnPct: number | null;
}

export interface EquitySeries {
  points: EquityPoint[];
  summary: EquitySummary | null;
}

const day = (iso: string) => iso.slice(0, 10);

// ─── Vista EUR ────────────────────────────────────────────────────────────────
// Tutti gli asset sono quotati in USD ma l'investitore è EUR-based: il cambio
// può dominare il P&L reale (SPY +10% con EUR +10% = zero in EUR). La curva in
// EUR è il valore del portafoglio convertito giorno per giorno al cambio as-of.

/** Punto FX minimo: chiusura EURUSD=X del giorno (USD per 1 EUR). */
export interface FxPoint {
  date: string;
  close: number;
}

/**
 * Converte una serie di equity USD in EUR con il cambio as-of giornaliero
 * (carry-forward nei giorni senza barra FX). Pura e testabile.
 *
 * - value/bench: divisi per il cambio del giorno (EURUSD = USD per 1 EUR).
 * - invested: ogni *incremento* (contributo) è convertito al cambio del giorno
 *   in cui avviene — convertire il cumulato al cambio corrente sbaglierebbe il
 *   capitale realmente versato in EUR.
 * - drawdown e summary: ricalcolati sulla curva EUR (il DD in EUR differisce
 *   da quello USD quando il cambio si muove).
 */
export function convertSeriesToEur(series: EquitySeries, fx: FxPoint[]): EquitySeries {
  if (series.points.length === 0 || fx.length === 0) return { points: [], summary: null };
  const sortedFx = [...fx].sort((a, b) => a.date.localeCompare(b.date));

  let fi = 0;
  let rate: number | null = null;
  const rateAt = (date: string): number => {
    while (fi < sortedFx.length && sortedFx[fi].date <= date) {
      if (sortedFx[fi].close > 0) rate = sortedFx[fi].close;
      fi++;
    }
    // Prima della prima barra FX: usa la prima disponibile (meglio di saltare i punti).
    return rate ?? sortedFx.find((p) => p.close > 0)?.close ?? 1;
  };

  const points: EquityPoint[] = [];
  let peak = -Infinity;
  let maxDd = 0;
  let investedEur = 0;
  let prevInvestedUsd = 0;
  let benchFirstEur: number | null = null;
  let benchLastEur: number | null = null;

  for (const p of series.points) {
    const r = rateAt(p.date);
    const value = p.value / r;
    investedEur += Math.max(0, p.invested - prevInvestedUsd) / r;
    prevInvestedUsd = p.invested;
    const bench = p.bench != null ? p.bench / r : null;
    if (bench != null) {
      if (benchFirstEur == null) benchFirstEur = bench;
      benchLastEur = bench;
    }
    peak = Math.max(peak, value);
    const dd = peak > 0 ? (peak - value) / peak : 0;
    maxDd = Math.max(maxDd, dd);
    points.push({
      date: p.date,
      value: +value.toFixed(2),
      invested: +investedEur.toFixed(2),
      drawdownPct: +(dd * 100).toFixed(2),
      bench: bench != null ? +bench.toFixed(2) : null,
    });
  }

  const current = points[points.length - 1].value;
  return {
    points,
    summary: {
      startValue: points[0].value,
      currentValue: current,
      totalReturnPct: investedEur > 0 ? +(((current - investedEur) / investedEur) * 100).toFixed(2) : 0,
      maxDrawdownPct: +(maxDd * 100).toFixed(2),
      benchReturnPct:
        benchFirstEur != null && benchFirstEur > 0 && benchLastEur != null
          ? +(((benchLastEur - benchFirstEur) / benchFirstEur) * 100).toFixed(2)
          : null,
    },
  };
}

/**
 * Lettore "as-of": scorre candele ordinate in modo crescente e, chiamato con
 * date monotòne non decrescenti, restituisce l'ultima chiusura con data <= date
 * (carry-forward nei giorni senza barra: weekend, festivi, quote mancante).
 */
function asOfReader(candles: Candle[]): (date: string) => number | null {
  let i = 0;
  let last: number | null = null;
  return (date: string): number | null => {
    while (i < candles.length && candles[i].date <= date) {
      last = candles[i].close;
      i++;
    }
    return last;
  };
}

/**
 * Ricostruisce la serie giornaliera di equity dal replay dei trade.
 *
 * @param trades  BUY/SELL del portafoglio (ordine qualsiasi: riordinati qui).
 * @param candlesByTicker  candele per ogni ticker mai detenuto.
 * @param benchCandles  candele del benchmark (SPY); usate anche come calendario
 *                      di borsa "master" quando presenti.
 *
 * NB: usa la chiusura **grezza** (`close`, non `adjClose`) per coerenza con i
 * prezzi di esecuzione non aggiustati. Caveat: un titolo che splitta mentre è in
 * portafoglio distorce il suo tratto di curva (raro; gestibile in futuro con gli
 * eventi di split).
 */
export function replayEquity(
  trades: ReplayTrade[],
  candlesByTicker: Record<string, Candle[]>,
  benchCandles: Candle[] = [],
): EquitySeries {
  if (trades.length === 0) return { points: [], summary: null };

  const sorted = [...trades].sort((a, b) => a.executedAt.localeCompare(b.executedAt));
  const startDate = day(sorted[0].executedAt);
  const endDate = day(new Date().toISOString());

  // Calendario di borsa: giorni di SPY se disponibili (SPY quota ogni giorno di
  // mercato), altrimenti unione dei giorni-candela dei ticker detenuti.
  let calendar: string[];
  if (benchCandles.length > 0) {
    calendar = benchCandles
      .map((c) => c.date)
      .filter((d) => d >= startDate && d <= endDate);
  } else {
    const set = new Set<string>();
    for (const cs of Object.values(candlesByTicker)) {
      for (const c of cs) if (c.date >= startDate && c.date <= endDate) set.add(c.date);
    }
    calendar = [...set].sort();
  }
  if (calendar.length === 0) calendar = [startDate];

  // Lettori as-of per ogni ticker e per il benchmark.
  const readers: Record<string, (d: string) => number | null> = {};
  for (const [tk, cs] of Object.entries(candlesByTicker)) {
    readers[tk] = asOfReader([...cs].sort((a, b) => a.date.localeCompare(b.date)));
  }
  const benchReader = benchCandles.length
    ? asOfReader([...benchCandles].sort((a, b) => a.date.localeCompare(b.date)))
    : null;

  // Stato corrente del portafoglio durante il replay. Modello a libro cassa:
  // l'equity è cassa (proventi delle vendite) + valore degli holding aperti.
  // I portafogli manuali non tracciano depositi, quindi ogni acquisto non
  // coperto dalla cassa disponibile è un "contributo" esterno implicito — così
  // la curva resta continua quando si chiude una posizione (i proventi restano
  // in cassa invece di far crollare il valore).
  const shares: Record<string, number> = {};
  const lastTradePrice: Record<string, number> = {};
  let cash = 0;
  let contributions = 0;
  let ti = 0;

  const points: EquityPoint[] = [];
  let peak = -Infinity;
  let maxDd = 0;
  let startValue: number | null = null;
  let benchStart: number | null = null;
  let benchLastRaw: number | null = null;

  for (const date of calendar) {
    // Applica tutti i trade eseguiti in questo giorno o prima.
    while (ti < sorted.length && day(sorted[ti].executedAt) <= date) {
      const t = sorted[ti++];
      lastTradePrice[t.ticker] = t.price;
      const cur = shares[t.ticker] ?? 0;
      if (t.action === "BUY") {
        const cost = t.shares * t.price;
        if (cash < cost) {
          contributions += cost - cash; // deposito implicito per coprire l'acquisto
          cash = cost;
        }
        cash -= cost;
        shares[t.ticker] = cur + t.shares;
      } else {
        // SELL: i proventi tornano in cassa.
        const sold = Math.min(t.shares, cur);
        cash += sold * t.price;
        shares[t.ticker] = cur - sold;
      }
    }

    // Valorizza gli holding aperti alla chiusura as-of (con carry-forward);
    // fallback al prezzo dell'ultimo trade se mancano candele per quel giorno.
    let holdings = 0;
    for (const tk of Object.keys(shares)) {
      const sh = shares[tk];
      if (sh <= 0) continue;
      const close = readers[tk]?.(date) ?? lastTradePrice[tk] ?? 0;
      holdings += sh * close;
    }
    const value = cash + holdings;
    const invested = contributions;

    if (startValue == null) startValue = value;
    peak = Math.max(peak, value);
    const dd = peak > 0 ? (peak - value) / peak : 0;
    maxDd = Math.max(maxDd, dd);

    let bench: number | null = null;
    if (benchReader) {
      const bc = benchReader(date);
      if (bc != null) {
        if (benchStart == null) benchStart = bc;
        benchLastRaw = bc;
        bench = benchStart > 0 ? startValue * (bc / benchStart) : null;
      }
    }

    points.push({
      date,
      value: +value.toFixed(2),
      invested: +invested.toFixed(2),
      drawdownPct: +(dd * 100).toFixed(2),
      bench: bench != null ? +bench.toFixed(2) : null,
    });
  }

  const start = points[0].value;
  const current = points[points.length - 1].value;
  // Rendimento sul capitale versato: (equity − contributi) = profitto netto.
  const totalReturnPct = contributions > 0 ? +(((current - contributions) / contributions) * 100).toFixed(2) : 0;
  const benchReturnPct =
    benchStart != null && benchStart > 0 && benchLastRaw != null
      ? +(((benchLastRaw - benchStart) / benchStart) * 100).toFixed(2)
      : null;

  return {
    points,
    summary: {
      startValue: start,
      currentValue: current,
      totalReturnPct,
      maxDrawdownPct: +(maxDd * 100).toFixed(2),
      benchReturnPct,
    },
  };
}
