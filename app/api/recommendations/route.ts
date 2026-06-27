import { NextRequest, NextResponse } from "next/server";
import {
  getRecommendationsByDate,
  getLatestScanDate,
  getMeta,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get("date");
  const latest = getLatestScanDate();
  const lastScanAttempt = getMeta("last_scan_date");
  const regimeRaw = getMeta("market_regime");
  const marketRegime = regimeRaw ? JSON.parse(regimeRaw) : null;
  const date = dateParam ?? latest;
  if (!date) {
    return NextResponse.json({ scanDate: null, recommendations: [], lastScanAttempt, marketRegime });
  }
  const recommendations = getRecommendationsByDate(date);
  return NextResponse.json({
    scanDate: date,
    latestScanDate: latest,
    lastScanAttempt,
    marketRegime,
    recommendations,
  });
}
