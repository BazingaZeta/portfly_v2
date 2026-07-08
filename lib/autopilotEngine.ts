import {
  getAutoEquity,
  getAutoLog as getDbAutoLog,
  getAutoPositions,
  getAutoState as getDbAutoState,
  getAutoTrades as getDbAutoTrades,
  insertAutoLog,
  insertAutoTrade,
  resetAutoState as resetDbAutoState,
  upsertAutoEquity,
  upsertAutoPosition,
  upsertAutoState,
  type AutoTrack,
} from "./db";
import { getMeta, setMeta } from "./db";
import { computeStrategy, fetchUniverseCandles, AUTO_UNIVERSE, AUTO_NAMES } from "./autopilot";
import { sendTelegram } from "./notify";
import {
  rotationDecision,
  normalizeRotationConfig,
  ASSET_NAMES,
  DEFAULT_ROTATION,
  type RotationConfig,
} from "./leverageRotation";
import {
  cryptoTrendDecision,
  normalizeCryptoTrendConfig,
  CRYPTO_NAMES,
  DEFAULT_CRYPTO_TREND,
  type CryptoTrendConfig,
} from "./cryptoTrend";
import { fetchQuotes, fetchCandles } from "./marketData";
import type { Candle } from "./types";

export type { AutoTrack } from "./db";
export type AutopilotStrategy = "dual_momentum" | "rotation" | "crypto_trend";

const STRATEGY_LABELS: Record<AutopilotStrategy, string> = {
  dual_momentum: "Dual Momentum ETF (mensile)",
  rotation: "Rotazione a leva (SPY vs SMA200)",
  crypto_trend: "Crypto Trend (BTC/ETH sopra trend)",
};

// La traccia "crypto" gira SOLO la strategia crypto_trend; "main" resta
// rotation/dual_momentum come prima. Le meta key sono namespacate per traccia
// (prefisso "crypto_") — la traccia main usa le key storiche invariate.
function mk(track: AutoTrack, key: string): string {
  return track === "crypto" ? `crypto_${key}` : key;
}

function nameFor(ticker: string): string {
  return AUTO_NAMES[ticker] ?? ASSET_NAMES[ticker] ?? CRYPTO_NAMES[ticker] ?? ticker;
}

export interface AutopilotStrategyInfo {
  strategy: AutopilotStrategy;
  label: string;
  rotation: RotationConfig;
  crypto: CryptoTrendConfig;
}

export async function getAutopilotStrategy(track: AutoTrack = "main"): Promise<AutopilotStrategyInfo> {
  let rotation = DEFAULT_ROTATION;
  try {
    const cfg = await getMeta(mk(track, "autopilot_rotation_config"));
    if (cfg) rotation = normalizeRotationConfig(JSON.parse(cfg));
  } catch { /* default */ }
  let crypto = DEFAULT_CRYPTO_TREND;
  try {
    const cfg = await getMeta(mk(track, "autopilot_crypto_config"));
    if (cfg) crypto = normalizeCryptoTrendConfig(JSON.parse(cfg));
  } catch { /* default */ }

  // La traccia crypto è dedicata: strategia sempre crypto_trend.
  if (track === "crypto") {
    return { strategy: "crypto_trend", label: STRATEGY_LABELS.crypto_trend, rotation, crypto };
  }
  const raw = (await getMeta(mk(track, "autopilot_strategy"))) as AutopilotStrategy | null;
  const strategy: AutopilotStrategy = raw === "rotation" ? "rotation" : "dual_momentum";
  return { strategy, label: STRATEGY_LABELS[strategy], rotation, crypto };
}

export interface AutoPosition {
  ticker: string;
  name: string;
  shares: number;
  avgCost: number;
  price: number;
  value: number;
  pnl: number;
  pnlPct: number;
  weight: number;
}
export interface AutoStateView {
  running: boolean;
  cash: number;
  initialCapital: number;
  equity: number;
  totalPnl: number;
  totalPnlPct: number;
  startedAt: string | null;
  lastRun: string | null;
  positions: AutoPosition[];
}
export interface AutoLogEntry { ts: string; runId: string; kind: string; message: string; }
export interface AutoTrade { ticker: string; action: string; shares: number; price: number; executedAt: string; reason: string | null; }

type StateRow = {
  cash: number; initial_capital: number; started_at: string;
  last_run: string | null; last_rebalance_month: string | null;
};

export async function getAutoStateRow(track: AutoTrack = "main"): Promise<StateRow | null> {
  const state = await getDbAutoState(track);
  if (!state) return null;
  return {
    cash: state.cash,
    initial_capital: state.initial_capital,
    started_at: state.started_at,
    last_run: state.last_run,
    last_rebalance_month: state.last_rebalance_month,
  };
}

export async function startAutopilot(
  initialCapital = 10000,
  strategy: AutopilotStrategy = "dual_momentum",
  rotationCfg?: Partial<RotationConfig>,
  cryptoCfg?: Partial<CryptoTrendConfig>,
  track: AutoTrack = "main"
): Promise<void> {
  const now = new Date().toISOString();
  // La traccia crypto forza la strategia crypto_trend a prescindere.
  if (track === "crypto") strategy = "crypto_trend";
  await resetDbAutoState(track);
  await setMeta(mk(track, "autopilot_strategy"), strategy);
  if (strategy === "rotation") {
    await setMeta(mk(track, "autopilot_rotation_config"), JSON.stringify(normalizeRotationConfig(rotationCfg)));
  }
  if (strategy === "crypto_trend") {
    await setMeta(mk(track, "autopilot_crypto_config"), JSON.stringify(normalizeCryptoTrendConfig(cryptoCfg)));
  }
  await upsertAutoState({
    cash: initialCapital,
    initial_capital: initialCapital,
    started_at: now,
    last_run: null,
    last_rebalance_month: null,
  }, track);
  await log(
    now.slice(0, 19),
    "start",
    `Autopilot avviato con capitale virtuale ${initialCapital}$ — strategia: ${STRATEGY_LABELS[strategy]}.`,
    track
  );
}

export async function resetAutopilot(track: AutoTrack = "main"): Promise<void> {
  await resetDbAutoState(track);
  await setMeta(mk(track, "autopilot_paused"), "0");
  await setMeta(mk(track, "autopilot_peak_equity"), "0");
}

async function log(runId: string, kind: string, message: string, track: AutoTrack = "main"): Promise<void> {
  await insertAutoLog(runId, kind, message, track);
}

async function positionsMap(track: AutoTrack): Promise<Record<string, { shares: number; avgCost: number }>> {
  const rows = await getAutoPositions(track);
  const m: Record<string, { shares: number; avgCost: number }> = {};
  for (const r of rows) m[r.ticker] = { shares: r.shares, avgCost: r.avg_cost };
  return m;
}

// ─── Kill-switch ──────────────────────────────────────────────────────────────
// Pausa automatica se l'equity scende oltre maxDd% dal picco: il bot smette di
// operare (i tick non fanno nulla) finché non viene ripreso dalla UI. Per-traccia.

export const DEFAULT_MAX_DD_PCT = 25;

export async function getKillSwitch(track: AutoTrack = "main"): Promise<{ paused: boolean; maxDdPct: number; peakEquity: number | null }> {
  const [paused, maxDd, peak] = await Promise.all([
    getMeta(mk(track, "autopilot_paused")),
    getMeta(mk(track, "autopilot_max_dd_pct")),
    getMeta(mk(track, "autopilot_peak_equity")),
  ]);
  return {
    paused: paused === "1",
    maxDdPct: maxDd ? Number(maxDd) : DEFAULT_MAX_DD_PCT,
    peakEquity: peak ? Number(peak) : null,
  };
}

/** Riprende dopo una pausa kill-switch: il picco riparte dall'equity attuale. */
export async function resumeAutopilot(track: AutoTrack = "main"): Promise<void> {
  await setMeta(mk(track, "autopilot_paused"), "0");
  const view = await getAutoState(undefined, track);
  await setMeta(mk(track, "autopilot_peak_equity"), String(view.equity || 0));
  await insertAutoLog(new Date().toISOString().slice(0, 19), "run", "▶ Ripresa manuale dopo pausa kill-switch: picco azzerato all'equity attuale.", track);
}

export async function setMaxDd(pct: number, track: AutoTrack = "main"): Promise<void> {
  await setMeta(mk(track, "autopilot_max_dd_pct"), String(Math.min(90, Math.max(5, pct))));
}

export async function runTick(track: AutoTrack = "main", force = false): Promise<{ ran: boolean; rebalanced: boolean }> {
  let state = await getAutoStateRow(track);
  if (!state) {
    // La traccia crypto NON si auto-avvia (parte solo su richiesta dell'utente).
    if (track === "crypto") return { ran: false, rebalanced: false };
    await startAutopilot();
    state = (await getAutoStateRow(track))!;
  }
  const runId = new Date().toISOString().slice(0, 19);
  const now = new Date().toISOString();

  const kill = await getKillSwitch(track);
  if (kill.paused && !force) {
    await log(runId, "decision", "⏸ Kill-switch attivo: nessuna operazione (riprendi dalla pagina Autopilot).", track);
    return { ran: false, rebalanced: false };
  }

  const stratInfo = await getAutopilotStrategy(track);
  const positions = await positionsMap(track);
  const currentPositions = { ...positions };

  let decision: { targets: Record<string, number>; steps: string[] };
  let priceOf: (t: string) => number;

  if (stratInfo.strategy === "rotation") {
    await log(runId, "run", `▶ Avvio ciclo (${stratInfo.label}): scarico SPY e quote…`, track);
    const cfg = stratInfo.rotation;
    const spy = await fetchCandles("SPY", 2);
    decision = rotationDecision(spy, cfg);
    const quoteList = [
      ...new Set([
        cfg.bull,
        ...(cfg.defensive !== "CASH" ? [cfg.defensive] : []),
        ...Object.keys(positions),
      ]),
    ];
    const prices = await fetchQuotes(quoteList);
    const spyLast = spy[spy.length - 1]?.close ?? 0;
    priceOf = (t) => prices[t] ?? (t === "SPY" ? spyLast : 0);
  } else if (stratInfo.strategy === "crypto_trend") {
    await log(runId, "run", `▶ Avvio ciclo (${stratInfo.label}): scarico BTC/ETH e quote…`, track);
    const cfg = stratInfo.crypto;
    const candlesArr = await Promise.all(cfg.assets.map((a) => fetchCandles(a, 2)));
    const candlesByAsset: Record<string, Candle[]> = {};
    cfg.assets.forEach((a, i) => { candlesByAsset[a] = candlesArr[i]; });
    decision = cryptoTrendDecision(candlesByAsset, cfg);
    const quoteList = [...new Set([...cfg.assets, ...Object.keys(positions)])];
    const prices = await fetchQuotes(quoteList);
    const lastClose: Record<string, number> = {};
    cfg.assets.forEach((a) => { lastClose[a] = candlesByAsset[a]?.[candlesByAsset[a].length - 1]?.close ?? 0; });
    priceOf = (t) => prices[t] ?? lastClose[t] ?? 0;
  } else {
    await log(runId, "run", "▶ Avvio ciclo: scarico i dati dell'universo ETF…", track);
    const candles = await fetchUniverseCandles(2);
    const prices = await fetchQuotes(AUTO_UNIVERSE);
    priceOf = (t) => prices[t] ?? candles[t]?.[candles[t].length - 1]?.close ?? 0;
    decision = computeStrategy(candles);
  }
  for (const s of decision.steps) await log(runId, "analysis", s, track);

  // Current month for monthly rebalance cadence.
  const month = now.slice(0, 7);

  // Trend-break guard: if a held asset is no longer selected AND fell out of the
  // top/trend, we exit it immediately (risk management) even mid-month.
  const heldOutOfTarget = Object.keys(positions).some((t) => !(t in decision.targets));
  // Rotation/crypto: a regime flip also shows up as a target we don't hold yet.
  const targetNotHeld = Object.keys(decision.targets).some((t) => !(t in positions));
  const isNewMonth = state.last_rebalance_month !== month;
  const firstRun = Object.keys(positions).length === 0 && state.last_rebalance_month == null;
  // Rotation e crypto_trend: cadenza giornaliera guidata dal regime (no mensile).
  const regimeDriven = stratInfo.strategy === "rotation" || stratInfo.strategy === "crypto_trend";
  const shouldRebalance = regimeDriven
    ? force || firstRun || heldOutOfTarget || targetNotHeld
    : force || firstRun || isNewMonth || heldOutOfTarget;

  let rebalanced = false;
  const tradeLines: string[] = [];
  if (shouldRebalance) {
    rebalanced = true;
    await log(
      runId,
      "decision",
      regimeDriven
        ? firstRun
          ? "Prima allocazione secondo il regime attuale."
          : "Cambio di regime: ruoto il portafoglio verso il nuovo target."
        : isNewMonth || firstRun
        ? "Ribilancio mensile programmato."
        : "Ribilancio anticipato: un asset in portafoglio non è più tra i target (rottura trend).",
      track
    );

    // Compute current equity (cash + positions marked to market).
    let invested = 0;
    for (const [t, p] of Object.entries(positions)) invested += p.shares * priceOf(t);
    const equity = state.cash + invested;

    let cash = state.cash;
    for (const [t, p] of Object.entries(positions)) {
      const px = priceOf(t);
      if (!(t in decision.targets)) {
        cash += p.shares * px;
        await upsertAutoPosition(t, 0, p.avgCost, track);
        delete currentPositions[t];
        await recordTrade(t, "SELL", p.shares, px, "Uscita: non più tra i target / rottura trend", track);
        await log(runId, "trade", `VENDO ${t} (${nameFor(t)}): ${p.shares.toFixed(2)} @ ${px.toFixed(2)}`, track);
        tradeLines.push(`🔴 VENDO ${p.shares.toFixed(2)} ${t} @ ${px.toFixed(2)}`);
      }
    }
    for (const [t, w] of Object.entries(decision.targets)) {
      const px = priceOf(t);
      if (px <= 0) continue;
      const targetVal = equity * w;
      const cur = currentPositions[t];
      const curVal = cur ? cur.shares * px : 0;
      const diffVal = targetVal - curVal;
      if (Math.abs(diffVal) < equity * 0.01) continue;
      const diffShares = diffVal / px;
      if (diffShares > 0) {
        cash -= diffShares * px;
        await upsertPosition(currentPositions, t, diffShares, px, track);
        await recordTrade(t, "BUY", diffShares, px, `Allocazione target — ${stratInfo.label}`, track);
        await log(runId, "trade", `COMPRO ${t} (${nameFor(t)}): ${diffShares.toFixed(2)} @ ${px.toFixed(2)} → peso ${Math.round(w * 100)}%`, track);
        tradeLines.push(`🟢 COMPRO ${diffShares.toFixed(2)} ${t} @ ${px.toFixed(2)} (peso ${Math.round(w * 100)}%)`);
      } else {
        cash += -diffShares * px;
        await upsertPosition(currentPositions, t, diffShares, px, track);
        await recordTrade(t, "SELL", -diffShares, px, "Riduzione verso peso target", track);
        tradeLines.push(`🔴 RIDUCO ${(-diffShares).toFixed(2)} ${t} @ ${px.toFixed(2)}`);
      }
    }
    cash = +cash.toFixed(2);
    await upsertAutoState({
      cash,
      initial_capital: state.initial_capital,
      started_at: state.started_at,
      last_run: now,
      last_rebalance_month: month,
    }, track);
    state = { ...state, cash, last_run: now, last_rebalance_month: month };
  } else {
    await log(runId, "decision", "Nessun ribilancio: allocazione invariata, aggiorno solo il valore.", track);
    await upsertAutoState({
      cash: state.cash,
      initial_capital: state.initial_capital,
      started_at: state.started_at,
      last_run: now,
      last_rebalance_month: state.last_rebalance_month,
    }, track);
    state = { ...state, last_run: now };
  }

  // Snapshot equity.
  const view = await getAutoState(priceOf, track);
  await upsertAutoEquity(now.slice(0, 10), +view.equity.toFixed(2), track);
  await log(runId, "run", `✔ Ciclo completato. Valore portafoglio: ${view.equity.toFixed(0)}$ (P&L ${view.totalPnl >= 0 ? "+" : ""}${view.totalPnl.toFixed(0)}$).`, track);

  // Notifica gli ordini eseguiti (no-op se Telegram non configurato).
  if (tradeLines.length > 0) {
    await sendTelegram(
      `🤖 <b>Autopilot — ${stratInfo.label}</b>\n${tradeLines.join("\n")}\n` +
      `Equity: $${view.equity.toFixed(0)} (P&L ${view.totalPnl >= 0 ? "+" : ""}${view.totalPnl.toFixed(0)}$)`
    );
  }

  // Kill-switch: pausa automatica se il drawdown dal picco supera la soglia.
  const peak = Math.max(kill.peakEquity ?? view.equity, view.equity);
  await setMeta(mk(track, "autopilot_peak_equity"), String(+peak.toFixed(2)));
  const ddPct = peak > 0 ? ((peak - view.equity) / peak) * 100 : 0;
  if (ddPct >= kill.maxDdPct && !kill.paused) {
    await setMeta(mk(track, "autopilot_paused"), "1");
    const msg = `⛔ Kill-switch: drawdown ${ddPct.toFixed(1)}% ≥ ${kill.maxDdPct}% dal picco ($${peak.toFixed(0)} → $${view.equity.toFixed(0)}). Autopilot in pausa: nessuna nuova operazione finché non riprendi dalla pagina.`;
    await log(runId, "decision", msg, track);
    await sendTelegram(`⛔ <b>Autopilot in pausa (kill-switch)</b>\n${msg}`);
  }

  return { ran: true, rebalanced };
}

async function recordTrade(ticker: string, action: string, shares: number, price: number, reason: string, track: AutoTrack): Promise<void> {
  await insertAutoTrade(ticker, action, +shares.toFixed(4), +price.toFixed(2), reason, track);
}

async function upsertPosition(
  positions: Record<string, { shares: number; avgCost: number }>,
  ticker: string,
  addShares: number,
  price: number,
  track: AutoTrack
): Promise<void> {
  const cur = positions[ticker];
  if (!cur) {
    const shares = +addShares.toFixed(6);
    await upsertAutoPosition(ticker, shares, price, track);
    positions[ticker] = { shares, avgCost: price };
    return;
  }
  const newShares = cur.shares + addShares;
  if (newShares <= 0.0000001) {
    await upsertAutoPosition(ticker, 0, cur.avgCost, track);
    delete positions[ticker];
    return;
  }
  // weighted avg cost only increases on buys
  const avg = addShares > 0 ? (cur.shares * cur.avgCost + addShares * price) / newShares : cur.avgCost;
  const shares = +newShares.toFixed(6);
  const avgCost = +avg.toFixed(2);
  await upsertAutoPosition(ticker, shares, avgCost, track);
  positions[ticker] = { shares, avgCost };
}

export async function getAutoState(priceOf?: (t: string) => number, track: AutoTrack = "main"): Promise<AutoStateView> {
  const state = await getAutoStateRow(track);
  if (!state) {
    return { running: false, cash: 0, initialCapital: 0, equity: 0, totalPnl: 0, totalPnlPct: 0, startedAt: null, lastRun: null, positions: [] };
  }
  const rows = await getAutoPositions(track);
  const positions: AutoPosition[] = rows.map((r) => {
    const price = (priceOf ? priceOf(r.ticker) : 0) || r.avg_cost;
    const value = r.shares * price;
    const cost = r.shares * r.avg_cost;
    return {
      ticker: r.ticker, name: nameFor(r.ticker), shares: +r.shares.toFixed(4),
      avgCost: +r.avg_cost.toFixed(2), price: +price.toFixed(2), value: +value.toFixed(2),
      pnl: +(value - cost).toFixed(2), pnlPct: cost > 0 ? +(((value - cost) / cost) * 100).toFixed(2) : 0,
      weight: 0,
    };
  });
  const invested = positions.reduce((s, p) => s + p.value, 0);
  const equity = state.cash + invested;
  for (const p of positions) p.weight = equity > 0 ? +((p.value / equity) * 100).toFixed(1) : 0;
  return {
    running: true,
    cash: +state.cash.toFixed(2),
    initialCapital: state.initial_capital,
    equity: +equity.toFixed(2),
    totalPnl: +(equity - state.initial_capital).toFixed(2),
    totalPnlPct: +(((equity - state.initial_capital) / state.initial_capital) * 100).toFixed(2),
    startedAt: state.started_at,
    lastRun: state.last_run,
    positions: positions.sort((a, b) => b.value - a.value),
  };
}

export async function getAutoLog(limit = 80, track: AutoTrack = "main"): Promise<AutoLogEntry[]> {
  const rows = await getDbAutoLog(limit, track);
  return rows.map((r) => ({ ts: r.ts, runId: r.run_id, kind: r.kind, message: r.message }));
}

export async function getAutoTrades(limit = 50, track: AutoTrack = "main"): Promise<AutoTrade[]> {
  const rows = await getDbAutoTrades(limit, track);
  return rows.map((r) => ({ ticker: r.ticker, action: r.action, shares: r.shares, price: r.price, executedAt: r.executed_at, reason: r.reason }));
}

export async function getAutoEquityCurve(track: AutoTrack = "main"): Promise<{ date: string; equity: number }[]> {
  const rows = await getAutoEquity(500, track);
  return rows.map((r) => ({ date: r.ts, equity: r.equity }));
}
