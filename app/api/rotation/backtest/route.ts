import { NextRequest, NextResponse } from "next/server";
import { runRotationBacktest } from "@/lib/leverageRotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const result = await runRotationBacktest({
      bull: sp.get("bull") ?? undefined,
      defensive: sp.get("def") ?? undefined,
      smaPeriod: sp.get("sma") ? Number(sp.get("sma")) : undefined,
      years: sp.get("years") ? Number(sp.get("years")) : undefined,
      accountSize: sp.get("account") ? Number(sp.get("account")) : undefined,
      slippageBps: sp.get("slip") ? Number(sp.get("slip")) : undefined,
      folds: sp.get("folds") ? Number(sp.get("folds")) : undefined,
      deep: sp.get("deep") === "1",
      hysteresisPct: sp.get("hyst") ? Number(sp.get("hyst")) : undefined,
      mode: sp.get("mode") === "ladder" ? ("ladder" as const) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backtest fallito" },
      { status: 500 }
    );
  }
}
