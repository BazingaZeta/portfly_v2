// Stato del mercato azionario USA calcolato nel fuso America/New_York, così è
// corretto ovunque si trovi l'utente (noi non siamo negli USA) e segue in
// automatico l'ora legale americana (DST) — che cambia in date diverse da quella
// europea. Puramente locale: nessuna chiamata di rete.
//
// Nota: non considera le festività di borsa (~9/anno) né le chiusure anticipate;
// in quei giorni lo stato può risultare "regular" per errore. Impatto minimo:
// solo qualche poll a vuoto, i prezzi restano all'ultima chiusura.

export type MarketSession = "regular" | "pre" | "post" | "closed";

export interface MarketStatus {
  open: boolean; // true solo durante la sessione regolare (9:30–16:00 ET)
  session: MarketSession;
  label: string; // etichetta breve in italiano
  etTime: string; // ora corrente a New York "HH:MM" (per tooltip)
}

const LABELS: Record<MarketSession, string> = {
  regular: "live",
  pre: "pre-market",
  post: "after-hours",
  closed: "mercato chiuso",
};

/** Stato del mercato USA all'istante `now` (default: adesso). */
export function usMarketStatus(now: Date = new Date()): MarketStatus {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const mins = hour * 60 + minute;
  const etTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const weekend = weekday === "Sat" || weekday === "Sun";
  let session: MarketSession;
  if (weekend) session = "closed";
  else if (mins >= 570 && mins < 960) session = "regular"; // 9:30–16:00
  else if (mins >= 240 && mins < 570) session = "pre"; // 4:00–9:30
  else if (mins >= 960 && mins < 1200) session = "post"; // 16:00–20:00
  else session = "closed";

  return { open: session === "regular", session, label: LABELS[session], etTime };
}

// ─── Prossima apertura / chiusura (istanti assoluti, UTC) ─────────────────────
// Restituiti come Date "vere": la UI li formatta poi nel fuso locale RILEVATO
// dell'utente (vedi userTimeZone), così l'orario è corretto ovunque — non
// assumiamo dove si trovi.

/** Minuti di offset ET rispetto a UTC all'istante `d` (negativo: ET dietro UTC). */
function etOffsetMinutes(d: Date): number {
  const asEt = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const asUtc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((asEt.getTime() - asUtc.getTime()) / 60000);
}

function etDateParts(d: Date): { y: number; mo: number; da: number; weekday: string } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { y: Number(g("year")), mo: Number(g("month")), da: Number(g("day")), weekday: g("weekday") };
}

/** Istante della prossima apertura in sessione regolare (9:30 ET, lun–ven). */
export function nextMarketOpen(now: Date = new Date()): Date {
  for (let i = 0; i < 10; i++) {
    const probe = new Date(now.getTime() + i * 86_400_000);
    const { y, mo, da, weekday } = etDateParts(probe);
    if (weekday === "Sat" || weekday === "Sun") continue;
    // 9:30 non cade mai in una transizione DST (avvengono alle 2:00), quindi
    // l'offset del giorno è affidabile.
    const open = Date.UTC(y, mo - 1, da, 9, 30) - etOffsetMinutes(probe) * 60000;
    if (open > now.getTime()) return new Date(open);
  }
  return now; // fallback improbabile
}

/** Istante della chiusura odierna (16:00 ET) se siamo in sessione, altrimenti null. */
export function nextMarketClose(now: Date = new Date()): Date | null {
  if (usMarketStatus(now).session !== "regular") return null;
  const { y, mo, da } = etDateParts(now);
  return new Date(Date.UTC(y, mo - 1, da, 16, 0) - etOffsetMinutes(now) * 60000);
}

/** Fuso orario dell'utente rilevato dal browser (fallback UTC). */
export function userTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
