/**
 * Canali di regressione ANCORATI — la logica con cui Antonio traccia i canali
 * a mano su ProRealTime, resa meccanica.
 * ============================================================================
 *
 * Differenza con `regressionChannel` (lib/regression.ts): quello è una finestra
 * fissa che scorre (sempre le ultime N barre), quindi non ha un inizio né una
 * fine. Qui ogni canale NASCE in un punto preciso, si allunga barra dopo barra
 * finché regge e MUORE quando si rompe. La serie storica diventa una sequenza
 * di canali — rialzisti, ribassisti, laterali — come nei grafici tracciati a
 * mano.
 *
 * Le regole (feedback di Antonio, ott 2026):
 *
 *  1. Ogni canale è una regressione lineare sui close, dal suo punto d'ancora
 *     fino alla barra precedente, con bande a ±2 deviazioni standard dei
 *     residui.
 *  2. Quando il canale è giovane (poche barre) la deviazione standard è poco
 *     affidabile: la banda parte più larga (`maxBandK`) e si stringe in
 *     `rampBars` barre fino a `bandK`.
 *  3. Rottura = CHIUSURA fuori banda, confermata se nelle `confirmBars` barre
 *     successive il prezzo non rientra. Se rientra, era rumore e il canale
 *     continua.
 *  4. Rottura confermata della banda superiore → nasce un canale nuovo ancorato
 *     al MINIMO precedente (il punto da cui è partito il movimento). Rottura
 *     della banda inferiore → canale nuovo ancorato al MASSIMO precedente.
 *  5. Anche un canale che si allarga — non segue più i prezzi — finisce: è il
 *     segnale che il trend sta cambiando forma prima ancora della rottura.
 *  6. La direzione di un canale è la sua pendenza: sotto `minSlopePct` annuo
 *     in valore assoluto è laterale. Così un canale nato da una rottura può
 *     diventare laterale, e da lì rientrare nel trend vecchio o girare.
 *
 * Tutto è CAUSALE: lo stato alla barra t usa solo i close fino a t. Il canale
 * che viene disegnato invece (`segments`) è fittato a posteriori su tutta la
 * sua vita, come fa chi lo traccia a mano — serve a leggere il grafico, non a
 * prendere decisioni.
 */

export type ChannelDir = "up" | "down" | "flat";

export interface AnchoredChannelOptions {
  /** Larghezza delle bande a regime, in deviazioni standard. */
  bandK: number;
  /** Larghezza iniziale delle bande quando il canale ha poche barre. */
  maxBandK: number;
  /** Barre in cui la banda passa da `maxBandK` a `bandK`. */
  rampBars: number;
  /** Barre minime prima che un canale possa rompersi. */
  minBars: number;
  /** Chiusure successive che devono restare fuori banda per confermare la rottura. */
  confirmBars: number;
  /** Quante barre indietro si cerca il minimo/massimo a cui ancorare il canale nuovo. */
  pivotLookback: number;
  /** Pendenza annua minima (in %) perché un canale sia rialzista o ribassista. */
  minSlopePct: number;
  /**
   * Il canale finisce se la sua deviazione standard supera questo multiplo di
   * quella che aveva a maturità (`rampBars`). 0 = disattivo.
   */
  widenFactor: number;
  /** Barre per anno della serie: 252 per il giornaliero, 52 per il settimanale. */
  periodsPerYear: number;
  /**
   * Se false, una rottura NELLA direzione del canale (il prezzo che accelera
   * sopra un canale rialzista, o affonda sotto uno ribassista) non apre un
   * canale nuovo: è il trend che continua, non che cambia. È così che li
   * traccia Antonio — un canale rialzista muore solo dalla banda inferiore.
   */
  trendContinuationBreaks: boolean;
}

export const DEFAULT_ANCHORED: AnchoredChannelOptions = {
  // Tarati a vista sul grafico di PLTR tracciato a mano da Antonio (ott 2024
  // → ott 2026, ~9 canali): con questi valori ne escono 10 sullo stesso
  // periodo, e 5-7 l'anno sugli altri titoli. Con le bande iniziali a 3σ e 5
  // barre minime ne uscivano 39 — un canale nuovo ogni due settimane.
  bandK: 2,
  maxBandK: 3.5,
  rampBars: 30,
  minBars: 10,
  confirmBars: 2,
  pivotLookback: 20,
  minSlopePct: 10,
  widenFactor: 0,
  periodsPerYear: 252,
  trendContinuationBreaks: false,
};

/**
 * Le stesse regole sulla serie settimanale: una barra settimanale vale cinque
 * giornaliere, quindi le finestre si accorciano in proporzione e la conferma
 * è la settimana successiva.
 */
export function weeklyOptions(daily: AnchoredChannelOptions): AnchoredChannelOptions {
  return {
    ...daily,
    rampBars: Math.max(4, Math.round(daily.rampBars / 5)),
    minBars: Math.max(3, Math.round(daily.minBars / 2)),
    confirmBars: 1,
    pivotLookback: Math.max(4, Math.round(daily.pivotLookback / 5)),
    periodsPerYear: 52,
  };
}

/** Perché è nato il canale attivo. */
export type ChannelCause =
  | "start"       // il primo canale della serie
  | "break_up"    // rottura confermata della banda superiore
  | "break_down"  // rottura confermata della banda inferiore
  | "widen";      // il canale precedente si era allargato

export const CAUSE_CODES: ChannelCause[] = ["start", "break_up", "break_down", "widen"];

/** Un canale disegnabile: vita intera, retta e bande fittate a posteriori. */
export interface ChannelSegment {
  /** Barra d'ancora (il minimo o massimo da cui parte). */
  start: number;
  /** Ultima barra del canale (la rottura, o l'ultima barra della serie). */
  end: number;
  /** Barra in cui la nascita è stata confermata: da qui in poi lo si sapeva. */
  confirmedAt: number;
  dir: ChannelDir;
  cause: ChannelCause;
  /** Perché è finito; "open" = è il canale ancora attivo. */
  endReason: "break_up" | "break_down" | "widen" | "open";
  /** Retta: fit(i) = intercept + slope × (i − start). */
  slope: number;
  intercept: number;
  stdev: number;
  k: number;
  r2: number;
  slopePct: number;
}

/** Stato del canale attivo, barra per barra (array paralleli, per leggerezza). */
export interface AnchoredSeries {
  n: number;
  /** 1 = rialzista, −1 = ribassista, 0 = laterale o non ancora definito. */
  dir: Int8Array;
  /** Barra d'ancora del canale attivo. */
  anchor: Int32Array;
  /** Barra in cui il canale attivo è stato confermato. */
  birth: Int32Array;
  /** Indice in CAUSE_CODES del motivo per cui è nato il canale attivo. */
  cause: Int8Array;
  mid: Float64Array;
  upper: Float64Array;
  lower: Float64Array;
  segments: ChannelSegment[];
}

const DIR_CODE: Record<ChannelDir, number> = { up: 1, down: -1, flat: 0 };

export function dirOf(code: number): ChannelDir {
  return code > 0 ? "up" : code < 0 ? "down" : "flat";
}

/** Somme prefisse per fittare in O(1) la regressione su qualunque intervallo. */
class Prefix {
  private sy: Float64Array;
  private siy: Float64Array;
  private syy: Float64Array;
  constructor(y: number[]) {
    const n = y.length;
    this.sy = new Float64Array(n + 1);
    this.siy = new Float64Array(n + 1);
    this.syy = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      this.sy[i + 1] = this.sy[i] + y[i];
      this.siy[i + 1] = this.siy[i] + i * y[i];
      this.syy[i + 1] = this.syy[i] + y[i] * y[i];
    }
  }
  /** Regressione su [a, b] inclusi, con x = i − a. Null se meno di 2 punti. */
  fit(a: number, b: number): { slope: number; intercept: number; stdev: number; r2: number; mean: number } | null {
    const m = b - a + 1;
    if (m < 2) return null;
    const Sy = this.sy[b + 1] - this.sy[a];
    const Sxy = this.siy[b + 1] - this.siy[a] - a * Sy;
    const Syy = this.syy[b + 1] - this.syy[a];
    const Sx = (m * (m - 1)) / 2;
    const Sxx = ((m - 1) * m * (2 * m - 1)) / 6;
    const den = m * Sxx - Sx * Sx;
    if (den === 0) return null;
    const slope = (m * Sxy - Sx * Sy) / den;
    const intercept = (Sy - slope * Sx) / m;
    const ssRes = Math.max(0, Syy - intercept * Sy - slope * Sxy);
    const ssTot = Math.max(0, Syy - (Sy * Sy) / m);
    return {
      slope,
      intercept,
      stdev: Math.sqrt(ssRes / m),
      r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0,
      mean: Sy / m,
    };
  }
}

/** Larghezza della banda per un canale con `bars` barre di fit. */
export function bandKAt(bars: number, o: AnchoredChannelOptions): number {
  if (o.maxBandK <= o.bandK || o.rampBars <= o.minBars) return o.bandK;
  const t = (bars - o.minBars) / (o.rampBars - o.minBars);
  const w = Math.min(1, Math.max(0, t));
  return o.maxBandK + (o.bandK - o.maxBandK) * w;
}

function classify(slope: number, mean: number, o: AnchoredChannelOptions): ChannelDir {
  if (!(mean > 0)) return "flat";
  const pctYr = (slope / mean) * o.periodsPerYear * 100;
  if (pctYr >= o.minSlopePct) return "up";
  if (pctYr <= -o.minSlopePct) return "down";
  return "flat";
}

/** Riempie i buchi (NaN) col valore precedente; i NaN iniziali restano. */
function forwardFill(y: number[]): { y: number[]; first: number } {
  const out = y.slice();
  let first = -1;
  let last = NaN;
  for (let i = 0; i < out.length; i++) {
    if (isFinite(out[i]) && out[i] > 0) {
      if (first < 0) first = i;
      last = out[i];
    } else if (first >= 0) {
      out[i] = last;
    }
  }
  // Prima del primo valore valido: lo stesso valore, ma lo stato resta "non
  // definito" (il ciclo principale parte da `first`).
  if (first > 0) for (let i = 0; i < first; i++) out[i] = out[first];
  return { y: out, first };
}

/**
 * Il cuore: percorre la serie una barra alla volta e mantiene il canale attivo.
 * Funzione pura, nessun I/O.
 */
export function anchoredChannels(series: number[], o: AnchoredChannelOptions = DEFAULT_ANCHORED): AnchoredSeries {
  const n = series.length;
  const dir = new Int8Array(n);
  const anchorArr = new Int32Array(n).fill(-1);
  const birthArr = new Int32Array(n).fill(-1);
  const causeArr = new Int8Array(n);
  const mid = new Float64Array(n).fill(NaN);
  const upper = new Float64Array(n).fill(NaN);
  const lower = new Float64Array(n).fill(NaN);
  const segments: ChannelSegment[] = [];
  const out: AnchoredSeries = { n, dir, anchor: anchorArr, birth: birthArr, cause: causeArr, mid, upper, lower, segments };
  if (n === 0) return out;

  const { y, first } = forwardFill(series);
  if (first < 0) return out;
  const pre = new Prefix(y);

  let anchor = first;
  let birth = first;
  let cause = "start" as ChannelCause;
  /** Deviazione standard a maturità: il riferimento per accorgersi dell'allargamento. */
  let sdRef = NaN;
  let pending: {
    side: "up" | "down";
    bar: number;
    slope: number;
    intercept: number;
    band: number; // k × stdev congelati alla barra di rottura
    anchor: number;
  } | null = null;

  /** Chiude il canale attivo (per il disegno) e ne apre uno nuovo. */
  const reanchor = (t: number, breakBar: number, newAnchor: number, why: ChannelCause, endReason: ChannelSegment["endReason"]) => {
    segments.push(drawSegment(pre, anchor, breakBar, birth, cause, endReason, o));
    anchor = newAnchor;
    birth = t;
    cause = why;
    sdRef = NaN;
    pending = null;
  };

  const argExtreme = (from: number, to: number, wantMin: boolean) => {
    let best = to;
    for (let i = to; i >= from; i--) {
      if (wantMin ? y[i] < y[best] : y[i] > y[best]) best = i;
    }
    return best;
  };

  for (let t = first; t < n; t++) {
    let bars = t - anchor; // barre nel fit, cioè [anchor, t−1]
    const close = y[t];

    // ── 1. Rottura in attesa di conferma.
    if (pending) {
      const p: NonNullable<typeof pending> = pending;
      const x = t - p.anchor;
      const line = p.intercept + p.slope * x;
      const back = p.side === "up" ? close <= line + p.band : close >= line - p.band;
      if (back) {
        pending = null; // rientrata: era rumore, il canale continua
      } else if (t - p.bar >= o.confirmBars) {
        const from = Math.max(anchor, p.bar - o.pivotLookback);
        const na = argExtreme(from, p.bar, p.side === "up");
        reanchor(t, p.bar, na, p.side === "up" ? "break_up" : "break_down", p.side === "up" ? "break_up" : "break_down");
        bars = t - anchor;
      }
    }

    // ── 2. Il canale attivo, fittato fino a ieri e proiettato su oggi.
    let f = bars >= 2 ? pre.fit(anchor, t - 1) : null;
    if (f && !pending && bars >= o.minBars) {
      const k = bandKAt(bars, o);
      const m = f.intercept + f.slope * bars;
      const up = m + k * f.stdev;
      const lo = m - k * f.stdev;
      const curDir = classify(f.slope, f.mean, o);
      const breakUp = close > up && (o.trendContinuationBreaks || curDir !== "up");
      const breakDown = close < lo && (o.trendContinuationBreaks || curDir !== "down");
      if (breakUp || breakDown) {
        pending = { side: breakUp ? "up" : "down", bar: t, slope: f.slope, intercept: f.intercept, band: k * f.stdev, anchor };
        if (o.confirmBars <= 0) {
          const p: NonNullable<typeof pending> = pending;
          const na = argExtreme(Math.max(anchor, t - o.pivotLookback), t, p.side === "up");
          reanchor(t, t, na, p.side === "up" ? "break_up" : "break_down", p.side === "up" ? "break_up" : "break_down");
          bars = t - anchor;
          f = bars >= 2 ? pre.fit(anchor, t - 1) : null;
        }
      } else if (o.widenFactor > 0 && bars >= o.rampBars) {
        // Allargamento: il fit peggiora perché i prezzi curvano. Il canale nuovo
        // si ancora dalla parte opposta a dove sta andando il prezzo.
        if (!isFinite(sdRef)) sdRef = f.stdev;
        else if (f.stdev > o.widenFactor * sdRef) {
          const goingDown = close < m;
          const na = argExtreme(Math.max(anchor, t - o.pivotLookback), t, !goingDown);
          reanchor(t, t, na, "widen", "widen");
          bars = t - anchor;
          f = bars >= 2 ? pre.fit(anchor, t - 1) : null;
        }
      }
    }

    // ── 3. Stato di oggi.
    anchorArr[t] = anchor;
    birthArr[t] = birth;
    causeArr[t] = CAUSE_CODES.indexOf(cause);
    if (f) {
      const k = bandKAt(bars, o);
      const m = f.intercept + f.slope * bars;
      mid[t] = m;
      upper[t] = m + k * f.stdev;
      lower[t] = m - k * f.stdev;
      dir[t] = DIR_CODE[classify(f.slope, f.mean, o)];
    } else {
      // Canale appena nato (1-2 barre): la direzione è quella della rottura che
      // l'ha generato — nasce da un minimo, quindi sale, e viceversa.
      dir[t] = cause === "break_up" ? 1 : cause === "break_down" ? -1 : 0;
    }
  }

  segments.push(drawSegment(pre, anchor, n - 1, birth, cause, "open", o));
  return out;
}

function drawSegment(
  pre: Prefix,
  start: number,
  end: number,
  confirmedAt: number,
  cause: ChannelCause,
  endReason: ChannelSegment["endReason"],
  o: AnchoredChannelOptions
): ChannelSegment {
  const f = pre.fit(start, Math.max(start + 1, end));
  const bars = end - start + 1;
  const k = endReason === "open" ? bandKAt(bars, o) : o.bandK;
  if (!f) {
    return { start, end, confirmedAt, dir: "flat", cause, endReason, slope: 0, intercept: 0, stdev: 0, k, r2: 0, slopePct: 0 };
  }
  return {
    start,
    end,
    confirmedAt,
    dir: classify(f.slope, f.mean, o),
    cause,
    endReason,
    slope: f.slope,
    intercept: f.intercept,
    stdev: f.stdev,
    k,
    r2: +f.r2.toFixed(3),
    slopePct: f.mean > 0 ? +((f.slope / f.mean) * o.periodsPerYear * 100).toFixed(1) : 0,
  };
}

// ─── Serie settimanale ───────────────────────────────────────────────────────

/** Chiave della settimana: la data del lunedì (UTC). */
export function weekKey(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunedì
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface WeeklySeries {
  /** Data dell'ultima seduta di ogni settimana. */
  dates: string[];
  closes: number[];
  channels: AnchoredSeries;
  /**
   * Per ogni barra giornaliera, la direzione del canale settimanale all'ultima
   * settimana CHIUSA prima di quella barra (0 se non c'è ancora). La settimana
   * in corso non conta: il suo close non si conosce fino a venerdì.
   */
  dailyDir: Int8Array;
}

export function weeklyChannels(dates: string[], closes: number[], daily: AnchoredChannelOptions): WeeklySeries {
  const wDates: string[] = [];
  const wCloses: number[] = [];
  const weekOfDay = new Int32Array(dates.length);
  let curKey = "";
  for (let i = 0; i < dates.length; i++) {
    const k = weekKey(dates[i]);
    if (k !== curKey) {
      curKey = k;
      wDates.push(dates[i]);
      wCloses.push(closes[i]);
    } else {
      wDates[wDates.length - 1] = dates[i];
      wCloses[wCloses.length - 1] = closes[i];
    }
    weekOfDay[i] = wDates.length - 1;
  }
  const channels = anchoredChannels(wCloses, weeklyOptions(daily));
  const dailyDir = new Int8Array(dates.length);
  for (let i = 0; i < dates.length; i++) {
    const prevWeek = weekOfDay[i] - 1;
    dailyDir[i] = prevWeek >= 0 ? channels.dir[prevWeek] : 0;
  }
  return { dates: wDates, closes: wCloses, channels, dailyDir };
}
