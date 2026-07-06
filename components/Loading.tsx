// Stati di caricamento condivisi: lo spinner evita il "flash" dell'empty state
// (es. "Nessuna posizione aperta" mostrato per un attimo prima che arrivino i
// dati). Usare SEMPRE uno di questi al posto di renderizzare l'empty state
// mentre il primo fetch è ancora in volo.

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`spinner inline-block ${className}`} aria-label="Caricamento" role="status" />;
}

/** Pannello di caricamento a tutta larghezza, stessa gabbia degli empty state. */
export function LoadingPanel({ label = "Carico i dati…" }: { label?: string }) {
  return (
    <section className="mb-6 rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--muted)]">
      <div className="flex flex-col items-center gap-3">
        <Spinner />
        <p className="text-sm">{label}</p>
      </div>
    </section>
  );
}
