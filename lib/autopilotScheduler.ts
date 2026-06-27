import { runTick, getAutoStateRow } from "./autopilotEngine";

// Autonomous loop: while the server process is alive, run the Autopilot cycle
// on an interval. Paper account only — no real orders. Only ticks if the bot
// has been started (auto_state exists); a Reset stops it until restarted.

export const SCHEDULER_INTERVAL_MIN = 10;
const INTERVAL_MS = SCHEDULER_INTERVAL_MIN * 60 * 1000;

let started = false;
let ticking = false;

async function safeTick(): Promise<void> {
  if (ticking) return; // never overlap
  try {
    if (!getAutoStateRow()) return; // bot not started → nothing to do
    ticking = true;
    const r = await runTick(false);
    console.log(`[autopilot] tick automatico — ${r.rebalanced ? "RIBILANCIATO" : "nessun ribilancio"}`);
  } catch (e) {
    console.error("[autopilot] tick automatico fallito:", e instanceof Error ? e.message : e);
  } finally {
    ticking = false;
  }
}

export function startAutopilotScheduler(): void {
  if (started) return;
  started = true;
  // First tick shortly after boot, then every interval.
  setTimeout(safeTick, 15_000);
  setInterval(safeTick, INTERVAL_MS);
  console.log(`[autopilot] scheduler attivo: ciclo automatico ogni ${SCHEDULER_INTERVAL_MIN} min finché il server è aperto.`);
}
