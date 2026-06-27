export function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function pct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

import type { TFunc } from "./i18n";

export function relativeTime(iso: string, t: TFunc): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return t("rel.now");
  if (mins < 60) return t("rel.min", { n: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t("rel.hour", { n: hrs });
  const days = Math.round(hrs / 24);
  return t("rel.day", { n: days });
}

export function scoreColor(score: number): string {
  if (score >= 70) return "var(--positive)";
  if (score >= 55) return "var(--accent)";
  return "var(--warning)";
}
