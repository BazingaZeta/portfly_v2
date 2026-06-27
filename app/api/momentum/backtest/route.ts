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
    accountSize: sp.get("account") ? Number(sp.get("account")) : 10_000,
    riskPct: sp.get("risk") ? Number(sp.get("risk")) : 1,
    maxPositions: sp.get("maxpos") ? Number(sp.get("maxpos")) : 5,
    slippageBps: 5,
    maxHoldBars: sp.get("hold") ? Number(sp.get("hold")) : 20,
    stopAtr: sp.get("stopAtr") ? Number(sp.get("stopAtr")) : 2,
    targetAtr: sp.get("targetAtr") ? Number(sp.get("targetAtr")) : 3,
    scanFreq: sp.get("freq") ? Number(sp.get("freq")) : 5,
    topN: sp.get("topN") ? Number(sp.get("topN")) : 5,
    minMetaR2: sp.get("r2") ? Number(sp.get("r2")) : 0.5,
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
