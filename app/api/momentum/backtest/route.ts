import { NextRequest } from "next/server";
import { runMomentumBacktest } from "@/lib/momentumBacktest";
import { getSession } from "@/lib/auth";
import type { BacktestProgress } from "@/lib/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Non autenticato", { status: 401 });

  const sp = req.nextUrl.searchParams;

  const startDate = sp.get("start") ?? "";
  const endDate = sp.get("end") ?? "";
  if (!startDate || !endDate)
    return new Response("start e end sono obbligatori", { status: 400 });

  const opts = {
    indexKey: sp.get("index") ?? "SP500",
    startDate,
    endDate,
    accountSize: sp.get("account") ? Number(sp.get("account")) : undefined,
    riskPct: sp.get("risk") ? Number(sp.get("risk")) : undefined,
    maxPositions: sp.get("maxpos") ? Number(sp.get("maxpos")) : undefined,
    slippageBps: 5,
    // Parametri assenti → default v3 del motore (config validata walk-forward).
    maxHoldBars: sp.get("hold") ? Number(sp.get("hold")) : undefined,
    stopAtr: sp.get("stopAtr") ? Number(sp.get("stopAtr")) : undefined,
    targetAtr: sp.get("targetAtr") ? Number(sp.get("targetAtr")) : undefined,
    scanFreq: sp.get("freq") ? Number(sp.get("freq")) : undefined,
    topN: sp.get("topN") ? Number(sp.get("topN")) : undefined,
    minMetaR2: sp.get("r2") ? Number(sp.get("r2")) : undefined,
    folds: sp.get("folds") ? Number(sp.get("folds")) : undefined,
    // "off" disattiva il gate z (null); assente = default del motore (0.5, parity live)
    maxZ: sp.get("maxZ") === "off" ? null : sp.get("maxZ") ? Number(sp.get("maxZ")) : undefined,
    stopMode: sp.get("stopMode") === "atr" ? ("atr" as const)
      : sp.get("stopMode") === "channel" ? ("channel" as const) : undefined,
    useRegime: sp.get("regime") ? sp.get("regime") === "1" : undefined,
    // "off" → null (trailing disattivato); assente → default v3 (3 × ATR)
    trailAtr: sp.get("trail") === "off" ? null : sp.get("trail") ? Number(sp.get("trail")) : undefined,
    exitOnTrendBreak: sp.get("trendExit") ? sp.get("trendExit") === "1" : undefined,
    sizing: sp.get("sizing") === "equal" ? ("equal" as const)
      : sp.get("sizing") === "risk" ? ("risk" as const) : undefined,
    w30: sp.get("w30") ? Number(sp.get("w30")) : undefined,
    w90: sp.get("w90") ? Number(sp.get("w90")) : undefined,
    w180: sp.get("w180") ? Number(sp.get("w180")) : undefined,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runMomentumBacktest(opts, (p: BacktestProgress) => send("progress", p));
        // Sanitize Infinity
        if (!isFinite(result.summary.profitFactor))
          (result.summary as { profitFactor: number }).profitFactor = 99;
        send("complete", result);
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "Backtest fallito" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
