"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@majlis/i18n";
import type { Earnings } from "@majlis/shared";
import { api, errorMessage, useLocale, useT } from "@/lib/store";
import { Button, Input, cx } from "@/components/ui";
import { PageShell } from "@/components/pay/PageShell";
import { useMoney } from "@/components/pay/shared";

/** Teacher earnings: pending (in hold), available, paid out; every ledger line; where to send payouts. */
export default function EarningsPage() {
  const t = useT();
  const locale = useLocale();
  const money = useMoney();
  const [data, setData] = useState<Earnings | null>(null);
  const [username, setUsername] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getEarnings().then((d) => {
      setData(d);
      setUsername(d.payoutAccount.whopUsername ?? "");
    }, (e) => setError(errorMessage(e)));
  }, []);

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const acct = await api.setPayoutAccount(username.trim());
      setData((d) => (d ? { ...d, payoutAccount: acct } : d));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const balances = data?.balances.length ? data.balances : [{ currency: "sar", pendingMinor: 0, availableMinor: 0, paidMinor: 0, grossSalesMinor: 0 }];

  return (
    <PageShell title={t("pay.earnings")} icon="💰">
      {error && <p className="text-sm text-danger">{error}</p>}
      {data && (
        <>
          {balances.map((b) => (
            <section key={b.currency} className="grid gap-3 sm:grid-cols-4">
              {[
                ["pay.available", b.availableMinor, "text-success"],
                ["pay.pending", b.pendingMinor, ""],
                ["pay.paidOut", b.paidMinor, ""],
                ["pay.gross", b.grossSalesMinor, "text-muted"],
              ].map(([label, v, cls]) => (
                <div key={label as string} className="rounded-2xl border border-line bg-sidebar p-4">
                  <div className="text-xs text-muted">{t(label as "pay.available")}</div>
                  <div className={cx("text-2xl font-bold", (v as number) < 0 ? "text-danger" : (cls as string))}>{money(v as number, b.currency)}</div>
                </div>
              ))}
            </section>
          ))}
          <p className="text-sm text-muted">
            {t("pay.holdNote", { days: data.holdDays, min: money(data.minPayoutMinor, balances[0]!.currency) })}
          </p>

          <form onSubmit={saveAccount} className="space-y-2 rounded-2xl border border-line bg-sidebar p-5">
            <h2 className="font-bold">{t("pay.payoutAccount")}</h2>
            <p className="text-sm text-muted">{t("pay.payoutAccountHelp")}</p>
            <div className="flex gap-2">
              <Input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setSaved(false);
                }}
                placeholder={t("pay.whopUsername")}
                dir="ltr"
                required
              />
              <Button disabled={!username.trim() || username.trim() === data.payoutAccount.whopUsername}>{saved ? "✓" : t("common.save")}</Button>
            </div>
          </form>

          {data.payouts.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-bold">{t("pay.payoutsHistory")}</h2>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {data.payouts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span>{formatDate(p.sentAt, locale)}</span>
                    <span className="text-muted" dir="ltr">
                      {p.whopReference}
                    </span>
                    <span className="font-semibold">{money(p.amountMinor, p.currency)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-bold">{t("pay.history")}</h2>
            {data.entries.length === 0 ? (
              <p className="text-muted">{t("pay.noEntries")}</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {data.entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                    <span className="w-24 shrink-0 text-muted">{formatDate(e.createdAt, locale)}</span>
                    <span className="flex-1">
                      {t(`pay.ledger_${e.type}` as const)}
                      {e.note && <bdi className="text-muted"> · {e.note}</bdi>}
                      {e.serverName && <bdi className="text-muted"> · {e.serverName}</bdi>}
                    </span>
                    {new Date(e.availableAt) > new Date() && <span className="text-xs text-muted">⏳ {formatDate(e.availableAt, locale)}</span>}
                    <span className={cx("font-semibold", e.amountMinor < 0 ? "text-danger" : "text-success")} dir="ltr">
                      {money(e.amountMinor, e.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}
