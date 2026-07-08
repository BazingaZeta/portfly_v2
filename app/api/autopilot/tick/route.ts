import { NextRequest, NextResponse } from "next/server";
import { runTick, getAutoStateRow, type AutoTrack } from "@/lib/autopilotEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Tick giornaliero per Vercel Cron (vedi vercel.json). Il path è pubblico nel
 * proxy (il cron non ha cookie di sessione), quindi è protetto da CRON_SECRET:
 * Vercel invia automaticamente "Authorization: Bearer <CRON_SECRET>" quando la
 * env var è configurata sul progetto.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET non configurata: tick via cron disabilitato (resta il tick pigro dalla pagina)" },
      { status: 503 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "non autorizzato" }, { status: 401 });
  }

  // Tick di ENTRAMBE le tracce avviate (main + crypto). Ogni traccia gira solo
  // se il suo conto è stato avviato; gli errori di una non bloccano l'altra.
  const tracks: AutoTrack[] = ["main", "crypto"];
  const results: Record<string, unknown> = {};
  let anyRan = false;
  for (const track of tracks) {
    if (!(await getAutoStateRow(track))) {
      results[track] = { ran: false, reason: "non avviato" };
      continue;
    }
    try {
      const r = await runTick(track, false);
      results[track] = { ran: true, rebalanced: r.rebalanced };
      anyRan = true;
    } catch (e) {
      results[track] = { error: e instanceof Error ? e.message : "tick fallito" };
    }
  }
  return NextResponse.json({ ran: anyRan, tracks: results, at: new Date().toISOString() });
}
