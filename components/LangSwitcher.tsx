"use client";

import { useI18n } from "./I18nProvider";
import { LOCALES, type Locale } from "@/lib/i18n";

export function LangSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label="Language"
      className="input text-xs py-1 px-2 cursor-pointer"
      style={{ width: "auto" }}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
