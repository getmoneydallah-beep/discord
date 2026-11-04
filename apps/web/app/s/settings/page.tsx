"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@majlis/i18n";
import type { MyEntitlement } from "@majlis/shared";
import { actions, api, app, errorMessage, useApp, useLocale, useT } from "@/lib/store";
import { Button, Input, cx } from "@/components/ui";
import { PageShell } from "@/components/pay/PageShell";
import { useOfferPrice } from "@/components/pay/shared";
import { ThemeSegmented } from "@/components/ThemeToggle";

/** Settings for everyone: profile, preferences, my subscriptions, teaching (only for teachers), account. */
export default function SettingsPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const me = useApp((s) => s.me);
  const prefs = useApp((s) => s.prefs);
  const servers = useApp((s) => s.servers);
  const price = useOfferPrice();
  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subs, setSubs] = useState<MyEntitlement[] | null>(null);
  const [hasPlan, setHasPlan] = useState(false);
  const isTeacher = hasPlan || servers.some((s) => s.ownerId === me?.id);

  useEffect(() => {
    api.myEntitlements().then(setSubs, () => setSubs([]));
    api.getBilling().then((b) => setHasPlan(Boolean(b.subscription)), () => undefined);
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const updated = await api.updateMe({ displayName: displayName.trim() });
      app.store.setState({ me: updated });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const live = (s: MyEntitlement) => ["active", "trialing", "past_due"].includes(s.status);

  return (
    <PageShell title={t("settingsPage.title")} icon="⚙">
      {/* Profile */}
      <Section title={`👤 ${t("settingsPage.profile")}`}>
        <form onSubmit={saveProfile} className="space-y-3">
          <Input
            label={t("settingsPage.displayName")}
            value={displayName}
            onChange={(e) => (setDisplayName(e.target.value), setSaved(false))}
            required
            maxLength={64}
            dir="auto"
          />
          <div className="text-sm text-muted">
            {t("settingsPage.username")}: <span dir="ltr">@{me?.username}</span> · <span dir="ltr">{me?.email}</span>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-success">{t("settingsPage.saved")}</span>}
            <Button disabled={!displayName.trim() || displayName.trim() === me?.displayName}>{t("common.save")}</Button>
          </div>
        </form>
      </Section>

      {/* Preferences */}
      <Section title={`🌐 ${t("settingsPage.preferences")}`}>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span>{t("common.language")}</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-1 text-sm">
              {(["ar", "en"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => void actions.setPrefs({ locale: l })}
                  className={cx("rounded-md px-3 py-1.5", prefs.locale === l ? "bg-brand text-white" : "text-muted hover:text-fg")}
                >
                  {l === "ar" ? "العربية" : "English"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{t("settingsPage.theme")}</span>
            <ThemeSegmented labels={{ light: t("settingsPage.themeLight"), dark: t("settingsPage.themeDark"), system: t("settingsPage.themeSystem") }} />
          </div>
          <label className="flex items-center justify-between gap-3">
            <span>{t("settingsPage.easternDigits")}</span>
            <input
              type="checkbox"
              checked={prefs.easternDigits}
              onChange={(e) => void actions.setPrefs({ easternDigits: e.target.checked })}
              className="h-5 w-5 accent-brand"
            />
          </label>
        </div>
      </Section>

      {/* My subscriptions */}
      <Section title={`🎟 ${t("settingsPage.subscriptions")}`}>
        {subs === null && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {subs?.length === 0 && <p className="text-sm text-muted">{t("settingsPage.noSubscriptions")}</p>}
        {subs && subs.length > 0 && (
          <ul className="divide-y divide-line">
            {subs.map((s) => (
              <li key={s.id} className={cx("flex flex-wrap items-center gap-3 py-3", !live(s) && "opacity-60")}>
                <Link href={`/s/${s.serverId}`} className="min-w-0 flex-1">
                  <bdi className="block font-semibold">{s.offerName}</bdi>
                  <span className="block text-sm text-muted">
                    <bdi>{s.serverName}</bdi> · {s.source === "manual" ? t("settingsPage.granted") : price(s)}
                  </span>
                  <span className="block text-xs text-muted">
                    {t("settingsPage.since", { date: formatDate(s.startsAt, locale) })}
                    {s.endsAt && ` · ${t("settingsPage.until", { date: formatDate(s.endsAt, locale) })}`}
                  </span>
                </Link>
                <span
                  className={cx(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    s.status === "past_due" ? "bg-danger/15 text-danger" : live(s) ? "bg-success/15 text-success" : "bg-line text-muted",
                  )}
                >
                  {t(`settingsPage.status_${s.status}` as const)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Teaching */}
      <Section title={`🎓 ${t("settingsPage.teaching")}`}>
        {isTeacher ? (
          <nav className="grid gap-2 sm:grid-cols-3">
            {[
              ["/s/billing", "⭐", t("pay.billing")],
              ["/s/whop", "🔗", t("pay.whop")],
              ["/s/sales", "🧾", t("pay.sales")],
            ].map(([href, icon, label]) => (
              <Link key={href} href={href!} className="rounded-xl border border-line px-3 py-3 text-center text-sm hover:border-brand hover:text-brand">
                <span className="block text-xl">{icon}</span>
                {label}
              </Link>
            ))}
          </nav>
        ) : (
          <Link href="/s/billing" className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line p-4 text-sm hover:border-brand">
            <span>{t("settingsPage.startTeaching")}</span>
            <span className="flip-rtl inline-block text-brand">→</span>
          </Link>
        )}
      </Section>

      {/* Account */}
      <Section title={`🔐 ${t("settingsPage.account")}`}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            className="border border-line"
            onClick={async () => {
              await actions.signOut();
              router.push("/login");
            }}
          >
            {t("auth.logout")}
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            className="text-danger"
            onClick={async () => {
              if (!confirm(t("auth.deleteAccountConfirm"))) return;
              try {
                await actions.deleteAccount();
                router.push("/register");
              } catch (err) {
                alert(errorMessage(err));
              }
            }}
          >
            {t("auth.deleteAccount")}
          </Button>
        </div>
      </Section>
    </PageShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-sidebar p-5">
      <h2 className="font-bold">{title}</h2>
      {children}
    </section>
  );
}
