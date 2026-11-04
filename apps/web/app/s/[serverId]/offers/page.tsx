"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  OFFER_BILLING,
  OFFER_CURRENCIES,
  type BillingInfo,
  type WhopConnectionInfo,
  type Entitlement,
  type Offer,
  type OfferBilling,
  type OfferCurrency,
  type OfferGrant,
} from "@majlis/shared";
import { actions, api, errorMessage, useApp, useT } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { Button, Input, Modal, cx } from "@/components/ui";
import { useOfferPrice, useOffers } from "@/components/pay/shared";

/** Owner/admin page: offers (what students can buy), who holds them, manual grants. */
export default function OffersPage() {
  const t = useT();
  const { serverId } = useParams<{ serverId: string }>();
  const st = useApp((s) => s.serverState[serverId]);
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const me = useApp((s) => s.me);
  const offers = useOffers(serverId);
  const price = useOfferPrice();
  const setNav = useUi((s) => s.setNav);
  const [editing, setEditing] = useState<Offer | "new" | null>(null);
  const [ents, setEnts] = useState<Entitlement[]>([]);
  const [ownerBilling, setOwnerBilling] = useState<BillingInfo | null>(null);
  const [whop, setWhop] = useState<WhopConnectionInfo | null>(null);
  const [grantFor, setGrantFor] = useState("");
  const [grantOffer, setGrantOffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isOwner = server?.ownerId === me?.id;

  const reloadEnts = () => api.listEntitlements(serverId).then(setEnts, () => undefined);
  useEffect(() => {
    void reloadEnts();
    if (isOwner) {
      api.getBilling().then(setOwnerBilling, () => undefined);
      api.getWhopConnection().then(setWhop, () => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, isOwner]);

  if (!st || !server) return null;
  if (st.myRole === "member") return <div className="p-8 text-muted">{t("errors.forbidden")}</div>;
  const canSell = ownerBilling ? ownerBilling.limits.canSell : true;
  const live = ents.filter((e) => ["active", "trialing", "past_due"].includes(e.status));

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <button onClick={() => setNav(true)} className="p-1 text-xl text-muted md:hidden" aria-label="menu">
          ☰
        </button>
        <span>💳</span>
        <h1 className="font-bold">{t("pay.offers")}</h1>
        <div className="flex-1" />
        {isOwner && canSell && <Button onClick={() => setEditing("new")}>+ {t("pay.newOffer")}</Button>}
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
          {isOwner && ownerBilling && !canSell && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 p-4">
              <span className="flex-1">{t("pay.upgradeToSell")}</span>
              <Link href="/s/billing" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
                {t("pay.seePlans")}
              </Link>
            </div>
          )}
          {isOwner && canSell && whop && whop.connection?.status !== "active" && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 p-4">
              <span className="flex-1">{whop.connection ? t("pay.conn_broken") : t("pay.connectToSell")}</span>
              <Link href="/s/whop" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
                🔗 {t("pay.whop")}
              </Link>
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}

          <section className="space-y-3">
            {(offers ?? []).length === 0 && <p className="text-muted">{t("pay.noEntries")}</p>}
            {(offers ?? []).map((o) => (
              <div key={o.id} className={cx("rounded-xl border border-line bg-sidebar p-4", !o.active && "opacity-60")}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold" dir="auto">
                        {o.name}
                      </span>
                      <span className={cx("rounded px-1.5 py-0.5 text-xs", o.active ? "bg-success/15 text-success" : "bg-line text-muted")}>
                        {o.active ? t("pay.activeOffer") : t("pay.inactiveOffer")}
                      </span>
                    </div>
                    <div className="text-sm">{price(o)}</div>
                    <div className="mt-1 text-xs text-muted">
                      {o.grants
                        .map((g) => (g.targetType === "server" ? t("pay.wholeServer") : (st.channels.find((c) => c.id === g.targetId)?.name ?? "?")))
                        .join(" · ")}
                      {" · "}
                      {o.seatLimit ? t("pay.seats", { taken: o.seatsTaken, limit: o.seatLimit }) : `${o.seatsTaken} ${t("pay.members")}`}
                    </div>
                  </div>
                  {isOwner && (
                    <div className="flex gap-1">
                      <Button variant="ghost" className="py-1" onClick={() => setEditing(o)}>
                        ✏️
                      </Button>
                      <Button
                        variant="ghost"
                        className="py-1"
                        onClick={() => run(() => api.updateOffer(o.id, { active: !o.active }).then(() => actions.loadOffers(serverId)))}
                      >
                        {o.active ? t("pay.deactivate") : t("pay.activate")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>

          {(offers ?? []).length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-bold">
                {t("pay.members")} ({live.length})
              </h2>
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-3">
                <label className="min-w-40 flex-1 space-y-1 text-sm">
                  <span className="text-xs text-muted">{t("pay.grantTo")}</span>
                  <select value={grantFor} onChange={(e) => setGrantFor(e.target.value)} className="w-full rounded-lg border border-line bg-bg px-2 py-2">
                    <option value="" />
                    {st.members
                      .filter((m) => m.role === "member")
                      .map((m) => (
                        <option key={m.user.id} value={m.user.id}>
                          {m.user.displayName} (@{m.user.username})
                        </option>
                      ))}
                  </select>
                </label>
                <label className="min-w-40 flex-1 space-y-1 text-sm">
                  <span className="text-xs text-muted">{t("pay.offers")}</span>
                  <select value={grantOffer} onChange={(e) => setGrantOffer(e.target.value)} className="w-full rounded-lg border border-line bg-bg px-2 py-2">
                    <option value="" />
                    {(offers ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={!grantFor || !grantOffer}
                  onClick={() =>
                    run(async () => {
                      await api.grantEntitlement(serverId, grantFor, grantOffer);
                      setGrantFor("");
                      await reloadEnts();
                      await actions.loadOffers(serverId);
                    })
                  }
                >
                  {t("pay.grant")}
                </Button>
              </div>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {live.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <bdi className="font-medium">{e.user.displayName}</bdi> <span className="text-muted">· {e.offerName}</span>
                    </span>
                    <span className="text-xs text-muted">{t(e.source === "manual" ? "pay.source_manual" : "pay.source_whop")}</span>
                    <button
                      className="text-xs text-danger hover:underline"
                      onClick={() => run(async () => {
                        await api.revokeEntitlement(e.id);
                        await reloadEnts();
                      })}
                    >
                      {t("pay.revoke")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {editing && (
        <OfferEditor
          serverId={serverId}
          offer={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
            void actions.loadOffers(serverId);
          }}
        />
      )}
    </div>
  );
}

function OfferEditor({ serverId, offer, onClose }: { serverId: string; offer: Offer | null; onClose: () => void }) {
  const t = useT();
  const st = useApp((s) => s.serverState[serverId])!;
  const [name, setName] = useState(offer?.name ?? "");
  const [description, setDescription] = useState(offer?.description ?? "");
  const [price, setPrice] = useState(offer ? String(offer.priceMinor / 100) : "");
  const [currency, setCurrency] = useState<OfferCurrency>(offer?.currency ?? "sar");
  const [billing, setBilling] = useState<OfferBilling>(offer?.billing ?? "monthly");
  const [trialDays, setTrialDays] = useState(offer?.trialDays ? String(offer.trialDays) : "");
  const [seatLimit, setSeatLimit] = useState(offer?.seatLimit ? String(offer.seatLimit) : "");
  const [grants, setGrants] = useState<OfferGrant[]>(offer?.grants ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whole = grants.some((g) => g.targetType === "server");
  const targets = st.channels.filter((c) => c.type !== "category");

  const toggle = (g: OfferGrant) =>
    setGrants((cur) =>
      cur.some((x) => x.targetType === g.targetType && x.targetId === g.targetId)
        ? cur.filter((x) => !(x.targetType === g.targetType && x.targetId === g.targetId))
        : [...cur, g],
    );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input = {
      name: name.trim(),
      description: description.trim(),
      priceMinor: Math.round(Number(price) * 100),
      currency,
      billing,
      trialDays: billing !== "one_time" && trialDays ? Number(trialDays) : null,
      seatLimit: seatLimit ? Number(seatLimit) : null,
      grants,
    };
    try {
      if (offer) await api.updateOffer(offer.id, input);
      else await api.createOffer(serverId, input);
      // Content an offer unlocks becomes paid automatically, so it's locked for everyone else.
      for (const g of grants) {
        const ch = st.channels.find((c) => c.id === g.targetId);
        if (g.targetType === "channel" && ch && ch.access !== "paid") await api.setChannelAccess(ch.id, "paid");
      }
      await actions.refreshAccess(serverId);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={offer ? offer.name : t("pay.newOffer")}>
      <form onSubmit={save} className="max-h-[75vh] space-y-4 overflow-y-auto pe-1">
        <Input label={t("pay.offerName")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} dir="auto" autoFocus />
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("pay.description")}</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
            dir="auto"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-fg outline-none focus:border-brand"
          />
        </label>
        <div className="flex gap-2">
          <div className="flex-1">
            <Input label={t("pay.price")} type="number" min="1" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required dir="ltr" />
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("pay.currency")}</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as OfferCurrency)} className="rounded-lg border border-line bg-bg px-2 py-2">
              {OFFER_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("pay.billingType")}</span>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-bg p-1 text-sm">
            {OFFER_BILLING.map((b) => (
              <button
                type="button"
                key={b}
                onClick={() => setBilling(b)}
                className={cx("rounded-md px-2 py-1.5", billing === b ? "bg-brand text-white" : "text-muted hover:text-fg")}
              >
                {t(b === "one_time" ? "pay.one_time" : b === "monthly" ? "pay.monthly" : "pay.yearly")}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {billing !== "one_time" && (
            <Input label={t("pay.trialDays")} type="number" min="1" max="90" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} dir="ltr" />
          )}
          <Input label={t("pay.seatLimit")} type="number" min="1" value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} dir="ltr" />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted">{t("pay.unlocks")}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={whole} onChange={() => toggle({ targetType: "server", targetId: serverId })} />
            ⭐ {t("pay.wholeServer")}
          </label>
          {!whole &&
            targets.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={grants.some((g) => g.targetType === "channel" && g.targetId === c.id)}
                  onChange={() => toggle({ targetType: "channel", targetId: c.id })}
                />
                {c.type === "course" ? "🎓" : "#"} <bdi>{c.name}</bdi>
              </label>
            ))}
        </fieldset>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy || grants.length === 0}>{t("common.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}
