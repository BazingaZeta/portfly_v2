import Parser from "rss-parser";
import { finnhubEnabled, fhCompanyNews } from "./finnhub";
import type { NewsItem } from "./types";

const parser = new Parser({
  timeout: 10000,
  headers: { "User-Agent": "Mozilla/5.0 (finance-bot)" },
});

// Lightweight finance sentiment lexicon. Not ML — deterministic and transparent.
const POSITIVE = [
  "beat", "beats", "surge", "surges", "soar", "soars", "rally", "rallies",
  "jump", "jumps", "gain", "gains", "rise", "rises", "record", "upgrade",
  "upgraded", "outperform", "bullish", "growth", "profit", "strong", "boost",
  "boosts", "win", "wins", "approval", "approved", "breakthrough", "raises",
  "raised", "tops", "top", "expand", "expansion", "buyback", "dividend",
  "optimistic", "rebound", "recovery", "momentum", "demand", "acquire",
  "acquisition", "partnership", "launch", "launches", "milestone",
];
const NEGATIVE = [
  "miss", "misses", "missed", "plunge", "plunges", "tumble", "tumbles",
  "drop", "drops", "fall", "falls", "slump", "slumps", "downgrade",
  "downgraded", "underperform", "bearish", "loss", "losses", "weak",
  "warning", "warns", "cut", "cuts", "layoff", "layoffs", "lawsuit",
  "investigation", "probe", "recall", "fraud", "decline", "declines",
  "slowdown", "concern", "concerns", "fears", "risk", "risks", "selloff",
  "bankruptcy", "default", "halt", "halts", "delay", "delays", "scandal",
  "fine", "fined", "crash", "crashes", "slashes", "slashed",
];

// Words that flip the polarity of the sentiment term that follows them, within
// a short window. A deterministic lexicon is blind to negation otherwise:
// "no longer fears bankruptcy" would read as strongly negative.
const NEGATORS = new Set([
  "no", "not", "never", "without", "cannot", "cant",
  "avoid", "avoids", "avoided",
]);
const NEGATION_WINDOW = 3; // tokens after a negator whose polarity is inverted

// Bigrams the unigram lexicon gets wrong. Finance context: a "rate cut" or
// "buyback" is bullish; "guidance cut" or "job cuts" is bearish. Scored as a
// single unit (and their component words are skipped).
const BIGRAMS: Record<string, number> = {
  "rate cut": 1, "rate cuts": 1, "cost cuts": 1, "tax cut": 1, "tax cuts": 1,
  "share buyback": 1, "debt reduction": 1,
  "guidance cut": -1, "job cuts": -1, "job cut": -1, "dividend cut": -1,
  "guidance cuts": -1, "profit warning": -1, "price cut": -1, "price cuts": -1,
  "growth concerns": -1, "recession fears": -1,
};

const POSITIVE_SET = new Set(POSITIVE);
const NEGATIVE_SET = new Set(NEGATIVE);

/** Score a headline in [-1, 1] from positive/negative keyword counts. */
export function scoreSentiment(text: string): number {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z']+/g) ?? [];
  let pos = 0;
  let neg = 0;

  // 1. Bigrams first; remember which token positions they consumed.
  const consumed = new Set<number>();
  for (let i = 0; i < words.length - 1; i++) {
    const bg = `${words[i]} ${words[i + 1]}`;
    const score = BIGRAMS[bg];
    if (score !== undefined) {
      if (score > 0) pos++; else neg++;
      consumed.add(i);
      consumed.add(i + 1);
      i++; // don't overlap bigrams
    }
  }

  // 2. Unigrams, with a negation flip if a negator precedes within the window.
  for (let i = 0; i < words.length; i++) {
    if (consumed.has(i)) continue;
    const w = words[i];
    let polarity = 0;
    if (POSITIVE_SET.has(w)) polarity = 1;
    else if (NEGATIVE_SET.has(w)) polarity = -1;
    if (polarity === 0) continue;

    let negated = false;
    for (let j = Math.max(0, i - NEGATION_WINDOW); j < i; j++) {
      if (NEGATORS.has(words[j])) { negated = true; break; }
    }
    const eff = negated ? -polarity : polarity;
    if (eff > 0) pos++; else neg++;
  }

  if (pos + neg === 0) return 0;
  return (pos - neg) / (pos + neg);
}

type RawItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  creator?: string;
};

function toNewsItem(
  item: RawItem,
  source: string,
  tickers: string[]
): NewsItem | null {
  const title = item.title?.trim();
  if (!title) return null;
  const publishedAt = item.isoDate ?? item.pubDate ?? new Date().toISOString();
  return {
    title,
    link: item.link ?? "",
    source,
    publishedAt: new Date(publishedAt).toISOString(),
    sentiment: scoreSentiment(title),
    tickers,
  };
}

/** Per-ticker news: Finnhub (multi-fonte, con summary) quando configurato, altrimenti RSS Yahoo. */
export async function fetchTickerNews(
  ticker: string,
  limit = 6
): Promise<NewsItem[]> {
  // Finnhub: più fonti, testo più ricco (headline+summary → il lessico lavora
  // su più segnale), storico fino a ~1 anno. Fallback silenzioso su Yahoo.
  if (finnhubEnabled()) {
    const rows = await fhCompanyNews(ticker, 7);
    if (rows.length > 0) {
      const seen = new Set<string>();
      const items: NewsItem[] = [];
      // Più recenti prima, dedup per titolo
      for (const r of rows.sort((a, b) => b.datetime - a.datetime)) {
        const key = r.headline.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          title: r.headline,
          link: r.url ?? "",
          source: r.source || "Finnhub",
          publishedAt: new Date(r.datetime * 1000).toISOString(),
          sentiment: scoreSentiment(`${r.headline}. ${r.summary ?? ""}`),
          tickers: [ticker],
        });
        if (items.length >= limit) break;
      }
      return items;
    }
  }
  return fetchTickerNewsYahoo(ticker, limit);
}

/** Fallback: headlines dal feed RSS gratuito di Yahoo Finance. */
async function fetchTickerNewsYahoo(
  ticker: string,
  limit = 6
): Promise<NewsItem[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(
    ticker
  )}&region=US&lang=en-US`;
  try {
    const feed = await parser.parseURL(url);
    const items = (feed.items ?? [])
      .slice(0, limit)
      .map((i) => toNewsItem(i as RawItem, "Yahoo Finance", [ticker]))
      .filter((x): x is NewsItem => x !== null);
    return items;
  } catch {
    return [];
  }
}

// General market / tech / world feeds for the news page.
const GENERAL_FEEDS: { url: string; source: string }[] = [
  { url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", source: "MarketWatch" },
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", source: "CNBC" },
  { url: "https://feeds.a.dj.com/rss/RSSWSJD.xml", source: "WSJ Tech" },
  { url: "https://finance.yahoo.com/news/rssindex", source: "Yahoo Finance" },
];

/** Aggregate general finance/tech/world headlines for the news feed page. */
export async function fetchGeneralNews(limit = 40): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    GENERAL_FEEDS.map((f) => parser.parseURL(f.url).then((feed) => ({ feed, f })))
  );

  const items: NewsItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { feed, f } = r.value;
    for (const i of feed.items ?? []) {
      const n = toNewsItem(i as RawItem, f.source, []);
      if (n) items.push(n);
    }
  }
  // newest first, de-duplicated by title
  const seen = new Set<string>();
  const deduped = items.filter((n) => {
    const key = n.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
  return deduped.slice(0, limit);
}

/** Aggregate sentiment from a list of headlines, recency-weighted. */
export function aggregateSentiment(news: NewsItem[]): number {
  if (news.length === 0) return 0;
  const now = Date.now();
  let weighted = 0;
  let totalWeight = 0;
  for (const n of news) {
    const ageDays = (now - new Date(n.publishedAt).getTime()) / 86_400_000;
    const weight = Math.exp(-ageDays / 3); // ~3-day half-life
    weighted += n.sentiment * weight;
    totalWeight += weight;
  }
  return totalWeight ? weighted / totalWeight : 0;
}
