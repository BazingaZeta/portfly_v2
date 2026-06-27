import { db } from "./db";
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

export function getAutoStateRow(): StateRow | null {
  return (db().prepare(`SELECT * FROM auto_state WHERE id = 1`).get() as StateRow) ?? null;
}

export function startAutopilot(initialCapital = 10000): void {
  const now = new Date().toISOString();
  db().prepare(
    `INSERT INTO auto_state (id, cash, initial_capital, started_at, last_run, last_rebalance_month)
     VALUES (1, @cap, @cap, @now, NULL, NULL)
     ON CONFLICT(id) DO UPDATE SET cash=@cap, initial_capital=@cap, started_at=@now, last_run=NULL, last_rebalance_month=NULL`
  ).run({ cap: initialCapital, now });
  db().prepare(`DELETE FROM auto_positions`).run();
  db().prepare(`DELETE FROM auto_trades`).run();
  db().prepare(`DELETE FROM auto_log`).run();
  db().prepare(`DELETE FROM auto_equity`).run();
  log(now.slice(0, 19), "start", `Autopilot avviato con capitale virtuale ${initialCapital}$.`);
}

export function resetAutopilot(): void {
  db().prepare(`DELETE FROM auto_state`).run();
  db().prepare(`DELETE FROM auto_positions`).run();
  db().prepare(`DELETE FROM auto_trades`).run();
  db().prepare(`DELETE FROM auto_log`).run();
  db().prepare(`DELETE FROM auto_equity`).run();
}

function log(runId: string, kind: string, message: string): void {
  db().prepare(`INSERT INTO auto_log (ts, run_id, kind, message) VALUES (?, ?, ?, ?)`)
    .run(new Date().toISOString(), runId, kind, message);
}

function positionsMap(): Record<string, { shares: number; avgCost: number }> {
  const rows = db().prepare(`SELECT ticker, shares, avg_cost FROM auto_positions`).all() as {
    ticker: string; shares: number; avg_cost: number;
  }[];
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
  let state = getAutoStateRow();
  if (!state) {
    startAutopilot();
    state = getAutoStateRow()!;
  }
  const runId = new Date().toISOString().slice(0, 19);
  const now = new Date().toISOString();
  log(runId, "run", "▶ Avvio ciclo: scarico i dati dell'universo ETF…");

  const candles = await fetchUniverseCandles(2);
  const prices = await fetchQuotes(AUTO_UNIVERSE);
  const priceOf = (t: string) => prices[t] ?? candles[t]?.[candles[t].length - 1]?.close ?? 0;

  const decision = computeStrategy(candles);
  for (const s of decision.steps) log(runId, "analysis", s);

  // Current month for monthly rebalance cadence.
  const month = now.slice(0, 7);
  const positions = positionsMap();

  // Trend-break guard: if a held asset is no longer selected AND fell out of the
  // top/trend, we exit it immediately (risk management) even mid-month.
  const heldOutOfTarget = Object.keys(positions).some((t) => !(t in decision.targets));
  const isNewMonth = state.last_rebalance_month !== month;
  const firstRun = Object.keys(positions).length === 0 && state.last_rebalance_month == null;
  const shouldRebalance = force || firstRun || isNewMonth || heldOutOfTarget;

  let rebalanced = false;
  if (shouldRebalance) {
    rebalanced = true;
    log(runId, "decision", isNewMonth || firstRun ? "Ribilancio mensile programmato." : "Ribilancio anticipato: un asset in portafoglio non è più tra i target (rottura trend).");

    // Compute current equity (cash + positions marked to market).
    let invested = 0;
    for (const [t, p] of Object.entries(positions)) invested += p.shares * priceOf(t);
    const equity = state.cash + invested;

    const tx = db().transaction(() => {
      // 1) Sell everything not in the new target (full rebalance to target weights).
      let cash = state!.cash;
      for (const [t, p] of Object.entries(positions)) {
        const px = priceOf(t);
        if (!(t in decision.targets)) {
          cash += p.shares * px;
          db().prepare(`DELETE FROM auto_positions WHERE ticker = ?`).run(t);
          recordTrade(t, "SELL", p.shares, px, "Uscita: non più tra i target / rottura trend");
          log(runId, "trade", `VENDO ${t} (${AUTO_NAMES[t] ?? t}): ${p.shares.toFixed(2)} @ ${px.toFixed(2)}`);
        }
      }
      // 2) Compute target $ per asset and adjust holdings.
      for (const [t, w] of Object.entries(decision.targets)) {
        const px = priceOf(t);
        if (px <= 0) continue;
        const targetVal = equity * w;
        const cur = positionsMap()[t];
        const curVal = cur ? cur.shares * px : 0;
        const diffVal = targetVal - curVal;
        if (Math.abs(diffVal) < equity * 0.01) continue; // ignore <1% drift
        const diffShares = diffVal / px;
        if (diffShares > 0) {
          cash -= diffShares * px;
          upsertPosition(t, diffShares, px);
          recordTrade(t, "BUY", diffShares, px, "Allocazione target dual-momentum");
          log(runId, "trade", `COMPRO ${t} (${AUTO_NAMES[t] ?? t}): ${diffShares.toFixed(2)} @ ${px.toFixed(2)} → peso ${Math.round(w * 100)}%`);
        } else {
          cash += -diffShares * px;
          upsertPosition(t, diffShares, px);
          recordTrade(t, "SELL", -diffShares, px, "Riduzione verso peso target");
        }
      }
      db().prepare(`UPDATE auto_state SET cash = ?, last_run = ?, last_rebalance_month = ? WHERE id = 1`)
        .run(+cash.toFixed(2), now, month);
    });
    tx();
  } else {
    log(runId, "decision", "Nessun ribilancio: allocazione invariata, aggiorno solo il valore.");
    db().prepare(`UPDATE auto_state SET last_run = ? WHERE id = 1`).run(now);
  }

  // Snapshot equity.
  const view = getAutoState(priceOf);
  db().prepare(`INSERT INTO auto_equity (ts, equity) VALUES (?, ?) ON CONFLICT(ts) DO UPDATE SET equity = excluded.equity`)
    .run(now.slice(0, 10), +view.equity.toFixed(2));
  log(runId, "run", `✔ Ciclo completato. Valore portafoglio: ${view.equity.toFixed(0)}$ (P&L ${view.totalPnl >= 0 ? "+" : ""}${view.totalPnl.toFixed(0)}$).`);

  return { ran: true, rebalanced };
}

function recordTrade(ticker: string, action: string, shares: number, price: number, reason: string): void {
  db().prepare(`INSERT INTO auto_trades (ticker, action, shares, price, executed_at, reason) VALUES (?,?,?,?,?,?)`)
    .run(ticker, action, +shares.toFixed(4), +price.toFixed(2), new Date().toISOString(), reason);
}

function upsertPosition(ticker: string, addShares: number, price: number): void {
  const cur = db().prepare(`SELECT shares, avg_cost FROM auto_positions WHERE ticker = ?`).get(ticker) as
    | { shares: number; avg_cost: number } | undefined;
  if (!cur) {
    db().prepare(`INSERT INTO auto_positions (ticker, shares, avg_cost) VALUES (?,?,?)`).run(ticker, +addShares.toFixed(6), price);
    return;
  }
  const newShares = cur.shares + addShares;
  if (newShares <= 0.0000001) {
    db().prepare(`DELETE FROM auto_positions WHERE ticker = ?`).run(ticker);
    return;
  }
  // weighted avg cost only increases on buys
  const avg = addShares > 0 ? (cur.shares * cur.avg_cost + addShares * price) / newShares : cur.avg_cost;
  db().prepare(`UPDATE auto_positions SET shares = ?, avg_cost = ? WHERE ticker = ?`).run(+newShares.toFixed(6), +avg.toFixed(2), ticker);
}

export function getAutoState(priceOf?: (t: string) => number): AutoStateView {
  const state = getAutoStateRow();
  if (!state) {
    return { running: false, cash: 0, initialCapital: 0, equity: 0, totalPnl: 0, totalPnlPct: 0, startedAt: null, lastRun: null, positions: [] };
  }
  const rows = db().prepare(`SELECT ticker, shares, avg_cost FROM auto_positions`).all() as {
    ticker: string; shares: number; avg_cost: number;
  }[];
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

export function getAutoLog(limit = 80): AutoLogEntry[] {
  const rows = db().prepare(`SELECT ts, run_id, kind, message FROM auto_log ORDER BY id DESC LIMIT ?`).all(limit) as {
    ts: string; run_id: string; kind: string; message: string;
  }[];
  return rows.map((r) => ({ ts: r.ts, runId: r.run_id, kind: r.kind, message: r.message }));
}

export function getAutoTrades(limit = 50): AutoTrade[] {
  const rows = db().prepare(`SELECT ticker, action, shares, price, executed_at, reason FROM auto_trades ORDER BY id DESC LIMIT ?`).all(limit) as {
    ticker: string; action: string; shares: number; price: number; executed_at: string; reason: string | null;
  }[];
  return rows.map((r) => ({ ticker: r.ticker, action: r.action, shares: r.shares, price: r.price, executedAt: r.executed_at, reason: r.reason }));
}

export function getAutoEquityCurve(): { date: string; equity: number }[] {
  const rows = db().prepare(`SELECT ts, equity FROM auto_equity ORDER BY ts ASC`).all() as { ts: string; equity: number }[];
  return rows.map((r) => ({ date: r.ts, equity: r.equity }));
}
