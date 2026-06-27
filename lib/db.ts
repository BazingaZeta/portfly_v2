import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type {
  Recommendation,
  Trade,
  IndexTrade,
  SignalReason,
  NewsItem,
  Indicators,
} from "./types";

// Single shared connection. The DB file lives in ./data at the project root.
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "finance-bot.db");

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const database = new Database(DB_PATH);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recommendations (
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
      reasons TEXT NOT NULL,        -- JSON SignalReason[]
      news_sentiment REAL NOT NULL,
      news TEXT NOT NULL,           -- JSON NewsItem[]
      indicators TEXT NOT NULL      -- JSON Indicators
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recommendation_id INTEGER,
      ticker TEXT NOT NULL,
      action TEXT NOT NULL,         -- BUY | SELL
      shares REAL NOT NULL,
      price REAL NOT NULL,
      executed_at TEXT NOT NULL,
      status TEXT NOT NULL,         -- open | closed
      notes TEXT,
      closes_trade_id INTEGER,
      FOREIGN KEY (recommendation_id) REFERENCES recommendations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rec_scan_date ON recommendations(scan_date);
    CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Isolated tracking for the Index Trader section.
    CREATE TABLE IF NOT EXISTS index_trades (
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
      realized_pnl REAL
    );
    CREATE INDEX IF NOT EXISTS idx_index_trades_ticker ON index_trades(ticker);

    -- Autopilot (isolated autonomous paper-trading engine) --
    CREATE TABLE IF NOT EXISTS auto_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cash REAL NOT NULL,
      initial_capital REAL NOT NULL,
      started_at TEXT NOT NULL,
      last_run TEXT,
      last_rebalance_month TEXT
    );
    CREATE TABLE IF NOT EXISTS auto_positions (
      ticker TEXT PRIMARY KEY,
      shares REAL NOT NULL,
      avg_cost REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auto_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      action TEXT NOT NULL,
      shares REAL NOT NULL,
      price REAL NOT NULL,
      executed_at TEXT NOT NULL,
      reason TEXT
    );
    CREATE TABLE IF NOT EXISTS auto_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auto_equity (
      ts TEXT PRIMARY KEY,
      equity REAL NOT NULL
    );
  `);

  // Migration: add realized_pnl to trades if missing.
  const tradeCols = database.prepare(`PRAGMA table_info(trades)`).all() as {
    name: string;
  }[];
  if (!tradeCols.some((c) => c.name === "realized_pnl")) {
    database.exec(`ALTER TABLE trades ADD COLUMN realized_pnl REAL`);
  }
  if (!tradeCols.some((c) => c.name === "target")) {
    database.exec(`ALTER TABLE trades ADD COLUMN target REAL`);
  }
  if (!tradeCols.some((c) => c.name === "stop")) {
    database.exec(`ALTER TABLE trades ADD COLUMN stop REAL`);
  }
  if (!tradeCols.some((c) => c.name === "profile")) {
    database.exec(`ALTER TABLE trades ADD COLUMN profile TEXT`);
    // Existing trades belong to the default profile.
    database.exec(`UPDATE trades SET profile = 'Edo' WHERE profile IS NULL`);
  }

  // Migration: add user_id to trades (replacing the old profile text field).
  if (!tradeCols.some((c) => c.name === "user_id")) {
    database.exec(`ALTER TABLE trades ADD COLUMN user_id INTEGER`);
  }

  // Migration: add user_id to index_trades.
  const idxCols = database.prepare(`PRAGMA table_info(index_trades)`).all() as {
    name: string;
  }[];
  if (!idxCols.some((c) => c.name === "user_id")) {
    database.exec(`ALTER TABLE index_trades ADD COLUMN user_id INTEGER`);
  }

  // Migration: add earnings columns to recommendations if missing.
  const recCols = database.prepare(`PRAGMA table_info(recommendations)`).all() as {
    name: string;
  }[];
  if (!recCols.some((c) => c.name === "earnings_date")) {
    database.exec(`ALTER TABLE recommendations ADD COLUMN earnings_date TEXT`);
  }
  if (!recCols.some((c) => c.name === "earnings_days")) {
    database.exec(`ALTER TABLE recommendations ADD COLUMN earnings_days REAL`);
  }
  if (!recCols.some((c) => c.name === "spark")) {
    database.exec(`ALTER TABLE recommendations ADD COLUMN spark TEXT`);
  }

  _db = database;
  return _db;
}

// ---- Recommendations ----

type RecRow = {
  id: number;
  scan_date: string;
  created_at: string;
  ticker: string;
  name: string;
  action: string;
  score: number;
  price: number;
  target: number;
  stop: number;
  reasons: string;
  news_sentiment: number;
  news: string;
  indicators: string;
  earnings_date: string | null;
  earnings_days: number | null;
  spark: string | null;
};

function rowToRec(r: RecRow): Recommendation {
  return {
    id: r.id,
    scanDate: r.scan_date,
    createdAt: r.created_at,
    ticker: r.ticker,
    name: r.name,
    action: r.action as Recommendation["action"],
    score: r.score,
    price: r.price,
    target: r.target,
    stop: r.stop,
    reasons: JSON.parse(r.reasons) as SignalReason[],
    newsSentiment: r.news_sentiment,
    news: JSON.parse(r.news) as NewsItem[],
    indicators: JSON.parse(r.indicators) as Indicators,
    earningsDate: r.earnings_date ?? null,
    earningsDays: r.earnings_days ?? null,
    spark: r.spark ? (JSON.parse(r.spark) as number[]) : [],
  };
}

export function insertRecommendations(
  recs: Omit<Recommendation, "id">[]
): void {
  const stmt = db().prepare(`
    INSERT INTO recommendations
      (scan_date, created_at, ticker, name, action, score, price, target, stop, reasons, news_sentiment, news, indicators, earnings_date, earnings_days, spark)
    VALUES
      (@scanDate, @createdAt, @ticker, @name, @action, @score, @price, @target, @stop, @reasons, @newsSentiment, @news, @indicators, @earningsDate, @earningsDays, @spark)
  `);
  const tx = db().transaction((items: Omit<Recommendation, "id">[]) => {
    for (const rec of items) {
      stmt.run({
        scanDate: rec.scanDate,
        createdAt: rec.createdAt,
        ticker: rec.ticker,
        name: rec.name,
        action: rec.action,
        score: rec.score,
        price: rec.price,
        target: rec.target,
        stop: rec.stop,
        reasons: JSON.stringify(rec.reasons),
        newsSentiment: rec.newsSentiment,
        news: JSON.stringify(rec.news),
        indicators: JSON.stringify(rec.indicators),
        earningsDate: rec.earningsDate ?? null,
        earningsDays: rec.earningsDays ?? null,
        spark: JSON.stringify(rec.spark ?? []),
      });
    }
  });
  tx(recs);
}

/** Delete recommendations for a given scan date (so re-scans replace, not duplicate). */
export function deleteRecommendationsForDate(scanDate: string): void {
  const database = db();
  const tx = database.transaction((d: string) => {
    // Detach any trades that referenced these recs (target/stop are snapshotted
    // on the trade itself, so nothing is lost) to avoid FK violations.
    database
      .prepare(
        `UPDATE trades SET recommendation_id = NULL
         WHERE recommendation_id IN (SELECT id FROM recommendations WHERE scan_date = ?)`
      )
      .run(d);
    database.prepare(`DELETE FROM recommendations WHERE scan_date = ?`).run(d);
  });
  tx(scanDate);
}

export function getRecommendationsByDate(scanDate: string): Recommendation[] {
  const rows = db()
    .prepare(
      `SELECT * FROM recommendations WHERE scan_date = ? ORDER BY score DESC`
    )
    .all(scanDate) as RecRow[];
  return rows.map(rowToRec);
}

export function getLatestScanDate(): string | null {
  const row = db()
    .prepare(`SELECT scan_date FROM recommendations ORDER BY scan_date DESC LIMIT 1`)
    .get() as { scan_date: string } | undefined;
  return row?.scan_date ?? null;
}

export function getAllRecentRecommendations(limit = 200): Recommendation[] {
  const rows = db()
    .prepare(`SELECT * FROM recommendations ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as RecRow[];
  return rows.map(rowToRec);
}

export function getRecommendationById(id: number): Recommendation | null {
  const row = db()
    .prepare(`SELECT * FROM recommendations WHERE id = ?`)
    .get(id) as RecRow | undefined;
  return row ? rowToRec(row) : null;
}

// ---- Trades ----

type TradeRow = {
  id: number;
  recommendation_id: number | null;
  ticker: string;
  action: string;
  shares: number;
  price: number;
  executed_at: string;
  status: string;
  notes: string | null;
  closes_trade_id: number | null;
  realized_pnl: number | null;
  target: number | null;
  stop: number | null;
};

function rowToTrade(r: TradeRow): Trade {
  return {
    id: r.id,
    recommendationId: r.recommendation_id,
    ticker: r.ticker,
    action: r.action as Trade["action"],
    shares: r.shares,
    price: r.price,
    executedAt: r.executed_at,
    status: r.status as Trade["status"],
    notes: r.notes,
    closesTradeId: r.closes_trade_id,
    realizedPnl: r.realized_pnl ?? null,
    target: r.target ?? null,
    stop: r.stop ?? null,
  };
}

export function insertTrade(t: Omit<Trade, "id">, userId: number): Trade {
  const info = db()
    .prepare(
      `INSERT INTO trades
        (recommendation_id, ticker, action, shares, price, executed_at, status, notes, closes_trade_id, realized_pnl, target, stop, user_id)
       VALUES
        (@recommendationId, @ticker, @action, @shares, @price, @executedAt, @status, @notes, @closesTradeId, @realizedPnl, @target, @stop, @userId)`
    )
    .run({
      recommendationId: t.recommendationId,
      ticker: t.ticker,
      action: t.action,
      shares: t.shares,
      price: t.price,
      executedAt: t.executedAt,
      status: t.status,
      notes: t.notes,
      closesTradeId: t.closesTradeId,
      realizedPnl: t.realizedPnl ?? null,
      target: t.target ?? null,
      stop: t.stop ?? null,
      userId,
    });
  return { ...t, id: Number(info.lastInsertRowid) };
}

/** All closed SELL trades (realized P&L history) for a user, newest first. */
export function getSellTrades(userId: number): Trade[] {
  const rows = db()
    .prepare(`SELECT * FROM trades WHERE action = 'SELL' AND user_id = ? ORDER BY executed_at DESC`)
    .all(userId) as TradeRow[];
  return rows.map(rowToTrade);
}

export function getAllTrades(userId: number): Trade[] {
  const rows = db()
    .prepare(`SELECT * FROM trades WHERE user_id = ? ORDER BY executed_at DESC`)
    .all(userId) as TradeRow[];
  return rows.map(rowToTrade);
}

export function getOpenBuyTrades(userId: number): Trade[] {
  const rows = db()
    .prepare(
      `SELECT * FROM trades WHERE action = 'BUY' AND status = 'open' AND user_id = ? ORDER BY executed_at ASC`
    )
    .all(userId) as TradeRow[];
  return rows.map(rowToTrade);
}

export function markTradeClosed(id: number): void {
  db().prepare(`UPDATE trades SET status = 'closed' WHERE id = ?`).run(id);
}

// ---- Meta (key/value) ----

export function getMeta(key: string): string | null {
  const row = db().prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db()
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

// ---- Index Trader (isolated) ----

type IndexTradeRow = {
  id: number;
  index_key: string;
  ticker: string;
  name: string;
  action: string;
  shares: number;
  price: number;
  executed_at: string;
  status: string;
  notes: string | null;
  target: number | null;
  stop: number | null;
  realized_pnl: number | null;
};

function rowToIndexTrade(r: IndexTradeRow): IndexTrade {
  return {
    id: r.id,
    indexKey: r.index_key,
    ticker: r.ticker,
    name: r.name,
    action: r.action as IndexTrade["action"],
    shares: r.shares,
    price: r.price,
    executedAt: r.executed_at,
    status: r.status as IndexTrade["status"],
    notes: r.notes,
    target: r.target ?? null,
    stop: r.stop ?? null,
    realizedPnl: r.realized_pnl ?? null,
  };
}

export function insertIndexTrade(t: Omit<IndexTrade, "id">, userId: number): IndexTrade {
  const info = db()
    .prepare(
      `INSERT INTO index_trades
        (index_key, ticker, name, action, shares, price, executed_at, status, notes, target, stop, realized_pnl, user_id)
       VALUES
        (@indexKey, @ticker, @name, @action, @shares, @price, @executedAt, @status, @notes, @target, @stop, @realizedPnl, @userId)`
    )
    .run({
      indexKey: t.indexKey,
      ticker: t.ticker,
      name: t.name,
      action: t.action,
      shares: t.shares,
      price: t.price,
      executedAt: t.executedAt,
      status: t.status,
      notes: t.notes,
      target: t.target ?? null,
      stop: t.stop ?? null,
      realizedPnl: t.realizedPnl ?? null,
      userId,
    });
  return { ...t, id: Number(info.lastInsertRowid) };
}

export function getIndexTrades(userId: number): IndexTrade[] {
  const rows = db()
    .prepare(`SELECT * FROM index_trades WHERE user_id = ? ORDER BY executed_at DESC`)
    .all(userId) as IndexTradeRow[];
  return rows.map(rowToIndexTrade);
}

export function getOpenIndexBuys(userId: number): IndexTrade[] {
  const rows = db()
    .prepare(`SELECT * FROM index_trades WHERE action = 'BUY' AND status = 'open' AND user_id = ? ORDER BY executed_at ASC`)
    .all(userId) as IndexTradeRow[];
  return rows.map(rowToIndexTrade);
}

export function markIndexTradeClosed(id: number): void {
  db().prepare(`UPDATE index_trades SET status = 'closed' WHERE id = ?`).run(id);
}
