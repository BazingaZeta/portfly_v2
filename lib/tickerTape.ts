import YahooFinance from "yahoo-finance2";

// Nastro "Wall Street": dati di mercato per il banner scorrevole in cima all'app.
// Indici USA + mega-cap leader + principali crypto (24/7). Yahoo dà prezzo e
// variazione % in un colpo solo per tutti (azioni, indici e crypto con -USD),
// quindi non serve Finnhub qui e restiamo fuori dai suoi rate limit.

const yahooFinance = new YahooFinance();
try {
  (yahooFinance as unknown as { suppressNotices?: (n: string[]) => void }).suppressNotices?.([
    "yahooSurvey",
    "ripHistorical",
  ]);
} catch {
  /* safe to ignore */
}

export interface TickerItem {
  symbol: string;
  label: string;
  price: number;
  changePct: number;
  /** "crypto" quota 24/7; "index"/"stock" solo in orario di mercato. */
  kind: "index" | "stock" | "crypto";
}

// Simboli curati, nell'ordine in cui scorrono. Yahoo: indici con "^",
// crypto con "-USD".
const TAPE: { symbol: string; label: string; kind: TickerItem["kind"] }[] = [
  { symbol: "^GSPC", label: "S&P 500", kind: "index" },
  { symbol: "^IXIC", label: "Nasdaq", kind: "index" },
  { symbol: "^DJI", label: "Dow Jones", kind: "index" },
  { symbol: "^VIX", label: "VIX", kind: "index" },
  { symbol: "AAPL", label: "Apple", kind: "stock" },
  { symbol: "MSFT", label: "Microsoft", kind: "stock" },
  { symbol: "NVDA", label: "Nvidia", kind: "stock" },
  { symbol: "AMZN", label: "Amazon", kind: "stock" },
  { symbol: "TSLA", label: "Tesla", kind: "stock" },
  { symbol: "GOOGL", label: "Alphabet", kind: "stock" },
  { symbol: "META", label: "Meta", kind: "stock" },
  { symbol: "BTC-USD", label: "Bitcoin", kind: "crypto" },
  { symbol: "ETH-USD", label: "Ethereum", kind: "crypto" },
  { symbol: "SOL-USD", label: "Solana", kind: "crypto" },
  { symbol: "XRP-USD", label: "XRP", kind: "crypto" },
  { symbol: "BNB-USD", label: "BNB", kind: "crypto" },
  { symbol: "DOGE-USD", label: "Dogecoin", kind: "crypto" },
];

type Q = { price: number; changePct: number };

function readQuote(r: unknown): [string, Q] | null {
  const q = r as { symbol?: string; regularMarketPrice?: number; regularMarketChangePercent?: number };
  if (!q?.symbol || typeof q.regularMarketPrice !== "number") return null;
  return [q.symbol, { price: q.regularMarketPrice, changePct: typeof q.regularMarketChangePercent === "number" ? q.regularMarketChangePercent : 0 }];
}

/** Prezzo + variazione % per l'intero nastro. Ordine preservato; simboli non
 *  risolti vengono semplicemente omessi (il nastro si accorcia, non si rompe). */
export async function fetchTickerTape(): Promise<TickerItem[]> {
  const symbols = TAPE.map((t) => t.symbol);
  const quotes: Record<string, Q> = {};

  try {
    const results = await yahooFinance.quote(symbols);
    for (const r of Array.isArray(results) ? results : [results]) {
      const kv = readQuote(r);
      if (kv) quotes[kv[0]] = kv[1];
    }
  } catch {
    // Un simbolo che fallisce la validazione affonda il batch: riprova uno a uno.
    for (const s of symbols) {
      try {
        const r = await yahooFinance.quote(s);
        const kv = readQuote(Array.isArray(r) ? r[0] : r);
        if (kv) quotes[kv[0]] = kv[1];
      } catch {
        /* skip */
      }
    }
  }

  return TAPE.flatMap((t) => {
    const q = quotes[t.symbol];
    return q ? [{ symbol: t.symbol, label: t.label, price: q.price, changePct: q.changePct, kind: t.kind }] : [];
  });
}
