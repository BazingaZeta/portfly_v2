import { NextRequest } from "next/server";
import { runMomentumAnalysis, type MomentumProgress } from "@/lib/momentumAnalysis";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// SSE: streams progress updates then the full momentum analysis for the chosen index.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response("Non autenticato", { status: 401 });
  }

  const indexKey = req.nextUrl.searchParams.get("index") ?? "SP500";
  const topN = parseInt(req.nextUrl.searchParams.get("topN") ?? "25", 10);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        const result = await runMomentumAnalysis(indexKey, (p: MomentumProgress) => send("progress", p), topN);
        send("complete", result);
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "Analisi fallita" });
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
