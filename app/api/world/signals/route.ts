import { NextRequest, NextResponse } from "next/server";
import { runTickerSignalHistory, channelParams } from "@/lib/worldMomentum";
import { getSession } from "@/lib/auth";
import type { ExitRule } from "@/lib/worldMomentum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const EXIT_RULES: ExitRule[] = ["price_band", "channel_flat", "meta_break"];

function num(req: NextRequest, key: string, fallback: number): number {
  const raw = req.nextUrl.searchParams.get(key);
  if (raw == null) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const ticker = (req.nextUrl.searchParams.get("ticker") ?? "").toUpperCase().trim();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) {
    return NextResponse.json({ error: "Ticker non valido" }, { status: 400 });
  }

  const rawExit = req.nextUrl.searchParams.get("exitRule") as ExitRule | null;
  const exitRule: ExitRule = rawExit && EXIT_RULES.includes(rawExit) ? rawExit : "meta_break";

  try {
    const history = await runTickerSignalHistory(ticker, {
      indexKey: req.nextUrl.searchParams.get("index") ?? "SP500",
      years: num(req, "years", 5),
      exitRule,
      ...channelParams(req.nextUrl.searchParams),
      metaWindow: num(req, "metaWindow", 60),
      minMetaR2: num(req, "minMetaR2", 0.5),
      priceWindow: num(req, "priceWindow", 40),
      minPriceR2: num(req, "minPriceR2", 0.5),
      entryMaxZ: num(req, "entryMaxZ", 0),
      scanFreq: num(req, "scanFreq", 5),
      useRegime: req.nextUrl.searchParams.get("useRegime") !== "false",
    });
    return NextResponse.json(history);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Storico non disponibile" },
      { status: 500 }
    );
  }
}
