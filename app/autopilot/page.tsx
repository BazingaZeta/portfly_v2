"use client";

import { AutopilotPanel } from "@/components/AutopilotPanel";
import { useI18n } from "@/components/I18nProvider";

// Autopilot azionario (traccia "main"): rotation / dual momentum. La traccia
// crypto è un secondo autopilot indipendente, embeddato nella sezione /crypto.
export default function AutopilotPage() {
  const { t } = useI18n();
  return <AutopilotPanel track="main" heading={t("auto.title")} subtitle={t("auto.subtitle")} />;
}
