/**
 * World Momentum — motore a due stadi sul canale di regressione
 * ==============================================================
 * Implementa lo schema operativo descritto nel feedback (set 2026), che è
 * diverso dalla Momentum RS v3 in un punto sostanziale: qui il canale di
 * regressione lavora DUE volte, con due ruoli distinti.
 *
 *   Stadio 1 — SELEZIONE. Metatitolo = titolo / benchmark (MSCI World via
 *   URTH). Canale di regressione sul metatitolo: passano solo i titoli il cui
 *   metatitolo è in canale ascendente e pulito, ordinati per RS composito.
 *   È l'insieme dei "più forti del benchmark", e cambia nel tempo: alcuni si
 *   indeboliscono ed escono, altri entrano. La storia di questo insieme viene
 *   restituita in `rankingHistory` — serve al grafico della rotazione.
 *
 *   Stadio 2 — TIMING. Sui soli titoli forti, canale di regressione sul prezzo
 *   grezzo: si compra "all'inizio del canale" (prezzo nella metà bassa, z ≤
 *   entryMaxZ) e si vende quando il canale ascendente si rompe.
 *
 * Nella Momentum RS v3 il canale sul prezzo esisteva ma NON decideva nulla:
 * serviva solo a stampare stop e target, mentre entrata e uscita nascevano dal
 * metatitolo più un trailing ATR. Qui il prezzo torna a essere il trigger.
 *
 * "Rompere il canale" ammette tre letture, tutte e tre implementate come
 * varianti confrontabili (`exitRule`) perché solo il walk-forward può dire
 * quale regge:
 *   - `price_band`   il close buca la banda inferiore del canale prezzo
 *   - `channel_flat` il canale prezzo smette di essere ascendente (pendenza
 *                    ≤ 0 oppure R² sotto soglia): si rompe la struttura, non
 *                    il singolo prezzo
 *   - `meta_break`   si rompe il canale del METAtitolo: il titolo smette di
 *                    battere il benchmark anche se il prezzo tiene
 *
 * ─── Validazione (set 2026, SP500 top-80, 2021-09 → 2026-09, URTH +75,5%) ───
 *
 * Confronto delle tre uscite, regime ON, 5 fold consecutivi:
 *
 *   regola         totale   PF    maxDD   batte URTH in
 *   price_band     -10,8%   0,92  44,2%   3/5   ← la lettura letterale PERDE
 *   channel_flat    19,8%   1,14  26,3%   3/5
 *   meta_break     115,4%   1,76  28,7%   4/5   ← adottata come default
 *
 * `price_band` viene sballottata dal rumore: 334 trade, 14 barre di durata
 * media. Il prezzo buca la banda inferiore a ogni respiro del trend, e si esce
 * da posizioni ancora valide. `meta_break` tiene 29 barre e lascia correre.
 *
 * Il fold peggiore (2021-22) ha PF 0,47 e NON passa il gate "peggior fold
 * PF ≥ 0,9" della skill del repo. Letto però contro il benchmark dello stesso
 * fold, quel periodo è -8,3% contro -17,7% di URTH: la strategia ha dimezzato
 * il bear. Il gate sul PF assoluto è tarato su strategie che devono guadagnare
 * in ogni regime; una long-only in un mercato a -18% non può passarlo per
 * costruzione. Per questo motore il criterio onesto è il delta per fold contro
 * il benchmark, non il PF assoluto.
 *
 * ONESTÀ SUL NUMERO DI TESTA: il +115,4% è l'estremo fortunato di una banda di
 * rumore. Sull'asse `metaWindow` i valori 50-70 danno 98 / 77 / 115 / 94 / 65%
 * — stessa strategia, ±40 punti di oscillazione su ~150 trade. La media della
 * regione (~90%) è l'aspettativa onesta, cioè ~+14 punti su URTH in 5 anni,
 * non +40. La relazione sottostante è però monotona e ha una spiegazione
 * economica: finestra più lunga → segnale più lento → posizioni tenute più a
 * lungo → si cattura il trend invece del rumore (35 barre: 324 trade, +19%;
 * 100 barre: 85 trade, +191% ma maxDD 38%). `metaWindow` 60 è il centro della
 * regione stabile, non un picco scelto a posteriori.
 *
 * Plateau verificato (griglia dichiarata prima): minMetaR2, entryMaxZ,
 * priceWindow e strongTopN sono piatti attorno al centro. `maxPositions` e
 * `scanFreq` sono monotoni (3 posizioni → +201%, scan ogni 3 barre → +181%):
 * è concentrazione, non edge — e NON vanno impilati sui valori migliori di
 * ogni asse, che è il modo classico di costruire un backtest bellissimo e
 * inutile.
 *
 * Limiti: una sola finestra da 5 anni, in larga parte toro; universo con
 * survivorship bias (lista di oggi testata sul passato). I numeri sopra sono
 * indicativi, mai promessi come attesi live.
 */

import type { Candle } from "./types";
import { indexByKey } from "./indices";
import { nameFor } from "./universe";
import { fetchCandles } from "./marketData";
import { regressionChannel, type RegressionChannel } from "./regression";
import type { BacktestSummary, WalkForwardPeriod, WalkForwardReport } from "./backtest";
import { walkForwardStats } from "./backtest";

// ─── Benchmark ────────────────────────────────────────────────────────────────

/**
 * MSCI World. URTH (iShares MSCI World, USD, NYSE Arca) è l'unico proxy con
 * daily pulito e storico utilizzabile: l'indice MSCI vero (^990100-USD-STRD)
 * ha ~17% di barre nulle, inservibile per una regressione. USD come i titoli,
 * così il rapporto non si porta dentro il cambio.
 */
export const WORLD_BENCHMARK = "URTH";

/** Da quando URTH ha storico: prima di questa data il benchmark non esiste. */
export const WORLD_BENCHMARK_INCEPTION = "2012-02-01";

// ─── Tipi pubblici ────────────────────────────────────────────────────────────

export type ExitRule = "price_band" | "channel_flat" | "meta_break";

export const EXIT_RULE_LABELS: Record<ExitRule, string> = {
  price_band: "Prezzo sotto la banda inferiore del canale",
  channel_flat: "Canale prezzo non più ascendente",
  meta_break: "Canale del metatitolo rotto",
};

export interface WorldMomentumOptions {
  indexKey: string;
  startDate: string;
  endDate: string;
  benchmark?: string;
  accountSize?: number;
  maxPositions?: number;
  slippageBps?: number;
  /** Stadio 1: barre del canale sul metatitolo. */
  metaWindow?: number;
  /** Stadio 1: R² minimo perché il trend del metatitolo sia "pulito". */
  minMetaR2?: number;
  /** Stadio 1: quanti titoli forti tenere in lista per il timing. */
  strongTopN?: number;
  /** Stadio 2: barre del canale sul prezzo grezzo. */
  priceWindow?: number;
  /** Stadio 2: R² minimo del canale prezzo per considerarlo un canale. */
  minPriceR2?: number;
  /** Stadio 2: si entra solo con z ≤ questo ("inizio del canale"). */
  entryMaxZ?: number;
  exitRule?: ExitRule;
  /**
   * Filtro di regime: niente NUOVE entrate mentre il benchmark è sotto la sua
   * SMA(regimeSma). Le posizioni aperte seguono comunque la regola di uscita —
   * il filtro decide quando si compra, non quando si vende.
   */
  useRegime?: boolean;
  regimeSma?: number;
  /** Ogni quante barre si rifà la selezione dello stadio 1. */
  scanFreq?: number;
  /** Time-stop di sicurezza, in barre (0 = nessuno). */
  maxHoldBars?: number;
  folds?: number;
  w30?: number;
  w90?: number;
  w180?: number;
}

export type ResolvedWorldOptions = Required<WorldMomentumOptions>;

export interface WorldTrade {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  shares: number;
  pnl: number;
  returnPct: number;
  barsHeld: number;
  outcome: "channel_break" | "time" | "end_of_test";
}

/** Attribuzione per titolo: quanto ha reso davvero ogni nome (passaggio 4). */
export interface TickerAttribution {
  ticker: string;
  trades: number;
  wins: number;
  winRate: number;
  realizedPnl: number;
  avgReturnPct: number;
  bestPct: number;
  worstPct: number;
  avgBarsHeld: number;
}

/** Fotografia dell'insieme dei "forti" a una data di scan (passaggio 2). */
export interface RankingSnapshot {
  date: string;
  /** Ticker in ordine di RS composito decrescente. */
  strong: { ticker: string; rs: number; metaR2: number; metaZ: number }[];
  /** Entrati nell'insieme rispetto allo scan precedente. */
  entered: string[];
  /** Usciti dall'insieme rispetto allo scan precedente. */
  exited: string[];
}

export interface WorldMomentumResult {
  summary: BacktestSummary;
  /** Equity mark-to-market (realizzato + non realizzato a mercato). */
  equity: { date: string; equity: number }[];
  /** P&L realizzato cumulato: si muove SOLO quando una posizione si chiude. */
  realizedCurve: { date: string; realized: number }[];
  /** Benchmark buy & hold sulla stessa finestra, stesso capitale iniziale. */
  benchEquity: { date: string; equity: number }[];
  trades: WorldTrade[];
  perTicker: TickerAttribution[];
  rankingHistory: RankingSnapshot[];
  walkForward?: WalkForwardReport;
  options: ResolvedWorldOptions;
  tickersTested: number;
  signalsTotal: number;
  signalsTaken: number;
}

// ─── Dati interni ─────────────────────────────────────────────────────────────

interface TickerData {
  ticker: string;
  candles: Candle[];
  /** Close grezzi: sono i prezzi a cui si eseguono gli ordini. */
  closes: number[];
  /** Metatitolo su close aggiustati (total return), allineato per data. */
  meta: number[];
  dateIdx: Map<string, number>;
}

interface OpenPosition {
  ticker: string;
  entryBar: number;
  entryDate: string;
  entryPrice: number;
  shares: number;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

const px = (c: Candle) => c.adjClose ?? c.close;

function metaReturn(meta: number[], endIdx: number, lookback: number): number | null {
  const startIdx = endIdx - lookback;
  if (startIdx < 0) return null;
  const a = meta[startIdx];
  const b = meta[endIdx];
  if (!isFinite(a) || !isFinite(b) || a === 0) return null;
  return ((b - a) / a) * 100;
}

/** RS composito multi-periodo sul metatitolo (30/90/180 giorni pesati). */
function rsComposite(meta: number[], endIdx: number, w30: number, w90: number, w180: number): number {
  const r30 = metaReturn(meta, endIdx, 30);
  const r90 = metaReturn(meta, endIdx, 90);
  const r180 = metaReturn(meta, endIdx, 180);
  let num = 0;
  let den = 0;
  if (r30 !== null) { num += r30 * w30; den += w30; }
  if (r90 !== null) { num += r90 * w90; den += w90; }
  if (r180 !== null) { num += r180 * w180; den += w180; }
  return den > 0 ? num / den : -Infinity;
}

/** Finestra di serie che termina a `endIdx` incluso, o null se incompleta/sporca. */
function windowAt(series: number[], endIdx: number, size: number): number[] | null {
  const start = endIdx + 1 - size;
  if (start < 0) return null;
  const slice = series.slice(start, endIdx + 1);
  return slice.some((v) => !isFinite(v)) ? null : slice;
}

async function pool<T, R>(items: T[], limit: number, fn: (i: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (idx < items.length) {
        const k = idx++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

function emptySummary(accountSize: number): BacktestSummary {
  return {
    trades: 0, wins: 0, losses: 0, winRate: 0, avgWin: 0, avgLoss: 0,
    profitFactor: 0, expectancy: 0, maxDrawdown: 0, totalReturn: 0,
    cagr: 0, finalEquity: accountSize,
    byOutcome: { target: 0, stop: 0, time: 0 },
  };
}

function buildSummary(
  trades: WorldTrade[],
  finalEquity: number,
  maxDd: number,
  opts: ResolvedWorldOptions
): BacktestSummary {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const years =
    (new Date(opts.endDate).getTime() - new Date(opts.startDate).getTime()) / (365.25 * 86_400_000);
  const cagr =
    years > 0.05 && finalEquity > 0
      ? (Math.pow(finalEquity / opts.accountSize, 1 / years) - 1) * 100
      : 0;

  // Expectancy in percentuale per trade: qui non c'è uno stop fisso a definire
  // l'R, quindi l'R-multiplo della v3 non è calcolabile. Il rendimento medio %
  // è la misura onesta equivalente — attenzione a non confrontarlo con gli R
  // della Momentum RS: sono unità diverse.
  const expectancy = trades.length
    ? trades.reduce((s, t) => s + t.returnPct, 0) / trades.length
    : 0;

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
    avgWin: wins.length ? +(wins.reduce((s, t) => s + t.returnPct, 0) / wins.length).toFixed(2) : 0,
    avgLoss: losses.length ? +(losses.reduce((s, t) => s + t.returnPct, 0) / losses.length).toFixed(2) : 0,
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 99 : 0,
    expectancy: +expectancy.toFixed(3),
    maxDrawdown: +(maxDd * 100).toFixed(1),
    totalReturn: +(((finalEquity - opts.accountSize) / opts.accountSize) * 100).toFixed(1),
    cagr: +cagr.toFixed(1),
    finalEquity: +finalEquity.toFixed(0),
    byOutcome: {
      target: 0, // non esiste un target fisso in questo schema
      stop: trades.filter((t) => t.outcome === "channel_break").length,
      time: trades.filter((t) => t.outcome !== "channel_break").length,
    },
  };
}

/** Attribuzione per titolo a partire dai trade chiusi. */
export function attributeByTicker(trades: WorldTrade[]): TickerAttribution[] {
  const byTicker = new Map<string, WorldTrade[]>();
  for (const t of trades) {
    const arr = byTicker.get(t.ticker) ?? [];
    arr.push(t);
    byTicker.set(t.ticker, arr);
  }
  const rows: TickerAttribution[] = [];
  for (const [ticker, ts] of byTicker) {
    const wins = ts.filter((t) => t.pnl > 0).length;
    rows.push({
      ticker,
      trades: ts.length,
      wins,
      winRate: +((wins / ts.length) * 100).toFixed(1),
      realizedPnl: +ts.reduce((s, t) => s + t.pnl, 0).toFixed(2),
      avgReturnPct: +(ts.reduce((s, t) => s + t.returnPct, 0) / ts.length).toFixed(2),
      bestPct: +Math.max(...ts.map((t) => t.returnPct)).toFixed(2),
      worstPct: +Math.min(...ts.map((t) => t.returnPct)).toFixed(2),
      avgBarsHeld: +(ts.reduce((s, t) => s + t.barsHeld, 0) / ts.length).toFixed(1),
    });
  }
  return rows.sort((a, b) => b.realizedPnl - a.realizedPnl);
}

// ─── Simulazione ──────────────────────────────────────────────────────────────

interface SimOutput {
  summary: BacktestSummary;
  equity: { date: string; equity: number }[];
  realizedCurve: { date: string; realized: number }[];
  trades: WorldTrade[];
  rankingHistory: RankingSnapshot[];
  signalsTotal: number;
  signalsTaken: number;
}

function simulate(
  allData: TickerData[],
  benchCandles: Candle[],
  opts: ResolvedWorldOptions
): SimOutput {
  const slip = opts.slippageBps / 10_000;
  const dates = benchCandles
    .filter((c) => c.date >= opts.startDate && c.date <= opts.endDate)
    .map((c) => c.date);

  if (dates.length < 2) {
    return {
      summary: emptySummary(opts.accountSize),
      equity: [], realizedCurve: [], trades: [], rankingHistory: [],
      signalsTotal: 0, signalsTaken: 0,
    };
  }

  const dataByTicker = new Map(allData.map((d) => [d.ticker, d]));

  // Mappa di regime: benchmark sopra la propria SMA, calcolata su tutta la
  // serie (serve il warm-up) ma letta solo alla data corrente — nessun futuro.
  const regimeOk = new Map<string, boolean>();
  if (opts.useRegime) {
    const closes = benchCandles.map((c) => px(c));
    let sum = 0;
    for (let i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= opts.regimeSma) sum -= closes[i - opts.regimeSma];
      const sma = i >= opts.regimeSma - 1 ? sum / opts.regimeSma : NaN;
      // Prima di avere la SMA non si blocca nulla: il warm-up non è un bear.
      regimeOk.set(benchCandles[i].date, isNaN(sma) ? true : closes[i] > sma);
    }
  }

  let realized = opts.accountSize; // capitale realizzato (aperte valutate al costo)
  let peak = realized;
  let maxDd = 0;
  const equityCurve: { date: string; equity: number }[] = [];
  const realizedCurve: { date: string; realized: number }[] = [];
  const openPositions = new Map<string, OpenPosition>();
  const trades: WorldTrade[] = [];
  const rankingHistory: RankingSnapshot[] = [];
  let prevStrong = new Set<string>();
  let signalsTotal = 0;
  let signalsTaken = 0;

  /** Il canale prezzo di un titolo alla barra `barIdx`, o null se non fittabile. */
  const priceChannelAt = (td: TickerData, barIdx: number) => {
    const w = windowAt(td.closes, barIdx, opts.priceWindow);
    return w ? regressionChannel(w, 2) : null;
  };

  /** Il canale del metatitolo di un titolo alla barra `barIdx`. */
  const metaChannelAt = (td: TickerData, barIdx: number) => {
    const w = windowAt(td.meta, barIdx, opts.metaWindow);
    return w ? regressionChannel(w, 2) : null;
  };

  for (let di = 0; di < dates.length; di++) {
    const date = dates[di];
    const isScan = di % opts.scanFreq === 0;

    // ── 1. Uscite. La regola di uscita È la strategia: nessuno stop ATR di
    // contorno, altrimenti non si misura la regola che si vuole testare.
    for (const [ticker, pos] of [...openPositions]) {
      if (pos.entryBar > di) continue; // entra domani, non è ancora sul libro
      const td = dataByTicker.get(ticker);
      if (!td) continue;
      const barIdx = td.dateIdx.get(date);
      if (barIdx == null) continue;

      const bar = td.candles[barIdx];
      const barsHeld = di - pos.entryBar;
      let exit = false;
      let outcome: WorldTrade["outcome"] = "channel_break";

      switch (opts.exitRule) {
        case "price_band": {
          // Il canale si rifitta ogni giorno: la banda inferiore si muove con
          // il trend. Uscita sul close, non intrabarra — la banda è un livello
          // statistico, non un ordine di stop appoggiato al book.
          const ch = priceChannelAt(td, barIdx);
          if (ch && bar.close < ch.lowerNow) exit = true;
          break;
        }
        case "channel_flat": {
          const ch = priceChannelAt(td, barIdx);
          if (ch && (ch.trend !== "asc" || ch.r2 < opts.minPriceR2)) exit = true;
          break;
        }
        case "meta_break": {
          const ch = metaChannelAt(td, barIdx);
          if (ch && (ch.trend !== "asc" || ch.r2 < opts.minMetaR2)) exit = true;
          break;
        }
      }

      if (!exit && opts.maxHoldBars > 0 && barsHeld >= opts.maxHoldBars) {
        exit = true;
        outcome = "time";
      }

      if (exit) {
        const exitPrice = bar.close * (1 - slip);
        const pnl = pos.shares * (exitPrice - pos.entryPrice);
        realized += pnl;
        trades.push({
          ticker,
          entryDate: pos.entryDate,
          entryPrice: +pos.entryPrice.toFixed(4),
          exitDate: date,
          exitPrice: +exitPrice.toFixed(4),
          shares: pos.shares,
          pnl: +pnl.toFixed(2),
          returnPct: +(((exitPrice - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2),
          barsHeld,
          outcome,
        });
        openPositions.delete(ticker);
      }
    }

    // ── 2. Mark-to-market giornaliero + curva del realizzato.
    let unrealized = 0;
    for (const pos of openPositions.values()) {
      if (pos.entryBar > di) continue;
      const td = dataByTicker.get(pos.ticker);
      const barIdx = td?.dateIdx.get(date);
      if (!td || barIdx == null) continue;
      unrealized += pos.shares * (td.candles[barIdx].close - pos.entryPrice);
    }
    const mtm = realized + unrealized;
    peak = Math.max(peak, mtm);
    maxDd = Math.max(maxDd, peak > 0 ? (peak - mtm) / peak : 0);
    equityCurve.push({ date, equity: +mtm.toFixed(2) });
    realizedCurve.push({ date, realized: +(realized - opts.accountSize).toFixed(2) });

    if (!isScan) continue;

    // ── 3. Stadio 1 — chi è più forte del benchmark, oggi.
    const strong: RankingSnapshot["strong"] = [];
    for (const td of allData) {
      const barIdx = td.dateIdx.get(date);
      if (barIdx == null) continue;
      const metaCh = metaChannelAt(td, barIdx);
      if (!metaCh || metaCh.trend !== "asc" || metaCh.r2 < opts.minMetaR2) continue;
      const rs = rsComposite(td.meta, barIdx, opts.w30, opts.w90, opts.w180);
      if (!isFinite(rs)) continue;
      strong.push({ ticker: td.ticker, rs: +rs.toFixed(2), metaR2: metaCh.r2, metaZ: metaCh.z });
    }
    strong.sort((a, b) => b.rs - a.rs);
    const selected = strong.slice(0, opts.strongTopN);

    const nowStrong = new Set(selected.map((s) => s.ticker));
    rankingHistory.push({
      date,
      strong: selected,
      entered: [...nowStrong].filter((t) => !prevStrong.has(t)),
      exited: [...prevStrong].filter((t) => !nowStrong.has(t)),
    });
    prevStrong = nowStrong;

    // ── 4. Stadio 2 — fra i forti, chi è all'inizio del proprio canale prezzo.
    if (openPositions.size >= opts.maxPositions) continue;
    if (opts.useRegime && regimeOk.get(date) === false) continue;

    const entries: { ticker: string; rs: number }[] = [];
    for (const s of selected) {
      if (openPositions.has(s.ticker)) continue;
      const td = dataByTicker.get(s.ticker)!;
      const barIdx = td.dateIdx.get(date);
      if (barIdx == null) continue;

      const priceCh = priceChannelAt(td, barIdx);
      if (!priceCh || priceCh.trend !== "asc" || priceCh.r2 < opts.minPriceR2) continue;
      signalsTotal++;
      // "Inizio del canale": prezzo nella parte bassa della banda. z è in unità
      // di deviazione standard dei residui, quindi la soglia è confrontabile
      // fra titoli con volatilità diverse.
      if (priceCh.z > opts.entryMaxZ) continue;
      entries.push({ ticker: s.ticker, rs: s.rs });
    }

    entries.sort((a, b) => b.rs - a.rs);
    const slots = opts.maxPositions - openPositions.size;

    for (const e of entries.slice(0, slots)) {
      const nextDate = dates[di + 1];
      if (!nextDate) break;
      const td = dataByTicker.get(e.ticker)!;
      const nextIdx = td.dateIdx.get(nextDate);
      if (nextIdx == null) continue;

      // Segnale al close di oggi, esecuzione all'apertura di domani: nessuno
      // sguardo al futuro.
      const entryPrice = td.candles[nextIdx].open * (1 + slip);
      if (!(entryPrice > 0)) continue;

      const committed = [...openPositions.values()].reduce((s, p) => s + p.shares * p.entryPrice, 0);
      const cash = realized - committed;
      if (cash <= 0) break;

      let shares = realized / opts.maxPositions / entryPrice;
      if (shares * entryPrice > cash) shares = cash / entryPrice;
      if (!(shares > 0)) continue;

      openPositions.set(e.ticker, {
        ticker: e.ticker,
        entryBar: di + 1,
        entryDate: nextDate,
        entryPrice,
        shares: +shares.toFixed(4),
      });
      signalsTaken++;
    }
  }

  // ── Chiusura forzata a fine test: le aperte diventano realizzate, altrimenti
  // il confronto fra varianti premia chi resta dentro per caso.
  const lastDate = dates[dates.length - 1];
  for (const [ticker, pos] of openPositions) {
    const td = dataByTicker.get(ticker);
    const barIdx = td?.dateIdx.get(lastDate);
    if (!td || barIdx == null) continue;
    const exitPrice = td.candles[barIdx].close * (1 - slip);
    const pnl = pos.shares * (exitPrice - pos.entryPrice);
    realized += pnl;
    trades.push({
      ticker,
      entryDate: pos.entryDate,
      entryPrice: +pos.entryPrice.toFixed(4),
      exitDate: lastDate,
      exitPrice: +exitPrice.toFixed(4),
      shares: pos.shares,
      pnl: +pnl.toFixed(2),
      returnPct: +(((exitPrice - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2),
      barsHeld: dates.length - 1 - pos.entryBar,
      outcome: "end_of_test",
    });
  }
  if (equityCurve.length) {
    equityCurve[equityCurve.length - 1].equity = +realized.toFixed(2);
    realizedCurve[realizedCurve.length - 1].realized = +(realized - opts.accountSize).toFixed(2);
  }
  peak = Math.max(peak, realized);
  maxDd = Math.max(maxDd, peak > 0 ? (peak - realized) / peak : 0);

  return {
    summary: buildSummary(trades, realized, maxDd, opts),
    equity: equityCurve,
    realizedCurve,
    trades,
    rankingHistory,
    signalsTotal,
    signalsTaken,
  };
}

// ─── Analisi live (i due stadi, alla data di oggi) ───────────────────────────

export interface WorldLeader {
  ticker: string;
  name: string;
  price: number;
  /** Rango nell'insieme dei forti (1 = il più forte del benchmark). */
  rank: number;
  rs: number;
  /** Stadio 1 — canale sul metatitolo: decide se il titolo è "forte". */
  metaChannel: RegressionChannel;
  /** Stadio 2 — canale sul prezzo: decide il timing. Null se non fittabile. */
  priceChannel: RegressionChannel | null;
  /**
   * COMPRA  = forte + canale prezzo ascendente + prezzo a inizio canale
   * ATTENDI = forte ma il prezzo non è in zona d'ingresso
   * DEBOLE  = non batte il benchmark (non passa lo stadio 1)
   */
  signal: "COMPRA" | "ATTENDI" | "DEBOLE";
  /** Motivo leggibile del segnale, per non far indovinare all'utente. */
  reason: string;
  entry: number;
  /** Banda inferiore del canale prezzo: il livello sotto cui il canale è rotto. */
  channelLow: number;
  channelHigh: number;
  /** Serie per i grafici, allineate alla finestra del rispettivo canale. */
  priceSpark: number[];
  metaSpark: number[];
}

export interface WorldAnalysis {
  indexKey: string;
  indexLabel: string;
  benchmark: string;
  analyzedAt: string;
  /** Regime del benchmark: quando è false, la strategia non apre nuove posizioni. */
  regimeOk: boolean;
  regimeNote: string;
  leaders: WorldLeader[];
  options: ResolvedWorldOptions;
}

export interface WorldProgress {
  current: number;
  total: number;
  message: string;
}

/**
 * I due stadi applicati alla data più recente. È la versione "live" della
 * stessa matematica del backtest: stessa finestra, stesse soglie, stesso
 * benchmark — se qui e là divergono, i numeri del backtest non valgono niente
 * (è la trappola che l'audit di luglio ha già trovato una volta nel repo).
 */
export async function runWorldAnalysis(
  options: Omit<WorldMomentumOptions, "startDate" | "endDate"> & {
    startDate?: string;
    endDate?: string;
  },
  onProgress?: (p: WorldProgress) => void
): Promise<WorldAnalysis> {
  const today = new Date().toISOString().slice(0, 10);
  const opts = resolveWorldOptions({
    startDate: options.startDate ?? today,
    endDate: options.endDate ?? today,
    ...options,
  } as WorldMomentumOptions);

  const def = indexByKey(opts.indexKey);
  if (!def) throw new Error(`Indice sconosciuto: ${opts.indexKey}`);

  // 2 anni bastano: servono 180 barre di RS + la finestra del canale.
  const benchCandles = await fetchCandles(opts.benchmark, 2);
  if (benchCandles.length < opts.metaWindow + 180) {
    throw new Error(`Dati benchmark ${opts.benchmark} insufficienti (${benchCandles.length} barre)`);
  }
  const benchByDate = new Map(benchCandles.map((c) => [c.date, px(c)]));

  // Regime: benchmark sopra la propria SMA.
  const benchCloses = benchCandles.map((c) => px(c));
  const smaWindow = benchCloses.slice(-opts.regimeSma);
  const benchSma = smaWindow.length === opts.regimeSma
    ? smaWindow.reduce((s, v) => s + v, 0) / opts.regimeSma
    : NaN;
  const benchLast = benchCloses[benchCloses.length - 1];
  const regimeOk = isNaN(benchSma) ? true : benchLast > benchSma;
  const regimeNote = isNaN(benchSma)
    ? "Storico insufficiente per la SMA di regime."
    : regimeOk
    ? `${opts.benchmark} sopra la SMA${opts.regimeSma} (${benchLast.toFixed(2)} vs ${benchSma.toFixed(2)}): la strategia può aprire posizioni.`
    : `${opts.benchmark} sotto la SMA${opts.regimeSma} (${benchLast.toFixed(2)} vs ${benchSma.toFixed(2)}): niente nuove entrate finché il regime non torna positivo.`;

  let done = 0;
  const total = def.tickers.length;

  const rows = await pool(def.tickers, 8, async (ticker) => {
    const candles = await fetchCandles(ticker, 2);
    done++;
    onProgress?.({ current: done, total, message: `${ticker} (${done}/${total})` });
    if (candles.length < opts.metaWindow + 180) return null;

    const closes = candles.map((c) => c.close);
    const meta = candles.map((c) => {
      const b = benchByDate.get(c.date);
      return b && b > 0 ? px(c) / b : NaN;
    });
    const last = candles.length - 1;

    const metaWin = windowAt(meta, last, opts.metaWindow);
    const metaChannel = metaWin ? regressionChannel(metaWin, 2) : null;
    if (!metaChannel) return null;

    const priceWin = windowAt(closes, last, opts.priceWindow);
    const priceChannel = priceWin ? regressionChannel(priceWin, 2) : null;
    const rs = rsComposite(meta, last, opts.w30, opts.w90, opts.w180);

    return {
      ticker,
      price: closes[last],
      rs: isFinite(rs) ? rs : -Infinity,
      metaChannel,
      priceChannel,
      priceSpark: (priceWin ?? closes.slice(-opts.priceWindow)).map((v) => +v.toFixed(2)),
      metaSpark: (metaWin ?? []).map((v) => +v.toFixed(6)),
    };
  }).then((r) => r.filter((x): x is NonNullable<typeof x> => x !== null));

  // ── Stadio 1: chi batte il benchmark.
  const strong = rows
    .filter((r) => r.metaChannel.trend === "asc" && r.metaChannel.r2 >= opts.minMetaR2 && isFinite(r.rs))
    .sort((a, b) => b.rs - a.rs)
    .slice(0, opts.strongTopN);
  const strongSet = new Map(strong.map((r, i) => [r.ticker, i + 1]));

  const leaders: WorldLeader[] = rows
    .map((r): WorldLeader => {
      const rank = strongSet.get(r.ticker) ?? 0;
      const pc = r.priceChannel;

      let signal: WorldLeader["signal"] = "DEBOLE";
      let reason: string;

      if (!rank) {
        reason =
          r.metaChannel.trend !== "asc"
            ? "Il metatitolo non è in canale ascendente: non batte il benchmark."
            : r.metaChannel.r2 < opts.minMetaR2
            ? `Trend del metatitolo troppo rumoroso (R² ${r.metaChannel.r2} < ${opts.minMetaR2}).`
            : `Fuori dai primi ${opts.strongTopN} per forza relativa.`;
      } else if (!pc || pc.trend !== "asc" || pc.r2 < opts.minPriceR2) {
        signal = "ATTENDI";
        reason = !pc
          ? "Canale prezzo non calcolabile."
          : pc.trend !== "asc"
          ? "Forte sul benchmark, ma il prezzo non è in canale ascendente."
          : `Canale prezzo troppo rumoroso (R² ${pc.r2} < ${opts.minPriceR2}).`;
      } else if (pc.z > opts.entryMaxZ) {
        signal = "ATTENDI";
        reason = `Canale valido ma prezzo già alto dentro il canale (z ${pc.z} > ${opts.entryMaxZ}): si aspetta un rientro.`;
      } else {
        signal = "COMPRA";
        reason = `Forte sul benchmark (#${rank}) e prezzo a inizio canale (z ${pc.z}).`;
      }

      if (signal === "COMPRA" && !regimeOk) {
        signal = "ATTENDI";
        reason = `Setup valido ma il regime è negativo: ${opts.benchmark} sotto la SMA${opts.regimeSma}.`;
      }

      return {
        ticker: r.ticker,
        name: nameFor(r.ticker),
        price: +r.price.toFixed(2),
        rank,
        rs: +r.rs.toFixed(2),
        metaChannel: r.metaChannel,
        priceChannel: pc,
        signal,
        reason,
        entry: +r.price.toFixed(2),
        channelLow: pc ? +Math.max(0, pc.lowerNow).toFixed(2) : 0,
        channelHigh: pc ? +pc.upperNow.toFixed(2) : 0,
        priceSpark: r.priceSpark,
        metaSpark: r.metaSpark,
      };
    })
    // COMPRA prima, poi ATTENDI per rango, poi i deboli per RS.
    .sort((a, b) => {
      const order = { COMPRA: 0, ATTENDI: 1, DEBOLE: 2 };
      if (order[a.signal] !== order[b.signal]) return order[a.signal] - order[b.signal];
      if (a.rank && b.rank) return a.rank - b.rank;
      return b.rs - a.rs;
    });

  return {
    indexKey: opts.indexKey,
    indexLabel: def.label,
    benchmark: opts.benchmark,
    analyzedAt: new Date().toISOString(),
    regimeOk,
    regimeNote,
    leaders,
    options: opts,
  };
}

// ─── Dettaglio di un singolo titolo ──────────────────────────────────────────

/** Un punto della finestra su cui è stato fittato un canale. */
export interface ChannelPoint {
  date: string;
  /** Valore osservato (close grezzo, o metatitolo). */
  value: number;
  /** Valore della retta di regressione in quel punto. */
  fit: number;
  upper: number;
  lower: number;
  /** Scarto dal fit, in unità di deviazione standard dei residui. */
  z: number;
}

/**
 * Un canale con tutti i suoi ingredienti espliciti: la finestra, la retta, le
 * bande e i punti. Serve a poter RILEGGERE come è stato costruito, non solo a
 * vederne il risultato.
 */
export interface ChannelDetail {
  channel: RegressionChannel;
  /** Barre usate per il fit. */
  window: number;
  from: string;
  to: string;
  /** Larghezza delle bande in deviazioni standard. */
  k: number;
  points: ChannelPoint[];
}

export interface WorldTickerDetail {
  ticker: string;
  name: string;
  benchmark: string;
  price: number;
  asOf: string;
  rank: number;
  rs: { d30: number | null; d90: number | null; d180: number | null; composite: number };
  /** Pesi usati per il composito, così il calcolo è verificabile. */
  rsWeights: { w30: number; w90: number; w180: number };
  meta: ChannelDetail;
  priceChannel: ChannelDetail | null;
  signal: "COMPRA" | "ATTENDI" | "DEBOLE";
  reason: string;
  /** Serie lunga di contesto (fino a 250 barre) per inquadrare la finestra. */
  context: { date: string; close: number; meta: number }[];
  regimeOk: boolean;
  regimeNote: string;
  options: ResolvedWorldOptions;
}

/**
 * Costruisce un ChannelDetail a partire dalla serie e dalla finestra.
 * Esportata per i test: è la matematica che alimenta la pagina di dettaglio.
 */
export function channelDetail(
  dates: string[],
  series: number[],
  endIdx: number,
  window: number,
  k = 2
): ChannelDetail | null {
  const win = windowAt(series, endIdx, window);
  if (!win) return null;
  const ch = regressionChannel(win, k);
  if (!ch) return null;
  const start = endIdx + 1 - window;
  const points: ChannelPoint[] = win.map((value, i) => {
    const fit = ch.intercept + ch.slope * i;
    return {
      date: dates[start + i],
      value: +value.toFixed(6),
      fit: +fit.toFixed(6),
      upper: +(fit + k * ch.stdev).toFixed(6),
      lower: +(fit - k * ch.stdev).toFixed(6),
      z: ch.stdev > 0 ? +((value - fit) / ch.stdev).toFixed(3) : 0,
    };
  });
  return { channel: ch, window, from: points[0].date, to: points[points.length - 1].date, k, points };
}

/**
 * Tutto quello che serve per capire un singolo titolo: le due serie, i due
 * canali con i loro punti, la scomposizione dell'RS e il motivo del segnale.
 * Rifà esattamente la stessa matematica di `runWorldAnalysis` — se un giorno
 * divergono, è un bug, non una scelta.
 */
export async function runWorldTickerDetail(
  ticker: string,
  options: Omit<WorldMomentumOptions, "startDate" | "endDate"> & {
    startDate?: string;
    endDate?: string;
  }
): Promise<WorldTickerDetail> {
  const today = new Date().toISOString().slice(0, 10);
  const opts = resolveWorldOptions({
    startDate: options.startDate ?? today,
    endDate: options.endDate ?? today,
    ...options,
  } as WorldMomentumOptions);

  const [benchCandles, candles] = await Promise.all([
    fetchCandles(opts.benchmark, 2),
    fetchCandles(ticker, 2),
  ]);
  if (candles.length < opts.metaWindow + 180) {
    throw new Error(`Dati insufficienti per ${ticker} (${candles.length} barre)`);
  }
  const benchByDate = new Map(benchCandles.map((c) => [c.date, px(c)]));

  // Solo le barre per cui esiste anche il benchmark: il metatitolo deve essere
  // allineato per data, e i canali devono guardare le stesse barre.
  const aligned = candles.filter((c) => {
    const b = benchByDate.get(c.date);
    return b != null && b > 0;
  });
  if (aligned.length < opts.metaWindow + 180) {
    throw new Error(`Date allineate insufficienti per ${ticker} (${aligned.length} barre)`);
  }

  const dates = aligned.map((c) => c.date);
  const closes = aligned.map((c) => c.close);
  const meta = aligned.map((c) => px(c) / benchByDate.get(c.date)!);
  const last = aligned.length - 1;

  const metaDetail = channelDetail(dates, meta, last, opts.metaWindow);
  if (!metaDetail) throw new Error(`Canale del metatitolo non calcolabile per ${ticker}`);
  const priceDetail = channelDetail(dates, closes, last, opts.priceWindow);

  const d30 = metaReturn(meta, last, 30);
  const d90 = metaReturn(meta, last, 90);
  const d180 = metaReturn(meta, last, 180);
  const composite = rsComposite(meta, last, opts.w30, opts.w90, opts.w180);

  // Regime del benchmark, identico all'analisi.
  const benchCloses = benchCandles.map((c) => px(c));
  const smaSlice = benchCloses.slice(-opts.regimeSma);
  const benchSma = smaSlice.length === opts.regimeSma
    ? smaSlice.reduce((s, v) => s + v, 0) / opts.regimeSma
    : NaN;
  const benchLast = benchCloses[benchCloses.length - 1];
  const regimeOk = isNaN(benchSma) ? true : benchLast > benchSma;
  const regimeNote = isNaN(benchSma)
    ? "Storico insufficiente per la SMA di regime."
    : regimeOk
    ? `${opts.benchmark} sopra la SMA${opts.regimeSma} (${benchLast.toFixed(2)} vs ${benchSma.toFixed(2)}).`
    : `${opts.benchmark} sotto la SMA${opts.regimeSma} (${benchLast.toFixed(2)} vs ${benchSma.toFixed(2)}): niente nuove entrate.`;

  const mc = metaDetail.channel;
  const isStrong = mc.trend === "asc" && mc.r2 >= opts.minMetaR2;

  let signal: WorldTickerDetail["signal"] = "DEBOLE";
  let reason: string;
  if (!isStrong) {
    reason =
      mc.trend !== "asc"
        ? "Il metatitolo non è in canale ascendente: non batte il benchmark."
        : `Trend del metatitolo troppo rumoroso (R² ${mc.r2} < ${opts.minMetaR2}).`;
  } else if (!priceDetail || priceDetail.channel.trend !== "asc" || priceDetail.channel.r2 < opts.minPriceR2) {
    signal = "ATTENDI";
    reason = !priceDetail
      ? "Canale prezzo non calcolabile."
      : priceDetail.channel.trend !== "asc"
      ? "Forte sul benchmark, ma il prezzo non è in canale ascendente."
      : `Canale prezzo troppo rumoroso (R² ${priceDetail.channel.r2} < ${opts.minPriceR2}).`;
  } else if (priceDetail.channel.z > opts.entryMaxZ) {
    signal = "ATTENDI";
    reason = `Canale valido ma prezzo già alto dentro il canale (z ${priceDetail.channel.z} > ${opts.entryMaxZ}).`;
  } else if (!regimeOk) {
    signal = "ATTENDI";
    reason = `Setup valido ma il regime è negativo: ${opts.benchmark} sotto la SMA${opts.regimeSma}.`;
  } else {
    signal = "COMPRA";
    reason = `Forte sul benchmark e prezzo a inizio canale (z ${priceDetail.channel.z}).`;
  }

  const ctxLen = Math.min(250, aligned.length);
  const context = aligned.slice(-ctxLen).map((c, i) => ({
    date: c.date,
    close: +c.close.toFixed(2),
    meta: +meta[aligned.length - ctxLen + i].toFixed(6),
  }));

  return {
    ticker,
    name: nameFor(ticker),
    benchmark: opts.benchmark,
    price: +closes[last].toFixed(2),
    asOf: dates[last],
    // Il rango richiede l'intero universo: lo calcola il chiamante se serve.
    rank: 0,
    rs: {
      d30: d30 != null ? +d30.toFixed(2) : null,
      d90: d90 != null ? +d90.toFixed(2) : null,
      d180: d180 != null ? +d180.toFixed(2) : null,
      composite: isFinite(composite) ? +composite.toFixed(2) : 0,
    },
    rsWeights: { w30: opts.w30, w90: opts.w90, w180: opts.w180 },
    meta: metaDetail,
    priceChannel: priceDetail,
    signal,
    reason,
    context,
    regimeOk,
    regimeNote,
    options: opts,
  };
}

// ─── Storico dei segnali su un singolo titolo ────────────────────────────────

/** Un ciclo compra→vendi che la regola avrebbe prodotto su questo titolo. */
export interface TickerSignal {
  entryDate: string;
  entryPrice: number;
  exitDate: string | null; // null = ancora aperto alla fine dello storico
  exitPrice: number | null;
  returnPct: number | null;
  barsHeld: number;
  /** Perché si è usciti (o perché si è ancora dentro). */
  exitReason: string;
}

export interface TickerSignalHistory {
  ticker: string;
  signals: TickerSignal[];
  /** Serie su cui i segnali sono marcati: tutta la finestra analizzata. */
  series: { date: string; close: number }[];
  from: string;
  to: string;
  summary: {
    count: number;
    closed: number;
    wins: number;
    winRate: number;
    avgReturnPct: number;
    bestPct: number;
    worstPct: number;
    avgBarsHeld: number;
    /** Rendimento composto reinvestendo su questo solo titolo. */
    compoundedPct: number;
  };
}

/** Le serie allineate di un titolo, pronte per il replay. */
export interface TickerSeries {
  dates: string[];
  /** Chiusure grezze: i livelli del canale prezzo e dell'uscita. */
  closes: number[];
  /** Aperture: è a questo prezzo che si esegue, la barra dopo il segnale. */
  opens: number[];
  /** Metatitolo (titolo / benchmark) allineato per data. */
  meta: number[];
  /** Regime del benchmark per data; vuota = filtro disattivo. */
  regimeOk: Map<string, boolean>;
}

/**
 * Il replay vero e proprio: funzione pura, nessun I/O, così è testabile.
 *
 * Due invarianti che è facile rompere senza accorgersene:
 *  - il segnale nasce al close della barra i, ma l'esecuzione è all'APERTURA
 *    della barra i+1 — altrimenti si compra a un prezzo che non si conosceva;
 *  - sulla barra in cui si esce non si rientra, anche se il setup è di nuovo
 *    valido: servirebbe conoscere il close prima di averlo.
 */
export function replayTickerSignals(
  series: TickerSeries,
  opts: ResolvedWorldOptions,
  startBar: number
): TickerSignal[] {
  const { dates, closes, opens, meta, regimeOk } = series;
  const n = dates.length;

  const metaChAt = (i: number) => {
    const w = windowAt(meta, i, opts.metaWindow);
    return w ? regressionChannel(w, 2) : null;
  };
  const priceChAt = (i: number) => {
    const w = windowAt(closes, i, opts.priceWindow);
    return w ? regressionChannel(w, 2) : null;
  };

  const signals: TickerSignal[] = [];
  let open: { bar: number; date: string; price: number } | null = null;

  for (let i = startBar; i < n; i++) {
    // ── Uscita: valutata ogni barra, come nel motore di portafoglio.
    if (open && i > open.bar) {
      let exit = false;
      let reason = "";
      switch (opts.exitRule) {
        case "price_band": {
          const ch = priceChAt(i);
          if (ch && closes[i] < ch.lowerNow) {
            exit = true;
            reason = "prezzo sotto la banda inferiore del canale";
          }
          break;
        }
        case "channel_flat": {
          const ch = priceChAt(i);
          if (ch && (ch.trend !== "asc" || ch.r2 < opts.minPriceR2)) {
            exit = true;
            reason = ch.trend !== "asc" ? "canale prezzo non più ascendente" : "canale prezzo troppo rumoroso";
          }
          break;
        }
        case "meta_break": {
          const ch = metaChAt(i);
          if (ch && (ch.trend !== "asc" || ch.r2 < opts.minMetaR2)) {
            exit = true;
            reason =
              ch.trend !== "asc"
                ? "il titolo ha smesso di battere il benchmark"
                : "trend sul benchmark diventato rumoroso";
          }
          break;
        }
      }
      if (!exit && opts.maxHoldBars > 0 && i - open.bar >= opts.maxHoldBars) {
        exit = true;
        reason = "time stop";
      }

      if (exit) {
        const exitPrice = closes[i];
        signals.push({
          entryDate: open.date,
          entryPrice: +open.price.toFixed(2),
          exitDate: dates[i],
          exitPrice: +exitPrice.toFixed(2),
          returnPct: +(((exitPrice - open.price) / open.price) * 100).toFixed(2),
          barsHeld: i - open.bar,
          exitReason: reason,
        });
        open = null;
        continue; // niente rientro sulla stessa barra dell'uscita
      }
    }

    // ── Entrata: solo alle barre di scan, come nel motore di portafoglio.
    if (open || i % opts.scanFreq !== 0) continue;
    if (opts.useRegime && regimeOk.get(dates[i]) === false) continue;

    const mc = metaChAt(i);
    if (!mc || mc.trend !== "asc" || mc.r2 < opts.minMetaR2) continue;
    const pc = priceChAt(i);
    if (!pc || pc.trend !== "asc" || pc.r2 < opts.minPriceR2) continue;
    if (pc.z > opts.entryMaxZ) continue;

    const next = i + 1;
    if (next >= n) break;
    open = { bar: next, date: dates[next], price: opens[next] };
  }

  // Posizione ancora aperta alla fine: la si mostra come tale, non la si chiude
  // d'ufficio — qui stiamo elencando segnali, non misurando una performance.
  if (open) {
    signals.push({
      entryDate: open.date,
      entryPrice: +open.price.toFixed(2),
      exitDate: null,
      exitPrice: null,
      returnPct: null,
      barsHeld: n - 1 - open.bar,
      exitReason: "ancora aperta: il canale non si è rotto",
    });
  }

  return signals;
}

/**
 * Replay della regola a due stadi su UN titolo, barra per barra.
 *
 * ATTENZIONE a cosa è e cosa non è: questi sono i segnali della REGOLA su
 * questo nome, non i trade che il portafoglio avrebbe davvero eseguito. Il
 * backtest di portafoglio ne prende solo una parte, perché ha un numero
 * limitato di posizioni e perché seleziona i primi `strongTopN` per forza
 * relativa — un confronto che richiede l'intero universo e che qui, con due
 * sole serie scaricate, non si può fare. Serve a vedere *dove* la strategia
 * sarebbe entrata e uscita su questo titolo; per il P&L reale vale il backtest.
 */
export async function runTickerSignalHistory(
  ticker: string,
  options: Omit<WorldMomentumOptions, "startDate" | "endDate"> & { years?: number }
): Promise<TickerSignalHistory> {
  const today = new Date().toISOString().slice(0, 10);
  const opts = resolveWorldOptions({
    startDate: today,
    endDate: today,
    ...options,
  } as WorldMomentumOptions);
  const years = Math.min(10, Math.max(2, options.years ?? 5));

  const [benchCandles, candles] = await Promise.all([
    fetchCandles(opts.benchmark, years),
    fetchCandles(ticker, years),
  ]);
  const benchByDate = new Map(benchCandles.map((c) => [c.date, px(c)]));

  const aligned = candles.filter((c) => {
    const b = benchByDate.get(c.date);
    return b != null && b > 0;
  });
  const need = Math.max(opts.metaWindow, opts.priceWindow) + 180;
  if (aligned.length < need + 5) {
    throw new Error(`Storico insufficiente per ${ticker} (${aligned.length} barre, ne servono ${need + 5})`);
  }

  const dates = aligned.map((c) => c.date);
  const closes = aligned.map((c) => c.close);
  const meta = aligned.map((c) => px(c) / benchByDate.get(c.date)!);

  // Regime del benchmark barra per barra, con sola informazione passata.
  const regimeOk = new Map<string, boolean>();
  if (opts.useRegime) {
    const bc = benchCandles.map((c) => px(c));
    let sum = 0;
    for (let i = 0; i < bc.length; i++) {
      sum += bc[i];
      if (i >= opts.regimeSma) sum -= bc[i - opts.regimeSma];
      const sma = i >= opts.regimeSma - 1 ? sum / opts.regimeSma : NaN;
      regimeOk.set(benchCandles[i].date, isNaN(sma) ? true : bc[i] > sma);
    }
  }

  const signals = replayTickerSignals(
    { dates, closes, opens: aligned.map((c) => c.open), meta, regimeOk },
    opts,
    need
  );

  const closed = signals.filter((s) => s.returnPct != null);
  const rets = closed.map((s) => s.returnPct!);
  const wins = rets.filter((r) => r > 0).length;
  const compounded = rets.reduce((acc, r) => acc * (1 + r / 100), 1);

  return {
    ticker,
    signals,
    series: aligned.slice(need).map((c) => ({ date: c.date, close: +c.close.toFixed(2) })),
    from: dates[need],
    to: dates[dates.length - 1],
    summary: {
      count: signals.length,
      closed: closed.length,
      wins,
      winRate: closed.length ? +((wins / closed.length) * 100).toFixed(1) : 0,
      avgReturnPct: rets.length ? +(rets.reduce((a, b) => a + b, 0) / rets.length).toFixed(2) : 0,
      bestPct: rets.length ? +Math.max(...rets).toFixed(2) : 0,
      worstPct: rets.length ? +Math.min(...rets).toFixed(2) : 0,
      avgBarsHeld: closed.length
        ? +(closed.reduce((a, s) => a + s.barsHeld, 0) / closed.length).toFixed(1)
        : 0,
      compoundedPct: rets.length ? +((compounded - 1) * 100).toFixed(1) : 0,
    },
  };
}

// ─── Punto d'ingresso ─────────────────────────────────────────────────────────

export function resolveWorldOptions(opts: WorldMomentumOptions): ResolvedWorldOptions {
  return {
    indexKey: opts.indexKey,
    startDate: opts.startDate,
    endDate: opts.endDate,
    benchmark: opts.benchmark ?? WORLD_BENCHMARK,
    accountSize: opts.accountSize ?? 10_000,
    maxPositions: opts.maxPositions ?? 5,
    slippageBps: opts.slippageBps ?? 5,
    metaWindow: opts.metaWindow ?? 60,
    minMetaR2: opts.minMetaR2 ?? 0.5,
    strongTopN: opts.strongTopN ?? 20,
    priceWindow: opts.priceWindow ?? 40,
    minPriceR2: opts.minPriceR2 ?? 0.5,
    entryMaxZ: opts.entryMaxZ ?? 0,
    // meta_break è l'unica delle tre che batte URTH sul periodo e in 4 fold
    // su 5 (vedi la tabella nell'intestazione).
    exitRule: opts.exitRule ?? "meta_break",
    useRegime: opts.useRegime ?? true,
    regimeSma: opts.regimeSma ?? 200,
    scanFreq: opts.scanFreq ?? 5,
    maxHoldBars: opts.maxHoldBars ?? 0,
    folds: opts.folds ?? 0,
    w30: opts.w30 ?? 0.2,
    w90: opts.w90 ?? 0.5,
    w180: opts.w180 ?? 0.3,
  };
}

/** Quanti anni di storico servono per coprire la finestra + il warm-up. */
function yearsNeeded(startDate: string): number {
  const span = (Date.now() - new Date(startDate).getTime()) / (365.25 * 86_400_000);
  // 180 barre di RS + la finestra del canale ≈ 1 anno di warm-up.
  return Math.min(15, Math.max(2, Math.ceil(span + 1.5)));
}

export async function runWorldMomentum(
  options: WorldMomentumOptions
): Promise<WorldMomentumResult> {
  const opts = resolveWorldOptions(options);
  const def = indexByKey(opts.indexKey);
  if (!def) throw new Error(`Indice sconosciuto: ${opts.indexKey}`);
  if (opts.startDate < WORLD_BENCHMARK_INCEPTION) {
    throw new Error(
      `Il benchmark ${opts.benchmark} esiste dal ${WORLD_BENCHMARK_INCEPTION}: startDate non può essere precedente`
    );
  }

  const years = yearsNeeded(opts.startDate);
  const benchCandles = await fetchCandles(opts.benchmark, years);
  if (benchCandles.length < opts.metaWindow + 180) {
    throw new Error(`Dati benchmark ${opts.benchmark} insufficienti (${benchCandles.length} barre)`);
  }
  const benchByDate = new Map(benchCandles.map((c) => [c.date, px(c)]));

  const rows = await pool(def.tickers, 8, async (ticker): Promise<TickerData | null> => {
    const candles = await fetchCandles(ticker, years);
    if (candles.length < opts.metaWindow + 180) return null;
    const closes = candles.map((c) => c.close);
    // Metatitolo su close aggiustati per entrambi: è un rapporto fra due
    // total-return, altrimenti ogni stacco di dividendo fa un gradino e la
    // regressione lo legge come cambio di trend.
    const meta = candles.map((c) => {
      const b = benchByDate.get(c.date);
      return b && b > 0 ? px(c) / b : NaN;
    });
    const dateIdx = new Map<string, number>();
    candles.forEach((c, i) => dateIdx.set(c.date, i));
    return { ticker, candles, closes, meta, dateIdx };
  });

  const allData = rows.filter((r): r is TickerData => r !== null);
  if (allData.length === 0) throw new Error("Nessun titolo con dati sufficienti");

  const full = simulate(allData, benchCandles, opts);

  // Benchmark buy & hold sulla stessa finestra.
  const inWindow = benchCandles.filter((c) => c.date >= opts.startDate && c.date <= opts.endDate);
  const base = inWindow.length ? px(inWindow[0]) : 0;
  const benchEquity = base
    ? inWindow.map((c) => ({ date: c.date, equity: +((opts.accountSize * px(c)) / base).toFixed(2) }))
    : [];

  // Walk-forward: periodi consecutivi, ognuno con capitale fresco.
  let walkForward: WalkForwardReport | undefined;
  if (opts.folds >= 2) {
    const t0 = new Date(opts.startDate).getTime();
    const t1 = new Date(opts.endDate).getTime();
    const step = (t1 - t0) / opts.folds;
    const periods: WalkForwardPeriod[] = [];
    for (let i = 0; i < opts.folds; i++) {
      const s = new Date(t0 + step * i).toISOString().slice(0, 10);
      const e = new Date(t0 + step * (i + 1)).toISOString().slice(0, 10);
      const r = simulate(allData, benchCandles, { ...opts, startDate: s, endDate: e });
      periods.push({ start: s, end: e, summary: r.summary });
    }
    walkForward = walkForwardStats(periods);
  }

  return {
    summary: full.summary,
    equity: full.equity,
    realizedCurve: full.realizedCurve,
    benchEquity,
    trades: full.trades,
    perTicker: attributeByTicker(full.trades),
    rankingHistory: full.rankingHistory,
    walkForward,
    options: opts,
    tickersTested: allData.length,
    signalsTotal: full.signalsTotal,
    signalsTaken: full.signalsTaken,
  };
}
