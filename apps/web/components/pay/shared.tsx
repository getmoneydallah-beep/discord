"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Channel, Offer } from "@majlis/shared";
import { formatMoney } from "@majlis/i18n";
import { actions, api, errorMessage, useApp, useLocale, useT } from "@/lib/store";
import { Button, cx } from "../ui";
import { useUi } from "@/lib/ui";

export function useMoney() {
  const locale = useLocale();
  const eastern = useApp((s) => s.prefs.easternDigits);
  return (minor: number, currency: string) => formatMoney(minor, currency, locale, { easternDigits: eastern });
}

/** "99 ر.س." / "49 ر.س. / شهرياً" */
export function useOfferPrice() {
  const t = useT();
  const money = useMoney();
  return (o: { priceMinor: number; currency: string; billing: Offer["billing"] }) =>
    `${money(o.priceMinor, o.currency)}${o.billing === "monthly" ? ` ${t("pay.perMonth")}` : o.billing === "yearly" ? ` ${t("pay.perYear")}` : ""}`;
}

export function offersUnlocking(offers: Offer[] | undefined, serverId: string, channelId: string) {
  return (offers ?? []).filter(
    (o) => o.active && o.grants.some((g) => (g.targetType === "server" && g.targetId === serverId) || (g.targetType === "channel" && g.targetId === channelId)),
  );
}

export function useOffers(serverId: string) {
  const offers = useApp((s) => s.offers[serverId]);
  useEffect(() => {
    void actions.loadOffers(serverId).catch(() => undefined);
  }, [serverId]);
  return offers;
}

/** Sends the member to Whop checkout for an offer. Selling happens on the web only. */
export function UnlockButton({ offer, className = "w-full sm:w-auto" }: { offer: Offer; className?: string }) {
  const t = useT();
  const price = useOfferPrice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (offer.owned) return <span className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">✓ {t("pay.owned")}</span>;
  return (
    <span className="inline-flex flex-col items-stretch gap-1">
      <Button
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const { url } = await api.offerCheckout(offer.id);
            window.location.href = url;
          } catch (e) {
            setError(errorMessage(e));
            setBusy(false);
          }
        }}
      >
        🔓 {t("pay.unlock", { price: price(offer) })}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/** Shown instead of paid content: what it is, and the offers that unlock it. */
export function LockedPanel({ serverId, channelId, className }: { serverId: string; channelId: string; className?: string }) {
  const t = useT();
  const offers = offersUnlocking(useOffers(serverId), serverId, channelId);
  return (
    <div className={cx("mx-auto max-w-lg space-y-4 rounded-2xl border border-line bg-sidebar p-6 text-center", className)}>
      <div className="text-5xl">🔒</div>
      <h2 className="text-xl font-bold">{t("pay.lockedTitle")}</h2>
      <p className="text-muted">{offers.length ? t("pay.lockedBody") : t("pay.noOffersForThis")}</p>
      <div className="space-y-3 text-start">
        {offers.map((o) => (
          <OfferCard key={o.id} offer={o} />
        ))}
      </div>
    </div>
  );
}

export function OfferCard({ offer }: { offer: Offer }) {
  const t = useT();
  const price = useOfferPrice();
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-bg p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="font-bold" dir="auto">
          {offer.name}
        </div>
        {offer.description && (
          <p className="bidi text-sm text-muted" dir="auto">
            {offer.description}
          </p>
        )}
        <div className="mt-1 text-sm">
          <span className="font-semibold">{price(offer)}</span>
          {offer.trialDays ? <span className="ms-2 rounded bg-brand/15 px-1.5 py-0.5 text-xs text-brand">{t("pay.trialBadge", { n: offer.trialDays })}</span> : null}
        </div>
      </div>
      <UnlockButton offer={offer} />
    </div>
  );
}

/** Header badges (paid, announcements) and, for staff, the channel settings gear. */
export function ChannelHeaderTools({ channel }: { channel: Channel }) {
  const t = useT();
  const myRole = useApp((s) => s.serverState[channel.serverId]?.myRole ?? "member");
  const openModal = useUi((s) => s.openModal);
  return (
    <span className="flex items-center gap-1">
      {channel.access === "paid" && (
        <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand" title={t("channel.seePaid")}>
          🔒 {t("pay.paid")}
        </span>
      )}
      {channel.postPolicy === "staff" && (
        <span className="rounded-md bg-surface px-2 py-0.5 text-xs text-muted" title={t("channel.postStaff")}>
          📢 {t("channel.typeAnnouncements")}
        </span>
      )}
      {myRole !== "member" && (
        <button
          onClick={() => openModal("channelSettings", channel.id)}
          className="rounded-md px-2 py-1 text-muted hover:bg-surface hover:text-fg"
          title={t("channel.settings")}
          aria-label={t("channel.settings")}
        >
          ⚙
        </button>
      )}
    </span>
  );
}

/**
 * After Whop checkout redirects back with ?purchase=<offerId>, wait for the
 * webhook to grant access (the gateway's ACCESS_UPDATE usually arrives first;
 * polling is the fallback).
 */
export function PurchaseWatcher({ serverId }: { serverId: string }) {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const offerId = params.get("purchase");
  const owned = useApp((s) => s.offers[serverId]?.find((o) => o.id === offerId)?.owned);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!offerId || owned) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      void actions.refreshAccess(serverId).catch(() => undefined);
      if (tries >= 30) {
        clearInterval(timer);
        setGaveUp(true);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [offerId, owned, serverId]);

  useEffect(() => {
    if (!offerId || !owned) return;
    const timer = setTimeout(() => router.replace(pathname), 4000);
    return () => clearTimeout(timer);
  }, [offerId, owned, router, pathname]);

  if (!offerId || gaveUp) return null;
  return (
    <div className={cx("fixed bottom-4 start-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg rtl:translate-x-1/2", owned ? "bg-success text-white" : "bg-sidebar text-fg")}>
      {owned ? `✓ ${t("pay.purchased")}` : `⏳ ${t("pay.processing")}`}
    </div>
  );
}
