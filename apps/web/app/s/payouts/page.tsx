"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@majlis/i18n";
import type { AdminPayoutRow, Payout } from "@majlis/shared";
import { api, errorMessage, useApp, useLocale, useT } from "@/lib/store";
import { Button, Input, Modal, cx } from "@/components/ui";
import { PageShell } from "@/components/pay/PageShell";
import { useMoney } from "@/components/pay/shared";

type Data = { rows: AdminPayoutRow[]; history: Payout[]; minPayoutMinor: number; holdDays: number };

/** Owner-only: teachers with balances; send in Whop, then record it here. */
export default function PayoutsPage() {
  const t = useT();
  const locale = useLocale();
  const money = useMoney();
  const me = useApp((s) => s.me);
  const [data, setData] = useState<Data | null>(null);
  const [paying, setPaying] = useState<AdminPayoutRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.adminPayouts().then(setData, (e) => setError(errorMessage(e)));
  useEffect(() => {
    if (me?.isPlatformAdmin) void load();
  }, [me?.isPlatformAdmin]);

  if (!me?.isPlatformAdmin) return <PageShell title={t("pay.payouts")} icon="🏦"><p className="text-muted">{t("errors.forbidden")}</p></PageShell>;

  async function downloadCsv() {
    try {
      const csv = await api.adminPayoutsCsv();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `majlis-payouts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const names = new Map(data?.rows.map((r) => [r.teacher.id, r.teacher.displayName]));

  return (
    <PageShell title={t("pay.payouts")} icon="🏦" actions={<Button variant="ghost" onClick={downloadCsv}>⬇ {t("pay.downloadCsv")}</Button>}>
      <p className="text-sm text-muted">{t("pay.payoutsHelp")}</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      {data && (
        <>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-sidebar text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-start">{t("pay.teacher")}</th>
                  <th className="px-3 py-2 text-start">{t("pay.whopUsername")}</th>
                  <th className="px-3 py-2 text-end">{t("pay.available")}</th>
                  <th className="px-3 py-2 text-end">{t("pay.pending")}</th>
                  <th className="px-3 py-2 text-end">{t("pay.paidOut")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted">
                      {t("pay.noEntries")}
                    </td>
                  </tr>
                )}
                {data.rows.map((r) => (
                  <tr key={`${r.teacher.id}:${r.balance.currency}`}>
                    <td className="px-3 py-2">
                      <bdi className="font-medium">{r.teacher.displayName}</bdi>
                      <div className="text-xs text-muted" dir="ltr">
                        {r.teacher.email}
                      </div>
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {r.payoutAccount.whopUsername ?? <span className="text-muted">{t("pay.noAccount")}</span>}
                    </td>
                    <td className={cx("px-3 py-2 text-end font-semibold", r.balance.availableMinor < 0 && "text-danger")}>
                      {money(r.balance.availableMinor, r.balance.currency)}
                    </td>
                    <td className="px-3 py-2 text-end text-muted">{money(r.balance.pendingMinor, r.balance.currency)}</td>
                    <td className="px-3 py-2 text-end text-muted">{money(r.balance.paidMinor, r.balance.currency)}</td>
                    <td className="px-3 py-2 text-end">
                      {r.eligible ? (
                        <Button className="py-1" onClick={() => setPaying(r)}>
                          {t("pay.markPaid")}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted">{t("pay.notEligible")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.history.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-bold">{t("pay.payoutsHistory")}</h2>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {data.history.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                    <span className="w-28 text-muted">{formatDate(p.sentAt, locale)}</span>
                    <bdi className="flex-1">{names.get(p.teacherId) ?? p.teacherId}</bdi>
                    <span className="text-muted" dir="ltr">
                      {p.whopReference}
                    </span>
                    <span className="font-semibold">{money(p.amountMinor, p.currency)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {paying && (
        <MarkPaid
          row={paying}
          onClose={(done) => {
            setPaying(null);
            if (done) void load();
          }}
        />
      )}
    </PageShell>
  );
}

function MarkPaid({ row, onClose }: { row: AdminPayoutRow; onClose: (done: boolean) => void }) {
  const t = useT();
  const money = useMoney();
  const [amount, setAmount] = useState(String(row.balance.availableMinor / 100));
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.markPaid({
        teacherId: row.teacher.id,
        currency: row.balance.currency,
        amountMinor: Math.round(Number(amount) * 100),
        whopReference: ref.trim(),
        note: note.trim() || undefined,
      });
      onClose(true);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={() => onClose(false)} title={`${t("pay.markPaid")} · ${row.teacher.displayName}`}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">
          {t("pay.available")}: <b>{money(row.balance.availableMinor, row.balance.currency)}</b> → <span dir="ltr">@{row.payoutAccount.whopUsername}</span>
        </p>
        <Input label={`${t("pay.price")} (${row.balance.currency.toUpperCase()})`} type="number" step="0.01" min="0.01" max={row.balance.availableMinor / 100} value={amount} onChange={(e) => setAmount(e.target.value)} required dir="ltr" />
        <Input label={t("pay.whopReference")} value={ref} onChange={(e) => setRef(e.target.value)} required dir="ltr" />
        <Input label={t("pay.note")} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onClose(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy}>{t("pay.markPaid")}</Button>
        </div>
      </form>
    </Modal>
  );
}
