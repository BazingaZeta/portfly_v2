import { NextRequest } from "next/server";
import { runIndexOptimize } from "@/lib/indexBacktest";
import type { BacktestProgress } from "@/lib/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const indexKey = req.nextUrl.searchParams.get("index") ?? "SP500";
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runIndexOptimize(indexKey, (p: BacktestProgress) => send("progress", p));
        for (const r of result.rows) {
          for (const s of [r.full, r.is, r.oos]) {
            if (!isFinite(s.profitFactor)) (s as { profitFactor: number }).profitFactor = 999;
          }
        }
        send("complete", result);
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "Ottimizzazione fallita" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
