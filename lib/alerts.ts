import type { Position } from "./types";

export type AlertType = "target" | "stop" | "near-target" | "near-stop";

export interface PositionAlert {
  key: string; // unique per ticker+type
  ticker: string;
  type: AlertType;
  message: string;
  tone: "positive" | "negative" | "warning";
}

const NEAR = 0.015; // within 1.5% counts as "approaching"

/** Derive exit alerts for the open positions against their target/stop. */
export function computeAlerts(positions: Position[]): PositionAlert[] {
  const alerts: PositionAlert[] = [];
  for (const p of positions) {
    if (p.target == null || p.stop == null) continue;
    const price = p.currentPrice;
    if (price >= p.target) {
      alerts.push({
        key: `${p.ticker}-target`,
        ticker: p.ticker,
        type: "target",
        tone: "positive",
        message: `${p.ticker} ha raggiunto il target (${p.target}). Valuta di prendere profitto.`,
      });
    } else if (price <= p.stop) {
      alerts.push({
        key: `${p.ticker}-stop`,
        ticker: p.ticker,
        type: "stop",
        tone: "negative",
        message: `${p.ticker} ha toccato lo stop (${p.stop}). Valuta di tagliare la perdita.`,
      });
    } else if (price >= p.target * (1 - NEAR)) {
      alerts.push({
        key: `${p.ticker}-near-target`,
        ticker: p.ticker,
        type: "near-target",
        tone: "warning",
        message: `${p.ticker} è vicino al target (${p.target}).`,
      });
    } else if (price <= p.stop * (1 + NEAR)) {
      alerts.push({
        key: `${p.ticker}-near-stop`,
        ticker: p.ticker,
        type: "near-stop",
        tone: "warning",
        message: `${p.ticker} si sta avvicinando allo stop (${p.stop}).`,
      });
    }
  }
  return alerts;
}

/** Position progress between stop (0) and target (1). */
export function targetProgress(p: Position): number | null {
  if (p.target == null || p.stop == null || p.target <= p.stop) return null;
  const frac = (p.currentPrice - p.stop) / (p.target - p.stop);
  return Math.max(0, Math.min(1, frac));
}
