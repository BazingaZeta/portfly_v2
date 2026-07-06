// Shared domain types for the finance-bot platform.

/** A single daily OHLCV candle. */
export interface Candle {
  date: string; // ISO yyyy-mm-dd
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Dividend/split-adjusted close (total return); falls back to close. */
  adjClose?: number;
}

/** Snapshot of the technical indicators computed for a ticker. */
export interface Indicators {
  price: number;
  rsi: number; // 0..100
  emaFast: number; // 9
  emaSlow: number; // 21
  sma50: number;
  roc: number; // % rate of change over lookback
  volume: number;
  avgVolume: number; // 20-day average
  volumeRatio: number; // volume / avgVolume
  atr: number; // average true range (14)
  atrPct: number; // atr / price
  high52w: number;
  low52w: number;
}

/** One reason a signal fired, shown to the user as the rationale. */
export interface SignalReason {
  code: string; // e.g. "RSI_OVERSOLD"
  label: string; // human readable
  weight: number; // contribution to score
}

/** News headline relevant to a ticker. */
export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string; // ISO
  sentiment: number; // -1..1
  tickers: string[]; // tickers mentioned/associated
}

export type Action = "BUY" | "SELL";
export type TradeStatus = "open" | "closed";

/** A recommendation produced by the scan engine and persisted. */
export interface Recommendation {
  id: number;
  scanDate: string; // ISO yyyy-mm-dd
  createdAt: string; // ISO timestamp
  ticker: string;
  name: string;
  action: Action;
  score: number; // 0..100 confidence
  price: number; // price at recommendation time
  target: number; // suggested take-profit
  stop: number; // suggested stop-loss
  reasons: SignalReason[];
  newsSentiment: number; // -1..1 aggregate
  news: NewsItem[];
  indicators: Indicators;
  earningsDate: string | null; // next earnings date if known
  earningsDays: number | null; // calendar days until earnings
  spark: number[]; // recent daily closes for the sparkline (oldest → newest)
}

/** A trade the user confirmed they executed. */
export interface Trade {
  id: number;
  recommendationId: number | null;
  ticker: string;
  action: Action;
  shares: number;
  price: number; // execution price
  executedAt: string; // ISO
  status: TradeStatus;
  notes: string | null;
  // populated for SELL: which open buy it closes
  closesTradeId: number | null;
  // realized profit/loss, set on SELL trades only
  realizedPnl: number | null;
  // target/stop snapshotted from the originating recommendation at buy time
  target: number | null;
  stop: number | null;
}

/** A trade in the isolated Index Trader section. */
export interface IndexTrade {
  id: number;
  indexKey: string;
  ticker: string;
  name: string;
  action: Action;
  shares: number;
  price: number;
  executedAt: string;
  status: TradeStatus;
  notes: string | null;
  target: number | null;
  stop: number | null;
  realizedPnl: number | null;
}

/** An open position derived from confirmed trades, with live P&L. */
export interface Position {
  ticker: string;
  name?: string;
  shares: number;
  avgCost: number;
  /** true se la quote live non era disponibile: currentPrice = costo medio, P&L non affidabile. */
  priceStale?: boolean;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  openTradeIds: number[];
  source: "main" | "index" | "momentum"; // which section originated this position
  indexKey?: string; // for index/momentum positions
  // from the originating recommendation, when available
  recommendationId?: number | null;
  target?: number | null;
  stop?: number | null;
}
