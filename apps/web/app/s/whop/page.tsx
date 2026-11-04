"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@majlis/api-client";
import type { BillingInfo, WhopConnectionInfo } from "@majlis/shared";
import { api, errorMessage, useT } from "@/lib/store";
import { Button, Input, cx } from "@/components/ui";
import { PageShell } from "@/components/pay/PageShell";

/** Teacher connects their own Whop account by pasting an API key. */
export default function WhopConnectPage() {
  const t = useT();
  const [info, setInfo] = useState<WhopConnectionInfo | null>(null);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    api.getWhopConnection().then(setInfo, (e) => setError(errorMessage(e)));
    api.getBilling().then(setBilling, () => undefined);
  }, []);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMissing([]);
    try {
      setInfo(await api.connectWhop(key.trim()));
      setKey("");
    } catch (err) {
      if (err instanceof ApiError && err.code.startsWith("whop_missing_permissions:")) {
        setMissing(err.code.slice("whop_missing_permissions:".length).split(","));
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm(t("pay.disconnectConfirm"))) return;
    try {
      await api.disconnectWhop();
      setInfo(await api.getWhopConnection());
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const conn = info?.connection;
  const canSell = billing?.limits.canSell ?? true;
  const shownMissing = missing.length ? missing : (conn?.missingPermissions ?? []);

  return (
    <PageShell title={t("pay.whop")} icon="🔗">
      {billing && !canSell && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 p-4">
          <span className="flex-1">{t("pay.upgradeToSell")}</span>
          <Link href="/s/billing" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
            {t("pay.seePlans")}
          </Link>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-xl font-bold">{t("pay.whopTitle")}</h2>
        <p className="text-muted">{t("pay.whopIntro")}</p>
      </section>

      {conn && (
        <section
          className={cx(
            "space-y-2 rounded-2xl border p-5",
            conn.status === "active" ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold">{conn.status === "active" ? "✓" : "⚠"} {t(conn.status === "active" ? "pay.conn_active" : "pay.conn_broken")}</span>
            <div className="flex-1" />
            <Button variant="ghost" className="py-1 text-danger" onClick={disconnect}>
              {t("pay.disconnect")}
            </Button>
          </div>
          <p className="text-sm">
            {t("pay.connectedTo", { name: conn.accountTitle })} · <span dir="ltr">{conn.accountId}</span>
            {conn.keyLast4 && <> · {t("pay.keyEnding", { last4: conn.keyLast4 })}</>}
          </p>
          {conn.status !== "active" && <p className="text-sm">{t("pay.brokenHelp")}</p>}
          {!conn.webhookActive && <p className="text-xs text-muted">{t("pay.noWebhook")}</p>}
        </section>
      )}

      {info && (
        <form onSubmit={connect} className="space-y-4 rounded-2xl border border-line bg-sidebar p-5">
          <ol className="list-decimal space-y-3 ps-5 text-sm">
            <li>
              {t("pay.whopStep1")}{" "}
              <a
                href={info.env === "sandbox" ? "https://sandbox.whop.com/dashboard/developer" : "https://whop.com/dashboard/developer"}
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                ↗
              </a>
            </li>
            <li>
              {t("pay.whopStep2")}
              <ul className="mt-2 flex flex-wrap gap-1" dir="ltr">
                {info.requiredPermissions.map((p) => (
                  <li
                    key={p}
                    className={cx(
                      "rounded px-1.5 py-0.5 font-mono text-xs",
                      shownMissing.includes(p) ? "bg-danger/15 text-danger" : "bg-bg text-muted",
                    )}
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </li>
            <li>{t("pay.whopStep3")}</li>
          </ol>
          {info.env === "sandbox" && <p className="text-xs text-muted">🧪 {t("pay.whopSandbox")}</p>}
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              placeholder="apik_…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              dir="ltr"
              aria-label={t("pay.apiKey")}
              required
            />
            <Button disabled={busy || !key.trim() || !canSell}>{busy ? t("common.loading") : conn ? t("pay.reconnect") : t("pay.connect")}</Button>
          </div>
          {shownMissing.length > 0 && (
            <p className="text-sm text-danger">
              {t("pay.missingPerms")} <span dir="ltr" className="font-mono">{shownMissing.join(", ")}</span>
            </p>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <p className="text-xs text-muted">🔒 {t("pay.keySafety")}</p>
        </form>
      )}
    </PageShell>
  );
}
