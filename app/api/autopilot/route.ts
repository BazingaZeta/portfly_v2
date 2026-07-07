import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  runTick, getAutoState, getAutoLog, getAutoTrades, getAutoEquityCurve,
  startAutopilot, resetAutopilot, getAutoStateRow, getAutopilotStrategy,
  getKillSwitch, resumeAutopilot, setMaxDd,
  type AutopilotStrategy,
} from "@/lib/autopilotEngine";
import { telegramConfigured } from "@/lib/notify";
import { fetchQuotes, fetchMarketStatus } from "@/lib/marketData";
import { AUTO_UNIVERSE } from "@/lib/autopilot";
import { getAutoPositions } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// If nobody (cron or user) has ticked for this long, a page view triggers one.
const LAZY_TICK_AFTER_MS = 12 * 60 * 60 * 1000;

async function snapshot() {
  const strategyInfo = await getAutopilotStrategy();
  const positions = await getAutoPositions();
  const quoteList = [
    ...new Set([
      ...(strategyInfo.strategy === "rotation"
        ? [strategyInfo.rotation.bull,
           ...(strategyInfo.rotation.defensive !== "CASH" ? [strategyInfo.rotation.defensive] : [])]
        : strategyInfo.strategy === "crypto_trend"
        ? strategyInfo.crypto.assets
        : AUTO_UNIVERSE),
      ...positions.map((p) => p.ticker),
    ]),
  ];
  const [prices, market] = await Promise.all([fetchQuotes(quoteList), fetchMarketStatus()]);
  const [state, log, trades, equity, kill] = await Promise.all([
    getAutoState((t) => prices[t] ?? 0),
    getAutoLog(80),
    getAutoTrades(40),
    getAutoEquityCurve(),
    getKillSwitch(),
  ]);
  return {
    state,
    strategy: strategyInfo,
    market,
    log,
    trades,
    equity,
    kill: { ...kill, telegram: telegramConfigured() },
  };
}

export async function GET() {
  const row = await getAutoStateRow();
  if (!row) {
    return NextResponse.json({ state: { running: false }, log: [], trades: [], equity: [] });
  }
  // Lazy tick: keeps the paper account fresh even without a configured cron.
  // Runs after the response is sent (serverless-safe via `after`).
  const lastRun = row.last_run ? new Date(row.last_run).getTime() : 0;
  if (Date.now() - lastRun > LAZY_TICK_AFTER_MS) {
    after(async () => {
      try {
        await runTick(false);
        console.log("[autopilot] lazy tick eseguito (ultimo run datato)");
      } catch (e) {
        console.error("[autopilot] lazy tick fallito:", e instanceof Error ? e.message : e);
      }
    });
  }
  return NextResponse.json(await snapshot());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  let rebalanced = false;
  if (action === "start") {
    const strategy: AutopilotStrategy =
      body.strategy === "rotation" ? "rotation" : body.strategy === "crypto_trend" ? "crypto_trend" : "dual_momentum";
    await startAutopilot(
      Number(body.capital) > 0 ? Number(body.capital) : 10000,
      strategy,
      strategy === "rotation"
        ? { bull: body.bull, defensive: body.defensive, smaPeriod: Number(body.sma) || undefined }
        : undefined,
      strategy === "crypto_trend"
        ? { assets: body.assets, smaPeriod: Number(body.sma) || undefined, hysteresisPct: Number(body.hysteresis) }
        : undefined
    );
    const r = await runTick(true); // immediately invest
    rebalanced = r.rebalanced;
  } else if (action === "run") {
    const r = await runTick(Boolean(body.force));
    rebalanced = r.rebalanced;
  } else if (action === "reset") {
    await resetAutopilot();
    return NextResponse.json({ ok: true, reset: true });
  } else if (action === "resume") {
    await resumeAutopilot();
  } else if (action === "setMaxDd") {
    await setMaxDd(Number(body.maxDdPct) || 25);
  } else {
    return NextResponse.json({ error: "action non valida" }, { status: 400 });
  }
  return NextResponse.json({ ...(await snapshot()), rebalanced, ranAt: new Date().toISOString() });
}
