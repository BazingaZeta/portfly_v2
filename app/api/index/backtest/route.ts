import { NextRequest } from "next/server";
import { runIndexBacktest } from "@/lib/indexBacktest";
import type { BacktestProgress } from "@/lib/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const opts = {
    indexKey: sp.get("index") ?? "SP500",
    lookbackDays: sp.get("lookback") ? Number(sp.get("lookback")) : undefined,
    maxHoldDays: sp.get("maxHold") ? Number(sp.get("maxHold")) : undefined,
    riskPct: sp.get("risk") ? Number(sp.get("risk")) : undefined,
    accountSize: sp.get("account") ? Number(sp.get("account")) : undefined,
    maxConcurrent: sp.get("maxc") ? Number(sp.get("maxc")) : undefined,
    slippageBps: sp.get("slip") ? Number(sp.get("slip")) : undefined,
    requireRs: sp.get("rs") ? sp.get("rs") === "1" : undefined,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runIndexBacktest(opts, (p: BacktestProgress) => send("progress", p));
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
