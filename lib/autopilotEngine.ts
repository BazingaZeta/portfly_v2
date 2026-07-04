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
} from "./db";
import { computeStrategy, fetchUniverseCandles, AUTO_UNIVERSE, AUTO_NAMES } from "./autopilot";
import { fetchQuotes } from "./marketData";

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

export async function getAutoStateRow(): Promise<StateRow | null> {
  const state = await getDbAutoState();
  if (!state) return null;
  return {
    cash: state.cash,
    initial_capital: state.initial_capital,
    started_at: state.started_at,
    last_run: state.last_run,
    last_rebalance_month: state.last_rebalance_month,
  };
}

export async function startAutopilot(initialCapital = 10000): Promise<void> {
  const now = new Date().toISOString();
  await resetDbAutoState();
  await upsertAutoState({
    cash: initialCapital,
    initial_capital: initialCapital,
    started_at: now,
    last_run: null,
    last_rebalance_month: null,
  });
  await log(now.slice(0, 19), "start", `Autopilot avviato con capitale virtuale ${initialCapital}$.`);
}

export async function resetAutopilot(): Promise<void> {
  await resetDbAutoState();
}

async function log(runId: string, kind: string, message: string): Promise<void> {
  await insertAutoLog(runId, kind, message);
}

async function positionsMap(): Promise<Record<string, { shares: number; avgCost: number }>> {
  const rows = await getAutoPositions();
  const m: Record<string, { shares: number; avgCost: number }> = {};
  for (const r of rows) m[r.ticker] = { shares: r.shares, avgCost: r.avg_cost };
  return m;
}

/**
 * Run one autonomous cycle: fetch data, decide the target allocation, and (if it's
 * a rebalance moment or a trend broke) trade the paper account toward the target.
 * Everything is logged transparently. No real orders are ever placed.
 */
export async function runTick(force = false): Promise<{ ran: boolean; rebalanced: boolean }> {
  let state = await getAutoStateRow();
  if (!state) {
    await startAutopilot();
    state = (await getAutoStateRow())!;
  }
  const runId = new Date().toISOString().slice(0, 19);
  const now = new Date().toISOString();
  await log(runId, "run", "▶ Avvio ciclo: scarico i dati dell'universo ETF…");

  const candles = await fetchUniverseCandles(2);
  const prices = await fetchQuotes(AUTO_UNIVERSE);
  const priceOf = (t: string) => prices[t] ?? candles[t]?.[candles[t].length - 1]?.close ?? 0;

  const decision = computeStrategy(candles);
  for (const s of decision.steps) await log(runId, "analysis", s);

  // Current month for monthly rebalance cadence.
  const month = now.slice(0, 7);
  const positions = await positionsMap();
  const currentPositions = { ...positions };

  // Trend-break guard: if a held asset is no longer selected AND fell out of the
  // top/trend, we exit it immediately (risk management) even mid-month.
  const heldOutOfTarget = Object.keys(positions).some((t) => !(t in decision.targets));
  const isNewMonth = state.last_rebalance_month !== month;
  const firstRun = Object.keys(positions).length === 0 && state.last_rebalance_month == null;
  const shouldRebalance = force || firstRun || isNewMonth || heldOutOfTarget;

  let rebalanced = false;
  if (shouldRebalance) {
    rebalanced = true;
    await log(runId, "decision", isNewMonth || firstRun ? "Ribilancio mensile programmato." : "Ribilancio anticipato: un asset in portafoglio non è più tra i target (rottura trend).");

    // Compute current equity (cash + positions marked to market).
    let invested = 0;
    for (const [t, p] of Object.entries(positions)) invested += p.shares * priceOf(t);
    const equity = state.cash + invested;

    let cash = state.cash;
    for (const [t, p] of Object.entries(positions)) {
      const px = priceOf(t);
      if (!(t in decision.targets)) {
        cash += p.shares * px;
        await upsertAutoPosition(t, 0, p.avgCost);
        delete currentPositions[t];
        await recordTrade(t, "SELL", p.shares, px, "Uscita: non più tra i target / rottura trend");
        await log(runId, "trade", `VENDO ${t} (${AUTO_NAMES[t] ?? t}): ${p.shares.toFixed(2)} @ ${px.toFixed(2)}`);
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
        await upsertPosition(currentPositions, t, diffShares, px);
        await recordTrade(t, "BUY", diffShares, px, "Allocazione target dual-momentum");
        await log(runId, "trade", `COMPRO ${t} (${AUTO_NAMES[t] ?? t}): ${diffShares.toFixed(2)} @ ${px.toFixed(2)} → peso ${Math.round(w * 100)}%`);
      } else {
        cash += -diffShares * px;
        await upsertPosition(currentPositions, t, diffShares, px);
        await recordTrade(t, "SELL", -diffShares, px, "Riduzione verso peso target");
      }
    }
    cash = +cash.toFixed(2);
    await upsertAutoState({
      cash,
      initial_capital: state.initial_capital,
      started_at: state.started_at,
      last_run: now,
      last_rebalance_month: month,
    });
    state = { ...state, cash, last_run: now, last_rebalance_month: month };
  } else {
    await log(runId, "decision", "Nessun ribilancio: allocazione invariata, aggiorno solo il valore.");
    await upsertAutoState({
      cash: state.cash,
      initial_capital: state.initial_capital,
      started_at: state.started_at,
      last_run: now,
      last_rebalance_month: state.last_rebalance_month,
    });
    state = { ...state, last_run: now };
  }

  // Snapshot equity.
  const view = await getAutoState(priceOf);
  await upsertAutoEquity(now.slice(0, 10), +view.equity.toFixed(2));
  await log(runId, "run", `✔ Ciclo completato. Valore portafoglio: ${view.equity.toFixed(0)}$ (P&L ${view.totalPnl >= 0 ? "+" : ""}${view.totalPnl.toFixed(0)}$).`);

  return { ran: true, rebalanced };
}

async function recordTrade(ticker: string, action: string, shares: number, price: number, reason: string): Promise<void> {
  await insertAutoTrade(ticker, action, +shares.toFixed(4), +price.toFixed(2), reason);
}

async function upsertPosition(
  positions: Record<string, { shares: number; avgCost: number }>,
  ticker: string,
  addShares: number,
  price: number
): Promise<void> {
  const cur = positions[ticker];
  if (!cur) {
    const shares = +addShares.toFixed(6);
    await upsertAutoPosition(ticker, shares, price);
    positions[ticker] = { shares, avgCost: price };
    return;
  }
  const newShares = cur.shares + addShares;
  if (newShares <= 0.0000001) {
    await upsertAutoPosition(ticker, 0, cur.avgCost);
    delete positions[ticker];
    return;
  }
  // weighted avg cost only increases on buys
  const avg = addShares > 0 ? (cur.shares * cur.avgCost + addShares * price) / newShares : cur.avgCost;
  const shares = +newShares.toFixed(6);
  const avgCost = +avg.toFixed(2);
  await upsertAutoPosition(ticker, shares, avgCost);
  positions[ticker] = { shares, avgCost };
}

export async function getAutoState(priceOf?: (t: string) => number): Promise<AutoStateView> {
  const state = await getAutoStateRow();
  if (!state) {
    return { running: false, cash: 0, initialCapital: 0, equity: 0, totalPnl: 0, totalPnlPct: 0, startedAt: null, lastRun: null, positions: [] };
  }
  const rows = await getAutoPositions();
  const positions: AutoPosition[] = rows.map((r) => {
    const price = (priceOf ? priceOf(r.ticker) : 0) || r.avg_cost;
    const value = r.shares * price;
    const cost = r.shares * r.avg_cost;
    return {
      ticker: r.ticker, name: AUTO_NAMES[r.ticker] ?? r.ticker, shares: +r.shares.toFixed(4),
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

export async function getAutoLog(limit = 80): Promise<AutoLogEntry[]> {
  const rows = await getDbAutoLog(limit);
  return rows.map((r) => ({ ts: r.ts, runId: r.run_id, kind: r.kind, message: r.message }));
}

export async function getAutoTrades(limit = 50): Promise<AutoTrade[]> {
  const rows = await getDbAutoTrades(limit);
  return rows.map((r) => ({ ticker: r.ticker, action: r.action, shares: r.shares, price: r.price, executedAt: r.executed_at, reason: r.reason }));
}

export async function getAutoEquityCurve(): Promise<{ date: string; equity: number }[]> {
  const rows = await getAutoEquity();
  return rows.map((r) => ({ date: r.ts, equity: r.equity }));
}
