"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "./I18nProvider";
import { LangSwitcher } from "./LangSwitcher";

const LINKS = [
  { href: "/", key: "nav.signals", icon: "📊" },
  { href: "/track", key: "nav.portfolio", icon: "💼" },
  { href: "/index", key: "nav.index", icon: "🎯" },
  { href: "/autopilot", key: "nav.autopilot", icon: "🤖" },
  { href: "/performance", key: "nav.performance", icon: "📈" },
  { href: "/backtest", key: "nav.backtest", icon: "🧪" },
  { href: "/news", key: "nav.news", icon: "📰" },
];

export function Nav() {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav className="glass md:w-60 md:min-h-screen border-b md:border-b-0 md:border-r border-[var(--border)] px-4 py-4 md:py-6 flex md:flex-col gap-1 md:gap-2 items-center md:items-stretch md:sticky md:top-0 md:self-start">
      <div className="flex items-center gap-2.5 md:mb-7 mr-auto md:mr-0">
        <span
          className="grid place-items-center size-9 rounded-xl shadow-lg"
          style={{
            background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
            boxShadow: "0 4px 14px color-mix(in srgb, var(--accent) 40%, transparent)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <path d="M6 21 L13 14 L18 18 L26 9" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M21 9 L26 9 L26 14" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="font-semibold tracking-tight text-[15px]">Finance Bot</span>
      </div>
      <div className="flex md:flex-col gap-1 md:gap-1.5">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                active
                  ? "text-[#06121f] shadow-md"
                  : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              }`}
              style={
                active
                  ? {
                      background: "linear-gradient(120deg, var(--accent), var(--accent-2))",
                      boxShadow: "0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent)",
                    }
                  : undefined
              }
            >
              <span>{l.icon}</span>
              <span className="hidden sm:inline">{t(l.key)}</span>
            </Link>
          );
        })}
      </div>
      <div className="md:mt-auto md:pt-6">
        <LangSwitcher />
      </div>
      <p className="hidden md:block text-[10px] leading-tight text-[var(--muted)] pt-4">
        {t("common.disclaimer")}
      </p>
    </nav>
  );
}
