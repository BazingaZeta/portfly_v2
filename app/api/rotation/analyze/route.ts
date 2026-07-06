import { NextRequest, NextResponse } from "next/server";
import { analyzeRotation } from "@/lib/leverageRotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const status = await analyzeRotation({
      bull: sp.get("bull") ?? undefined,
      defensive: sp.get("def") ?? undefined,
      smaPeriod: sp.get("sma") ? Number(sp.get("sma")) : undefined,
      hysteresisPct: sp.get("hyst") ? Number(sp.get("hyst")) : undefined,
    });
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analisi fallita" },
      { status: 500 }
    );
  }
}
