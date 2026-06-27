import { NextRequest, NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/marketData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/quotes?tickers=AAPL,MSFT,MS -> { prices: { AAPL: 1.23, ... } }
export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = param
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  if (tickers.length === 0) {
    return NextResponse.json({ prices: {} });
  }
  const prices = await fetchQuotes([...new Set(tickers)]);
  return NextResponse.json({ prices, at: new Date().toISOString() });
}
