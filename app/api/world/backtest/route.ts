import { NextRequest, NextResponse } from "next/server";
import { runWorldMomentum, channelParams, WORLD_BENCHMARK_INCEPTION, type ExitRule } from "@/lib/worldMomentum";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  const years = Math.min(10, Math.max(1, num(req, "years", 5)));
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - years);
  // Il benchmark non esiste prima del 2012: meglio accorciare la finestra che
  // restituire un errore quando l'utente chiede più storico di quanto ce ne sia.
  const startDate =
    start.toISOString().slice(0, 10) < WORLD_BENCHMARK_INCEPTION
      ? WORLD_BENCHMARK_INCEPTION
      : start.toISOString().slice(0, 10);

  const rawExit = req.nextUrl.searchParams.get("exitRule") as ExitRule | null;
  const exitRule: ExitRule = rawExit && EXIT_RULES.includes(rawExit) ? rawExit : "meta_break";

  try {
    const result = await runWorldMomentum({
      indexKey: req.nextUrl.searchParams.get("index") ?? "SP500",
      startDate,
      endDate: end.toISOString().slice(0, 10),
      exitRule,
      ...channelParams(req.nextUrl.searchParams),
      accountSize: num(req, "accountSize", 10_000),
      maxPositions: num(req, "maxPositions", 5),
      metaWindow: num(req, "metaWindow", 60),
      minMetaR2: num(req, "minMetaR2", 0.5),
      strongTopN: num(req, "strongTopN", 20),
      priceWindow: num(req, "priceWindow", 40),
      minPriceR2: num(req, "minPriceR2", 0.5),
      entryMaxZ: num(req, "entryMaxZ", 0),
      scanFreq: num(req, "scanFreq", 5),
      useRegime: req.nextUrl.searchParams.get("useRegime") !== "false",
      // Volatility targeting: 0 lo spegne, per confrontare con la strategia nuda.
      volTarget: num(req, "volTarget", 20),
      folds: num(req, "folds", 5),
    });

    // La storia completa del ranking è grossa (uno snapshot ogni scanFreq barre
    // × strongTopN titoli): al client serve per il grafico della rotazione, ma
    // i soli ticker bastano — RS e canali si rivedono nell'analisi live.
    const rankingHistory = result.rankingHistory.map((s) => ({
      date: s.date,
      strong: s.strong.map((x) => x.ticker),
      entered: s.entered,
      exited: s.exited,
    }));

    return NextResponse.json({ ...result, rankingHistory });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backtest fallito" },
      { status: 500 }
    );
  }
}
