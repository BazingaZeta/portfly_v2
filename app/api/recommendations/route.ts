import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  getRecommendationsByDate,
  getLatestScanDate,
  getMeta,
} from "@/lib/db";
import { checkAutopilotHeartbeat } from "@/lib/heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // La dashboard è la pagina più visitata: heartbeat dei bot agganciato qui
  // (post-risposta, best-effort) così l'alert parte anche se non apri Autopilot.
  after(() => checkAutopilotHeartbeat());
  const dateParam = req.nextUrl.searchParams.get("date");
  const latest = await getLatestScanDate();
  const lastScanAttempt = await getMeta("last_scan_date");
  const regimeRaw = await getMeta("market_regime");
  const marketRegime = regimeRaw ? JSON.parse(regimeRaw) : null;
  const date = dateParam ?? latest;
  if (!date) {
    return NextResponse.json({ scanDate: null, recommendations: [], lastScanAttempt, marketRegime });
  }
  const recommendations = await getRecommendationsByDate(date);
  return NextResponse.json({
    scanDate: date,
    latestScanDate: latest,
    lastScanAttempt,
    marketRegime,
    recommendations,
  });
}
