import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchoredChannels,
  bandKAt,
  weeklyChannels,
  weekKey,
  DEFAULT_ANCHORED,
  CAUSE_CODES,
  type AnchoredChannelOptions,
} from "../lib/anchoredChannel";
import { regressionChannel } from "../lib/regression";
import {
  anchoredEntryBlock,
  anchoredExitReason,
  buildAnchoredSet,
  channelParams,
  replayTickerSignals,
  resolveWorldOptions,
} from "../lib/worldMomentum";

const O: AnchoredChannelOptions = { ...DEFAULT_ANCHORED };

/** Rumore deterministico: niente Math.random, i test devono ripetersi uguali. */
function noise(i: number, amp: number): number {
  return amp * Math.sin(i * 1.7) * Math.cos(i * 0.31);
}

/** Sale per `up` barre, poi scende per `down` barre. */
function peak(up: number, down: number, slope = 0.5, amp = 0.6): number[] {
  const out: number[] = [];
  for (let i = 0; i < up; i++) out.push(100 + slope * i + noise(i, amp));
  const top = 100 + slope * (up - 1);
  for (let j = 1; j <= down; j++) out.push(top - slope * 1.5 * j + noise(up + j, amp));
  return out;
}

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

test("anchored: la regressione O(1) coincide con regressionChannel sullo stesso intervallo", () => {
  const ys = peak(80, 0);
  const a = anchoredChannels(ys, O);
  const seg = a.segments[a.segments.length - 1];
  const ref = regressionChannel(ys.slice(seg.start, seg.end + 1), 2)!;
  assert.ok(Math.abs(seg.slope - ref.slope) < 1e-9);
  assert.ok(Math.abs(seg.intercept - ref.intercept) < 1e-9);
  assert.ok(Math.abs(seg.stdev - ref.stdev) < 1e-9);
});

test("anchored: un trend pulito resta UN canale rialzista, anche se accelera", () => {
  const ys = peak(120, 0);
  // Accelerazione finale: in un canale rialzista una rottura verso l'alto non è un cambio di trend.
  for (let i = 0; i < 15; i++) ys.push(ys[ys.length - 1] + 2);
  const a = anchoredChannels(ys, O);
  assert.equal(a.segments.length, 1);
  assert.equal(a.dir[ys.length - 1], 1);
});

test("anchored: la rottura della banda inferiore apre un canale ancorato al massimo precedente", () => {
  const ys = peak(100, 40);
  const a = anchoredChannels(ys, O);
  const last = ys.length - 1;
  assert.equal(CAUSE_CODES[a.cause[last]], "break_down");
  assert.equal(a.dir[last], -1);
  // L'ancora è il massimo nelle `pivotLookback` barre prima della rottura: il picco.
  const anchor = a.anchor[last];
  const top = ys.indexOf(Math.max(...ys));
  assert.ok(Math.abs(anchor - top) <= 2, `ancora ${anchor}, massimo ${top}`);
  // La conferma arriva DOPO la rottura, mai sulla stessa barra.
  assert.ok(a.birth[last] > anchor);
});

test("anchored: una chiusura fuori banda che rientra subito non rompe il canale", () => {
  const ys = peak(100, 0, 0.5, 0.3);
  ys[80] -= 15; // un solo giorno di panico, poi il trend riprende
  const a = anchoredChannels(ys, O);
  assert.equal(a.segments.length, 1, "la rottura non confermata non deve aprire un canale");
  const b = anchoredChannels(ys, { ...O, confirmBars: 0 });
  assert.ok(b.segments.length > 1, "senza conferma la stessa barra rompe il canale");
});

test("anchored: CAUSALE — lo stato fino a t non cambia aggiungendo barre future", () => {
  const ys = peak(90, 60);
  const full = anchoredChannels(ys, O);
  for (const cut of [40, 95, 110, 130]) {
    const part = anchoredChannels(ys.slice(0, cut), O);
    for (let t = 0; t < cut; t++) {
      assert.equal(part.dir[t], full.dir[t], `dir @${t} (cut ${cut})`);
      assert.equal(part.anchor[t], full.anchor[t], `anchor @${t} (cut ${cut})`);
      assert.equal(part.birth[t], full.birth[t], `birth @${t} (cut ${cut})`);
    }
  }
});

test("anchored: la banda parte larga e si stringe fino a bandK", () => {
  assert.equal(bandKAt(O.minBars, O), O.maxBandK);
  assert.equal(bandKAt(O.rampBars, O), O.bandK);
  assert.equal(bandKAt(O.rampBars * 3, O), O.bandK);
  const mid = bandKAt((O.minBars + O.rampBars) / 2, O);
  assert.ok(mid < O.maxBandK && mid > O.bandK);
});

test("anchored: i NaN (date senza benchmark) non avvelenano il fit", () => {
  const ys = peak(80, 0);
  ys[30] = NaN;
  ys[31] = NaN;
  const a = anchoredChannels(ys, O);
  assert.ok(a.segments.every((s) => isFinite(s.slope) && isFinite(s.stdev)));
  assert.equal(a.dir[79], 1);
});

test("weekly: la direzione giornaliera usa solo settimane già chiuse", () => {
  assert.equal(weekKey("2024-01-05"), "2024-01-01"); // venerdì → lunedì
  assert.equal(weekKey("2024-01-08"), "2024-01-08");
  const ds = dates(400);
  const ys = peak(250, 150).slice(0, 400);
  const w = weeklyChannels(ds, ys, O);
  // Lunedì e venerdì della stessa settimana vedono la stessa settimana chiusa.
  const mon = ds.findIndex((d) => d === "2024-06-03");
  const fri = ds.findIndex((d) => d === "2024-06-07");
  assert.equal(w.dailyDir[mon], w.dailyDir[fri]);
  // E il valore è quello della settimana PRECEDENTE.
  const prevWeek = w.dates.findIndex((d) => d >= "2024-05-27") ;
  assert.equal(w.dailyDir[mon], w.channels.dir[prevWeek]);
});

test("strategia ancorata: entrata e uscita seguono i canali, il default resta la finestra mobile", () => {
  const def = resolveWorldOptions({ indexKey: "SP500", startDate: "2024-01-01", endDate: "2024-12-31" });
  assert.equal(def.channelMode, "rolling", "il default non cambia: l'A/B non ha superato la soglia");
  assert.equal(def.anchoredExit, "meta");

  const o = resolveWorldOptions({
    indexKey: "SP500", startDate: "2024-01-01", endDate: "2024-12-31",
    channelMode: "anchored", anchoredExit: "price",
  });
  const ys = peak(120, 60);
  const ds = dates(ys.length);
  const set = buildAnchoredSet(ds, ys, ys.map((v) => v / 100), o.anchored);
  assert.equal(anchoredEntryBlock(set, 100, o), null);
  assert.equal(anchoredExitReason(set, 100, o), null);
  const last = ys.length - 1;
  assert.match(anchoredEntryBlock(set, last, o) ?? "", /ribassista/);
  assert.match(anchoredExitReason(set, last, o) ?? "", /banda inferiore/);
  // Con uscita sul metatitolo decide il canale del metatitolo.
  assert.ok(anchoredExitReason(set, last, { ...o, anchoredExit: "meta" }));
  // Con l'uscita della strategia precedente decide il chiamante (canale mobile).
  assert.equal(anchoredExitReason(set, last, { ...o, anchoredExit: "meta_rolling" }), null);
});

test("replay ancorato: compra nel canale rialzista, vende alla rottura, esegue all'apertura dopo", () => {
  const o = resolveWorldOptions({
    indexKey: "SP500", startDate: "2024-01-01", endDate: "2024-12-31",
    channelMode: "anchored", anchoredExit: "price", useRegime: false, scanFreq: 1,
  });
  const ys = peak(120, 60);
  const ds = dates(ys.length);
  const sig = replayTickerSignals(
    { dates: ds, closes: ys, opens: ys.map((v) => v - 0.1), meta: ys.map((v) => v / 100), regimeOk: new Map() },
    o,
    20
  );
  assert.ok(sig.length >= 1);
  const first = sig[0];
  assert.ok(first.exitDate, "la discesa deve chiudere la posizione");
  assert.match(first.exitReason, /banda inferiore|ribassista|laterale/);
  const i = ds.indexOf(first.entryDate);
  assert.equal(first.entryPrice, +(ys[i] - 0.1).toFixed(2), "esecuzione all'apertura");
});

test("channelParams: valori sconosciuti tornano ai default", () => {
  assert.deepEqual(channelParams(new URLSearchParams("channelMode=anchored&anchoredExit=price")), {
    channelMode: "anchored", anchoredExit: "price",
  });
  assert.deepEqual(channelParams(new URLSearchParams("channelMode=boh&anchoredExit=';drop")), {
    channelMode: "rolling", anchoredExit: "meta",
  });
});
