import { NextRequest } from "next/server";
import { runBacktest, type BacktestProgress } from "@/lib/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const opts = {
    lookbackDays: sp.get("lookback") ? Number(sp.get("lookback")) : undefined,
    scoreThreshold: sp.get("threshold") ? Number(sp.get("threshold")) : undefined,
    maxHoldDays: sp.get("maxHold") ? Number(sp.get("maxHold")) : undefined,
    useRegime: sp.get("regime") ? sp.get("regime") === "1" : undefined,
    riskPct: sp.get("risk") ? Number(sp.get("risk")) : undefined,
    accountSize: sp.get("account") ? Number(sp.get("account")) : undefined,
    maxConcurrent: sp.get("maxc") ? Number(sp.get("maxc")) : undefined,
    slippageBps: sp.get("slip") ? Number(sp.get("slip")) : undefined,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runBacktest((p: BacktestProgress) => send("progress", p), opts);
        // Infinity isn't valid JSON; coerce for transport.
        for (const s of [result.summary, result.is, result.oos]) {
          if (!isFinite(s.profitFactor)) (s as { profitFactor: number }).profitFactor = 999;
        }
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
