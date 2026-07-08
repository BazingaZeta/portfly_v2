import { NextResponse } from "next/server";
import { analyzeCryptoTrend } from "@/lib/cryptoTrend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/crypto/analyze -> stato corrente del segnale Crypto Trend (BTC/ETH).
export async function GET() {
  try {
    const status = await analyzeCryptoTrend();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "errore" }, { status: 500 });
  }
}
