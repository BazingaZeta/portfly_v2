/**
 * Portafoglio del backtest nel formato del riepilogo di Antonio: una riga per
 * titolo (aperto o chiuso) con P&L realizzato e non realizzato, e il registro
 * delle operazioni con la liquidità residua dopo ogni riga.
 *
 * Si ricostruisce dai trade del motore, che sono righe di uscita: ogni riga ha
 * la sua data e il suo prezzo d'ingresso, e le vendite parziali (trim) della
 * stessa posizione condividono l'ingresso. Una posizione ("lotto") è quindi
 * titolo + data d'ingresso, e la quantità comprata è la somma delle sue righe.
 * Le righe "end_of_test" non sono vendite: il motore chiude d'ufficio a fine
 * test per confrontare le varianti, qui restano posizioni APERTE.
 */

export interface BtTrade {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  shares: number;
  pnl: number;
  outcome: string;
}

export interface PortfolioRow {
  ticker: string;
  name: string;
  /** Quantità ancora in portafoglio a fine test. */
  shares: number;
  /** Costo medio della quantità in portafoglio (0 se chiusa). */
  avgCost: number;
  /** Chiusura dell'ultimo giorno del test. */
  price: number;
  value: number;
  /** Somma dei P&L di tutte le vendite di questo titolo nel tempo. */
  realizedPnl: number;
  /** Plus/minus sulla quantità ancora detenuta, rispetto al costo medio. */
  openPnl: number;
  totalPnl: number;
  status: "APERTA" | "CHIUSA";
  /** Peso sul portafoglio (titoli + liquidità), in %. */
  weightPct: number;
  /** Variazione dell'ultimo giorno, in %. */
  dayPct: number | null;
  /** Rendimento della quantità aperta sul suo costo, in %. */
  openPct: number | null;
  /** Controvalore d'acquisto della quantità in portafoglio. */
  invested: number;
  /** Numero di acquisti fatti su questo titolo nel periodo. */
  buys: number;
}

export interface LedgerRow {
  n: number;
  date: string;
  ticker: string;
  side: "ACQUISTO" | "VENDITA";
  shares: number;
  price: number;
  /** Controvalore: negativo per gli acquisti (escono soldi), positivo per le vendite. */
  amount: number;
  /** Liquidità dopo questa operazione. */
  cash: number;
  /** Solo vendite: P&L realizzato e motivo. */
  pnl?: number;
  outcome?: string;
}

export interface BacktestPortfolio {
  rows: PortfolioRow[];
  ledger: LedgerRow[];
  totals: {
    value: number;
    realizedPnl: number;
    openPnl: number;
    totalPnl: number;
    invested: number;
    cash: number;
    equity: number;
    initial: number;
    openPositions: number;
  };
}

export function backtestPortfolio(
  trades: BtTrade[],
  endPrices: Record<string, { close: number; prevClose: number }>,
  names: Record<string, string>,
  initial: number
): BacktestPortfolio {
  // ── Lotti: titolo + data d'ingresso.
  const lots = new Map<string, { ticker: string; date: string; price: number; shares: number }>();
  for (const t of trades) {
    const k = `${t.ticker}|${t.entryDate}`;
    const lot = lots.get(k) ?? { ticker: t.ticker, date: t.entryDate, price: t.entryPrice, shares: 0 };
    lot.shares += t.shares;
    lots.set(k, lot);
  }

  // ── Registro: acquisti (un lotto = un acquisto) e vendite (ogni riga non end_of_test).
  type Op = Omit<LedgerRow, "n" | "cash">;
  const ops: Op[] = [];
  for (const lot of lots.values()) {
    ops.push({ date: lot.date, ticker: lot.ticker, side: "ACQUISTO", shares: lot.shares, price: lot.price, amount: -lot.shares * lot.price });
  }
  for (const t of trades) {
    if (t.outcome === "end_of_test") continue;
    ops.push({
      date: t.exitDate, ticker: t.ticker, side: "VENDITA", shares: t.shares, price: t.exitPrice,
      amount: t.shares * t.exitPrice, pnl: t.pnl, outcome: t.outcome,
    });
  }
  // Nello stesso giorno prima le vendite: il motore esce al close e compra
  // all'apertura del giorno dopo, quindi la cassa liberata è già disponibile.
  ops.sort((a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === "VENDITA" ? -1 : 1));
  let cash = initial;
  const ledger: LedgerRow[] = ops.map((o, i) => {
    cash += o.amount;
    return { ...o, n: i + 1, amount: +o.amount.toFixed(2), cash: +cash.toFixed(2) };
  });

  // ── Riepilogo per titolo.
  const byTicker = new Map<string, BtTrade[]>();
  for (const t of trades) byTicker.set(t.ticker, [...(byTicker.get(t.ticker) ?? []), t]);
  const raw = [...byTicker.entries()].map(([ticker, ts]) => {
    const open = ts.filter((t) => t.outcome === "end_of_test");
    const shares = open.reduce((s, t) => s + t.shares, 0);
    const invested = open.reduce((s, t) => s + t.shares * t.entryPrice, 0);
    const avgCost = shares > 0 ? invested / shares : 0;
    const ep = endPrices[ticker];
    const price = ep?.close ?? (open[0]?.exitPrice ?? ts[ts.length - 1].exitPrice);
    const value = shares * price;
    const realizedPnl = ts.filter((t) => t.outcome !== "end_of_test").reduce((s, t) => s + t.pnl, 0);
    const openPnl = shares > 0 ? value - invested : 0;
    const buys = new Set(ts.map((t) => t.entryDate)).size;
    return {
      ticker, name: names[ticker] ?? ticker, shares, avgCost, price, value, realizedPnl, openPnl,
      totalPnl: realizedPnl + openPnl, status: (shares > 0 ? "APERTA" : "CHIUSA") as PortfolioRow["status"],
      dayPct: ep && ep.prevClose > 0 ? ((ep.close - ep.prevClose) / ep.prevClose) * 100 : null,
      openPct: invested > 0 ? (openPnl / invested) * 100 : null,
      invested, buys,
    };
  });

  const value = raw.reduce((s, r) => s + r.value, 0);
  const equity = value + cash;
  const rows: PortfolioRow[] = raw
    .map((r) => ({
      ...r,
      shares: +r.shares.toFixed(4),
      avgCost: +r.avgCost.toFixed(2),
      price: +r.price.toFixed(2),
      value: +r.value.toFixed(2),
      realizedPnl: +r.realizedPnl.toFixed(2),
      openPnl: +r.openPnl.toFixed(2),
      totalPnl: +r.totalPnl.toFixed(2),
      invested: +r.invested.toFixed(2),
      weightPct: equity > 0 ? +((r.value / equity) * 100).toFixed(2) : 0,
      dayPct: r.dayPct != null ? +r.dayPct.toFixed(2) : null,
      openPct: r.openPct != null ? +r.openPct.toFixed(2) : null,
    }))
    // Prima le aperte (per peso), poi le chiuse (per P&L).
    .sort((a, b) => (a.status !== b.status ? (a.status === "APERTA" ? -1 : 1) : a.status === "APERTA" ? b.value - a.value : b.totalPnl - a.totalPnl));

  const sum = (f: (r: PortfolioRow) => number) => +rows.reduce((s, r) => s + f(r), 0).toFixed(2);
  return {
    rows,
    ledger,
    totals: {
      value: sum((r) => r.value),
      realizedPnl: sum((r) => r.realizedPnl),
      openPnl: sum((r) => r.openPnl),
      totalPnl: sum((r) => r.totalPnl),
      invested: sum((r) => r.invested),
      cash: +cash.toFixed(2),
      equity: +equity.toFixed(2),
      initial,
      openPositions: rows.filter((r) => r.status === "APERTA").length,
    },
  };
}
