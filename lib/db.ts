import { createClient, type Client } from "@libsql/client";
import type {
  Recommendation,
  Trade,
  IndexTrade,
  SignalReason,
  NewsItem,
  Indicators,
} from "./types";

// ─── Client singleton ─────────────────────────────────────────────────────────

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL non configurata");
  _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return _client;
}

// ─── Schema init (runs once per process) ─────────────────────────────────────

let _ready: Promise<Client> | null = null;

export async function db(): Promise<Client> {
  if (_ready) return _ready;
  _ready = (async () => {
    const client = getClient();
    await client.batch(
      [
        `CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS recommendations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scan_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          ticker TEXT NOT NULL,
          name TEXT NOT NULL,
          action TEXT NOT NULL,
          score REAL NOT NULL,
          price REAL NOT NULL,
          target REAL NOT NULL,
          stop REAL NOT NULL,
          reasons TEXT NOT NULL,
          news_sentiment REAL NOT NULL,
          news TEXT NOT NULL,
          indicators TEXT NOT NULL,
          earnings_date TEXT,
          earnings_days REAL,
          spark TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recommendation_id INTEGER,
          ticker TEXT NOT NULL,
          action TEXT NOT NULL,
          shares REAL NOT NULL,
          price REAL NOT NULL,
          executed_at TEXT NOT NULL,
          status TEXT NOT NULL,
          notes TEXT,
          closes_trade_id INTEGER,
          realized_pnl REAL,
          target REAL,
          stop REAL,
          profile TEXT,
          user_id INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS idx_rec_scan_date ON recommendations(scan_date)`,
        `CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker)`,
        `CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS index_trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          index_key TEXT NOT NULL,
          ticker TEXT NOT NULL,
          name TEXT NOT NULL,
          action TEXT NOT NULL,
          shares REAL NOT NULL,
          price REAL NOT NULL,
          executed_at TEXT NOT NULL,
          status TEXT NOT NULL,
          notes TEXT,
          target REAL,
          stop REAL,
          realized_pnl REAL,
          user_id INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS idx_index_trades_ticker ON index_trades(ticker)`,
        `CREATE TABLE IF NOT EXISTS auto_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          cash REAL NOT NULL,
          initial_capital REAL NOT NULL,
          started_at TEXT NOT NULL,
          last_run TEXT,
          last_rebalance_month TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS auto_positions (
          ticker TEXT PRIMARY KEY,
          shares REAL NOT NULL,
          avg_cost REAL NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS auto_trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticker TEXT NOT NULL,
          action TEXT NOT NULL,
          shares REAL NOT NULL,
          price REAL NOT NULL,
          executed_at TEXT NOT NULL,
          reason TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS auto_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          run_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          message TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS auto_equity (
          ts TEXT PRIMARY KEY,
          equity REAL NOT NULL
        )`,
      ].map((sql) => ({ sql })),
      "write"
    );
    return client;
  })();
  return _ready;
}

// ─── Row helpers ──────────────────────────────────────────────────────────────

function n(v: unknown): number { return Number(v ?? 0); }
function s(v: unknown): string { return String(v ?? ""); }
function sn(v: unknown): string | null { return v == null ? null : String(v); }
function nn(v: unknown): number | null { return v == null ? null : Number(v); }

// ─── Recommendations ──────────────────────────────────────────────────────────

type RecRow = {
  id: number; scan_date: string; created_at: string; ticker: string; name: string;
  action: string; score: number; price: number; target: number; stop: number;
  reasons: string; news_sentiment: number; news: string; indicators: string;
  earnings_date: string | null; earnings_days: number | null; spark: string | null;
};

function rowToRec(r: RecRow): Recommendation {
  return {
    id: r.id, scanDate: r.scan_date, createdAt: r.created_at, ticker: r.ticker,
    name: r.name, action: r.action as Recommendation["action"], score: r.score,
    price: r.price, target: r.target, stop: r.stop,
    reasons: JSON.parse(r.reasons) as SignalReason[],
    newsSentiment: r.news_sentiment, news: JSON.parse(r.news) as NewsItem[],
    indicators: JSON.parse(r.indicators) as Indicators,
    earningsDate: r.earnings_date ?? null, earningsDays: r.earnings_days ?? null,
    spark: r.spark ? (JSON.parse(r.spark) as number[]) : [],
  };
}

function toRecRow(r: Record<string, unknown>): RecRow {
  return {
    id: n(r.id), scan_date: s(r.scan_date), created_at: s(r.created_at),
    ticker: s(r.ticker), name: s(r.name), action: s(r.action),
    score: n(r.score), price: n(r.price), target: n(r.target), stop: n(r.stop),
    reasons: s(r.reasons), news_sentiment: n(r.news_sentiment), news: s(r.news),
    indicators: s(r.indicators), earnings_date: sn(r.earnings_date),
    earnings_days: nn(r.earnings_days), spark: sn(r.spark),
  };
}

export async function insertRecommendations(recs: Omit<Recommendation, "id">[]): Promise<void> {
  const client = await db();
  await client.batch(
    recs.map((rec) => ({
      sql: `INSERT INTO recommendations
        (scan_date,created_at,ticker,name,action,score,price,target,stop,reasons,news_sentiment,news,indicators,earnings_date,earnings_days,spark)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        rec.scanDate, rec.createdAt, rec.ticker, rec.name, rec.action,
        rec.score, rec.price, rec.target, rec.stop,
        JSON.stringify(rec.reasons), rec.newsSentiment, JSON.stringify(rec.news),
        JSON.stringify(rec.indicators), rec.earningsDate ?? null,
        rec.earningsDays ?? null, JSON.stringify(rec.spark ?? []),
      ],
    })),
    "write"
  );
}

export async function deleteRecommendationsForDate(scanDate: string): Promise<void> {
  const client = await db();
  await client.batch([
    { sql: `UPDATE trades SET recommendation_id = NULL WHERE recommendation_id IN (SELECT id FROM recommendations WHERE scan_date = ?)`, args: [scanDate] },
    { sql: `DELETE FROM recommendations WHERE scan_date = ?`, args: [scanDate] },
  ], "write");
}

export async function getRecommendationsByDate(scanDate: string): Promise<Recommendation[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM recommendations WHERE scan_date = ? ORDER BY score DESC`, args: [scanDate] });
  return r.rows.map((row) => rowToRec(toRecRow(row as Record<string, unknown>)));
}

export async function getLatestScanDate(): Promise<string | null> {
  const client = await db();
  const r = await client.execute(`SELECT scan_date FROM recommendations ORDER BY scan_date DESC LIMIT 1`);
  return r.rows.length ? s(r.rows[0].scan_date) : null;
}

export async function getAllRecentRecommendations(limit = 200): Promise<Recommendation[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM recommendations ORDER BY created_at DESC LIMIT ?`, args: [limit] });
  return r.rows.map((row) => rowToRec(toRecRow(row as Record<string, unknown>)));
}

export async function getRecommendationById(id: number): Promise<Recommendation | null> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM recommendations WHERE id = ?`, args: [id] });
  return r.rows.length ? rowToRec(toRecRow(r.rows[0] as Record<string, unknown>)) : null;
}

// ─── Trades ───────────────────────────────────────────────────────────────────

function toTradeRow(r: Record<string, unknown>): Trade {
  return {
    id: n(r.id), recommendationId: nn(r.recommendation_id),
    ticker: s(r.ticker), action: s(r.action) as Trade["action"],
    shares: n(r.shares), price: n(r.price), executedAt: s(r.executed_at),
    status: s(r.status) as Trade["status"], notes: sn(r.notes),
    closesTradeId: nn(r.closes_trade_id), realizedPnl: nn(r.realized_pnl),
    target: nn(r.target), stop: nn(r.stop),
  };
}

export async function insertTrade(t: Omit<Trade, "id">, userId: number): Promise<Trade> {
  const client = await db();
  const r = await client.execute({
    sql: `INSERT INTO trades (recommendation_id,ticker,action,shares,price,executed_at,status,notes,closes_trade_id,realized_pnl,target,stop,user_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [t.recommendationId ?? null, t.ticker, t.action, t.shares, t.price,
           t.executedAt, t.status, t.notes ?? null, t.closesTradeId ?? null,
           t.realizedPnl ?? null, t.target ?? null, t.stop ?? null, userId],
  });
  return { ...t, id: Number(r.lastInsertRowid) };
}

export async function getSellTrades(userId: number): Promise<Trade[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM trades WHERE action='SELL' AND user_id=? ORDER BY executed_at DESC`, args: [userId] });
  return r.rows.map((row) => toTradeRow(row as Record<string, unknown>));
}

export async function getAllTrades(userId: number): Promise<Trade[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM trades WHERE user_id=? ORDER BY executed_at DESC`, args: [userId] });
  return r.rows.map((row) => toTradeRow(row as Record<string, unknown>));
}

export async function getOpenBuyTrades(userId: number): Promise<Trade[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM trades WHERE action='BUY' AND status='open' AND user_id=? ORDER BY executed_at ASC`, args: [userId] });
  return r.rows.map((row) => toTradeRow(row as Record<string, unknown>));
}

export async function markTradeClosed(id: number): Promise<void> {
  const client = await db();
  await client.execute({ sql: `UPDATE trades SET status='closed' WHERE id=?`, args: [id] });
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

export async function getMeta(key: string): Promise<string | null> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT value FROM meta WHERE key=?`, args: [key] });
  return r.rows.length ? s(r.rows[0].value) : null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: `INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, args: [key, value] });
}

// ─── Index Trader ─────────────────────────────────────────────────────────────

function toIndexTradeRow(r: Record<string, unknown>): IndexTrade {
  return {
    id: n(r.id), indexKey: s(r.index_key), ticker: s(r.ticker), name: s(r.name),
    action: s(r.action) as IndexTrade["action"], shares: n(r.shares), price: n(r.price),
    executedAt: s(r.executed_at), status: s(r.status) as IndexTrade["status"],
    notes: sn(r.notes), target: nn(r.target), stop: nn(r.stop), realizedPnl: nn(r.realized_pnl),
  };
}

export async function insertIndexTrade(t: Omit<IndexTrade, "id">, userId: number): Promise<IndexTrade> {
  const client = await db();
  const r = await client.execute({
    sql: `INSERT INTO index_trades (index_key,ticker,name,action,shares,price,executed_at,status,notes,target,stop,realized_pnl,user_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [t.indexKey, t.ticker, t.name, t.action, t.shares, t.price,
           t.executedAt, t.status, t.notes ?? null, t.target ?? null,
           t.stop ?? null, t.realizedPnl ?? null, userId],
  });
  return { ...t, id: Number(r.lastInsertRowid) };
}

export async function getIndexTrades(userId: number): Promise<IndexTrade[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM index_trades WHERE user_id=? ORDER BY executed_at DESC`, args: [userId] });
  return r.rows.map((row) => toIndexTradeRow(row as Record<string, unknown>));
}

export async function getOpenIndexBuys(userId: number): Promise<IndexTrade[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM index_trades WHERE action='BUY' AND status='open' AND user_id=? ORDER BY executed_at ASC`, args: [userId] });
  return r.rows.map((row) => toIndexTradeRow(row as Record<string, unknown>));
}

export async function markIndexTradeClosed(id: number): Promise<void> {
  const client = await db();
  await client.execute({ sql: `UPDATE index_trades SET status='closed' WHERE id=?`, args: [id] });
}

// ─── Momentum RS ──────────────────────────────────────────────────────────────

export async function getMomentumTrades(userId: number): Promise<IndexTrade[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM index_trades WHERE index_key LIKE 'MOMENTUM_%' AND user_id=? ORDER BY executed_at DESC`, args: [userId] });
  return r.rows.map((row) => toIndexTradeRow(row as Record<string, unknown>));
}

export async function getOpenMomentumBuys(userId: number): Promise<IndexTrade[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM index_trades WHERE action='BUY' AND status='open' AND index_key LIKE 'MOMENTUM_%' AND user_id=? ORDER BY executed_at ASC`, args: [userId] });
  return r.rows.map((row) => toIndexTradeRow(row as Record<string, unknown>));
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface UserRow { id: number; email: string; name: string; password_hash: string; created_at: string; }

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM users WHERE email=?`, args: [email] });
  if (!r.rows.length) return null;
  const row = r.rows[0] as Record<string, unknown>;
  return { id: n(row.id), email: s(row.email), name: s(row.name), password_hash: s(row.password_hash), created_at: s(row.created_at) };
}

export async function createUser(email: string, name: string, passwordHash: string): Promise<UserRow> {
  const client = await db();
  const createdAt = new Date().toISOString();
  const r = await client.execute({ sql: `INSERT INTO users (email,name,password_hash,created_at) VALUES (?,?,?,?)`, args: [email, name, passwordHash, createdAt] });
  return { id: Number(r.lastInsertRowid), email, name, password_hash: passwordHash, created_at: createdAt };
}

// ─── Autopilot ────────────────────────────────────────────────────────────────

export interface AutoState { id: number; cash: number; initial_capital: number; started_at: string; last_run: string | null; last_rebalance_month: string | null; }
export interface AutoPosition { ticker: string; shares: number; avg_cost: number; }
export interface AutoTrade { id: number; ticker: string; action: string; shares: number; price: number; executed_at: string; reason: string | null; }
export interface AutoLog { id: number; ts: string; run_id: string; kind: string; message: string; }
export interface AutoEquity { ts: string; equity: number; }

export async function getAutoState(): Promise<AutoState | null> {
  const client = await db();
  const r = await client.execute(`SELECT * FROM auto_state WHERE id=1`);
  if (!r.rows.length) return null;
  const row = r.rows[0] as Record<string, unknown>;
  return { id: 1, cash: n(row.cash), initial_capital: n(row.initial_capital), started_at: s(row.started_at), last_run: sn(row.last_run), last_rebalance_month: sn(row.last_rebalance_month) };
}

export async function upsertAutoState(state: Omit<AutoState, "id">): Promise<void> {
  const client = await db();
  await client.execute({ sql: `INSERT INTO auto_state (id,cash,initial_capital,started_at,last_run,last_rebalance_month) VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET cash=excluded.cash,last_run=excluded.last_run,last_rebalance_month=excluded.last_rebalance_month`, args: [state.cash, state.initial_capital, state.started_at, state.last_run ?? null, state.last_rebalance_month ?? null] });
}

export async function resetAutoState(): Promise<void> {
  const client = await db();
  await client.batch([
    { sql: `DELETE FROM auto_state` },
    { sql: `DELETE FROM auto_positions` },
    { sql: `DELETE FROM auto_trades` },
    { sql: `DELETE FROM auto_log` },
    { sql: `DELETE FROM auto_equity` },
  ], "write");
}

export async function getAutoPositions(): Promise<AutoPosition[]> {
  const client = await db();
  const r = await client.execute(`SELECT * FROM auto_positions`);
  return r.rows.map((row) => { const ro = row as Record<string, unknown>; return { ticker: s(ro.ticker), shares: n(ro.shares), avg_cost: n(ro.avg_cost) }; });
}

export async function upsertAutoPosition(ticker: string, shares: number, avgCost: number): Promise<void> {
  const client = await db();
  if (shares <= 0) {
    await client.execute({ sql: `DELETE FROM auto_positions WHERE ticker=?`, args: [ticker] });
  } else {
    await client.execute({ sql: `INSERT INTO auto_positions (ticker,shares,avg_cost) VALUES (?,?,?) ON CONFLICT(ticker) DO UPDATE SET shares=excluded.shares,avg_cost=excluded.avg_cost`, args: [ticker, shares, avgCost] });
  }
}

export async function insertAutoTrade(ticker: string, action: string, shares: number, price: number, reason: string | null): Promise<void> {
  const client = await db();
  await client.execute({ sql: `INSERT INTO auto_trades (ticker,action,shares,price,executed_at,reason) VALUES (?,?,?,?,?,?)`, args: [ticker, action, shares, price, new Date().toISOString(), reason ?? null] });
}

export async function getAutoTrades(limit = 100): Promise<AutoTrade[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM auto_trades ORDER BY executed_at DESC LIMIT ?`, args: [limit] });
  return r.rows.map((row) => { const ro = row as Record<string, unknown>; return { id: n(ro.id), ticker: s(ro.ticker), action: s(ro.action), shares: n(ro.shares), price: n(ro.price), executed_at: s(ro.executed_at), reason: sn(ro.reason) }; });
}

export async function insertAutoLog(runId: string, kind: string, message: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: `INSERT INTO auto_log (ts,run_id,kind,message) VALUES (?,?,?,?)`, args: [new Date().toISOString(), runId, kind, message] });
}

export async function getAutoLog(limit = 200): Promise<AutoLog[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM auto_log ORDER BY ts DESC LIMIT ?`, args: [limit] });
  return r.rows.map((row) => { const ro = row as Record<string, unknown>; return { id: n(ro.id), ts: s(ro.ts), run_id: s(ro.run_id), kind: s(ro.kind), message: s(ro.message) }; });
}

export async function upsertAutoEquity(ts: string, equity: number): Promise<void> {
  const client = await db();
  await client.execute({ sql: `INSERT INTO auto_equity (ts,equity) VALUES (?,?) ON CONFLICT(ts) DO UPDATE SET equity=excluded.equity`, args: [ts, equity] });
}

export async function getAutoEquity(limit = 500): Promise<AutoEquity[]> {
  const client = await db();
  const r = await client.execute({ sql: `SELECT * FROM auto_equity ORDER BY ts ASC LIMIT ?`, args: [limit] });
  return r.rows.map((row) => { const ro = row as Record<string, unknown>; return { ts: s(ro.ts), equity: n(ro.equity) }; });
}
