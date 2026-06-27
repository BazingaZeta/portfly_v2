import { NextRequest } from "next/server";
import { runIndexAnalysis, type AnalysisProgress } from "@/lib/indexAnalysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// SSE: streams progress, then the leaders + signals for the chosen index.
export async function GET(req: NextRequest) {
  const indexKey = req.nextUrl.searchParams.get("index") ?? "SP500";
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runIndexAnalysis(indexKey, (p: AnalysisProgress) => send("progress", p));
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
