import { NextRequest, NextResponse } from "next/server";
import {
  runTick, getAutoState, getAutoLog, getAutoTrades, getAutoEquityCurve,
  startAutopilot, resetAutopilot, getAutoStateRow,
} from "@/lib/autopilotEngine";
import { fetchQuotes, fetchMarketStatus } from "@/lib/marketData";
import { AUTO_UNIVERSE } from "@/lib/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function snapshot() {
  const [prices, market] = await Promise.all([fetchQuotes(AUTO_UNIVERSE), fetchMarketStatus()]);
  return {
    state: getAutoState((t) => prices[t] ?? 0),
    market,
    log: getAutoLog(80),
    trades: getAutoTrades(40),
    equity: getAutoEquityCurve(),
  };
}

export async function GET() {
  if (!getAutoStateRow()) {
    return NextResponse.json({ state: { running: false }, log: [], trades: [], equity: [] });
  }
  return NextResponse.json(await snapshot());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  let rebalanced = false;
  if (action === "start") {
    startAutopilot(Number(body.capital) > 0 ? Number(body.capital) : 10000);
    const r = await runTick(true); // immediately invest
    rebalanced = r.rebalanced;
  } else if (action === "run") {
    const r = await runTick(Boolean(body.force));
    rebalanced = r.rebalanced;
  } else if (action === "reset") {
    resetAutopilot();
    return NextResponse.json({ ok: true, reset: true });
  } else {
    return NextResponse.json({ error: "action non valida" }, { status: 400 });
  }
  return NextResponse.json({ ...(await snapshot()), rebalanced, ranAt: new Date().toISOString() });
}
