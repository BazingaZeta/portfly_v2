"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { RegressionDetailChart } from "@/components/RegressionDetailChart";
import { SignalHistoryChart } from "@/components/SignalHistoryChart";
import { LoadingPanel } from "@/components/Loading";
import { money } from "@/lib/format";
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

// ─── Storico dei segnali ─────────────────────────────────────────────────────

function SignalHistorySection({ query }: { query: string }) {
  const [data, setData] = useState<TickerSignalHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/world/signals?${query}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Storico non disponibile");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Storico non disponibile");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const s = data?.summary;

  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="text-lg font-semibold mb-1">Segnali storici su questo titolo</h2>
      <p className="text-xs text-[var(--muted)] mb-4 max-w-3xl">
        Dove la regola avrebbe comprato e venduto negli ultimi anni, applicando le stesse soglie
        che vedi nei parametri. <strong>Non</strong> sono i trade del backtest di portafoglio:
        quello ha un numero limitato di posizioni e sceglie i primi per forza relativa, quindi
        alcuni di questi segnali non sarebbero stati presi. Qui vedi la regola sul singolo nome,
        senza vincoli di capitale.
      </p>

      {loading && <LoadingPanel label="Ricostruisco i segnali storici…" />}
      {error && <p className="text-sm" style={{ color: "var(--negative)" }}>{error}</p>}

      {data && !loading && (
        <>
          {s && s.count > 0 ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <Stat label="Segnali" value={String(s.count)} />
                <Stat label="Chiusi in utile" value={`${s.wins}/${s.closed}`} />
                <Stat label="Win rate" value={`${s.winRate}%`} />
                <Stat label="Rendimento medio" value={`${s.avgReturnPct >= 0 ? "+" : ""}${s.avgReturnPct}%`}
                  tone={s.avgReturnPct >= 0 ? "pos" : "neg"} />
                <Stat label="Durata media" value={`${s.avgBarsHeld} barre`} />
              </div>

              <SignalHistoryChart series={data.series} signals={data.signals} />

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
                    {data.signals.map((sig, i) => (
                      <tr key={`${sig.entryDate}-${i}`} className="border-t border-[var(--border)]">
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
          )}
        </>
      )}
    </section>
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

// ─── Pagina ──────────────────────────────────────────────────────────────────

export default function TickerDetailPage() {
  const routeParams = useParams<{ ticker: string }>();
  const search = useSearchParams();
  const ticker = decodeURIComponent(routeParams.ticker ?? "").toUpperCase();

  const [data, setData] = useState<WorldTickerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/world/ticker?${query}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Dettaglio non disponibile");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dettaglio non disponibile");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    // Load deferito di un tick: setState sincrono nel corpo dell'effect causa
    // render a cascata (regola react-hooks strict del repo).
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const signalStyle = (s: WorldTickerDetail["signal"]) =>
    s === "COMPRA"
      ? { background: "color-mix(in srgb, var(--positive) 18%, transparent)", color: "var(--positive)" }
      : s === "ATTENDI"
      ? { background: "color-mix(in srgb, var(--warning) 18%, transparent)", color: "var(--warning)" }
      : { background: "var(--surface-2)", color: "var(--muted)" };

  return (
    <div className="flex flex-col gap-5">
      <Link href={backHref} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors w-fit">
        ← Torna a Momentum World
      </Link>

      {loading && <LoadingPanel label={`Ricostruisco i canali di ${ticker}…`} />}
      {error && <div className="glass rounded-2xl p-4 text-sm" style={{ color: "var(--negative)" }}>{error}</div>}

      {data && !loading && (
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
              prezzo in sé salga o scenda. Su questa serie viene fittata la retta dei minimi quadrati
              e ci si costruiscono attorno le bande a ±{data.meta.k}σ dei residui. Questo canale
              decide <strong>se</strong> il titolo è candidabile; non decide quando comprare.
            </p>

            <RegressionDetailChart points={data.meta.points} kind="meta" />

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
              Stesso metodo, applicato alla chiusura grezza su una finestra più corta. Questo canale
              decide <strong>quando</strong>: si compra quando il prezzo sta nella parte bassa del
              canale (z ≤ {data.options.entryMaxZ}), la fascia ombreggiata in azzurro. Comprare in
              alto nel canale significa pagare l&apos;estensione e prendersi il rientro.
            </p>

            {data.priceChannel ? (
              <>
                <RegressionDetailChart points={data.priceChannel.points} kind="price" entryMaxZ={data.options.entryMaxZ} />
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

          <SignalHistorySection query={query} />

          <section className="glass rounded-2xl p-5">
            <h2 className="text-sm font-semibold mb-2">Quando si esce</h2>
            <p className="text-xs text-[var(--muted)] max-w-3xl">
              La posizione si chiude quando il canale del <strong>metatitolo</strong> si rompe: la
              pendenza smette di essere positiva, oppure l&apos;R² scende sotto{" "}
              {data.options.minMetaR2}. In pratica si vende quando il titolo smette di essere più
              forte del mondo — non quando il prezzo fa una gamba storta. Le altre due letture di
              &ldquo;rottura del canale&rdquo; sono selezionabili nel backtest: uscire quando il
              prezzo buca la banda inferiore, sulla stessa finestra, rende meno di questa.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
