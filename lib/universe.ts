// Broad universe of liquid US large/mega-caps across sectors.
// This is the daily scan pool. Trim or extend freely — every entry is just a
// Yahoo Finance ticker. Kept intentionally to the most liquid names so that
// short-term momentum signals are tradable (tight spreads, real volume).

export const UNIVERSE: string[] = [
  // Mega-cap tech
  "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA", "AVGO",
  "ORCL", "ADBE", "CRM", "AMD", "INTC", "CSCO", "QCOM", "TXN", "INTU",
  "IBM", "NOW", "AMAT", "MU", "LRCX", "ADI", "PANW", "SNPS", "CDNS", "KLAC",
  "ANET", "FTNT", "PLTR", "CRWD", "DDOG", "SNOW", "NET", "SHOP", "UBER",
  "ABNB", "MRVL", "WDAY", "TEAM", "DELL", "HPQ", "SMCI",
  // Communication / media
  "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS", "WBD", "SPOT", "RBLX", "PINS",
  "SNAP", "ROKU",
  // Financials
  "JPM", "BAC", "WFC", "C", "GS", "MS", "SCHW", "AXP", "BLK", "SPGI",
  "V", "MA", "PYPL", "COF", "USB", "PNC", "BX", "KKR", "COIN", "HOOD",
  // Healthcare
  "UNH", "JNJ", "LLY", "ABBV", "MRK", "PFE", "TMO", "ABT", "DHR", "BMY",
  "AMGN", "GILD", "ISRG", "VRTX", "REGN", "CVS", "MDT", "MRNA", "HUM",
  // Consumer
  "WMT", "COST", "HD", "LOW", "TGT", "NKE", "MCD", "SBUX", "CMG", "KO",
  "PEP", "PG", "PM", "MDLZ", "CL", "EL", "LULU", "BKNG", "MAR", "DPZ",
  // Industrials / energy / materials
  "CAT", "DE", "BA", "GE", "HON", "UPS", "FDX", "RTX", "LMT", "NOC",
  "XOM", "CVX", "COP", "SLB", "OXY", "MPC", "PSX", "FCX", "NEM", "LIN",
  // Autos / EV / mobility
  "F", "GM", "RIVN", "LCID", "NIO",
  // Other notable movers
  "BABA", "PDD", "JD", "MELI", "SQ", "AFRM", "SOFI", "DKNG", "CVNA", "PLUG",
];

/** Full company names so the UI can show what each ticker actually is. */
export const NAMES: Record<string, string> = {
  // Mega-cap tech
  AAPL: "Apple", MSFT: "Microsoft", GOOGL: "Alphabet (Google)", GOOG: "Alphabet (Google)",
  AMZN: "Amazon", META: "Meta Platforms", NVDA: "NVIDIA", TSLA: "Tesla",
  AVGO: "Broadcom", ORCL: "Oracle", ADBE: "Adobe", CRM: "Salesforce",
  AMD: "AMD", INTC: "Intel", CSCO: "Cisco", QCOM: "Qualcomm",
  TXN: "Texas Instruments", INTU: "Intuit", IBM: "IBM", NOW: "ServiceNow",
  AMAT: "Applied Materials", MU: "Micron", LRCX: "Lam Research", ADI: "Analog Devices",
  PANW: "Palo Alto Networks", SNPS: "Synopsys", CDNS: "Cadence", KLAC: "KLA Corp",
  ANET: "Arista Networks", FTNT: "Fortinet", PLTR: "Palantir", CRWD: "CrowdStrike",
  DDOG: "Datadog", SNOW: "Snowflake", NET: "Cloudflare", SHOP: "Shopify",
  UBER: "Uber", ABNB: "Airbnb", MRVL: "Marvell", WDAY: "Workday",
  TEAM: "Atlassian", DELL: "Dell", HPQ: "HP", SMCI: "Super Micro Computer",
  // Communication / media
  NFLX: "Netflix", DIS: "Disney", CMCSA: "Comcast", T: "AT&T", VZ: "Verizon",
  TMUS: "T-Mobile", WBD: "Warner Bros. Discovery", SPOT: "Spotify", RBLX: "Roblox",
  PINS: "Pinterest", SNAP: "Snap", ROKU: "Roku",
  // Financials
  JPM: "JPMorgan Chase", BAC: "Bank of America", WFC: "Wells Fargo", C: "Citigroup",
  GS: "Goldman Sachs", MS: "Morgan Stanley", SCHW: "Charles Schwab", AXP: "American Express",
  BLK: "BlackRock", SPGI: "S&P Global", V: "Visa", MA: "Mastercard", PYPL: "PayPal",
  COF: "Capital One", USB: "U.S. Bancorp", PNC: "PNC Financial", BX: "Blackstone",
  KKR: "KKR", COIN: "Coinbase", HOOD: "Robinhood",
  // Healthcare
  UNH: "UnitedHealth", JNJ: "Johnson & Johnson", LLY: "Eli Lilly", ABBV: "AbbVie",
  MRK: "Merck", PFE: "Pfizer", TMO: "Thermo Fisher", ABT: "Abbott", DHR: "Danaher",
  BMY: "Bristol-Myers Squibb", AMGN: "Amgen", GILD: "Gilead", ISRG: "Intuitive Surgical",
  VRTX: "Vertex", REGN: "Regeneron", CVS: "CVS Health", MDT: "Medtronic",
  MRNA: "Moderna", HUM: "Humana",
  // Consumer
  WMT: "Walmart", COST: "Costco", HD: "Home Depot", LOW: "Lowe's", TGT: "Target",
  NKE: "Nike", MCD: "McDonald's", SBUX: "Starbucks", CMG: "Chipotle", KO: "Coca-Cola",
  PEP: "PepsiCo", PG: "Procter & Gamble", PM: "Philip Morris", MDLZ: "Mondelez",
  CL: "Colgate-Palmolive", EL: "Estée Lauder", LULU: "Lululemon", BKNG: "Booking Holdings",
  MAR: "Marriott", DPZ: "Domino's Pizza",
  // Industrials / energy / materials
  CAT: "Caterpillar", DE: "Deere", BA: "Boeing", GE: "GE Aerospace", HON: "Honeywell",
  UPS: "UPS", FDX: "FedEx", RTX: "RTX (Raytheon)", LMT: "Lockheed Martin",
  NOC: "Northrop Grumman", XOM: "Exxon Mobil", CVX: "Chevron", COP: "ConocoPhillips",
  SLB: "SLB (Schlumberger)", OXY: "Occidental", MPC: "Marathon Petroleum",
  PSX: "Phillips 66", FCX: "Freeport-McMoRan", NEM: "Newmont", LIN: "Linde",
  // Autos / EV
  F: "Ford", GM: "General Motors", RIVN: "Rivian", LCID: "Lucid", NIO: "NIO",
  // Other
  BABA: "Alibaba", PDD: "PDD Holdings", JD: "JD.com", MELI: "MercadoLibre",
  SQ: "Block", AFRM: "Affirm", SOFI: "SoFi", DKNG: "DraftKings",
  CVNA: "Carvana", PLUG: "Plug Power",
};

export function nameFor(ticker: string): string {
  return NAMES[ticker] ?? ticker;
}

// ---- Sectors / categories ----

export const CATEGORIES = [
  "Tutte",
  "Tech",
  "Comunicazione",
  "Finanza",
  "Salute",
  "Consumi",
  "Industria & Energia",
  "Auto & EV",
  "Altro",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const SECTORS: Record<string, Category> = {
  // Tech
  AAPL: "Tech", MSFT: "Tech", GOOGL: "Tech", GOOG: "Tech", AMZN: "Tech",
  META: "Tech", NVDA: "Tech", TSLA: "Tech", AVGO: "Tech", ORCL: "Tech",
  ADBE: "Tech", CRM: "Tech", AMD: "Tech", INTC: "Tech", CSCO: "Tech",
  QCOM: "Tech", TXN: "Tech", INTU: "Tech", IBM: "Tech", NOW: "Tech",
  AMAT: "Tech", MU: "Tech", LRCX: "Tech", ADI: "Tech", PANW: "Tech",
  SNPS: "Tech", CDNS: "Tech", KLAC: "Tech", ANET: "Tech", FTNT: "Tech",
  PLTR: "Tech", CRWD: "Tech", DDOG: "Tech", SNOW: "Tech", NET: "Tech",
  SHOP: "Tech", UBER: "Tech", ABNB: "Tech", MRVL: "Tech", WDAY: "Tech",
  TEAM: "Tech", DELL: "Tech", HPQ: "Tech", SMCI: "Tech",
  // Communication / media
  NFLX: "Comunicazione", DIS: "Comunicazione", CMCSA: "Comunicazione",
  T: "Comunicazione", VZ: "Comunicazione", TMUS: "Comunicazione",
  WBD: "Comunicazione", SPOT: "Comunicazione", RBLX: "Comunicazione",
  PINS: "Comunicazione", SNAP: "Comunicazione", ROKU: "Comunicazione",
  // Financials
  JPM: "Finanza", BAC: "Finanza", WFC: "Finanza", C: "Finanza", GS: "Finanza",
  MS: "Finanza", SCHW: "Finanza", AXP: "Finanza", BLK: "Finanza", SPGI: "Finanza",
  V: "Finanza", MA: "Finanza", PYPL: "Finanza", COF: "Finanza", USB: "Finanza",
  PNC: "Finanza", BX: "Finanza", KKR: "Finanza", COIN: "Finanza", HOOD: "Finanza",
  // Healthcare
  UNH: "Salute", JNJ: "Salute", LLY: "Salute", ABBV: "Salute", MRK: "Salute",
  PFE: "Salute", TMO: "Salute", ABT: "Salute", DHR: "Salute", BMY: "Salute",
  AMGN: "Salute", GILD: "Salute", ISRG: "Salute", VRTX: "Salute", REGN: "Salute",
  CVS: "Salute", MDT: "Salute", MRNA: "Salute", HUM: "Salute",
  // Consumer
  WMT: "Consumi", COST: "Consumi", HD: "Consumi", LOW: "Consumi", TGT: "Consumi",
  NKE: "Consumi", MCD: "Consumi", SBUX: "Consumi", CMG: "Consumi", KO: "Consumi",
  PEP: "Consumi", PG: "Consumi", PM: "Consumi", MDLZ: "Consumi", CL: "Consumi",
  EL: "Consumi", LULU: "Consumi", BKNG: "Consumi", MAR: "Consumi", DPZ: "Consumi",
  // Industrials / energy / materials
  CAT: "Industria & Energia", DE: "Industria & Energia", BA: "Industria & Energia",
  GE: "Industria & Energia", HON: "Industria & Energia", UPS: "Industria & Energia",
  FDX: "Industria & Energia", RTX: "Industria & Energia", LMT: "Industria & Energia",
  NOC: "Industria & Energia", XOM: "Industria & Energia", CVX: "Industria & Energia",
  COP: "Industria & Energia", SLB: "Industria & Energia", OXY: "Industria & Energia",
  MPC: "Industria & Energia", PSX: "Industria & Energia", FCX: "Industria & Energia",
  NEM: "Industria & Energia", LIN: "Industria & Energia",
  // Autos / EV
  F: "Auto & EV", GM: "Auto & EV", RIVN: "Auto & EV", LCID: "Auto & EV", NIO: "Auto & EV",
  // Other
  BABA: "Altro", PDD: "Altro", JD: "Altro", MELI: "Altro", SQ: "Altro",
  AFRM: "Altro", SOFI: "Altro", DKNG: "Altro", CVNA: "Altro", PLUG: "Altro",
};

export function sectorFor(ticker: string): Category {
  return SECTORS[ticker] ?? "Altro";
}

// ---- Logo domains (for logo.clearbit.com) ----

export const DOMAINS: Record<string, string> = {
  AAPL: "apple.com", MSFT: "microsoft.com", GOOGL: "google.com", GOOG: "google.com",
  AMZN: "amazon.com", META: "meta.com", NVDA: "nvidia.com", TSLA: "tesla.com",
  AVGO: "broadcom.com", ORCL: "oracle.com", ADBE: "adobe.com", CRM: "salesforce.com",
  AMD: "amd.com", INTC: "intel.com", CSCO: "cisco.com", QCOM: "qualcomm.com",
  TXN: "ti.com", INTU: "intuit.com", IBM: "ibm.com", NOW: "servicenow.com",
  AMAT: "appliedmaterials.com", MU: "micron.com", LRCX: "lamresearch.com", ADI: "analog.com",
  PANW: "paloaltonetworks.com", SNPS: "synopsys.com", CDNS: "cadence.com", KLAC: "kla.com",
  ANET: "arista.com", FTNT: "fortinet.com", PLTR: "palantir.com", CRWD: "crowdstrike.com",
  DDOG: "datadoghq.com", SNOW: "snowflake.com", NET: "cloudflare.com", SHOP: "shopify.com",
  UBER: "uber.com", ABNB: "airbnb.com", MRVL: "marvell.com", WDAY: "workday.com",
  TEAM: "atlassian.com", DELL: "dell.com", HPQ: "hp.com", SMCI: "supermicro.com",
  NFLX: "netflix.com", DIS: "disney.com", CMCSA: "comcast.com", T: "att.com",
  VZ: "verizon.com", TMUS: "t-mobile.com", WBD: "wbd.com", SPOT: "spotify.com",
  RBLX: "roblox.com", PINS: "pinterest.com", SNAP: "snap.com", ROKU: "roku.com",
  JPM: "jpmorganchase.com", BAC: "bankofamerica.com", WFC: "wellsfargo.com", C: "citi.com",
  GS: "goldmansachs.com", MS: "morganstanley.com", SCHW: "schwab.com", AXP: "americanexpress.com",
  BLK: "blackrock.com", SPGI: "spglobal.com", V: "visa.com", MA: "mastercard.com",
  PYPL: "paypal.com", COF: "capitalone.com", USB: "usbank.com", PNC: "pnc.com",
  BX: "blackstone.com", KKR: "kkr.com", COIN: "coinbase.com", HOOD: "robinhood.com",
  UNH: "unitedhealthgroup.com", JNJ: "jnj.com", LLY: "lilly.com", ABBV: "abbvie.com",
  MRK: "merck.com", PFE: "pfizer.com", TMO: "thermofisher.com", ABT: "abbott.com",
  DHR: "danaher.com", BMY: "bms.com", AMGN: "amgen.com", GILD: "gilead.com",
  ISRG: "intuitive.com", VRTX: "vrtx.com", REGN: "regeneron.com", CVS: "cvshealth.com",
  MDT: "medtronic.com", MRNA: "modernatx.com", HUM: "humana.com",
  WMT: "walmart.com", COST: "costco.com", HD: "homedepot.com", LOW: "lowes.com",
  TGT: "target.com", NKE: "nike.com", MCD: "mcdonalds.com", SBUX: "starbucks.com",
  CMG: "chipotle.com", KO: "coca-colacompany.com", PEP: "pepsico.com", PG: "pg.com",
  PM: "pmi.com", MDLZ: "mondelezinternational.com", CL: "colgatepalmolive.com", EL: "elcompanies.com",
  LULU: "lululemon.com", BKNG: "bookingholdings.com", MAR: "marriott.com", DPZ: "dominos.com",
  CAT: "caterpillar.com", DE: "deere.com", BA: "boeing.com", GE: "geaerospace.com",
  HON: "honeywell.com", UPS: "ups.com", FDX: "fedex.com", RTX: "rtx.com",
  LMT: "lockheedmartin.com", NOC: "northropgrumman.com", XOM: "exxonmobil.com", CVX: "chevron.com",
  COP: "conocophillips.com", SLB: "slb.com", OXY: "oxy.com", MPC: "marathonpetroleum.com",
  PSX: "phillips66.com", FCX: "fcx.com", NEM: "newmont.com", LIN: "linde.com",
  F: "ford.com", GM: "gm.com", RIVN: "rivian.com", LCID: "lucidmotors.com", NIO: "nio.com",
  BABA: "alibabagroup.com", PDD: "pddholdings.com", JD: "jd.com", MELI: "mercadolibre.com",
  SQ: "block.xyz", AFRM: "affirm.com", SOFI: "sofi.com", DKNG: "draftkings.com",
  CVNA: "carvana.com", PLUG: "plugpower.com",
};

export function domainFor(ticker: string): string | null {
  return DOMAINS[ticker] ?? null;
}
