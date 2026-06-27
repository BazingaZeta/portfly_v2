"use client";

import { useRisk } from "./RiskProvider";
import { useI18n } from "./I18nProvider";

export function RiskSettings() {
  const { accountSize, riskPct, setAccountSize, setRiskPct } = useRisk();
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <span className="text-xs uppercase tracking-wide text-[var(--muted)] self-center">
        ⚖️ {t("risk.title")}
      </span>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase text-[var(--muted)]">{t("risk.account")}</span>
        <input
          type="number"
          value={accountSize}
          min={1}
          onChange={(e) => setAccountSize(Number(e.target.value))}
          className="input w-28"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase text-[var(--muted)]">{t("risk.perTrade")}</span>
        <input
          type="number"
          value={riskPct}
          min={0.1}
          step={0.1}
          onChange={(e) => setRiskPct(Number(e.target.value))}
          className="input w-20"
        />
      </label>
      <span className="text-xs text-[var(--muted)] self-center">
        {t("risk.perTradeHint", { amount: ((accountSize * riskPct) / 100).toFixed(0) })}
      </span>
    </div>
  );
}
