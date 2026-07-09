"use client";

import { useEffect, useRef, useState } from "react";
import type { Recommendation } from "@/lib/types";
import { money, pct, relativeTime, scoreColor } from "@/lib/format";
import { nameFor } from "@/lib/universe";
import { LogoBadge } from "./LogoBadge";
import { Sparkline } from "./Sparkline";
import { useI18n } from "./I18nProvider";
import { useRisk } from "./RiskProvider";
import { positionSize } from "@/lib/risk";

export function SignalCard({
  rec,
  currentPrice,
  index = 0,
  onConfirmed,
}: {
  rec: Recommendation;
  currentPrice?: number;
  index?: number;
  onConfirmed?: () => void;
}) {
  const { t } = useI18n();
  const { accountSize, riskPct } = useRisk();
  const size = positionSize(accountSize, riskPct, rec.price, rec.stop);
  const [open, setOpen] = useState(false);
  // Flash the live price green/red whenever it ticks.
  const prevPrice = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (currentPrice == null) return;
    const prev = prevPrice.current;
    if (prev != null && currentPrice !== prev) {
      const dir = currentPrice > prev ? "up" : "down";
      setFlash(dir);
      const timer = setTimeout(() => setFlash(null), 900);
      prevPrice.current = currentPrice;
      return () => clearTimeout(timer);
    }
    prevPrice.current = currentPrice;
  }, [currentPrice]);

  const [showForm, setShowForm] = useState(false);
  const [shares, setShares] = useState("");
  // Il prezzo di esecuzione parte dall'ULTIMO prezzo di mercato (live, Finnhub via
  // /api/quotes) e resta editabile. All'apertura del form viene rinfrescato al
  // prezzo live corrente (se non già modificato dall'utente).
  const [price, setPrice] = useState(String(currentPrice ?? rec.price));
  const [priceEdited, setPriceEdited] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const riskReward =
    rec.price - rec.stop > 0
      ? ((rec.target - rec.price) / (rec.price - rec.stop)).toFixed(2)
      : "—";
  const upside = ((rec.target - rec.price) / rec.price) * 100;

  // Live price vs the entry snapshot taken at scan time.
  const liveDelta =
    currentPrice != null ? ((currentPrice - rec.price) / rec.price) * 100 : null;
  const targetHit = currentPrice != null && currentPrice >= rec.target;
  const stopHit = currentPrice != null && currentPrice <= rec.stop;

  async function confirm() {
    const s = Number(shares);
    const p = Number(price);
    if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(p) || p <= 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendationId: rec.id,
          ticker: rec.ticker,
          action: "BUY",
          shares: s,
          price: p,
          notes: notes || null,
        }),
      });
      if (res.ok) {
        setDone(true);
        setShowForm(false);
        onConfirmed?.();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="card-hover animate-in rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
      style={{ animationDelay: `${Math.min(index * 60, 600)}ms` }}
    >
      <div className="p-4 flex items-start gap-4">
        {/* Score ring */}
        <div
          className="shrink-0 size-14 rounded-full grid place-items-center font-semibold text-sm"
          style={{
            background: `conic-gradient(from -90deg, ${scoreColor(rec.score)}, var(--accent-2) ${rec.score}%, var(--surface-2) ${rec.score}%)`,
            boxShadow: `0 0 18px color-mix(in srgb, ${scoreColor(rec.score)} 30%, transparent)`,
          }}
        >
          <span className="size-11 rounded-full bg-[var(--surface)] grid place-items-center">
            <span style={{ color: scoreColor(rec.score) }}>{rec.score}</span>
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <LogoBadge ticker={rec.ticker} size={26} />
            <span className="font-mono font-semibold text-lg">{rec.ticker}</span>
            {nameFor(rec.ticker) !== rec.ticker && (
              <span className="text-sm text-[var(--muted)] truncate">{nameFor(rec.ticker)}</span>
            )}
            {rec.earningsDays != null && rec.earningsDays >= 0 && rec.earningsDays <= 7 && (
              <span
                className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium bg-[var(--warning)]/15 text-[var(--warning)]"
                title={rec.earningsDate ? `Earnings: ${rec.earningsDate}` : undefined}
              >
                ⚠️ {t("card.earnings", { n: rec.earningsDays })}
              </span>
            )}
            <span
              className={`${rec.earningsDays != null && rec.earningsDays >= 0 && rec.earningsDays <= 7 ? "" : "ml-auto"} text-xs px-2.5 py-0.5 rounded-full font-bold tracking-wide text-[#06121f]`}
              style={{ background: "linear-gradient(120deg, var(--positive), var(--accent-2))" }}
            >
              BUY
            </span>
          </div>

          {/* Live price vs entry snapshot */}
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-[var(--muted)] text-xs">{t("card.now")}</span>
            {currentPrice != null ? (
              <>
                <span
                  key={currentPrice}
                  className={`font-mono font-medium rounded px-1 -mx-1 inline-flex items-center gap-1 ${
                    flash === "up" ? "flash-up" : flash === "down" ? "flash-down" : ""
                  }`}
                >
                  {money(currentPrice)}
                  {flash && (
                    <span
                      className="arrow-pop text-xs"
                      style={{ color: flash === "up" ? "var(--positive)" : "var(--negative)" }}
                    >
                      {flash === "up" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
                {liveDelta != null && (
                  <span
                    className="font-mono text-xs"
                    style={{ color: liveDelta >= 0 ? "var(--positive)" : "var(--negative)" }}
                  >
                    {pct(liveDelta)}
                  </span>
                )}
                <span className="text-xs text-[var(--muted)]">{t("card.fromEntry")}</span>
                {targetHit && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--positive)]/15 text-[var(--positive)] font-medium">
                    {t("card.targetHit")}
                  </span>
                )}
                {stopHit && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--negative)]/15 text-[var(--negative)] font-medium">
                    {t("card.stopHit")}
                  </span>
                )}
              </>
            ) : (
              <span className="font-mono text-xs text-[var(--muted)]">—</span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <Stat label={t("card.entry")} value={money(rec.price)} />
            <Stat label={t("card.target")} value={money(rec.target)} sub={pct(upside)} positive />
            <Stat label={t("card.stop")} value={money(rec.stop)} negative />
          </div>

          {size && (
            <p className="mt-2 text-xs text-[var(--accent-2)]">
              {t("card.sizing", {
                shares: size.shares,
                cost: money(size.cost),
                risk: money(size.dollarRisk),
              })}
              {size.capped && <span className="text-[var(--warning)]"> {t("card.sizeCapped")}</span>}
            </p>
          )}

          {rec.spark.length > 1 && (
            <div className="mt-3">
              <Sparkline
                values={rec.spark}
                live={currentPrice}
                width={300}
                height={48}
                refs={[
                  { value: rec.target, color: "var(--positive)", dashed: true },
                  { value: rec.stop, color: "var(--negative)", dashed: true },
                ]}
              />
              <p className="text-[10px] text-[var(--muted)] mt-1">
                {t("card.sparkCaption", { n: rec.spark.length })}
              </p>
            </div>
          )}

          <div className="mt-2 flex items-center gap-3 text-xs text-[var(--muted)]">
            <span>R/R {riskReward}</span>
            <span>·</span>
            <span>
              {t("card.sentiment")}{" "}
              <span
                style={{
                  color:
                    rec.newsSentiment > 0.1
                      ? "var(--positive)"
                      : rec.newsSentiment < -0.1
                      ? "var(--negative)"
                      : "var(--muted)",
                }}
              >
                {rec.newsSentiment.toFixed(2)}
              </span>
            </span>
            <button
              onClick={() => setOpen((o) => !o)}
              className="ml-auto text-[var(--accent)] hover:underline"
            >
              {open ? t("card.hideDetails") : t("card.why")}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--border)] pt-3">
          <div>
            <p className="text-xs font-medium text-[var(--muted)] mb-2">
              {t("card.rationale")}
            </p>
            <ul className="space-y-1.5">
              {rec.reasons.map((r) => (
                <li key={r.code} className="flex items-center gap-2 text-sm">
                  <span
                    className="text-xs font-mono w-10 text-right"
                    style={{ color: r.weight >= 0 ? "var(--positive)" : "var(--negative)" }}
                  >
                    {r.weight >= 0 ? "+" : ""}
                    {r.weight}
                  </span>
                  <span>{r.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {rec.news.length > 0 && (
            <div>
              <p className="text-xs font-medium text-[var(--muted)] mb-2">
                {t("card.relatedNews")}
              </p>
              <ul className="space-y-1.5">
                {rec.news.slice(0, 4).map((n, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span
                      className="mt-1 size-1.5 rounded-full shrink-0"
                      style={{
                        background:
                          n.sentiment > 0
                            ? "var(--positive)"
                            : n.sentiment < 0
                            ? "var(--negative)"
                            : "var(--muted)",
                      }}
                    />
                    <a
                      href={n.link}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-[var(--accent)] hover:underline line-clamp-2"
                    >
                      {n.title}
                    </a>
                    <span className="text-xs text-[var(--muted)] whitespace-nowrap">
                      {relativeTime(n.publishedAt, t)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Confirm action */}
      <div className="px-4 py-3 bg-[var(--surface-2)] border-t border-[var(--border)]">
        {done ? (
          <p className="text-sm text-[var(--positive)]">{t("card.bought")}</p>
        ) : showForm ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("common.shares")}>
              <input
                type="number"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                placeholder="0"
                className="w-20 input"
              />
            </Field>
            <Field label={t("card.execPrice")}>
              <input
                type="number"
                value={price}
                onChange={(e) => { setPrice(e.target.value); setPriceEdited(true); }}
                className="w-24 input"
              />
            </Field>
            <Field label={t("common.notes")}>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("common.optional")}
                className="w-32 input"
              />
            </Field>
            <button
              onClick={confirm}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? t("common.saving") : t("card.confirm")}
            </button>
            <button onClick={() => setShowForm(false)} className="btn-ghost">
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              if (size && !shares) setShares(String(size.shares));
              // Apri il form col prezzo di mercato più fresco (se non già editato).
              if (!priceEdited && currentPrice != null) setPrice(String(currentPrice));
              setShowForm(true);
            }}
            className="btn-primary"
          >
            {t("card.boughtBtn")}
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  positive,
  negative,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const color = positive ? "var(--positive)" : negative ? "var(--negative)" : "var(--foreground)";
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="font-mono font-medium" style={{ color }}>
        {value}
      </p>
      {sub && <p className="text-xs" style={{ color }}>{sub}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}
