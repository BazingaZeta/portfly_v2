import { NextResponse } from "next/server";
import { fetchTickerTape } from "@/lib/tickerTape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ticker -> { items: [{ symbol, label, price, changePct, kind }], at }
// Alimenta il nastro scorrevole in cima all'app.
export async function GET() {
  const items = await fetchTickerTape();
  return NextResponse.json({ items, at: new Date().toISOString() });
}
