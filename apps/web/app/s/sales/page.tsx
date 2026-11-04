"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@majlis/i18n";
import type { Sale, WhopConnectionInfo } from "@majlis/shared";
import { api, errorMessage, useLocale, useT } from "@/lib/store";
import { PageShell } from "@/components/pay/PageShell";
import { useMoney } from "@/components/pay/shared";

/** Read-only list of student payments to the teacher's Whop account. */
export default function SalesPage() {
  const t = useT();
  const locale = useLocale();
  const money = useMoney();
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [info, setInfo] = useState<WhopConnectionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listSales().then(setSales, (e) => setError(errorMessage(e)));
    api.getWhopConnection().then(setInfo, () => undefined);
  }, []);

  const dashboard = info?.env === "sandbox" ? "https://sandbox.whop.com/dashboard" : "https://whop.com/dashboard";
  const totals = new Map<string, number>();
  for (const s of sales ?? []) totals.set(s.currency, (totals.get(s.currency) ?? 0) + s.totalMinor - s.refundedMinor);

  return (
    <PageShell
      title={t("pay.sales")}
      icon="🧾"
      actions={
        <a href={dashboard} target="_blank" rel="noreferrer" className="text-sm text-brand hover:underline">
          {t("pay.openWhop")} ↗
        </a>
      }
    >
      <p className="text-sm text-muted">{t("pay.salesHelp")}</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      {totals.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...totals].map(([cur, v]) => (
            <div key={cur} className="rounded-2xl border border-line bg-sidebar px-5 py-3 text-2xl font-bold">
              {money(v, cur)}
            </div>
          ))}
        </div>
      )}
      {sales && sales.length === 0 && <p className="text-muted">{t("pay.noEntries")}</p>}
      {sales && sales.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {sales.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
              <span className="w-28 shrink-0 text-muted">{formatDate(s.createdAt, locale)}</span>
              <span className="min-w-0 flex-1">
                <bdi className="font-medium">{s.student?.displayName ?? "—"}</bdi>
                {s.offerName && <bdi className="text-muted"> · {s.offerName}</bdi>}
                {s.serverName && <bdi className="text-muted"> · {s.serverName}</bdi>}
              </span>
              {s.refundedMinor > 0 && (
                <span className="rounded bg-danger/15 px-1.5 py-0.5 text-xs text-danger">
                  {t("pay.refunded")} {money(s.refundedMinor, s.currency)}
                </span>
              )}
              <span className="font-semibold">{money(s.totalMinor, s.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
