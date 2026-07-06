// Client Finnhub (https://finnhub.io) — dati più precisi dove il free tier li
// offre: quote real-time US, company news di qualità (multi-fonte, con summary),
// calendario earnings. SEMPRE opzionale: senza FINNHUB_API_KEY ogni funzione
// ritorna null/[] e i chiamanti restano su Yahoo. Free tier: 60 chiamate/min —
// i chiamanti devono usarlo per set piccoli (portafoglio, candidati scan),
// non per scansioni bulk da 150+ ticker.

const BASE = "https://finnhub.io/api/v1";
const TIMEOUT_MS = 8000;

export function finnhubEnabled(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}

async function fh<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const qs = new URLSearchParams({ ...params, token: key }).toString();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`${BASE}${path}?${qs}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null; // 429 (rate limit) incluso: il chiamante fa fallback
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Pool a concorrenza limitata (rispetta i 60 req/min del free tier). */
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

// ─── Quote real-time ──────────────────────────────────────────────────────────

interface FhQuote {
  c: number;  // prezzo corrente
  pc: number; // chiusura precedente
  t: number;  // unix timestamp
}

/**
 * Quote real-time per un set PICCOLO di ticker (≤ ~30). Ritorna solo i simboli
 * risolti (Finnhub dà c=0 per simboli sconosciuti); i mancanti restano al
 * chiamante per il fallback Yahoo.
 */
export async function fhQuotes(tickers: string[]): Promise<Record<string, number>> {
  if (!finnhubEnabled() || tickers.length === 0) return {};
  const rows = await pool(tickers, 6, async (symbol) => {
    const q = await fh<FhQuote>("/quote", { symbol });
    return q && q.c > 0 ? ([symbol, q.c] as const) : null;
  });
  const out: Record<string, number> = {};
  for (const r of rows) if (r) out[r[0]] = r[1];
  return out;
}

// ─── Company news ─────────────────────────────────────────────────────────────

export interface FhNewsItem {
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number; // unix seconds
}

/** News per ticker degli ultimi `days` giorni (free tier: storico ~1 anno). */
export async function fhCompanyNews(ticker: string, days = 7): Promise<FhNewsItem[]> {
  if (!finnhubEnabled()) return [];
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const rows = await fh<FhNewsItem[]>("/company-news", {
    symbol: ticker,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && r.headline && r.datetime > 0);
}

// ─── Earnings calendar ────────────────────────────────────────────────────────

interface FhEarningsCalendar {
  earningsCalendar?: { date: string; symbol: string }[];
}

/** Prossima data earnings per il ticker (finestra +120 giorni). Null se ignota. */
export async function fhNextEarnings(ticker: string): Promise<string | null> {
  if (!finnhubEnabled()) return null;
  const from = new Date();
  const to = new Date(from.getTime() + 120 * 86_400_000);
  const res = await fh<FhEarningsCalendar>("/calendar/earnings", {
    symbol: ticker,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });
  const rows = res?.earningsCalendar ?? [];
  if (!rows.length) return null;
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  return dates[0] ?? null;
}
