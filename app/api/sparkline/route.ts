import { NextRequest, NextResponse } from "next/server";
import { fetchCandles } from "@/lib/marketData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/sparkline?tickers=AAPL,MS&days=40 -> { series: { AAPL: number[], ... } }
export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("tickers") ?? "";
  const days = Math.min(Number(req.nextUrl.searchParams.get("days")) || 40, 120);
  const tickers = [
    ...new Set(
      param.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
    ),
  ];
  if (tickers.length === 0) return NextResponse.json({ series: {} });

  const series: Record<string, number[]> = {};
  await Promise.all(
    tickers.map(async (t) => {
      const candles = await fetchCandles(t);
      if (candles.length) {
        series[t] = candles.slice(-days).map((c) => +c.close.toFixed(2));
      }
    })
  );
  return NextResponse.json({ series });
}
