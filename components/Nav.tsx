"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "./I18nProvider";
import { LangSwitcher } from "./LangSwitcher";
import { useEffect, useState } from "react";

// Voci raggruppate per natura della pagina: Analisi (dove trovi le opportunità),
// Portafogli (cosa hai in mano), Automazione, Info. Icone tutte distinte.
const SECTIONS: { titleKey: string; links: { href: string; key: string; icon: string }[] }[] = [
  {
    titleKey: "nav.secAnalysis",
    links: [
      { href: "/", key: "nav.signals", icon: "📊" },
      { href: "/momentum", key: "nav.momentum", icon: "⚡" },
      // "/index" è un nome speciale: il router client di Next lo normalizza a "/"
      // nella barra URL (contenuto giusto, URL sbagliato). Da qui "index-trader".
      { href: "/index-trader", key: "nav.index", icon: "🎯" },
      { href: "/rotation", key: "nav.rotation", icon: "🔄" },
      { href: "/crypto", key: "nav.crypto", icon: "🪙" },
    ],
  },
  {
    titleKey: "nav.secPortfolios",
    links: [
      { href: "/portfolio-sentiment", key: "nav.portfolioSentiment", icon: "💼" },
      { href: "/portfolio-momentum", key: "nav.portfolioMomentum", icon: "📈" },
    ],
  },
  {
    titleKey: "nav.secAutomation",
    links: [
      { href: "/autopilot", key: "nav.autopilot", icon: "🤖" },
      { href: "/crypto-autopilot", key: "nav.autopilotCrypto", icon: "🦾" },
    ],
  },
  {
    titleKey: "nav.secInfo",
    links: [{ href: "/news", key: "nav.news", icon: "📰" }],
  },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.user) setUser(d.user); })
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/me", { method: "POST" });
    router.push("/login");
  }

  return (
    <nav className="glass md:w-60 md:min-h-[calc(100dvh-2rem)] border-b md:border-b-0 md:border-r border-[var(--border)] px-3 md:px-4 py-2.5 md:py-6 flex md:flex-col gap-2 items-center md:items-stretch sticky top-8 z-40 md:self-start">
      <div className="flex items-center gap-2.5 md:mb-7 shrink-0">
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
        <span className="hidden md:inline font-semibold tracking-tight text-[15px]">Finance Bot</span>
      </div>
      {/* Desktop: colonna con intestazioni di sezione. Mobile: le sezioni usano
          `display:contents` così i link confluiscono in un'unica riga scorrevole
          (intestazioni nascoste), con icona + etichetta per distinguerli. */}
      <div className="flex md:flex-col gap-1 md:gap-0.5 overflow-x-auto md:overflow-visible min-w-0 flex-1 md:flex-none [-webkit-overflow-scrolling:touch] [scrollbar-width:none]">
        {SECTIONS.map((section) => (
          <div key={section.titleKey} className="contents md:block md:mb-1.5">
            <p className="hidden md:block px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]/70">
              {t(section.titleKey)}
            </p>
            {section.links.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all shrink-0 whitespace-nowrap ${
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
                  <span aria-hidden="true">{l.icon}</span>
                  <span>{t(l.key)}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="md:mt-auto md:pt-6 flex md:flex-col gap-2 items-center md:items-stretch shrink-0">
        <LangSwitcher />
        {user && (
          <div className="hidden md:flex flex-col gap-1 pt-3 border-t border-[var(--border)]">
            <p className="text-xs text-[var(--muted)] truncate" title={user.email}>
              👤 {user.name}
            </p>
            <button
              onClick={handleLogout}
              className="text-xs text-[var(--muted)] hover:text-[var(--negative)] text-left transition-colors"
            >
              Esci →
            </button>
          </div>
        )}
      </div>
      <p className="hidden md:block text-[10px] leading-tight text-[var(--muted)] pt-4">
        {t("common.disclaimer")}
      </p>
    </nav>
  );
}
