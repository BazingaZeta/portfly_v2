"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { SyncedTimeChart, type HoldingSpan } from "@/components/SyncedTimeChart";
import { LoadingPanel } from "@/components/Loading";
import { money } from "@/lib/format";
import { runFetchJob, useJob, usePersistentState } from "@/lib/analysisStore";
import type { WorldTickerDetail, ChannelDetail, TickerSignalHistory } from "@/lib/worldMomentum";

// ─── Blocchi di spiegazione ──────────────────────────────────────────────────

function Row({ label, value, mono = true, hint }: { label: string; value: string; mono?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-[var(--border)] last:border-0">
      <span className="text-xs text-[var(--muted)]" title={hint}>{label}</span>
      <span className={`text-sm ${mono ? "font-mono" : ""} text-right`}>{value}</span>
    </div>
  );
}

/**
 * La "targa" del canale: finestra, retta, bande. È il pezzo che risponde alla
 * domanda "come l'hai costruito" — ogni numero qui è un ingrediente del fit,
 * non un risultato interpretato.
 */
function ChannelSpec({ detail, kind }: { detail: ChannelDetail; kind: "price" | "meta" }) {
  const ch = detail.channel;
  const fmt = kind === "price" ? (v: number) => `$${v.toFixed(2)}` : (v: number) => v.toFixed(5);
  const trendLabel =
    ch.trend === "asc" ? "ascendente" : ch.trend === "desc" ? "discendente" : "piatto (fit non abbastanza pulito)";

  return (
    <div className="grid md:grid-cols-2 gap-x-8">
      <div>
        <Row label="Finestra del fit" value={`${detail.window} barre`} hint="Quante chiusure entrano nella regressione" />
        <Row label="Dal / al" value={`${detail.from} → ${detail.to}`} />
        <Row label="Pendenza (per barra)" value={kind === "price" ? `$${ch.slope.toFixed(4)}` : ch.slope.toExponential(3)}
          hint="Di quanto sale la retta a ogni barra" />
        <Row label="Pendenza (% al giorno)" value={`${ch.slopePctPerDay}%`} />
        <Row label="Intercetta" value={kind === "price" ? `$${ch.intercept.toFixed(2)}` : ch.intercept.toFixed(5)}
          hint="Valore della retta alla prima barra della finestra" />
      </div>
      <div>
        <Row label="R² (bontà del fit)" value={String(ch.r2)}
          hint="Quanta parte del movimento è spiegata dalla retta. Sotto la soglia il trend è considerato rumore." />
        <Row label="Dev. std dei residui (σ)" value={fmt(ch.stdev)}
          hint="Quanto il valore si discosta in media dalla retta: è l'unità di misura delle bande" />
        <Row label="Larghezza bande" value={`±${detail.k}σ`} />
        <Row label="Trend" value={trendLabel} mono={false} />
        <Row label="Posizione attuale (z)" value={String(ch.z)}
          hint="Quante σ sopra (+) o sotto (−) la retta sta il valore di oggi" />
      </div>
    </div>
  );
}

/** Le ultime barre in tabella: il dato grezzo dietro al disegno. */
function PointsTable({ detail, kind }: { detail: ChannelDetail; kind: "price" | "meta" }) {
  const [expanded, setExpanded] = useState(false);
  const fmt = kind === "price" ? (v: number) => `$${v.toFixed(2)}` : (v: number) => v.toFixed(5);
  const rows = expanded ? [...detail.points].reverse() : [...detail.points].reverse().slice(0, 12);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs [&_th]:pr-4 [&_td]:pr-4 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
          <thead>
            <tr className="text-[var(--muted)] text-left">
              <th className="pb-2 font-medium">Data</th>
              <th className="pb-2 font-medium text-right">Valore</th>
              <th className="pb-2 font-medium text-right">Retta</th>
              <th className="pb-2 font-medium text-right">Banda inf.</th>
              <th className="pb-2 font-medium text-right">Banda sup.</th>
              <th className="pb-2 font-medium text-right">z</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((p) => (
              <tr key={p.date} className="border-t border-[var(--border)]">
                <td className="py-1.5 text-[var(--muted)]">{p.date}</td>
                <td className="py-1.5 text-right">{fmt(p.value)}</td>
                <td className="py-1.5 text-right text-[var(--muted)]">{fmt(p.fit)}</td>
                <td className="py-1.5 text-right text-[var(--muted)]">{fmt(p.lower)}</td>
                <td className="py-1.5 text-right text-[var(--muted)]">{fmt(p.upper)}</td>
                <td className={`py-1.5 text-right ${p.z > 0 ? "text-[var(--warning)]" : "text-[var(--positive)]"}`}>{p.z}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail.points.length > 12 && (
        <button className="btn-ghost text-xs mt-2" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Mostra solo le ultime 12" : `Mostra tutte le ${detail.points.length} barre`}
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-xl bg-[var(--surface-2)] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className={`font-mono text-base mt-0.5 ${tone === "pos" ? "text-[var(--positive)]" : tone === "neg" ? "text-[var(--negative)]" : ""}`}>
        {value}
      </p>
    </div>
  );
}

/** Periodo mostrato, in barre di borsa: vale per tutti e tre i grafici insieme. */
const RANGES = [
  { key: "3M", bars: 63 },
  { key: "6M", bars: 126 },
  { key: "1A", bars: 252 },
  { key: "2A", bars: 504 },
  { key: "Tutto", bars: Infinity },
] as const;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Richiesta fallita");
  return json as T;
}

// ─── Pagina ──────────────────────────────────────────────────────────────────

export default function TickerDetailPage() {
  const routeParams = useParams<{ ticker: string }>();
  const search = useSearchParams();
  const ticker = decodeURIComponent(routeParams.ticker ?? "").toUpperCase();

  // I parametri arrivano dalla pagina elenco: il dettaglio DEVE usare gli
  // stessi, altrimenti mostrerebbe un canale diverso da quello che ha
  // generato il segnale.
  const query = useMemo(() => {
    const q = new URLSearchParams(search.toString());
    q.set("ticker", ticker);
    return q.toString();
  }, [search, ticker]);

  const backHref = useMemo(() => {
    const q = search.toString();
    return q ? `/world-momentum?${q}` : "/world-momentum";
  }, [search]);

  // Dettaglio e storico segnali vivono nello store: tornando su questo titolo
  // si ritrovano subito, senza rifare le richieste.
  const detailKey = `world:ticker:${query}`;
  const signalsKey = `world:signals:${query}`;
  const detailJob = useJob<WorldTickerDetail>(detailKey);
  const signalsJob = useJob<TickerSignalHistory>(signalsKey);

  const load = () => {
    runFetchJob(detailKey, () => getJson<WorldTickerDetail>(`/api/world/ticker?${query}`));
    runFetchJob(signalsKey, () => getJson<TickerSignalHistory>(`/api/world/signals?${query}`));
  };

  useEffect(() => {
    // Carica solo se non c'è già niente in memoria per questa combinazione.
    if (detailJob.status === "idle") runFetchJob(detailKey, () => getJson<WorldTickerDetail>(`/api/world/ticker?${query}`));
    if (signalsJob.status === "idle") runFetchJob(signalsKey, () => getJson<TickerSignalHistory>(`/api/world/signals?${query}`));
  }, [detailKey, signalsKey, query, detailJob.status, signalsJob.status]);

  const data = detailJob.result ?? null;
  const signals = signalsJob.result ?? null;

  const [range, setRange] = usePersistentState<string>("world:detail:range", "1A");
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // Asse temporale condiviso: le ultime N date dello storico allineato.
  const domain = useMemo(() => {
    if (!data) return [];
    const all = data.context.map((c) => c.date);
    const bars = RANGES.find((r) => r.key === range)?.bars ?? 252;
    return Number.isFinite(bars) ? all.slice(-bars) : all;
  }, [data, range]);

  const metaSeries = useMemo(() => (data ? data.context.map((c) => ({ date: c.date, value: c.meta })) : []), [data]);
  const priceSeries = useMemo(() => (data ? data.context.map((c) => ({ date: c.date, value: c.close })) : []), [data]);
  const spans = useMemo<HoldingSpan[]>(
    () => (signals ? signals.signals.map((g) => ({ from: g.entryDate, to: g.exitDate, returnPct: g.returnPct })) : []),
    [signals]
  );
  const signalsInRange = useMemo(
    () => (signals && domain.length ? signals.signals.filter((g) => (g.exitDate ?? domain[domain.length - 1]) >= domain[0]).length : 0),
    [signals, domain]
  );

  const signalStyle = (sg: WorldTickerDetail["signal"]) =>
    sg === "COMPRA"
      ? { background: "color-mix(in srgb, var(--positive) 18%, transparent)", color: "var(--positive)" }
      : sg === "ATTENDI"
      ? { background: "color-mix(in srgb, var(--warning) 18%, transparent)", color: "var(--warning)" }
      : { background: "var(--surface-2)", color: "var(--muted)" };

  const loading = detailJob.status === "running" && !data;
  const s = signals?.summary;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href={backHref} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors w-fit">
          ← Torna a Momentum World
        </Link>
        <button className="btn-ghost text-xs" onClick={load} disabled={detailJob.status === "running"}>
          {detailJob.status === "running" ? "Aggiorno…" : "↻ Aggiorna i dati"}
        </button>
      </div>

      {loading && <LoadingPanel label={`Ricostruisco i canali di ${ticker}…`} />}
      {detailJob.status === "error" && (
        <div className="glass rounded-2xl p-4 text-sm" style={{ color: "var(--negative)" }}>{detailJob.error}</div>
      )}

      {data && (
        <>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {data.ticker} <span className="text-[var(--muted)] font-normal text-lg">{data.name}</span>
              </h1>
              <p className="text-sm text-[var(--muted)] mt-1">
                {money(data.price)} · chiusura del {data.asOf} · benchmark {data.benchmark}
              </p>
            </div>
            <div className="text-right">
              <span className="px-3 py-1 rounded-lg text-xs font-semibold" style={signalStyle(data.signal)}>
                {data.signal}
              </span>
              <p className="text-xs text-[var(--muted)] mt-2 max-w-sm">{data.reason}</p>
            </div>
          </header>

          <div
            className="glass rounded-2xl p-3 text-xs text-[var(--muted)]"
            style={{ borderLeft: `3px solid ${data.regimeOk ? "var(--positive)" : "var(--warning)"}` }}
          >
            {data.regimeNote}
          </div>

          {/* Periodo condiviso: i tre grafici hanno lo stesso asse e lo stesso cursore. */}
          {/* Fissa in alto mentre scorri, e opaca: semitrasparente, i grafici la attraversavano. */}
          <div className="rounded-2xl p-3 flex items-center gap-3 flex-wrap sticky top-10 z-30 border border-[var(--border)] bg-[var(--surface)] shadow-lg shadow-black/30">
            <span className="text-xs text-[var(--muted)]">Periodo mostrato</span>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                    range === r.key ? "bg-[var(--surface-2)] text-[var(--foreground)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {r.key}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-[var(--muted)]">
              {domain[0]} → {domain[domain.length - 1]} · i tre grafici condividono asse temporale e cursore
            </span>
          </div>

          {/* ── Stadio 1 ── */}
          <section className="glass rounded-2xl p-5">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
              <h2 className="text-lg font-semibold">Stadio 1 — il metatitolo</h2>
              <span className="text-xs text-[var(--muted)] font-mono">
                {data.ticker} ÷ {data.benchmark}
              </span>
            </div>
            <p className="text-xs text-[var(--muted)] mb-4 max-w-3xl">
              Ogni barra è il rapporto fra la chiusura aggiustata del titolo e quella del benchmark.
              Se il rapporto sale, il titolo sta battendo il mondo — a prescindere dal fatto che il
              prezzo in sé salga o scenda. Sulle ultime {data.meta.window} barre viene fittata la
              retta dei minimi quadrati, con le bande a ±{data.meta.k}σ dei residui. Questo canale
              decide <strong>se</strong> il titolo è candidabile; non decide quando comprare.
            </p>

            <SyncedTimeChart
              domain={domain} series={metaSeries} channel={data.meta.points} kind="meta"
              hoverDate={hoverDate} onHover={setHoverDate} height={260}
            />

            <div className="mt-5">
              <h3 className="text-sm font-semibold mb-2">Come è costruito</h3>
              <ChannelSpec detail={data.meta} kind="meta" />
            </div>

            <div className="mt-5">
              <h3 className="text-sm font-semibold mb-2">Forza relativa</h3>
              <p className="text-xs text-[var(--muted)] mb-2">
                Rendimento del metatitolo su tre orizzonti, combinato in un punteggio unico. È il
                criterio con cui i titoli forti vengono ordinati fra loro.
              </p>
              <div className="grid md:grid-cols-2 gap-x-8">
                <div>
                  <Row label={`30 giorni (peso ${data.rsWeights.w30})`} value={data.rs.d30 != null ? `${data.rs.d30}%` : "—"} />
                  <Row label={`90 giorni (peso ${data.rsWeights.w90})`} value={data.rs.d90 != null ? `${data.rs.d90}%` : "—"} />
                  <Row label={`180 giorni (peso ${data.rsWeights.w180})`} value={data.rs.d180 != null ? `${data.rs.d180}%` : "—"} />
                </div>
                <div>
                  <Row label="Punteggio composito" value={String(data.rs.composite)} />
                  <Row label="Soglia R² richiesta" value={String(data.options.minMetaR2)} />
                  <Row
                    label="Supera lo stadio 1?"
                    mono={false}
                    value={
                      data.meta.channel.trend === "asc" && data.meta.channel.r2 >= data.options.minMetaR2
                        ? "sì — canale ascendente e pulito"
                        : "no"
                    }
                  />
                </div>
              </div>
            </div>

            <details className="mt-4">
              <summary className="text-xs text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)]">
                Dati grezzi del canale
              </summary>
              <div className="mt-3"><PointsTable detail={data.meta} kind="meta" /></div>
            </details>
          </section>

          {/* ── Stadio 2 ── */}
          <section className="glass rounded-2xl p-5">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
              <h2 className="text-lg font-semibold">Stadio 2 — il prezzo</h2>
              <span className="text-xs text-[var(--muted)] font-mono">{data.ticker}</span>
            </div>
            <p className="text-xs text-[var(--muted)] mb-4 max-w-3xl">
              Stesso metodo, applicato alla chiusura grezza sulle ultime{" "}
              {data.priceChannel?.window ?? data.options.priceWindow} barre. Questo canale decide{" "}
              <strong>quando</strong>: si compra quando il prezzo sta nella parte bassa del canale
              (z ≤ {data.options.entryMaxZ}), la fascia ombreggiata in azzurro. Comprare in alto nel
              canale significa pagare l&apos;estensione e prendersi il rientro.
            </p>

            {data.priceChannel ? (
              <>
                <SyncedTimeChart
                  domain={domain} series={priceSeries} channel={data.priceChannel.points}
                  entryMaxZ={data.options.entryMaxZ} kind="price"
                  hoverDate={hoverDate} onHover={setHoverDate} height={260}
                />
                <div className="mt-5">
                  <h3 className="text-sm font-semibold mb-2">Come è costruito</h3>
                  <ChannelSpec detail={data.priceChannel} kind="price" />
                </div>
                <details className="mt-4">
                  <summary className="text-xs text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)]">
                    Dati grezzi del canale
                  </summary>
                  <div className="mt-3"><PointsTable detail={data.priceChannel} kind="price" /></div>
                </details>
              </>
            ) : (
              <p className="text-sm text-[var(--muted)]">Canale sul prezzo non calcolabile per questo titolo.</p>
            )}
          </section>

          {/* ── Segnali storici ── */}
          <section className="glass rounded-2xl p-5">
            <h2 className="text-lg font-semibold mb-1">Segnali storici su questo titolo</h2>
            <p className="text-xs text-[var(--muted)] mb-4 max-w-3xl">
              Dove la regola avrebbe comprato e venduto, applicando le stesse soglie che vedi nei
              parametri. <strong>Non</strong> sono i trade del backtest di portafoglio: quello ha un
              numero limitato di posizioni e sceglie i primi per forza relativa, quindi alcuni di
              questi segnali non sarebbero stati presi. Qui vedi la regola sul singolo nome, senza
              vincoli di capitale.
            </p>

            {signalsJob.status === "running" && !signals && <LoadingPanel label="Ricostruisco i segnali storici…" />}
            {signalsJob.status === "error" && <p className="text-sm" style={{ color: "var(--negative)" }}>{signalsJob.error}</p>}

            {signals && s && (
              s.count > 0 ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                    <Stat label="Segnali" value={String(s.count)} />
                    <Stat label="Chiusi in utile" value={`${s.wins}/${s.closed}`} />
                    <Stat label="Win rate" value={`${s.winRate}%`} />
                    <Stat label="Rendimento medio" value={`${s.avgReturnPct >= 0 ? "+" : ""}${s.avgReturnPct}%`}
                      tone={s.avgReturnPct >= 0 ? "pos" : "neg"} />
                    <Stat label="Durata media" value={`${s.avgBarsHeld} barre`} />
                  </div>

                  <SyncedTimeChart
                    domain={domain} series={priceSeries} spans={spans} kind="price"
                    hoverDate={hoverDate} onHover={setHoverDate} height={280}
                  />
                  <p className="text-[11px] text-[var(--muted)] mt-1 px-1">
                    ▲ acquisto · ▼ vendita · fascia verde = periodo in utile, rossa = in perdita ·
                    nel grafico {signalsInRange} segnali del periodo selezionato, in tabella tutti i {s.count}.
                  </p>

                  <div className="overflow-x-auto mt-5">
                    <table className="w-full text-xs [&_th]:pr-4 [&_td]:pr-4 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
                      <thead>
                        <tr className="text-[var(--muted)] text-left">
                          <th className="pb-2 font-medium">#</th>
                          <th className="pb-2 font-medium">Acquisto</th>
                          <th className="pb-2 font-medium text-right">Prezzo</th>
                          <th className="pb-2 font-medium">Vendita</th>
                          <th className="pb-2 font-medium text-right">Prezzo</th>
                          <th className="pb-2 font-medium text-right">Risultato</th>
                          <th className="pb-2 font-medium text-right">Barre</th>
                          <th className="pb-2 font-medium">Motivo dell&apos;uscita</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {signals.signals.map((sig, i) => (
                          <tr
                            key={`${sig.entryDate}-${i}`}
                            className="border-t border-[var(--border)] cursor-pointer hover:bg-[var(--surface-2)]"
                            onMouseEnter={() => setHoverDate(sig.entryDate)}
                            onMouseLeave={() => setHoverDate(null)}
                            title="Passa sopra la riga per ritrovarla sui grafici"
                          >
                            <td className="py-1.5 text-[var(--muted)]">{i + 1}</td>
                            <td className="py-1.5 text-[var(--positive)]">▲ {sig.entryDate}</td>
                            <td className="py-1.5 text-right">${sig.entryPrice.toFixed(2)}</td>
                            <td className="py-1.5 text-[var(--negative)]">
                              {sig.exitDate ? `▼ ${sig.exitDate}` : <span className="text-[var(--accent)]">aperta</span>}
                            </td>
                            <td className="py-1.5 text-right">{sig.exitPrice != null ? `$${sig.exitPrice.toFixed(2)}` : "—"}</td>
                            <td className={`py-1.5 text-right ${sig.returnPct == null ? "" : sig.returnPct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                              {sig.returnPct != null ? `${sig.returnPct >= 0 ? "+" : ""}${sig.returnPct}%` : "—"}
                            </td>
                            <td className="py-1.5 text-right text-[var(--muted)]">{sig.barsHeld}</td>
                            <td className="py-1.5 text-[var(--muted)] font-sans">{sig.exitReason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-[11px] text-[var(--muted)] mt-3">
                    Concatenando tutti i segnali chiusi su questo solo titolo:{" "}
                    <strong className={s.compoundedPct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                      {s.compoundedPct >= 0 ? "+" : ""}{s.compoundedPct}%
                    </strong>{" "}
                    (migliore {s.bestPct}%, peggiore {s.worstPct}%). Senza costi oltre allo scivolamento
                    già scontato, e con il senno di poi su quale titolo guardare: è una misura della
                    regola, non un rendimento ottenibile.
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  La regola non ha mai dato un segnale su questo titolo nel periodo analizzato.
                </p>
              )
            )}
          </section>

          <section className="glass rounded-2xl p-5">
            <h2 className="text-sm font-semibold mb-2">Quando si esce, e quanto si investe</h2>
            <p className="text-xs text-[var(--muted)] max-w-3xl">
              La posizione si chiude quando il canale del <strong>metatitolo</strong> si rompe: la
              pendenza smette di essere positiva, oppure l&apos;R² scende sotto{" "}
              {data.options.minMetaR2}. In pratica si vende quando il titolo smette di essere più
              forte del mondo — non quando il prezzo fa una gamba storta. Gli stop sul prezzo sono
              stati testati e scartati: riducono poco il drawdown e tagliano i vincitori.
            </p>
            <p className="text-xs text-[var(--muted)] max-w-3xl mt-2">
              La protezione dai drawdown agisce a livello di portafoglio, non del singolo titolo:
              quando la volatilità della strategia supera il {data.options.volTarget}% annuo si
              investe meno in proporzione. Non cambia quali titoli comprare né quando uscire.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
