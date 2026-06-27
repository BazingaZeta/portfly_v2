"use client";

import { useEffect, useState } from "react";
import type { NewsItem } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { useI18n } from "@/components/I18nProvider";

export default function NewsPage() {
  const { t } = useI18n();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/news", { cache: "no-store" });
        const data = await res.json();
        setNews(data.news ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">{t("news.title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t("news.subtitle")}</p>
      </header>

      {loading ? (
        <p className="text-[var(--muted)]">{t("news.loading")}</p>
      ) : news.length === 0 ? (
        <p className="text-[var(--muted)]">{t("news.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {news.map((n, i) => (
            <li
              key={i}
              className="animate-in rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 flex items-start gap-3 hover:border-[var(--accent)]/50 transition-colors"
              style={{ animationDelay: `${Math.min(i * 30, 600)}ms` }}
            >
              <span
                className="mt-1.5 size-2 rounded-full shrink-0"
                style={{
                  background:
                    n.sentiment > 0.1
                      ? "var(--positive)"
                      : n.sentiment < -0.1
                      ? "var(--negative)"
                      : "var(--muted)",
                }}
                title={`sentiment ${n.sentiment.toFixed(2)}`}
              />
              <div className="min-w-0">
                <a
                  href={n.link}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:text-[var(--accent)] hover:underline"
                >
                  {n.title}
                </a>
                <p className="text-xs text-[var(--muted)] mt-1">
                  {n.source} · {relativeTime(n.publishedAt, t)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
