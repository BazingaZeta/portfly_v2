import { runScan, type ScanProgress } from "@/lib/scanner";
import {
  deleteRecommendationsForDate,
  insertRecommendations,
  insertSentimentHistory,
  setMeta,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Streams scan progress as Server-Sent Events, then persists the results.
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const onProgress = (p: ScanProgress) => send("progress", p);
        const { recommendations: recs, regime, sentimentSamples } = await runScan(onProgress);

        const scanDate =
          recs[0]?.scanDate ?? sentimentSamples[0]?.scanDate ?? new Date().toISOString().slice(0, 10);
        deleteRecommendationsForDate(scanDate);
        if (recs.length) insertRecommendations(recs);
        // Persist the sentiment snapshot of every technical finalist for later
        // validation of the news overlay (best-effort; never blocks the scan).
        if (sentimentSamples.length) {
          insertSentimentHistory(sentimentSamples).catch(() => {});
        }
        // Mark today as scanned even if 0 signals, so auto-scan doesn't re-run.
        setMeta("last_scan_date", scanDate);
        if (regime) setMeta("market_regime", JSON.stringify(regime));

        send("complete", { scanDate, count: recs.length, regime });
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "Scan fallita" });
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
