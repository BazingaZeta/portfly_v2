"use client";

import { AutopilotPanel } from "@/components/AutopilotPanel";
import { useI18n } from "@/components/I18nProvider";

// Secondo autopilot indipendente (traccia "crypto"): gira la strategia Crypto
// Trend su un conto simulato dedicato, separato dall'autopilot azionario.
export default function CryptoAutopilotPage() {
  const { t } = useI18n();
  return <AutopilotPanel track="crypto" heading={t("crypto.autopilotHeading")} subtitle={t("crypto.autopilotSubtitle")} />;
}
