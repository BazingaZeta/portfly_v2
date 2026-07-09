// Heartbeat degli autopilot: se un bot avviato non esegue un tick da troppo
// tempo (cron morto, env CRON_SECRET persa, errore silenzioso), l'utente deve
// saperlo — un bot fermo è un rischio silenzioso quanto uno che perde.
//
// Il check viene agganciato alle route più visitate (dashboard, autopilot) via
// `after()`: nessun costo sulla risposta. Limite onesto: se NESSUNO apre l'app
// e il cron è morto, nessun alert può partire da qui — per una garanzia totale
// serve un monitor esterno (uptime robot sull'endpoint di tick).

import { getAutoStateRow, type AutoTrack } from "./autopilotEngine";
import { getMeta, setMeta, insertAutoLog } from "./db";
import { sendTelegram } from "./notify";

/** Un bot è "stantio" se l'ultimo tick è più vecchio di così. Il cron è
 *  giornaliero e c'è il lazy-tick a 12h: 36h = almeno due occasioni mancate. */
export const HEARTBEAT_STALE_MS = 36 * 60 * 60 * 1000;
/** Non ri-allertare più spesso di così (anti-spam). */
export const HEARTBEAT_REALERT_MS = 24 * 60 * 60 * 1000;

export interface HeartbeatDecision {
  stale: boolean;
  /** true se va inviato un alert ORA (stantio e non già allertato di recente). */
  alert: boolean;
  hoursSinceRun: number;
}

/** Decisione pura (testabile): stato heartbeat dati ultimo run e ultimo alert. */
export function heartbeatDecision(
  lastRun: string | null,
  lastAlerted: string | null,
  now: Date = new Date()
): HeartbeatDecision {
  // Mai girato (appena avviato): il primo tick arriva da start/lazy — non stantio.
  if (!lastRun) return { stale: false, alert: false, hoursSinceRun: 0 };
  const sinceRun = now.getTime() - new Date(lastRun).getTime();
  const hoursSinceRun = +(sinceRun / 3_600_000).toFixed(1);
  if (sinceRun < HEARTBEAT_STALE_MS) return { stale: false, alert: false, hoursSinceRun };
  const sinceAlert = lastAlerted ? now.getTime() - new Date(lastAlerted).getTime() : Infinity;
  return { stale: true, alert: sinceAlert >= HEARTBEAT_REALERT_MS, hoursSinceRun };
}

const TRACK_LABEL: Record<AutoTrack, string> = { main: "Autopilot", crypto: "Autopilot Crypto" };

/**
 * Controlla entrambe le tracce e, se un bot avviato è fermo da >36h, notifica
 * (Telegram + riga nel log del bot, così è visibile anche senza Telegram).
 * Best-effort: qualunque errore viene inghiottito, mai bloccare il chiamante.
 */
export async function checkAutopilotHeartbeat(now: Date = new Date()): Promise<void> {
  const tracks: AutoTrack[] = ["main", "crypto"];
  for (const track of tracks) {
    try {
      const state = await getAutoStateRow(track);
      if (!state) continue; // bot mai avviato: niente da monitorare
      const alertKey = track === "crypto" ? "crypto_heartbeat_alerted" : "heartbeat_alerted";
      const lastAlerted = await getMeta(alertKey);
      const d = heartbeatDecision(state.last_run, lastAlerted, now);
      if (!d.alert) continue;
      await setMeta(alertKey, now.toISOString());
      const msg =
        `⚠️ Heartbeat: nessun ciclo da ${d.hoursSinceRun}h (atteso ~24h). ` +
        `Il cron potrebbe essere fermo — apri la pagina per un tick manuale e controlla CRON_SECRET su Vercel.`;
      await insertAutoLog(now.toISOString().slice(0, 19), "decision", msg, track);
      await sendTelegram(`⚠️ <b>${TRACK_LABEL[track]} — bot fermo</b>\n${msg}`);
    } catch {
      /* best-effort */
    }
  }
}
