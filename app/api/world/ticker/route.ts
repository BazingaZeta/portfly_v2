import { NextRequest, NextResponse } from "next/server";
import { runWorldTickerDetail } from "@/lib/worldMomentum";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  // Il ticker finisce in una chiamata di rete: accetta solo la forma dei
  // simboli Yahoo (lettere, cifre, punto e trattino), niente altro.
  if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) {
    return NextResponse.json({ error: "Ticker non valido" }, { status: 400 });
  }

  try {
    const detail = await runWorldTickerDetail(ticker, {
      indexKey: req.nextUrl.searchParams.get("index") ?? "SP500",
      metaWindow: num(req, "metaWindow", 60),
      minMetaR2: num(req, "minMetaR2", 0.5),
      strongTopN: num(req, "strongTopN", 20),
      priceWindow: num(req, "priceWindow", 40),
      minPriceR2: num(req, "minPriceR2", 0.5),
      entryMaxZ: num(req, "entryMaxZ", 0),
      useRegime: req.nextUrl.searchParams.get("useRegime") !== "false",
    });
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dettaglio non disponibile" },
      { status: 500 }
    );
  }
}
