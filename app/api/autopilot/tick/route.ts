import { NextRequest, NextResponse } from "next/server";
import { runTick, getAutoStateRow } from "@/lib/autopilotEngine";

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

  if (!(await getAutoStateRow())) {
    return NextResponse.json({ ran: false, reason: "autopilot non avviato" });
  }
  try {
    const r = await runTick(false);
    return NextResponse.json({ ran: true, rebalanced: r.rebalanced, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "tick fallito" },
      { status: 500 }
    );
  }
}
