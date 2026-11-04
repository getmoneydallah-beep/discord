"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDate } from "@majlis/i18n";
import { PAID_TIERS, type BillingInfo, type BillingInterval, type PaidTier, type TeacherTier } from "@majlis/shared";
import { api, errorMessage, useLocale, useT } from "@/lib/store";
import { Button, cx } from "@/components/ui";
import { PageShell } from "@/components/pay/PageShell";
import { useMoney } from "@/components/pay/shared";

export default function BillingPage() {
  return (
    <Suspense>
      <Billing />
    </Suspense>
  );
}

function Billing() {
  const t = useT();
  const locale = useLocale();
  const money = useMoney();
  const params = useSearchParams();
  const justPaid = params.get("checkout") === "done";
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [interval, setInterval_] = useState<BillingInterval>("monthly");
  const [busy, setBusy] = useState<PaidTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let tries = 0;
    const load = () => api.getBilling().then(setInfo, (e) => setError(errorMessage(e)));
    void load();
    // After checkout the webhook may land a few seconds later.
    if (!justPaid) return;
    const timer = setInterval(() => {
      if (++tries > 20) return clearInterval(timer);
      void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [justPaid]);

  const date = (iso: string | null) => (iso ? formatDate(iso, locale) : "");
  const sub = info?.subscription;
  const live = sub && ["trialing", "active", "past_due"].includes(sub.status);

  async function choose(tier: PaidTier) {
    setBusy(tier);
    setError(null);
    try {
      const { url } = await api.teacherCheckout(tier, interval);
      window.location.href = url;
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  const tierName = (tier: TeacherTier) => t(`pay.tier_${tier}` as const);

  return (
    <PageShell title={t("pay.billing")} icon="⭐">
      {justPaid && !live && <p className="rounded-xl bg-brand/10 p-4 text-brand">⏳ {t("pay.checkoutDone")}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {info && (
        <>
          <section className="rounded-2xl border border-line bg-sidebar p-5">
            <div className="text-sm text-muted">{t("pay.yourPlan")}</div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-bold">{tierName(info.tier)}</span>
              {sub && (
                <span
                  className={cx(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    sub.status === "past_due" ? "bg-danger/15 text-danger" : live ? "bg-success/15 text-success" : "bg-line text-muted",
                  )}
                >
                  {t(`pay.status_${sub.status === "none" ? "expired" : sub.status}` as const, { date: date(sub.trialEndsAt) })}
                </span>
              )}
            </div>
            {sub && live && sub.currentPeriodEnd && sub.status !== "trialing" && (
              <p className="mt-1 text-sm text-muted">
                {t(sub.cancelAtPeriodEnd ? "pay.cancelsAt" : "pay.renews", { date: date(sub.currentPeriodEnd) })}
              </p>
            )}
            <ul className="mt-3 grid gap-1 text-sm text-muted sm:grid-cols-2">
              <li>{t("pay.servers", { n: `${info.usage.ownedServers} / ${info.limits.maxOwnedServers}` })}</li>
              <li>{info.limits.canSell ? t("pay.fee", { n: info.limits.platformFeeBps / 100 }) : t("pay.noSelling")}</li>
            </ul>
            {sub?.manageUrl && live && (
              <a href={sub.manageUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-brand hover:underline">
                {t("pay.manage")} ↗
              </a>
            )}
          </section>

          {!live && (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted">{t("pay.trialNote")}</p>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-sidebar p-1 text-sm">
                  {(["monthly", "yearly"] as const).map((i) => (
                    <button
                      key={i}
                      onClick={() => setInterval_(i)}
                      className={cx("rounded-md px-3 py-1.5", interval === i ? "bg-brand text-white" : "text-muted hover:text-fg")}
                    >
                      {t(`pay.${i}` as const)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {PAID_TIERS.map((tier) => {
                  const l = info.tiers[tier];
                  return (
                    <div key={tier} className={cx("flex flex-col gap-3 rounded-2xl border bg-sidebar p-5", tier === "pro" ? "border-brand" : "border-line")}>
                      <div className="text-lg font-bold">{tierName(tier)}</div>
                      <div>
                        <span className="text-3xl font-bold">{money(l.priceUsd[interval] * 100, "usd")}</span>
                        <span className="text-sm text-muted"> {t(interval === "monthly" ? "pay.perMonth" : "pay.perYear")}</span>
                        {interval === "yearly" && <div className="text-xs text-success">{t("pay.twoMonthsFree")}</div>}
                      </div>
                      <ul className="flex-1 space-y-1 text-sm">
                        <li>✓ {t("pay.servers", { n: l.maxOwnedServers })}</li>
                        <li>✓ {t("pay.offersPerServer", { n: l.maxOffersPerServer ?? t("pay.unlimited") })}</li>
                        <li>✓ {t("pay.fee", { n: l.platformFeeBps / 100 })}</li>
                        <li>✓ {t("pay.storage", { n: l.storageGb })}</li>
                      </ul>
                      <Button disabled={busy !== null} onClick={() => choose(tier)}>
                        {busy === tier ? t("common.loading") : t("pay.startTrial")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <p className="text-center text-sm text-muted">{t("pay.studentsFree")}</p>
        </>
      )}
    </PageShell>
  );
}
