import { NextRequest, NextResponse } from "next/server";
import { runCryptoTrendBacktest } from "@/lib/cryptoTrend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/crypto/backtest?years=12&folds=5&sma=100&hysteresis=3
// Backtest della strategia Crypto Trend (benchmark BTC buy&hold).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const num = (k: string) => (sp.get(k) != null ? Number(sp.get(k)) : undefined);
  try {
    const result = await runCryptoTrendBacktest({
      years: num("years"),
      folds: num("folds"),
      smaPeriod: num("sma"),
      hysteresisPct: num("hysteresis"),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "errore" }, { status: 500 });
  }
}
