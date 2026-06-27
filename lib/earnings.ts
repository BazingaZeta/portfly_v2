import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance();
try {
  (yf as unknown as { suppressNotices?: (n: string[]) => void }).suppressNotices?.([
    "yahooSurvey",
  ]);
} catch {
  /* ignore */
}

export interface EarningsInfo {
  date: string | null; // ISO date of next earnings, if known
  daysUntil: number | null; // trading-agnostic calendar days until earnings
}

/** Fetch the next earnings date for a ticker. Returns nulls on failure. */
export async function fetchEarnings(ticker: string): Promise<EarningsInfo> {
  try {
    const res = await yf.quoteSummary(ticker, { modules: ["calendarEvents"] });
    const dates = res?.calendarEvents?.earnings?.earningsDate;
    const first = Array.isArray(dates) && dates.length ? dates[0] : null;
    if (!first) return { date: null, daysUntil: null };
    const d = first instanceof Date ? first : new Date(first);
    if (isNaN(d.getTime())) return { date: null, daysUntil: null };
    const daysUntil = Math.round((d.getTime() - Date.now()) / 86_400_000);
    return { date: d.toISOString().slice(0, 10), daysUntil };
  } catch {
    return { date: null, daysUntil: null };
  }
}
