import Parser from "rss-parser";
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

/** Score a headline in [-1, 1] from positive/negative keyword counts. */
export function scoreSentiment(text: string): number {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  let pos = 0;
  let neg = 0;
  for (const w of words) {
    if (POSITIVE.includes(w)) pos++;
    if (NEGATIVE.includes(w)) neg++;
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

/** Per-ticker headlines from Yahoo Finance's free RSS endpoint. */
export async function fetchTickerNews(
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
