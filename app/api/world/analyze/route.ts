import { NextRequest } from "next/server";
import { runWorldAnalysis, type WorldProgress } from "@/lib/worldMomentum";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Numero dai query param, con default se assente o non numerico. */
function num(req: NextRequest, key: string, fallback: number): number {
  const raw = req.nextUrl.searchParams.get(key);
  if (raw == null) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

// SSE: manda il progresso ticker per ticker, poi l'analisi completa dei due stadi.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Non autenticato", { status: 401 });

  const indexKey = req.nextUrl.searchParams.get("index") ?? "SP500";
  const opts = {
    indexKey,
    metaWindow: num(req, "metaWindow", 60),
    minMetaR2: num(req, "minMetaR2", 0.5),
    strongTopN: num(req, "strongTopN", 20),
    priceWindow: num(req, "priceWindow", 40),
    minPriceR2: num(req, "minPriceR2", 0.5),
    entryMaxZ: num(req, "entryMaxZ", 0),
    useRegime: req.nextUrl.searchParams.get("useRegime") !== "false",
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runWorldAnalysis(opts, (p: WorldProgress) => send("progress", p));
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
