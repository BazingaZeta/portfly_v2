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
 *
 * ─── Riduzione del drawdown (ott 2026) ───────────────────────────────────────
 *
 * Diagnosi sulla baseline (2021-10 → 2026-10, maxDD 31,2%): due cause.
 *  1. Picchi restituiti: l'uscita sul metatitolo è lenta, e quando il canale si
 *     rompe metà del picco è andata (PLTR +343% → chiuso +200%, MU +152% →
 *     +72%). Senza ribilanciamento un vincitore arriva a pesare un terzo del
 *     portafoglio, e la sua discesa diventa il drawdown di tutti.
 *  2. Rischio di mercato: aprile 2025, bear 2022, semiconduttori tutti insieme.
 *
 * Tre griglie dichiarate in anticipo, poi la prova fuori campione:
 *
 *   meccanismo                   maxDD   rend.   Calmar   esito
 *   baseline                     31,2%   148,7%  0,64
 *   stop iniziale (migliore 8%)  26,8%   112,5%  0,61     peggiora il Calmar
 *   trailing (migliore 15%)      26,6%   116,6%  0,63     batte URTH solo 2/5
 *   uscita di regime (+isteresi) 23,2%   143,1%  0,84     un fold PF 0,39
 *   tetto peso 25% + corr < 0,7  25,5%   203,3%  0,98     NON regge fuori campione
 *   volTarget 20%                21,7%   150,3%  0,93     ADOTTATO
 *
 * Gli stop sul prezzo tagliano la coda destra di cui la strategia vive (la v3
 * aveva già misurato lo stesso). Il filtro di correlazione sembrava il migliore
 * nel campione, ma su dati mai visti rende MENO della baseline (2013-21: 517%
 * contro 567%; NDX: 166% contro 186%): fortuna di percorso, scartato.
 *
 * Il volatility targeting (Barroso & Santa-Clara 2015, "Momentum has its
 * moments": prior di letteratura indipendente da questi dati) taglia il
 * drawdown in tutti e tre i test, incluso il periodo che non avevo mai guardato:
 *
 *                       2021-26 SP500     2013-21 SP500     2021-26 NDX
 *   maxDD  baseline         31,2%             38,2%             30,8%
 *   maxDD  volTarget 20     21,7%             25,9%             23,9%
 *   Calmar baseline         0,64              0,65              0,76
 *   Calmar volTarget 20     0,93              0,86              1,04
 *
 * Plateau: volTarget 15/20/25 e volWindow 21/42/63 migliorano tutti il Calmar
 * in tutti e tre i test; minExposure non scatta mai. Costo onesto: nel lungo
 * toro 2013-21 il rendimento scende da 567% a 463% — è il prezzo del rischio
 * tolto, la strategia batte comunque URTH (+154%) di tre volte.
 *
 * ATTENZIONE — FASE DELLO SCAN. Lo scan avviene ogni 5 barre: spostare l'inizio
 * del backtest di UN giorno cambia quali giorni sono di scan e quali titoli si
 * comprano all'avvio. Sul 2021-26 il primo fold (bear 2022, ~19 trade) passa da
 * PF 1,18 a 0,22 spostando l'inizio dall'11 al 12 ottobre. Per questo la
 * validazione finale è ripetuta su tutte e 5 le fasi (mediana [min – max]):
 *
 *                     2021-26 SP500       2013-21 SP500       2021-26 NDX
 *   maxDD senza       28,7 [26,0–31,2]    38,8 [36,0–41,1]    33,0 [29,4–34,4]
 *   maxDD con         20,0 [16,4–21,7]    25,9 [24,6–27,2]    24,3 [21,3–27,0]
 *   Calmar senza      0,71                0,64                0,54
 *   Calmar con        0,93                0,86                0,99
 *   peggior PF senza  0,96 [0,15–1,06]    1,69                0,28 [0,09–0,65]
 *   peggior PF con    0,97 [0,22–1,18]    1,67                0,33 [0,11–0,71]
 *
 * La riduzione del drawdown regge in 15 casi su 15. Il peggior PF per fold
 * invece è instabile e dipende dalla fase: è una fragilità della strategia di
 * base (sul NDX non passa il gate della skill in nessuna variante), che la
 * protezione non peggiora e non risolve. Va trattata a parte — una pista è lo
 * scan giornaliero, che va validato prima di adottarlo.
 *
 * Non cambia QUALI titoli si comprano né QUANDO: stessi 160 round-trip della
 * baseline. Cambia solo quanto si investe. Le opzioni scartate restano nel
 * motore, spente, perché il risultato sia riproducibile.
 *
 * ─── Canali ancorati — A/B contro la strategia attuale (ott 2026) ────────────
 *
 * Feedback di Antonio: i canali vanno tracciati come su ProRealTime, con un
 * inizio (rottura confermata della banda opposta del canale precedente,
 * ancoraggio al minimo/massimo precedente) e una fine. Implementati in
 * lib/anchoredChannel.ts e selezionabili con `channelMode: "anchored"`.
 * Parametri del canale tarati a vista sul suo grafico di PLTR, PRIMA di
 * guardare qualunque rendimento. Regola di adozione fissata prima dei test: i
 * canali ancorati diventano il default solo se, in mediana sulle 5 fasi, hanno
 * Calmar ≥ e rendimento ≥ 90% della strategia attuale in TUTTI e tre i test.
 *
 * Mediane su 5 fasi, volTarget 20 per entrambe:
 *
 *                           2021-26 SP500     2013-21 SP500     2021-26 NDX
 *   attuale    rend / DD    139,7 / 20,0      460,0 / 25,9      158,5 / 24,3
 *   ancorati, uscita meta   193,6 / 21,9      780,9 / 25,3      209,7 / 34,2
 *   ancorati, uscita prezzo  56,2 / 26,6      609,4 / 19,6      112,6 / 29,9
 *   Calmar attuale           0,93              0,86              0,99
 *   Calmar uscita meta       1,04              1,19              0,76  ← boccia
 *
 * La regola alla lettera (uscita alla rottura del canale del PREZZO) perde in
 * 16 varianti su 16 sul set di taratura: esce dopo 15-22 sedute e taglia i
 * vincitori, come già misurato per `price_band`. L'ibrido — entrata a inizio
 * canale rialzista del prezzo, uscita alla rottura del canale ancorato del
 * METAtitolo — rende di più in tutti e tre i test e in tutte le 12 varianti di
 * plateau (160-222% contro 140%), ma sul Nasdaq il drawdown sale di 10 punti e
 * il peggior PF per fold è più basso quasi ovunque. Non passa la regola:
 * resta un'alternativa selezionabile, il default è invariato.
 */

import type { Candle } from "./types";
import { indexByKey } from "./indices";
import { nameFor, sectorFor } from "./universe";
import { fetchCandles } from "./marketData";
import { regressionChannel, type RegressionChannel } from "./regression";
import {
  anchoredChannels,
  weeklyChannels,
  DEFAULT_ANCHORED,
  CAUSE_CODES,
  type AnchoredChannelOptions,
  type AnchoredSeries,
  type ChannelSegment,
} from "./anchoredChannel";
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

/**
 * Come si costruiscono i canali:
 *  - "rolling":  finestra fissa che scorre (sempre le ultime N barre). È la
 *                strategia validata a settembre: entrata a z ≤ 0 dentro un
 *                canale ascendente, uscita sulla rottura del metatitolo.
 *  - "anchored": canali con un inizio e una fine, tracciati come li traccia
 *                Antonio (lib/anchoredChannel.ts). Si compra quando nasce un
 *                canale rialzista sul prezzo di un titolo il cui metatitolo è a
 *                sua volta in canale rialzista; si vende quando il canale del
 *                prezzo si rompe.
 */
export type ChannelMode = "rolling" | "anchored";

/**
 * Ancorati — quando si vende:
 *  - "price":        il canale giornaliero del prezzo non è più rialzista (la
 *                    regola di Antonio alla lettera)
 *  - "price_weekly": come "price", ma solo se anche il canale SETTIMANALE non
 *                    è più rialzista: la vista lunga filtra le rotture di breve
 *  - "meta":         il canale ancorato del metatitolo non è più rialzista
 *  - "meta_rolling": l'uscita della strategia precedente (rottura del canale
 *                    mobile del metatitolo), con l'entrata dei canali ancorati
 */
export type AnchoredExit = "price" | "price_weekly" | "meta" | "meta_rolling";

/** Conferma dal canale settimanale del prezzo, al momento dell'entrata. */
export type WeeklyFilter = "off" | "not_down" | "up";

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
  channelMode?: ChannelMode;
  /** Parametri dei canali ancorati (solo channelMode "anchored"). */
  anchored?: Partial<AnchoredChannelOptions>;
  /** Ancorati: conferma richiesta al canale settimanale all'entrata. */
  weeklyFilter?: WeeklyFilter;
  /** Ancorati: si esce anche quando il metatitolo esce dal canale rialzista. */
  exitOnMeta?: boolean;
  /** Ancorati: quale rottura chiude la posizione. */
  anchoredExit?: AnchoredExit;
  /** Ancorati: si entra solo entro N barre dalla nascita del canale (0 = in qualunque momento). */
  maxEntryAge?: number;
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
  // ── Gestione del rischio (0 = disattivo). Vedi `initialStop` e `trailStop`.
  /** Stop iniziale a k × ATR(14) sotto il prezzo d'ingresso. */
  stopAtr?: number;
  /** Stop iniziale a una % fissa sotto il prezzo d'ingresso. */
  stopPct?: number;
  /** Trailing: k × ATR(14) corrente sotto il massimo dall'ingresso. */
  trailAtr?: number;
  /** Trailing: % fissa sotto il massimo dall'ingresso. */
  trailPct?: number;
  /** Tetto al peso di una posizione sul capitale a mercato: l'eccesso si vende. */
  maxWeight?: number;
  /** "equal" = stesso capitale per slot; "invvol" = slot scalato su 1/volatilità. */
  sizing?: "equal" | "invvol";
  /** Con il regime negativo chiude anche le posizioni aperte, non solo le entrate. */
  regimeExit?: boolean;
  /**
   * Banda anti-whipsaw attorno alla SMA di regime (%): il regime diventa
   * negativo sotto SMA×(1−h) e torna positivo sopra SMA×(1+h). Stessa logica
   * già validata nella Rotazione a leva.
   */
  regimeHysteresisPct?: number;
  /** Non aprire un titolo con correlazione (60 barre) sopra questa soglia con uno già in portafoglio. */
  maxCorr?: number;
  /** Massimo numero di posizioni contemporanee nello stesso settore. */
  maxPerSector?: number;
  /**
   * Volatility targeting (Barroso & Santa-Clara 2015): volatilità annua
   * obiettivo della strategia, in %. Quando la volatilità realizzata la
   * supera, l'esposizione si riduce in proporzione. 0 = disattivo.
   */
  volTarget?: number;
  /** Barre di equity su cui si misura la volatilità realizzata. */
  volWindow?: number;
  /** Esposizione minima: anche nel panico non si scende sotto questa quota investita. */
  minExposure?: number;
  folds?: number;
  w30?: number;
  w90?: number;
  w180?: number;
}

export type ResolvedWorldOptions = Required<Omit<WorldMomentumOptions, "anchored">> & {
  anchored: AnchoredChannelOptions;
};

/**
 * Perché si è chiusa (in tutto o in parte) una posizione:
 *  - channel_break: la regola di uscita della strategia (default: metatitolo)
 *  - stop / trail:  lo stop sul prezzo, iniziale o trascinato dal massimo
 *  - trim:          vendita parziale per riportare il peso sotto `maxWeight`
 *  - regime:        uscita forzata col benchmark sotto la SMA di regime
 *  - time / end_of_test: time stop e chiusura d'ufficio a fine storico
 */
export type WorldExitKind =
  | "channel_break" | "stop" | "trail" | "trim" | "regime" | "time" | "end_of_test";

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
  outcome: WorldExitKind;
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
  /**
   * Ogni titolo passato dal portafoglio: chiusura dell'ultimo giorno del test e
   * del giorno prima, per valutarlo e per la variazione del giorno nel
   * riepilogo per titolo. I titoli ancora aperti sono le righe "end_of_test".
   */
  endPrices: Record<string, { close: number; prevClose: number }>;
  /** Nome di ogni titolo scambiato, per il riepilogo. */
  names: Record<string, string>;
  perTicker: TickerAttribution[];
  rankingHistory: RankingSnapshot[];
  walkForward?: WalkForwardReport;
  /**
   * L'ALTRA strategia (canali a finestra mobile ↔ canali ancorati), sugli
   * stessi dati, la stessa finestra e la stessa protezione: c'è sempre, così
   * il confronto fra strategia attuale e metodo Antonio è sempre a schermo,
   * qualunque delle due sia selezionata.
   */
  comparison?: {
    kind: "other_strategy";
    channelMode: ChannelMode;
    label: string;
    summary: BacktestSummary;
    equity: { date: string; equity: number }[];
    walkForward?: WalkForwardReport;
  };
  /**
   * La strategia selezionata SENZA volatility targeting: misura quanto rischio
   * toglie la protezione e quanto rendimento costa. Assente se volTarget = 0.
   */
  protection?: {
    summary: BacktestSummary;
    equity: { date: string; equity: number }[];
    walkForward?: WalkForwardReport;
  };
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
  /** ATR(14) di Wilder barra per barra (NaN nel warm-up). */
  atr: number[];
  dateIdx: Map<string, number>;
}

interface OpenPosition {
  ticker: string;
  entryBar: number;
  entryDate: string;
  entryPrice: number;
  shares: number;
  /** Stato dello stop sul prezzo (-Infinity = nessuno stop). */
  risk: RiskState;
}

// ─── Gestione del rischio: helper puri, condivisi da backtest e replay ───────

/**
 * Regime del benchmark barra per barra: true = si può comprare. Con isteresi
 * h > 0 lo stato cambia solo uscendo dalla banda [SMA×(1−h), SMA×(1+h)];
 * dentro la banda resta quello precedente — per questo serve il replay
 * dall'inizio della serie. Con h = 0 è il semplice "close > SMA".
 */
export function regimeMap(
  benchCandles: { date: string; close: number; adjClose?: number }[],
  opts: Pick<ResolvedWorldOptions, "regimeSma" | "regimeHysteresisPct">
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const h = opts.regimeHysteresisPct / 100;
  const closes = benchCandles.map((c) => c.adjClose ?? c.close);
  let sum = 0;
  let ok = true; // prima di avere la SMA non si blocca nulla: il warm-up non è un bear
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= opts.regimeSma) sum -= closes[i - opts.regimeSma];
    if (i >= opts.regimeSma - 1) {
      const sma = sum / opts.regimeSma;
      if (h === 0) ok = closes[i] > sma;
      else if (ok) ok = closes[i] > sma * (1 - h);
      else ok = closes[i] > sma * (1 + h);
    }
    out.set(benchCandles[i].date, ok);
  }
  return out;
}

/**
 * Esposizione obiettivo col volatility targeting: volTarget / volatilità
 * realizzata della curva di equity, limitata a [minExposure, 1]. Non si va
 * mai a leva (tetto 1): lo scopo è togliere rischio, non aggiungerlo.
 * Senza abbastanza storia restituisce 1 (nessuna riduzione).
 */
export function targetExposure(
  equity: { equity: number }[],
  opts: Pick<ResolvedWorldOptions, "volTarget" | "volWindow" | "minExposure">
): number {
  if (!(opts.volTarget > 0)) return 1;
  const annual = realizedVol(equity, opts.volWindow);
  if (annual == null || !(annual > 0)) return 1;
  return Math.min(1, Math.max(opts.minExposure, opts.volTarget / annual));
}

/** Volatilità annua (%) dei rendimenti giornalieri delle ultime `window` barre; null se poche. */
export function realizedVol(equity: { equity: number }[], window: number): number | null {
  if (equity.length < window + 1) return null;
  const w = equity.slice(-(window + 1));
  const rets: number[] = [];
  for (let i = 1; i < w.length; i++) {
    if (w[i - 1].equity > 0) rets.push(Math.log(w[i].equity / w[i - 1].equity));
  }
  if (rets.length < 10) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * 252) * 100;
}

/**
 * Correlazione dei rendimenti giornalieri di due titoli sulle `window` barre
 * che terminano alla data della barra `endIdx` di `a`. Le date sono allineate
 * per data, non per indice: i due titoli possono avere buchi diversi.
 */
export function returnCorrelation(
  a: { candles: { date: string; close: number }[] },
  b: { candles: { date: string; close: number }[]; dateIdx: Map<string, number> },
  endIdx: number,
  window = 60
): number {
  const ra: number[] = [];
  const rb: number[] = [];
  for (let k = endIdx - window + 1; k <= endIdx; k++) {
    if (k < 1) continue;
    const j = b.dateIdx.get(a.candles[k].date);
    const jp = b.dateIdx.get(a.candles[k - 1].date);
    if (j == null || jp == null) continue;
    ra.push(Math.log(a.candles[k].close / a.candles[k - 1].close));
    rb.push(Math.log(b.candles[j].close / b.candles[jp].close));
  }
  const n = ra.length;
  if (n < 20) return 0; // troppo pochi punti per dire qualcosa: non blocca
  const ma = ra.reduce((x, y) => x + y, 0) / n;
  const mb = rb.reduce((x, y) => x + y, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/**
 * Stato dello stop di una posizione aperta. `initial` resta fisso, `stop` sale
 * col trailing: se a farti uscire è un livello sopra l'iniziale, è un trailing.
 */
export interface RiskState {
  initial: number;
  stop: number;
  highSince: number;
}

/** ATR(14) di Wilder per ogni barra. Solo dati passati: nessuno sguardo avanti. */
export function atrSeries(candles: { high: number; low: number; close: number }[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  let value = NaN;
  let sum = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    if (i <= period) {
      sum += tr;
      if (i === period) value = sum / period;
    } else {
      value = (value * (period - 1) + tr) / period;
    }
    out[i] = value;
  }
  return out;
}

/**
 * Stop all'ingresso. Con più regole attive vince la più stretta (la più alta).
 * L'ATR è quello della barra del SEGNALE — noto al close, prima di eseguire.
 */
export function initialStop(entryPrice: number, atrAtSignal: number, opts: ResolvedWorldOptions): RiskState {
  let stop = -Infinity;
  if (opts.stopAtr > 0 && atrAtSignal > 0) stop = Math.max(stop, entryPrice - opts.stopAtr * atrAtSignal);
  if (opts.stopPct > 0) stop = Math.max(stop, entryPrice * (1 - opts.stopPct / 100));
  return { initial: stop, stop, highSince: entryPrice };
}

/**
 * Lo stop è stato toccato in questa barra? Gap sotto lo stop → si esce
 * all'apertura (peggio dello stop: succede davvero); altrimenti, se il minimo
 * lo buca, si esce allo stop. Lo stop qui è sempre quello fissato PRIMA di
 * questa barra.
 */
export function stopHit(
  bar: { open: number; low: number },
  risk: RiskState
): { price: number; kind: "stop" | "trail" } | null {
  if (!(risk.stop > 0)) return null;
  const kind = risk.stop > risk.initial ? "trail" : "stop";
  if (bar.open <= risk.stop) return { price: bar.open, kind };
  if (bar.low <= risk.stop) return { price: risk.stop, kind };
  return null;
}

/**
 * Trascina lo stop dopo aver controllato le uscite della barra, con massimo e
 * ATR di questa barra: vale dalla barra successiva in poi. Lo stop non scende
 * mai. L'ATR è quello corrente, non quello d'ingresso: un titolo che quadruplica
 * ha oscillazioni in dollari quadruple, e un trailing tarato sul prezzo
 * d'ingresso diventerebbe un filo che si spezza al primo respiro.
 */
export function trailStop(
  risk: RiskState,
  bar: { high: number },
  atrNow: number,
  opts: ResolvedWorldOptions
): void {
  risk.highSince = Math.max(risk.highSince, bar.high);
  if (opts.trailAtr > 0 && atrNow > 0) risk.stop = Math.max(risk.stop, risk.highSince - opts.trailAtr * atrNow);
  if (opts.trailPct > 0) risk.stop = Math.max(risk.stop, risk.highSince * (1 - opts.trailPct / 100));
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

// ─── Canali ancorati: stato e regole, condivisi da backtest, analisi e replay ──

/** I tre canali ancorati di un titolo: prezzo, metatitolo e prezzo settimanale. */
export interface AnchoredSet {
  price: AnchoredSeries;
  meta: AnchoredSeries;
  /** Direzione del canale settimanale all'ultima settimana chiusa, per barra giornaliera. */
  weeklyDir: Int8Array;
}

export function buildAnchoredSet(
  dates: string[],
  closes: number[],
  meta: number[],
  o: AnchoredChannelOptions
): AnchoredSet {
  return {
    price: anchoredChannels(closes, o),
    meta: anchoredChannels(meta, o),
    weeklyDir: weeklyChannels(dates, closes, o).dailyDir,
  };
}

/** Il metatitolo è in canale rialzista: il titolo sta battendo il benchmark. */
export function anchoredStrong(set: AnchoredSet, i: number): boolean {
  return set.meta.dir[i] > 0;
}

/**
 * Si può comprare alla barra i? Null = sì, altrimenti il motivo per cui no.
 * Il metatitolo si controlla a parte (stadio 1).
 */
export function anchoredEntryBlock(set: AnchoredSet, i: number, o: ResolvedWorldOptions): string | null {
  const p = set.price;
  if (p.dir[i] <= 0) {
    return p.dir[i] < 0 ? "il prezzo è in un canale ribassista" : "il prezzo è in un canale laterale";
  }
  const age = i - p.birth[i];
  if (o.maxEntryAge > 0 && age > o.maxEntryAge) {
    return `il canale rialzista è nato ${age} sedute fa: troppo tardi per entrare`;
  }
  if (o.weeklyFilter === "not_down" && set.weeklyDir[i] < 0) return "il canale settimanale è ribassista";
  if (o.weeklyFilter === "up" && set.weeklyDir[i] <= 0) return "il canale settimanale non è rialzista";
  return null;
}

/**
 * Si deve vendere alla barra i? Null = no, altrimenti il motivo. Con
 * `anchoredExit` "meta_rolling" la decisione è del canale mobile e la prende il
 * chiamante: qui risponde sempre null.
 */
export function anchoredExitReason(set: AnchoredSet, i: number, o: ResolvedWorldOptions): string | null {
  if (o.anchoredExit === "meta_rolling") return null;
  if (o.anchoredExit === "meta") {
    return set.meta.dir[i] <= 0 ? "il metatitolo è uscito dal canale rialzista" : null;
  }
  const p = set.price;
  if (o.anchoredExit === "price_weekly" && set.weeklyDir[i] > 0) {
    // Il settimanale è ancora rialzista: la rottura giornaliera non basta.
    return o.exitOnMeta && set.meta.dir[i] <= 0 ? "il metatitolo è uscito dal canale rialzista" : null;
  }
  if (p.dir[i] <= 0) {
    const cause = CAUSE_CODES[p.cause[i]];
    if (cause === "break_down") return "rottura confermata della banda inferiore del canale";
    if (cause === "widen") return "il canale si è allargato: non segue più i prezzi";
    return p.dir[i] < 0 ? "il canale del prezzo è diventato ribassista" : "il canale ha perso pendenza: laterale";
  }
  if (o.exitOnMeta && set.meta.dir[i] <= 0) return "il metatitolo è uscito dal canale rialzista";
  return null;
}

/** Posizione dentro il canale ancorato in unità di deviazione standard (come lo z del canale mobile). */
function anchoredZ(s: AnchoredSeries, i: number, value: number, k: number): number {
  const half = s.upper[i] - s.mid[i];
  if (!(half > 0)) return 0;
  return +(((value - s.mid[i]) / half) * k).toFixed(2);
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
  allRows: WorldTrade[],
  finalEquity: number,
  maxDd: number,
  opts: ResolvedWorldOptions
): BacktestSummary {
  // Il profit factor è in dollari: conta ogni riga, vendite parziali incluse.
  const grossProfit = allRows.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(allRows.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  // Conteggi, win rate e medie invece si fanno sui soli round-trip: una
  // riduzione d'esposizione non è un trade indipendente, e contarla gonfierebbe
  // il numero di operazioni e falserebbe la percentuale di vincenti.
  const trades = allRows.filter((t) => t.outcome !== "trim");
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
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
    // BacktestSummary ha tre secchi condivisi con gli altri motori: qui "target"
    // sono le prese di profitto parziali, "stop" ogni uscita di rischio o di
    // segnale, "time" time stop e chiusura a fine storico.
    byOutcome: {
      target: allRows.filter((t) => t.outcome === "trim").length,
      stop: trades.filter((t) => ["channel_break", "stop", "trail", "regime"].includes(t.outcome)).length,
      time: trades.filter((t) => t.outcome === "time" || t.outcome === "end_of_test").length,
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
  for (const [ticker, all] of byTicker) {
    // P&L in dollari da tutte le righe; conteggi e medie dai soli round-trip.
    const ts = all.filter((t) => t.outcome !== "trim");
    const n = ts.length || 1;
    const wins = ts.filter((t) => t.pnl > 0).length;
    rows.push({
      ticker,
      trades: ts.length,
      wins,
      winRate: ts.length ? +((wins / ts.length) * 100).toFixed(1) : 0,
      realizedPnl: +all.reduce((s, t) => s + t.pnl, 0).toFixed(2),
      avgReturnPct: +(ts.reduce((s, t) => s + t.returnPct, 0) / n).toFixed(2),
      bestPct: ts.length ? +Math.max(...ts.map((t) => t.returnPct)).toFixed(2) : 0,
      worstPct: ts.length ? +Math.min(...ts.map((t) => t.returnPct)).toFixed(2) : 0,
      avgBarsHeld: +(ts.reduce((s, t) => s + t.barsHeld, 0) / n).toFixed(1),
    });
  }
  return rows.sort((a, b) => b.realizedPnl - a.realizedPnl);
}

// ─── Simulazione ──────────────────────────────────────────────────────────────

interface SimOutput {
  /** Ogni titolo scambiato nel test: chiusura dell'ultimo giorno e del giorno prima. */
  endPrices: Record<string, { close: number; prevClose: number }>;
  summary: BacktestSummary;
  equity: { date: string; equity: number }[];
  realizedCurve: { date: string; realized: number }[];
  trades: WorldTrade[];
  rankingHistory: RankingSnapshot[];
  signalsTotal: number;
  signalsTaken: number;
}

/**
 * Cache dei canali di regressione per (titolo, barra, finestra). Un canale
 * dipende solo dalla serie e dalla finestra, non da sizing né da stop: fra la
 * strategia con e senza protezione, e fra i fold del walk-forward, i canali
 * sono identici. Senza cache si rifittano decine di migliaia di volte.
 */
type ChannelCache = Map<string, RegressionChannel | null>;

/** Stessa idea per i canali ancorati: dipendono da serie e parametri del canale, non dal portafoglio. */
type AnchoredCache = Map<string, AnchoredSet>;

function anchoredSetFor(td: TickerData, o: ResolvedWorldOptions, cache: AnchoredCache): AnchoredSet {
  const key = `${td.ticker}|${JSON.stringify(o.anchored)}`;
  let set = cache.get(key);
  if (!set) {
    set = buildAnchoredSet(td.candles.map((c) => c.date), td.closes, td.meta, o.anchored);
    cache.set(key, set);
  }
  return set;
}

function simulate(
  allData: TickerData[],
  benchCandles: Candle[],
  opts: ResolvedWorldOptions,
  cache: ChannelCache = new Map(),
  anchCache: AnchoredCache = new Map()
): SimOutput {
  const anchored = opts.channelMode === "anchored";
  const slip = opts.slippageBps / 10_000;
  const dates = benchCandles
    .filter((c) => c.date >= opts.startDate && c.date <= opts.endDate)
    .map((c) => c.date);

  if (dates.length < 2) {
    return {
      endPrices: {},
      summary: emptySummary(opts.accountSize),
      equity: [], realizedCurve: [], trades: [], rankingHistory: [],
      signalsTotal: 0, signalsTaken: 0,
    };
  }

  const dataByTicker = new Map(allData.map((d) => [d.ticker, d]));

  // Mappa di regime: benchmark sopra la propria SMA, calcolata su tutta la
  // serie (serve il warm-up) ma letta solo alla data corrente — nessun futuro.
  const regimeOk = opts.useRegime ? regimeMap(benchCandles, opts) : new Map<string, boolean>();

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

  const cached = (k: string, compute: () => RegressionChannel | null) => {
    if (cache.has(k)) return cache.get(k)!;
    const v = compute();
    cache.set(k, v);
    return v;
  };

  /** Il canale prezzo di un titolo alla barra `barIdx`, o null se non fittabile. */
  const priceChannelAt = (td: TickerData, barIdx: number) =>
    cached(`p|${td.ticker}|${barIdx}|${opts.priceWindow}`, () => {
      const w = windowAt(td.closes, barIdx, opts.priceWindow);
      return w ? regressionChannel(w, 2) : null;
    });

  /** Il canale del metatitolo di un titolo alla barra `barIdx`. */
  const metaChannelAt = (td: TickerData, barIdx: number) =>
    cached(`m|${td.ticker}|${barIdx}|${opts.metaWindow}`, () => {
      const w = windowAt(td.meta, barIdx, opts.metaWindow);
      return w ? regressionChannel(w, 2) : null;
    });

  for (let di = 0; di < dates.length; di++) {
    const date = dates[di];
    const isScan = di % opts.scanFreq === 0;

    /** Chiude (tutta o in parte) una posizione e la registra. */
    const close = (
      ticker: string,
      pos: OpenPosition,
      rawPrice: number,
      shares: number,
      outcome: WorldExitKind
    ) => {
      const exitPrice = rawPrice * (1 - slip);
      const pnl = shares * (exitPrice - pos.entryPrice);
      realized += pnl;
      trades.push({
        ticker,
        entryDate: pos.entryDate,
        entryPrice: +pos.entryPrice.toFixed(4),
        exitDate: date,
        exitPrice: +exitPrice.toFixed(4),
        shares: +shares.toFixed(4),
        pnl: +pnl.toFixed(2),
        returnPct: +(((exitPrice - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2),
        barsHeld: di - pos.entryBar,
        outcome,
      });
    };

    // ── 1. Uscite, in ordine di priorità: stop sul prezzo (intrabarra, scatta
    // per primo perché succede durante la seduta), poi la regola della
    // strategia al close, poi time stop e regime. Lo stop si trascina solo
    // DOPO, con i dati di oggi, e vale da domani.
    const regimeBad = opts.useRegime && regimeOk.get(date) === false;
    for (const [ticker, pos] of [...openPositions]) {
      if (pos.entryBar > di) continue; // entra domani, non è ancora sul libro
      const td = dataByTicker.get(ticker);
      if (!td) continue;
      const barIdx = td.dateIdx.get(date);
      if (barIdx == null) continue;

      const bar = td.candles[barIdx];
      const barsHeld = di - pos.entryBar;

      const hit = stopHit(bar, pos.risk);
      if (hit) {
        close(ticker, pos, hit.price, pos.shares, hit.kind);
        openPositions.delete(ticker);
        continue;
      }

      let outcome: WorldExitKind | null = null;
      if (anchored && opts.anchoredExit !== "meta_rolling") {
        if (anchoredExitReason(anchoredSetFor(td, opts, anchCache), barIdx, opts)) outcome = "channel_break";
      } else switch (anchored ? "meta_break" : opts.exitRule) {
        case "price_band": {
          // Il canale si rifitta ogni giorno: la banda inferiore si muove con
          // il trend. Uscita sul close, non intrabarra — la banda è un livello
          // statistico, non un ordine di stop appoggiato al book.
          const ch = priceChannelAt(td, barIdx);
          if (ch && bar.close < ch.lowerNow) outcome = "channel_break";
          break;
        }
        case "channel_flat": {
          const ch = priceChannelAt(td, barIdx);
          if (ch && (ch.trend !== "asc" || ch.r2 < opts.minPriceR2)) outcome = "channel_break";
          break;
        }
        case "meta_break": {
          const ch = metaChannelAt(td, barIdx);
          if (ch && (ch.trend !== "asc" || ch.r2 < opts.minMetaR2)) outcome = "channel_break";
          break;
        }
      }
      if (!outcome && opts.maxHoldBars > 0 && barsHeld >= opts.maxHoldBars) outcome = "time";
      if (!outcome && opts.regimeExit && regimeBad) outcome = "regime";

      if (outcome) {
        close(ticker, pos, bar.close, pos.shares, outcome);
        openPositions.delete(ticker);
        continue;
      }

      trailStop(pos.risk, bar, td.atr[barIdx], opts);
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

    // ── 2b. Tetto al peso. Un vincitore che quadruplica arriva a pesare un
    // terzo del portafoglio, e il suo ritracciamento diventa il drawdown di
    // tutti. Si vende solo l'eccedenza: la posizione resta aperta e continua a
    // seguire la sua regola di uscita.
    if (opts.maxWeight > 0 && mtm > 0) {
      for (const [ticker, pos] of openPositions) {
        if (pos.entryBar > di) continue;
        const td = dataByTicker.get(ticker);
        const barIdx = td?.dateIdx.get(date);
        if (!td || barIdx == null) continue;
        const px0 = td.candles[barIdx].close;
        const excess = pos.shares * px0 - opts.maxWeight * mtm;
        if (excess <= 0) continue;
        const sell = excess / px0;
        close(ticker, pos, px0, sell, "trim");
        pos.shares = +(pos.shares - sell).toFixed(4);
      }
    }

    // ── 2c. Volatility targeting. Se la volatilità realizzata della strategia
    // supera l'obiettivo, si riduce in proporzione TUTTO il portafoglio (non i
    // singoli titoli: è il rischio aggregato che si sta governando). Non si
    // ricompra quando la volatilità scende: l'esposizione torna su con le
    // nuove entrate, che evita di girare il portafoglio a ogni oscillazione.
    const exposure = targetExposure(equityCurve, opts);
    if (opts.volTarget > 0 && mtm > 0) {
      let gross = 0;
      const marks: [string, OpenPosition, number][] = [];
      for (const [ticker, pos] of openPositions) {
        if (pos.entryBar > di) continue;
        const td = dataByTicker.get(ticker);
        const barIdx = td?.dateIdx.get(date);
        if (!td || barIdx == null) continue;
        const pxNow = td.candles[barIdx].close;
        gross += pos.shares * pxNow;
        marks.push([ticker, pos, pxNow]);
      }
      const grossPct = gross / mtm;
      // Tolleranza di 5 punti: niente vendite microscopiche a ogni scan.
      if (grossPct > exposure + 0.05) {
        const keep = exposure / grossPct;
        for (const [ticker, pos, pxNow] of marks) {
          const sell = pos.shares * (1 - keep);
          if (sell <= 0) continue;
          close(ticker, pos, pxNow, sell, "trim");
          pos.shares = +(pos.shares - sell).toFixed(4);
        }
      }
    }

    // ── 3. Stadio 1 — chi è più forte del benchmark, oggi.
    const strong: RankingSnapshot["strong"] = [];
    for (const td of allData) {
      const barIdx = td.dateIdx.get(date);
      if (barIdx == null) continue;
      if (anchored) {
        const set = anchoredSetFor(td, opts, anchCache);
        if (!anchoredStrong(set, barIdx)) continue;
        const rs = rsComposite(td.meta, barIdx, opts.w30, opts.w90, opts.w180);
        if (!isFinite(rs)) continue;
        strong.push({
          ticker: td.ticker,
          rs: +rs.toFixed(2),
          metaR2: 0,
          metaZ: anchoredZ(set.meta, barIdx, td.meta[barIdx], opts.anchored.bandK),
        });
        continue;
      }
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

      if (anchored) {
        const set = anchoredSetFor(td, opts, anchCache);
        if (set.price.dir[barIdx] <= 0) continue;
        signalsTotal++;
        if (anchoredEntryBlock(set, barIdx, opts)) continue;
        entries.push({ ticker: s.ticker, rs: s.rs });
        continue;
      }

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

    // Volatilità di riferimento per il sizing "invvol": la mediana dell'ATR%
    // dell'universo oggi. Nessuna costante tarata a mano: il titolo tipico
    // riceve lo slot pieno, uno volatile il doppio riceve metà.
    let medianAtrPct = NaN;
    if (opts.sizing === "invvol" && entries.length) {
      const v: number[] = [];
      for (const td of allData) {
        const i = td.dateIdx.get(date);
        if (i == null) continue;
        const a = td.atr[i] / td.closes[i];
        if (a > 0 && isFinite(a)) v.push(a);
      }
      v.sort((a, b) => a - b);
      if (v.length) medianAtrPct = v[v.length >> 1];
    }

    let opened = 0;
    for (const e of entries) {
      if (opened >= slots) break;
      const nextDate = dates[di + 1];
      if (!nextDate) break;
      const td = dataByTicker.get(e.ticker)!;

      // Diversificazione: niente secondo/terzo titolo dello stesso settore, né
      // un titolo che si muove come uno già in portafoglio. Cinque semiconduttori
      // non sono cinque posizioni, sono una posizione con la leva.
      if (opts.maxPerSector > 0) {
        const sec = sectorFor(e.ticker);
        const same = [...openPositions.keys()].filter((t) => sectorFor(t) === sec).length;
        if (same >= opts.maxPerSector) continue;
      }
      if (opts.maxCorr > 0) {
        const sig = td.dateIdx.get(date);
        if (sig == null) continue;
        const tooClose = [...openPositions.keys()].some((t) => {
          const other = dataByTicker.get(t);
          return other ? returnCorrelation(td, other, sig) > opts.maxCorr : false;
        });
        if (tooClose) continue;
      }
      const nextIdx = td.dateIdx.get(nextDate);
      if (nextIdx == null) continue;

      // Segnale al close di oggi, esecuzione all'apertura di domani: nessuno
      // sguardo al futuro.
      const entryPrice = td.candles[nextIdx].open * (1 + slip);
      if (!(entryPrice > 0)) continue;

      const committed = [...openPositions.values()].reduce((s, p) => s + p.shares * p.entryPrice, 0);
      const cash = realized - committed;
      if (cash <= 0) break;

      const sigIdx = td.dateIdx.get(date)!;
      const atrSig = td.atr[sigIdx];
      let slot = (realized / opts.maxPositions) * exposure;
      if (opts.sizing === "invvol" && medianAtrPct > 0) {
        const myAtrPct = atrSig / td.closes[sigIdx];
        if (myAtrPct > 0) slot *= Math.min(1.5, Math.max(0.5, medianAtrPct / myAtrPct));
      }
      let shares = slot / entryPrice;
      if (shares * entryPrice > cash) shares = cash / entryPrice;
      if (!(shares > 0)) continue;

      openPositions.set(e.ticker, {
        ticker: e.ticker,
        entryBar: di + 1,
        entryDate: nextDate,
        entryPrice,
        shares: +shares.toFixed(4),
        risk: initialStop(entryPrice, atrSig, opts),
      });
      signalsTaken++;
      opened++;
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

  // Prezzo di fine test di ogni titolo passato dal portafoglio, aperto o
  // chiuso: serve al riepilogo per titolo (valore, variazione del giorno).
  const endPrices: SimOutput["endPrices"] = {};
  for (const t of new Set(trades.map((x) => x.ticker))) {
    const td = dataByTicker.get(t);
    if (!td) continue;
    let i = td.dateIdx.get(lastDate);
    if (i == null) {
      // Titolo senza barra nell'ultimo giorno (sospeso, delistato): l'ultima disponibile prima.
      i = td.candles.length - 1;
      while (i > 0 && td.candles[i].date > lastDate) i--;
    }
    endPrices[t] = {
      close: +td.candles[i].close.toFixed(4),
      prevClose: +td.candles[Math.max(0, i - 1)].close.toFixed(4),
    };
  }

  return {
    endPrices,
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
  /** Canali ancorati attivi oggi (solo con channelMode "anchored"). */
  anchoredNow?: { price: AnchoredNow; meta: AnchoredNow };
  /** Data dell'ultima barra e chiusura precedente: servono a calcolare la variazione del giorno col prezzo live. */
  lastDate: string;
  prevClose: number;
  /** Variazione del prezzo a 1 e 3 mesi (21 e 63 sedute), in %. */
  chg1m: number | null;
  chg3m: number | null;
}

export interface WorldAnalysis {
  indexKey: string;
  indexLabel: string;
  benchmark: string;
  analyzedAt: string;
  /** Regime del benchmark: quando è false, la strategia non apre nuove posizioni. */
  regimeOk: boolean;
  regimeNote: string;
  /** Quota di capitale da investire oggi secondo il volatility targeting. */
  exposure: { pct: number; realizedVol: number | null; note: string };
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
  const simData: TickerData[] = [];

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
    const dateIdx = new Map<string, number>();
    candles.forEach((c, i) => dateIdx.set(c.date, i));
    simData.push({ ticker, candles, closes, meta, atr: atrSeries(candles), dateIdx });

    const metaWin = windowAt(meta, last, opts.metaWindow);
    const metaChannel = metaWin ? regressionChannel(metaWin, 2) : null;
    if (!metaChannel) return null;

    const priceWin = windowAt(closes, last, opts.priceWindow);
    const priceChannel = priceWin ? regressionChannel(priceWin, 2) : null;
    const rs = rsComposite(meta, last, opts.w30, opts.w90, opts.w180);

    // Canali ancorati: stessa funzione del backtest, sugli stessi 2 anni. Lo
    // stato dipende dal percorso, ma converge alla prima rottura confermata
    // (l'ancora nuova si cerca solo nelle ultime `pivotLookback` barre), quindi
    // dopo pochi mesi coincide con quello calcolato su uno storico più lungo.
    let anch: { set: AnchoredSet; now: { price: AnchoredNow; meta: AnchoredNow } } | null = null;
    if (opts.channelMode === "anchored") {
      const dates = candles.map((c) => c.date);
      const set = buildAnchoredSet(dates, closes, meta, opts.anchored);
      anch = { set, now: { price: anchoredNow(set.price, dates, last), meta: anchoredNow(set.meta, dates, last) } };
    }

    const chg = (bars: number) =>
      last - bars >= 0 && closes[last - bars] > 0 ? +(((closes[last] / closes[last - bars]) - 1) * 100).toFixed(1) : null;

    return {
      ticker,
      anch,
      last,
      lastDate: candles[last].date,
      prevClose: last > 0 ? closes[last - 1] : closes[last],
      chg1m: chg(21),
      chg3m: chg(63),
      price: closes[last],
      rs: isFinite(rs) ? rs : -Infinity,
      metaChannel,
      priceChannel,
      priceSpark: (priceWin ?? closes.slice(-opts.priceWindow)).map((v) => +v.toFixed(2)),
      metaSpark: (metaWin ?? []).map((v) => +v.toFixed(6)),
    };
  }).then((r) => r.filter((x): x is NonNullable<typeof x> => x !== null));

  // ── Esposizione consigliata oggi. Il volatility targeting non cambia QUALI
  // titoli comprare, ma QUANTO: serve la volatilità realizzata della strategia,
  // cioè la sua curva di equity. La si ricostruisce simulando l'ultimo anno
  // con le stesse identiche regole del backtest, sui dati appena scaricati.
  const exposure = (() => {
    if (!(opts.volTarget > 0) || simData.length === 0) {
      return { pct: 100, realizedVol: null as number | null, note: "Volatility targeting disattivo: esposizione piena." };
    }
    const lastDate = benchCandles[benchCandles.length - 1].date;
    const from = benchCandles[Math.max(0, benchCandles.length - 252)].date;
    const sim = simulate(simData, benchCandles, { ...opts, startDate: from, endDate: lastDate });
    const e = targetExposure(sim.equity, opts);
    const vol = realizedVol(sim.equity, opts.volWindow);
    const pct = Math.round(e * 100);
    const note =
      vol == null
        ? "Storico insufficiente per misurare la volatilità: esposizione piena."
        : pct >= 100
        ? `Volatilità della strategia ${vol.toFixed(1)}% annua, sotto l'obiettivo del ${opts.volTarget}%: esposizione piena.`
        : `Volatilità della strategia ${vol.toFixed(1)}% annua, sopra l'obiettivo del ${opts.volTarget}%: investi il ${pct}% di quanto faresti normalmente.`;
    return { pct, realizedVol: vol, note };
  })();

  // ── Stadio 1: chi batte il benchmark.
  const isStrongRow = (r: (typeof rows)[number]) =>
    r.anch ? anchoredStrong(r.anch.set, r.last) : r.metaChannel.trend === "asc" && r.metaChannel.r2 >= opts.minMetaR2;
  const strong = rows
    .filter((r) => isStrongRow(r) && isFinite(r.rs))
    .sort((a, b) => b.rs - a.rs)
    .slice(0, opts.strongTopN);
  const strongSet = new Map(strong.map((r, i) => [r.ticker, i + 1]));

  const leaders: WorldLeader[] = rows
    .map((r): WorldLeader => {
      const rank = strongSet.get(r.ticker) ?? 0;
      const pc = r.priceChannel;

      let signal: WorldLeader["signal"] = "DEBOLE";
      let reason: string;

      if (r.anch) {
        const block = anchoredEntryBlock(r.anch.set, r.last, opts);
        if (!rank) {
          reason = !anchoredStrong(r.anch.set, r.last)
            ? "Il metatitolo non è in un canale rialzista: non batte il benchmark."
            : `Fuori dai primi ${opts.strongTopN} per forza relativa.`;
        } else if (block) {
          signal = "ATTENDI";
          reason = `Forte sul benchmark (#${rank}), ma ${block}.`;
        } else {
          signal = "COMPRA";
          reason = `Forte sul benchmark (#${rank}) e prezzo in un canale rialzista confermato il ${r.anch.now.price.confirmedAt}.`;
        }
      } else if (!rank) {
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
        anchoredNow: r.anch?.now,
        lastDate: r.lastDate,
        prevClose: +r.prevClose.toFixed(2),
        chg1m: r.chg1m,
        chg3m: r.chg3m,
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
    exposure,
    leaders,
    options: opts,
  };
}

// ─── Canali ancorati da disegnare ────────────────────────────────────────────

/** Un canale ancorato pronto per il grafico: due estremi e una banda costante. */
export interface DrawnChannel {
  from: string;
  to: string;
  /** Seduta in cui la nascita del canale è stata confermata. */
  confirmedAt: string;
  dir: "up" | "down" | "flat";
  cause: "start" | "break_up" | "break_down" | "widen";
  endReason: "break_up" | "break_down" | "widen" | "open";
  /** Retta: mid(i) = startMid + slope × (barre da `from`). */
  startMid: number;
  slope: number;
  /** Semi-ampiezza della banda (k × σ). */
  band: number;
  k: number;
  slopePct: number;
  r2: number;
}

export function drawnChannels(segments: ChannelSegment[], dates: string[]): DrawnChannel[] {
  return segments.map((g) => ({
    from: dates[g.start],
    to: dates[g.end],
    confirmedAt: dates[g.confirmedAt],
    dir: g.dir,
    cause: g.cause,
    endReason: g.endReason,
    startMid: g.intercept,
    slope: g.slope,
    band: g.k * g.stdev,
    k: +g.k.toFixed(2),
    slopePct: g.slopePct,
    r2: g.r2,
  }));
}

/** Stato del canale attivo oggi, in parole e date. */
export interface AnchoredNow {
  dir: "up" | "down" | "flat";
  /** Da quando c'è il canale attivo (ancora) e da quando lo si sapeva (conferma). */
  from: string;
  confirmedAt: string;
  cause: "start" | "break_up" | "break_down" | "widen";
  /** Sedute dalla conferma del canale a oggi. */
  age: number;
  /** Bande del canale proiettate su oggi (null se il canale è troppo giovane). */
  lower: number | null;
  upper: number | null;
}

function anchoredNow(s: AnchoredSeries, dates: string[], i: number): AnchoredNow {
  const band = (v: number) => (isFinite(v) ? +v.toFixed(6) : null);
  return {
    dir: s.dir[i] > 0 ? "up" : s.dir[i] < 0 ? "down" : "flat",
    from: dates[Math.max(0, s.anchor[i])],
    confirmedAt: dates[Math.max(0, s.birth[i])],
    cause: CAUSE_CODES[s.cause[i]],
    age: Math.max(0, i - s.birth[i]),
    lower: band(s.lower[i]),
    upper: band(s.upper[i]),
  };
}

/** I canali ancorati di un titolo: prezzo e metatitolo giornalieri, prezzo settimanale. */
export interface AnchoredView {
  price: DrawnChannel[];
  meta: DrawnChannel[];
  weekly: { series: { date: string; close: number }[]; channels: DrawnChannel[] };
  now: { price: AnchoredNow; meta: AnchoredNow; weekly: AnchoredNow };
  options: AnchoredChannelOptions;
}

export function anchoredView(dates: string[], closes: number[], meta: number[], o: AnchoredChannelOptions): AnchoredView {
  const price = anchoredChannels(closes, o);
  const metaCh = anchoredChannels(meta, o);
  const weekly = weeklyChannels(dates, closes, o);
  const last = dates.length - 1;
  return {
    price: drawnChannels(price.segments, dates),
    meta: drawnChannels(metaCh.segments, dates),
    weekly: {
      series: weekly.dates.map((d, i) => ({ date: d, close: +weekly.closes[i].toFixed(2) })),
      channels: drawnChannels(weekly.channels.segments, weekly.dates),
    },
    now: {
      price: anchoredNow(price, dates, last),
      meta: anchoredNow(metaCh, dates, last),
      weekly: anchoredNow(weekly.channels, weekly.dates, weekly.dates.length - 1),
    },
    options: o,
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
  /** Tutto lo storico allineato (prezzo e metatitolo): l'asse condiviso dei grafici. */
  context: { date: string; close: number; meta: number }[];
  /** I canali ancorati (come li traccia Antonio), sempre calcolati: servono ai grafici. */
  anchored: AnchoredView;
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
    /** Anni di storico: lo stesso dello storico segnali, così i grafici condividono l'asse. */
    years?: number;
  }
): Promise<WorldTickerDetail> {
  const years = Math.min(10, Math.max(2, options.years ?? 5));
  const today = new Date().toISOString().slice(0, 10);
  const opts = resolveWorldOptions({
    startDate: options.startDate ?? today,
    endDate: options.endDate ?? today,
    ...options,
  } as WorldMomentumOptions);

  const [benchCandles, candles] = await Promise.all([
    fetchCandles(opts.benchmark, years),
    fetchCandles(ticker, years),
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
  const anchored = anchoredView(dates, closes, meta, opts.anchored);

  let signal: WorldTickerDetail["signal"] = "DEBOLE";
  let reason: string;
  if (opts.channelMode === "anchored") {
    const set = buildAnchoredSet(dates, closes, meta, opts.anchored);
    const block = anchoredEntryBlock(set, last, opts);
    const n = anchored.now;
    if (!anchoredStrong(set, last)) {
      reason = "Il metatitolo non è in un canale rialzista: il titolo non sta battendo il benchmark.";
    } else if (block) {
      signal = "ATTENDI";
      reason = `Batte il benchmark (canale del metatitolo rialzista dal ${n.meta.from}), ma ${block}.`;
    } else if (!regimeOk) {
      signal = "ATTENDI";
      reason = `Setup valido ma il regime è negativo: ${opts.benchmark} sotto la SMA${opts.regimeSma}.`;
    } else {
      signal = "COMPRA";
      reason = `Metatitolo in canale rialzista dal ${n.meta.from} e prezzo in un canale rialzista confermato il ${n.price.confirmedAt}.`;
    }
  } else if (!isStrong) {
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

  const context = aligned.map((c, i) => ({
    date: c.date,
    close: +c.close.toFixed(2),
    meta: +meta[i].toFixed(6),
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
    anchored,
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
  /** Solo per la posizione aperta: ultima chiusura e P&L non realizzato a quel prezzo. */
  lastPrice?: number;
  openReturnPct?: number;
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

/** Giorni feriali dal lunedì 5 gennaio 1970: un contatore di sedute che non dipende da dove inizia la serie. */
export function scanPhase(date: string): number {
  const days = Math.round((Date.parse(date + "T00:00:00Z") - Date.UTC(1970, 0, 5)) / 86_400_000);
  const weeks = Math.floor(days / 7);
  const dow = days - weeks * 7;
  return weeks * 5 + Math.min(dow, 5);
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
  const anchored = opts.channelMode === "anchored";
  const set = anchored ? buildAnchoredSet(dates, closes, meta, opts.anchored) : null;

  for (let i = startBar; i < n; i++) {
    // ── Uscita: valutata ogni barra, come nel motore di portafoglio.
    if (open && i > open.bar) {
      let exit = false;
      let reason = "";
      const why = set ? anchoredExitReason(set, i, opts) : null;
      if (why) {
        exit = true;
        reason = why;
      } else if (!set || opts.anchoredExit === "meta_rolling") switch (set ? "meta_break" : opts.exitRule) {
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

    // ── Entrata: solo alle barre di scan, come nel motore di portafoglio. Il
    // turno di scan è agganciato al calendario, non all'indice della barra:
    // altrimenti due storici di lunghezza diversa (storico segnali e backtest
    // sul titolo) scansionerebbero in giorni diversi e darebbero date diverse.
    if (open || scanPhase(dates[i]) % opts.scanFreq !== 0) continue;
    if (opts.useRegime && regimeOk.get(dates[i]) === false) continue;

    if (set) {
      if (!anchoredStrong(set, i) || anchoredEntryBlock(set, i, opts)) continue;
    } else {
      const mc = metaChAt(i);
      if (!mc || mc.trend !== "asc" || mc.r2 < opts.minMetaR2) continue;
      const pc = priceChAt(i);
      if (!pc || pc.trend !== "asc" || pc.r2 < opts.minPriceR2) continue;
      if (pc.z > opts.entryMaxZ) continue;
    }

    const next = i + 1;
    if (next >= n) break;
    open = { bar: next, date: dates[next], price: opens[next] };
  }

  // Posizione ancora aperta alla fine: la si mostra come tale, non la si chiude
  // d'ufficio — qui stiamo elencando segnali, non misurando una performance.
  if (open) {
    const lastPrice = closes[n - 1];
    signals.push({
      entryDate: open.date,
      entryPrice: +open.price.toFixed(2),
      exitDate: null,
      exitPrice: null,
      returnPct: null,
      barsHeld: n - 1 - open.bar,
      exitReason: "ancora aperta: il canale non si è rotto",
      lastPrice: +lastPrice.toFixed(2),
      openReturnPct: +(((lastPrice - open.price) / open.price) * 100).toFixed(2),
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
/** Serie allineate di un titolo e del benchmark, pronte per replay e backtest. */
interface LoadedTicker {
  series: TickerSeries;
  /** Close aggiustati del benchmark allineati alle stesse date. */
  bench: number[];
  /** Prima barra utile dopo il warm-up dei canali e dell'RS. */
  need: number;
}

async function loadTickerSeries(ticker: string, opts: ResolvedWorldOptions, years: number): Promise<LoadedTicker> {
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

  return {
    series: { dates, closes, opens: aligned.map((c) => c.open), meta, regimeOk },
    bench: aligned.map((c) => benchByDate.get(c.date)!),
    need,
  };
}

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

  const { series, need } = await loadTickerSeries(ticker, opts, years);
  const { dates, closes } = series;
  const signals = replayTickerSignals(series, opts, need);

  const closed = signals.filter((s) => s.returnPct != null);
  const rets = closed.map((s) => s.returnPct!);
  const wins = rets.filter((r) => r > 0).length;
  const compounded = rets.reduce((acc, r) => acc * (1 + r / 100), 1);

  return {
    ticker,
    signals,
    series: dates.slice(need).map((d, k) => ({ date: d, close: +closes[need + k].toFixed(2) })),
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

// ─── Backtest sul singolo titolo: le due strategie a confronto ───────────────

export interface TickerBacktestStats {
  /** Rendimento totale sul periodo, posizione aperta valutata all'ultima chiusura. */
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  /** Rendimento ÷ rischio: CAGR / max drawdown. */
  calmar: number;
  trades: number;
  closedTrades: number;
  winRate: number;
  avgReturnPct: number;
  bestPct: number;
  worstPct: number;
  avgBarsHeld: number;
  /** Quota delle sedute passate in posizione. */
  timeInMarketPct: number;
}

export interface TickerBacktestStrategy {
  key: ChannelMode;
  label: string;
  /** La regola di uscita, in parole. */
  exitLabel: string;
  signals: TickerSignal[];
  equity: { date: string; equity: number }[];
  stats: TickerBacktestStats;
}

export interface TickerBacktest {
  ticker: string;
  name: string;
  benchmark: string;
  from: string;
  to: string;
  years: number;
  accountSize: number;
  /** [strategia attuale (finestra mobile), metodo Antonio (canali ancorati)]. */
  strategies: TickerBacktestStrategy[];
  buyHold: { equity: { date: string; equity: number }[]; stats: TickerBacktestStats };
  benchEquity: { date: string; equity: number }[];
  benchReturn: number;
  /** Prezzi del periodo, per i marcatori di entrata e uscita. */
  series: { date: string; close: number }[];
}

/**
 * Equity di una strategia su UN titolo: tutto il capitale dentro quando c'è
 * una posizione, tutto in cassa quando non c'è. Si entra all'apertura della
 * barra dopo il segnale e si esce al close, come nel replay; lo scivolamento
 * costa a ogni lato. Marcata a mercato ogni giorno, quindi il drawdown
 * comprende anche le perdite non realizzate.
 */
export function tickerEquity(
  series: Pick<TickerSeries, "dates" | "closes">,
  signals: TickerSignal[],
  startBar: number,
  accountSize: number,
  slippageBps: number
): { equity: { date: string; equity: number }[]; stats: TickerBacktestStats } {
  const { dates, closes } = series;
  const slip = slippageBps / 10_000;
  const entryAt = new Map<string, TickerSignal>();
  const exitAt = new Map<string, TickerSignal>();
  for (const s of signals) {
    entryAt.set(s.entryDate, s);
    if (s.exitDate) exitAt.set(s.exitDate, s);
  }

  let cash = accountSize;
  let shares = 0;
  let peak = accountSize;
  let maxDd = 0;
  let inMarket = 0;
  const equity: { date: string; equity: number }[] = [];

  for (let i = startBar; i < dates.length; i++) {
    const d = dates[i];
    const ent = entryAt.get(d);
    if (ent && shares === 0) {
      const price = ent.entryPrice * (1 + slip);
      shares = cash / price;
      cash = 0;
    }
    const ex = exitAt.get(d);
    if (ex && shares > 0) {
      cash = shares * (ex.exitPrice ?? closes[i]) * (1 - slip);
      shares = 0;
    }
    if (shares > 0) inMarket++;
    const eq = cash + shares * closes[i];
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak > 0 ? (peak - eq) / peak : 0);
    equity.push({ date: d, equity: +eq.toFixed(2) });
  }

  const final = equity.length ? equity[equity.length - 1].equity : accountSize;
  const bars = equity.length;
  const yrs = bars / 252;
  const cagr = yrs > 0.05 && final > 0 ? (Math.pow(final / accountSize, 1 / yrs) - 1) * 100 : 0;
  const closed = signals.filter((s) => s.returnPct != null);
  const rets = signals.map((s) => s.returnPct ?? s.openReturnPct ?? 0);
  const closedRets = closed.map((s) => s.returnPct!);
  const wins = closedRets.filter((r) => r > 0).length;
  const dd = maxDd * 100;

  return {
    equity,
    stats: {
      totalReturn: +(((final - accountSize) / accountSize) * 100).toFixed(1),
      cagr: +cagr.toFixed(1),
      maxDrawdown: +dd.toFixed(1),
      calmar: +(cagr / Math.max(0.1, dd)).toFixed(2),
      trades: signals.length,
      closedTrades: closed.length,
      winRate: closed.length ? +((wins / closed.length) * 100).toFixed(1) : 0,
      avgReturnPct: rets.length ? +(rets.reduce((a, b) => a + b, 0) / rets.length).toFixed(2) : 0,
      bestPct: rets.length ? +Math.max(...rets).toFixed(2) : 0,
      worstPct: rets.length ? +Math.min(...rets).toFixed(2) : 0,
      avgBarsHeld: signals.length ? +(signals.reduce((a, s) => a + s.barsHeld, 0) / signals.length).toFixed(1) : 0,
      timeInMarketPct: bars ? +((inMarket / bars) * 100).toFixed(0) : 0,
    },
  };
}

/**
 * Le due strategie sullo stesso titolo, stesse date, stesso capitale: la
 * regola esatta del replay (e quindi dell'analisi), una volta con i canali a
 * finestra mobile e una con i canali ancorati. NON è il backtest di
 * portafoglio: qui non c'è la classifica per forza relativa né il numero
 * massimo di posizioni, e la protezione dai drawdown (che agisce sul
 * portafoglio) non si applica.
 */
export async function runTickerBacktest(
  ticker: string,
  options: Omit<WorldMomentumOptions, "startDate" | "endDate"> & { years?: number }
): Promise<TickerBacktest> {
  const today = new Date().toISOString().slice(0, 10);
  const base = resolveWorldOptions({ startDate: today, endDate: today, ...options } as WorldMomentumOptions);
  const years = Math.min(10, Math.max(1, options.years ?? 5));

  // Un anno in più di storico per il warm-up: il backtest copre davvero `years` anni.
  const { series, bench, need } = await loadTickerSeries(ticker, base, years + 1);
  const { dates, closes } = series;
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  const fromStr = from.toISOString().slice(0, 10);
  let start = dates.findIndex((d) => d >= fromStr);
  if (start < need) start = need;

  const EXIT_TEXT: Record<AnchoredExit, string> = {
    meta: "rottura del canale del metatitolo",
    price: "rottura del canale del prezzo",
    price_weekly: "rottura del prezzo confermata dal settimanale",
    meta_rolling: "rottura del canale mobile del metatitolo",
  };
  const variants: { key: ChannelMode; label: string; exitLabel: string; opts: ResolvedWorldOptions }[] = [
    {
      key: "rolling",
      label: "Strategia attuale",
      exitLabel: EXIT_RULE_LABELS[base.exitRule].toLowerCase(),
      opts: { ...base, channelMode: "rolling" },
    },
    {
      key: "anchored",
      label: "Metodo Antonio",
      exitLabel: EXIT_TEXT[base.anchoredExit],
      opts: { ...base, channelMode: "anchored" },
    },
  ];

  const strategies = variants.map((v) => {
    const signals = replayTickerSignals(series, v.opts, start);
    const { equity, stats } = tickerEquity(series, signals, start, base.accountSize, base.slippageBps);
    return { key: v.key, label: v.label, exitLabel: v.exitLabel, signals, equity, stats };
  });

  // Buy & hold del titolo: comprato all'apertura del primo giorno, mai venduto.
  const bh: TickerSignal = {
    entryDate: dates[start],
    entryPrice: series.opens[start],
    exitDate: null, exitPrice: null, returnPct: null,
    barsHeld: dates.length - 1 - start,
    exitReason: "buy & hold",
    lastPrice: closes[closes.length - 1],
    openReturnPct: +(((closes[closes.length - 1] - series.opens[start]) / series.opens[start]) * 100).toFixed(2),
  };
  const buyHold = tickerEquity(series, [bh], start, base.accountSize, base.slippageBps);

  const b0 = bench[start];
  const benchEquity = dates.slice(start).map((d, k) => ({
    date: d,
    equity: +((base.accountSize * bench[start + k]) / b0).toFixed(2),
  }));

  return {
    ticker,
    name: nameFor(ticker),
    benchmark: base.benchmark,
    from: dates[start],
    to: dates[dates.length - 1],
    years,
    accountSize: base.accountSize,
    strategies,
    buyHold,
    benchEquity,
    benchReturn: +(((bench[bench.length - 1] - b0) / b0) * 100).toFixed(1),
    series: dates.slice(start).map((d, k) => ({ date: d, close: +closes[start + k].toFixed(2) })),
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
    stopAtr: opts.stopAtr ?? 0,
    stopPct: opts.stopPct ?? 0,
    trailAtr: opts.trailAtr ?? 0,
    trailPct: opts.trailPct ?? 0,
    maxWeight: opts.maxWeight ?? 0,
    sizing: opts.sizing ?? "equal",
    regimeExit: opts.regimeExit ?? false,
    regimeHysteresisPct: opts.regimeHysteresisPct ?? 0,
    maxCorr: opts.maxCorr ?? 0,
    channelMode: opts.channelMode ?? "rolling",
    anchored: { ...DEFAULT_ANCHORED, ...(opts.anchored ?? {}) },
    weeklyFilter: opts.weeklyFilter ?? "off",
    exitOnMeta: opts.exitOnMeta ?? false,
    // Fra le uscite dei canali ancorati, quella sul metatitolo è l'unica che batte
    // la strategia precedente sul set di taratura (A/B nell'intestazione).
    anchoredExit: opts.anchoredExit ?? "meta",
    maxEntryAge: opts.maxEntryAge ?? 0,
    maxPerSector: opts.maxPerSector ?? 0,
    // Adottato dopo la validazione (intestazione del modulo): l'unico
    // meccanismo che taglia il drawdown nel campione E fuori campione.
    volTarget: opts.volTarget ?? 20,
    volWindow: opts.volWindow ?? 42,
    minExposure: opts.minExposure ?? 0.25,
    folds: opts.folds ?? 0,
    w30: opts.w30 ?? 0.2,
    w90: opts.w90 ?? 0.5,
    w180: opts.w180 ?? 0.3,
  };
}

/** Benchmark selezionabili: ETF che replicano gli indici, con storico Yahoo lungo. */
export const BENCHMARKS: Record<string, string> = {
  URTH: "MSCI World",
  SPY: "S&P 500",
  QQQ: "Nasdaq 100",
  DIA: "Dow Jones 30",
};

/** Il benchmark naturale di ogni universo, per la scelta "automatico". */
export function autoBenchmark(indexKey: string): string {
  if (indexKey === "NDX") return "QQQ";
  if (indexKey === "DJIA") return "DIA";
  return "SPY";
}

/**
 * Benchmark e media mobile del filtro di regime dai query param. "auto" segue
 * l'indice analizzato; valori sconosciuti tornano al default validato
 * (MSCI World, SMA 200).
 */
export function marketParams(sp: URLSearchParams): { benchmark: string; regimeSma: number } {
  const raw = (sp.get("benchmark") ?? "").toUpperCase();
  const benchmark =
    raw === "AUTO" ? autoBenchmark(sp.get("index") ?? "SP500") : BENCHMARKS[raw] ? raw : WORLD_BENCHMARK;
  const sma = Math.round(Number(sp.get("regimeSma")));
  return { benchmark, regimeSma: Number.isFinite(sma) && sma >= 10 && sma <= 400 ? sma : 200 };
}

/**
 * Modalità dei canali dai query param delle route: valori sconosciuti → default.
 * Un solo parser per tutte le route, così analisi, dettaglio, storico segnali e
 * backtest leggono la stessa cosa.
 */
export function channelParams(sp: URLSearchParams): { channelMode: ChannelMode; anchoredExit: AnchoredExit } {
  const mode = sp.get("channelMode");
  const exit = sp.get("anchoredExit");
  const EXITS: AnchoredExit[] = ["price", "price_weekly", "meta", "meta_rolling"];
  return {
    channelMode: mode === "anchored" ? "anchored" : "rolling",
    anchoredExit: EXITS.includes(exit as AnchoredExit) ? (exit as AnchoredExit) : "meta",
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
  if (opts.benchmark === WORLD_BENCHMARK && opts.startDate < WORLD_BENCHMARK_INCEPTION) {
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
    return { ticker, candles, closes, meta, atr: atrSeries(candles), dateIdx };
  });

  const allData = rows.filter((r): r is TickerData => r !== null);
  if (allData.length === 0) throw new Error("Nessun titolo con dati sufficienti");

  const cache: ChannelCache = new Map();
  const anchCache: AnchoredCache = new Map();
  const full = simulate(allData, benchCandles, opts, cache, anchCache);

  // Benchmark buy & hold sulla stessa finestra.
  const inWindow = benchCandles.filter((c) => c.date >= opts.startDate && c.date <= opts.endDate);
  const base = inWindow.length ? px(inWindow[0]) : 0;
  const benchEquity = base
    ? inWindow.map((c) => ({ date: c.date, equity: +((opts.accountSize * px(c)) / base).toFixed(2) }))
    : [];

  /** Walk-forward: periodi consecutivi, ognuno con capitale fresco. */
  const walkForwardOf = (o: ResolvedWorldOptions): WalkForwardReport | undefined => {
    if (o.folds < 2) return undefined;
    const t0 = new Date(o.startDate).getTime();
    const t1 = new Date(o.endDate).getTime();
    const step = (t1 - t0) / o.folds;
    const periods: WalkForwardPeriod[] = [];
    for (let i = 0; i < o.folds; i++) {
      const s0 = new Date(t0 + step * i).toISOString().slice(0, 10);
      const e0 = new Date(t0 + step * (i + 1)).toISOString().slice(0, 10);
      const r = simulate(allData, benchCandles, { ...o, startDate: s0, endDate: e0 }, cache, anchCache);
      periods.push({ start: s0, end: e0, summary: r.summary });
    }
    return walkForwardStats(periods);
  };

  const walkForward = walkForwardOf(opts);

  // L'A/B fra le due strategie: stessi dati, stessa finestra, stessa
  // protezione dal drawdown — cambia SOLO come si costruiscono i canali.
  const otherMode: ChannelMode = opts.channelMode === "anchored" ? "rolling" : "anchored";
  const otherOpts: ResolvedWorldOptions = { ...opts, channelMode: otherMode };
  const other = simulate(allData, benchCandles, otherOpts, cache, anchCache);
  const comparison: WorldMomentumResult["comparison"] = {
    kind: "other_strategy",
    channelMode: otherMode,
    label: otherMode === "anchored" ? "metodo Antonio" : "strategia attuale",
    summary: other.summary,
    equity: other.equity,
    walkForward: walkForwardOf(otherOpts),
  };

  let protection: WorldMomentumResult["protection"];
  if (opts.volTarget > 0) {
    const bare = { ...opts, volTarget: 0 };
    const r = simulate(allData, benchCandles, bare, cache, anchCache);
    protection = { summary: r.summary, equity: r.equity, walkForward: walkForwardOf(bare) };
  }

  return {
    summary: full.summary,
    equity: full.equity,
    realizedCurve: full.realizedCurve,
    benchEquity,
    trades: full.trades,
    endPrices: full.endPrices,
    names: Object.fromEntries([...new Set(full.trades.map((t) => t.ticker))].map((t) => [t, nameFor(t)])),
    perTicker: attributeByTicker(full.trades),
    rankingHistory: full.rankingHistory,
    walkForward,
    comparison,
    protection,
    options: opts,
    tickersTested: allData.length,
    signalsTotal: full.signalsTotal,
    signalsTaken: full.signalsTaken,
  };
}
