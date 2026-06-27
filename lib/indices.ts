// Index constituent lists. Cap-weighted indices are top-heavy, so the leading
// names drive most of the move — we list the largest constituents per index.

export interface IndexDef {
  key: string;
  label: string;
  proxy: string; // tradable ETF used as the index price for relative strength
  tickers: string[];
}

export const INDICES: IndexDef[] = [
  {
    key: "SP500",
    label: "S&P 500 (top per peso)",
    proxy: "SPY",
    tickers: [
      "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "AVGO", "TSLA",
      "BRK-B", "LLY", "JPM", "V", "XOM", "UNH", "MA", "COST", "HD", "PG", "JNJ",
      "ORCL", "ABBV", "NFLX", "BAC", "KO", "MRK", "CVX", "AMD", "PEP", "CRM",
      "TMO", "WMT", "ADBE", "LIN", "MCD", "CSCO", "ACN", "ABT", "GE", "DHR",
      "QCOM", "TXN", "WFC", "PM", "INTU", "IBM", "DIS", "CAT", "NOW", "AMGN",
      "GS", "ISRG", "INTC", "VZ", "RTX", "AXP", "PFE", "SPGI", "UNP", "T",
      "LOW", "BKNG", "HON", "MS", "PANW", "BLK", "C", "ELV", "SYK", "VRTX",
      "BA", "MDT", "GILD", "ADP", "MU", "PLTR", "LRCX", "REGN", "KLAC", "ANET",
    ],
  },
  {
    key: "NDX",
    label: "Nasdaq 100 (top per peso)",
    proxy: "QQQ",
    tickers: [
      "AAPL", "MSFT", "NVDA", "AMZN", "AVGO", "META", "TSLA", "GOOGL", "GOOG",
      "COST", "NFLX", "AMD", "PEP", "ADBE", "CSCO", "TMUS", "INTC", "QCOM",
      "INTU", "AMAT", "TXN", "ISRG", "BKNG", "HON", "VRTX", "REGN", "LRCX",
      "MU", "PANW", "KLAC", "SNPS", "CDNS", "MRVL", "ABNB", "CRWD", "FTNT",
      "MELI", "PYPL", "ORLY", "ADP", "PLTR", "ROKU", "DDOG", "TEAM", "WDAY",
    ],
  },
  {
    key: "DJIA",
    label: "Dow Jones 30",
    proxy: "DIA",
    tickers: [
      "AAPL", "AMZN", "AMGN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
      "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM", "MRK",
      "MSFT", "NKE", "NVDA", "PG", "SHW", "TRV", "UNH", "V", "VZ", "WMT",
    ],
  },
];

export function indexByKey(key: string): IndexDef | undefined {
  return INDICES.find((i) => i.key === key);
}
