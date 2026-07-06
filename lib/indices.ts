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
  {
    key: "SP500_FULL",
    label: "S&P 500 completo (503 titoli, snapshot 2026-07)",
    proxy: "SPY",
    // Snapshot dei costituenti attuali (Wikipedia, 2026-07-06). Stesso survivorship
    // bias delle altre liste: e' la composizione DI OGGI applicata al passato.
    tickers: [
      "A", "AAPL", "ABBV", "ABNB", "ABT", "ACGL", "ACN", "ADBE", "ADI", "ADM", "ADP", "ADSK",
      "AEE", "AEP", "AES", "AFL", "AIG", "AIZ", "AJG", "AKAM", "ALB", "ALGN", "ALL", "ALLE",
      "AMAT", "AMCR", "AMD", "AME", "AMGN", "AMP", "AMT", "AMZN", "ANET", "AON", "AOS", "APA",
      "APD", "APH", "APO", "APP", "APTV", "ARE", "ARES", "ATO", "AVB", "AVGO", "AVY", "AWK",
      "AXON", "AXP", "AZO", "BA", "BAC", "BALL", "BAX", "BBY", "BDX", "BEN", "BF-B", "BG",
      "BIIB", "BKNG", "BKR", "BLDR", "BLK", "BMY", "BNY", "BR", "BRK-B", "BRO", "BSX", "BX",
      "BXP", "C", "CAH", "CARR", "CASY", "CAT", "CB", "CBOE", "CBRE", "CCI", "CCL", "CDNS",
      "CDW", "CEG", "CF", "CFG", "CHD", "CHRW", "CHTR", "CI", "CIEN", "CINF", "CL", "CLX",
      "CMCSA", "CME", "CMG", "CMI", "CMS", "CNC", "CNP", "COF", "COHR", "COIN", "COO", "COP",
      "COR", "COST", "CPAY", "CPRT", "CPT", "CRH", "CRL", "CRM", "CRWD", "CSCO", "CSGP", "CSX",
      "CTAS", "CTSH", "CTVA", "CVNA", "CVS", "CVX", "D", "DAL", "DASH", "DD", "DDOG", "DE",
      "DECK", "DELL", "DG", "DGX", "DHI", "DHR", "DIS", "DLR", "DLTR", "DOC", "DOV", "DOW",
      "DPZ", "DRI", "DTE", "DUK", "DVA", "DVN", "DXCM", "EA", "EBAY", "ECHO", "ECL", "ED",
      "EFX", "EG", "EIX", "EL", "ELV", "EME", "EMR", "EOG", "EQIX", "EQR", "EQT", "ERIE",
      "ES", "ESS", "ETN", "ETR", "EVRG", "EW", "EXC", "EXE", "EXPD", "EXPE", "EXR", "F",
      "FANG", "FAST", "FCX", "FDS", "FDX", "FDXF", "FE", "FFIV", "FICO", "FIS", "FISV", "FITB",
      "FIX", "FLEX", "FOX", "FOXA", "FRT", "FSLR", "FTNT", "FTV", "GD", "GDDY", "GE", "GEHC",
      "GEN", "GEV", "GILD", "GIS", "GL", "GLW", "GM", "GNRC", "GOOG", "GOOGL", "GPC", "GPN",
      "GRMN", "GS", "GWW", "HAL", "HAS", "HBAN", "HCA", "HD", "HIG", "HII", "HLT", "HON",
      "HONA", "HOOD", "HPE", "HPQ", "HRL", "HSIC", "HST", "HSY", "HUBB", "HUM", "HWM", "IBKR",
      "IBM", "ICE", "IDXX", "IEX", "IFF", "INCY", "INTC", "INTU", "INVH", "IP", "IQV", "IR",
      "IRM", "ISRG", "IT", "ITW", "IVZ", "J", "JBHT", "JBL", "JCI", "JKHY", "JNJ", "JPM",
      "KDP", "KEY", "KEYS", "KHC", "KIM", "KKR", "KLAC", "KMB", "KMI", "KO", "KR", "KVUE",
      "L", "LDOS", "LEN", "LH", "LHX", "LII", "LIN", "LITE", "LLY", "LMT", "LNT", "LOW",
      "LRCX", "LULU", "LUV", "LVS", "LYB", "LYV", "MA", "MAA", "MAR", "MAS", "MCD", "MCHP",
      "MCK", "MCO", "MDLZ", "MDT", "MET", "META", "MGM", "MKC", "MLM", "MMM", "MNST", "MO",
      "MOS", "MPC", "MPWR", "MRK", "MRNA", "MRSH", "MRVL", "MS", "MSCI", "MSFT", "MSI", "MTB",
      "MTD", "MU", "NCLH", "NDAQ", "NDSN", "NEE", "NEM", "NFLX", "NI", "NKE", "NOC", "NOW",
      "NRG", "NSC", "NTAP", "NTRS", "NUE", "NVDA", "NVR", "NWS", "NWSA", "NXPI", "O", "ODFL",
      "OKE", "OMC", "ON", "ORCL", "ORLY", "OTIS", "OXY", "PANW", "PAYX", "PCAR", "PCG", "PEG",
      "PEP", "PFE", "PFG", "PG", "PGR", "PH", "PHM", "PKG", "PLD", "PLTR", "PM", "PNC",
      "PNR", "PNW", "PODD", "PPG", "PPL", "PRU", "PSA", "PSKY", "PSX", "PTC", "PWR", "PYPL",
      "Q", "QCOM", "RCL", "REG", "REGN", "RF", "RJF", "RL", "RMD", "ROK", "ROL", "ROP",
      "ROST", "RSG", "RTX", "RVTY", "SBAC", "SBUX", "SCHW", "SHW", "SJM", "SLB", "SMCI", "SNA",
      "SNDK", "SNPS", "SO", "SOLV", "SPG", "SPGI", "SRE", "STE", "STLD", "STT", "STX", "STZ",
      "SW", "SWK", "SWKS", "SYF", "SYK", "SYY", "T", "TAP", "TDG", "TDY", "TECH", "TEL",
      "TER", "TFC", "TGT", "TJX", "TKO", "TMO", "TMUS", "TPL", "TPR", "TRGP", "TRMB", "TROW",
      "TRV", "TSCO", "TSLA", "TSN", "TT", "TTD", "TTWO", "TXN", "TXT", "TYL", "UAL", "UBER",
      "UDR", "UHS", "ULTA", "UNH", "UNP", "UPS", "URI", "USB", "V", "VEEV", "VICI", "VLO",
      "VLTO", "VMC", "VRSK", "VRSN", "VRT", "VRTX", "VST", "VTR", "VTRS", "VZ", "WAB", "WAT",
      "WBD", "WDAY", "WDC", "WEC", "WELL", "WFC", "WM", "WMB", "WMT", "WRB", "WSM", "WST",
      "WTW", "WY", "WYNN", "XEL", "XOM", "XYL", "XYZ", "YUM", "ZBH", "ZBRA", "ZTS",
    ],
  },
];

export function indexByKey(key: string): IndexDef | undefined {
  return INDICES.find((i) => i.key === key);
}
