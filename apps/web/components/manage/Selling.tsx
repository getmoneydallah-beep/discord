"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
import { Button, FieldLabel, Input, Modal, OptionCard, cx } from "@/components/ui";
import { useOfferPrice, useOffers } from "@/components/pay/shared";

/** Owner/admin panel: offers (what students can buy), who holds them, manual grants. */
export function SellingPanel({ serverId }: { serverId: string }) {
  const t = useT();
  const st = useApp((s) => s.serverState[serverId]);
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const me = useApp((s) => s.me);
  const offers = useOffers(serverId);
  const price = useOfferPrice();
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
    <div className="space-y-6">
      {isOwner && canSell && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>+ {t("pay.newOffer")}</Button>
        </div>
      )}
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
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const [step, setStep] = useState(1);
  const [name, setName] = useState(offer?.name ?? "");
  const [description, setDescription] = useState(offer?.description ?? "");
  const [price, setPrice] = useState(offer ? String(offer.priceMinor / 100) : "");
  const [currency, setCurrency] = useState<OfferCurrency>(offer?.currency ?? "sar");
  const [billing, setBilling] = useState<OfferBilling>(offer?.billing ?? "monthly");
  const [trialDays, setTrialDays] = useState(offer?.trialDays ? String(offer.trialDays) : "");
  const [seatLimit, setSeatLimit] = useState(offer?.seatLimit ? String(offer.seatLimit) : "");
  const [grants, setGrants] = useState<OfferGrant[]>(offer?.grants ?? [{ targetType: "server", targetId: serverId }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whole = grants.some((g) => g.targetType === "server");
  const courses = st.channels.filter((c) => c.type === "course");
  const chats = st.channels.filter((c) => c.type === "text");
  const priceMinor = Math.round(Number(price) * 100);
  const preview = useOfferPrice();

  const toggle = (id: string) =>
    setGrants((cur) =>
      cur.some((x) => x.targetType === "channel" && x.targetId === id)
        ? cur.filter((x) => !(x.targetType === "channel" && x.targetId === id))
        : [...cur.filter((x) => x.targetType === "channel"), { targetType: "channel", targetId: id }],
    );

  const canNext = step === 1 ? grants.length > 0 : step === 2 ? name.trim().length > 0 && priceMinor >= 100 : true;

  async function save() {
    setBusy(true);
    setError(null);
    const input = {
      name: name.trim(),
      description: description.trim(),
      priceMinor,
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

  const unlockedNames = whole
    ? [t("pay.wholeServer")]
    : grants.map((g) => st.channels.find((c) => c.id === g.targetId)?.name).filter(Boolean) as string[];

  return (
    <Modal open onClose={onClose} title={offer ? offer.name : t("pay.newOffer")}>
      <div className="space-y-5">
        {/* Stepper */}
        <ol className="flex items-center gap-2 text-xs">
          {[t("pay.step1"), t("pay.step2"), t("pay.step3")].map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={cx(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-bold",
                  step > i + 1 ? "bg-success text-white" : step === i + 1 ? "bg-brand text-white" : "bg-line text-muted",
                )}
              >
                {step > i + 1 ? "✓" : i + 1}
              </span>
              <span className={cx("truncate", step === i + 1 ? "font-semibold" : "text-muted")}>{label}</span>
            </li>
          ))}
        </ol>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pe-1">
          {step === 1 && (
            <div className="space-y-2" role="radiogroup">
              <OptionCard
                selected={whole}
                onSelect={() => setGrants([{ targetType: "server", targetId: serverId }])}
                icon="⭐"
                title={t("pay.wholeServer")}
                hint={t("pay.wholeServerHint")}
              />
              <OptionCard
                selected={!whole}
                onSelect={() => setGrants(grants.filter((g) => g.targetType === "channel"))}
                icon="🎯"
                title={t("pay.pickContent")}
              />
              {!whole && (
                <div className="space-y-1 rounded-xl border border-line p-3">
                  {[...courses, ...chats].map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-hover">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand"
                        checked={grants.some((g) => g.targetType === "channel" && g.targetId === c.id)}
                        onChange={() => toggle(c.id)}
                      />
                      <span>{c.type === "course" ? "🎓" : c.postPolicy === "staff" ? "📢" : "#"}</span>
                      <bdi className="flex-1">{c.name}</bdi>
                      {c.access === "paid" && <span className="text-xs text-muted">🔒</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <>
              <Input label={t("pay.offerName")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} dir="auto" autoFocus placeholder={t("pay.offerNamePlaceholder")} />
              <label className="block space-y-1">
                <FieldLabel>{t("pay.price")}</FieldLabel>
                <div className="flex overflow-hidden rounded-lg border border-line focus-within:border-brand">
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    dir="ltr"
                    className="w-full bg-bg px-3 py-3 text-2xl font-bold outline-none"
                    placeholder="99"
                  />
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as OfferCurrency)}
                    className="border-s border-line bg-surface px-3 font-semibold"
                    aria-label={t("pay.currency")}
                  >
                    {OFFER_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
              <div className="space-y-2" role="radiogroup" aria-label={t("pay.billingType")}>
                <FieldLabel>{t("pay.billingType")}</FieldLabel>
                {OFFER_BILLING.map((b) => (
                  <OptionCard
                    key={b}
                    selected={billing === b}
                    onSelect={() => setBilling(b)}
                    icon={b === "one_time" ? "💎" : b === "monthly" ? "🔁" : "📅"}
                    title={t(b === "one_time" ? "pay.one_time" : b === "monthly" ? "pay.monthly" : "pay.yearly")}
                    hint={t(`pay.${b}_hint` as const)}
                  />
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <label className="block space-y-1">
                <FieldLabel>{t("pay.description")}</FieldLabel>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  dir="auto"
                  placeholder={t("pay.descriptionPlaceholder")}
                  className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-fg outline-none focus:border-brand"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {billing !== "one_time" && (
                  <label className="block space-y-1">
                    <FieldLabel>{t("pay.trialDays")}</FieldLabel>
                    <Input type="number" min="1" max="90" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} dir="ltr" placeholder="7" />
                    <span className="block text-xs text-muted">{t("pay.trialHint")}</span>
                  </label>
                )}
                <label className="block space-y-1">
                  <FieldLabel>{t("pay.seatLimit")}</FieldLabel>
                  <Input type="number" min="1" value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} dir="ltr" placeholder="50" />
                  <span className="block text-xs text-muted">{t("pay.seatHint")}</span>
                </label>
              </div>
              <div className="space-y-2">
                <FieldLabel>{t("pay.previewTitle")}</FieldLabel>
                <div className="rounded-xl border border-line bg-bg p-4">
                  <div className="text-xs text-muted" dir="auto">{server?.name}</div>
                  <div className="text-lg font-bold" dir="auto">{name || t("pay.offerName")}</div>
                  {description && <p className="bidi text-sm text-muted" dir="auto">{description}</p>}
                  <ul className="mt-2 space-y-0.5 text-sm">
                    {unlockedNames.map((n) => (
                      <li key={n}>✓ <bdi>{n}</bdi></li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xl font-bold">{priceMinor >= 100 ? preview({ priceMinor, currency, billing }) : "—"}</span>
                    <span className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white">
                      🔓 {t("pay.unlock", { price: priceMinor >= 100 ? preview({ priceMinor, currency, billing }) : "…" })}
                    </span>
                  </div>
                  {billing !== "one_time" && trialDays && (
                    <div className="mt-2 text-xs text-brand">{t("pay.trialBadge", { n: trialDays })}</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={step === 1 ? onClose : () => setStep(step - 1)}>
            {step === 1 ? t("common.cancel") : t("pay.prev")}
          </Button>
          <div className="flex-1" />
          {step < 3 ? (
            <Button type="button" disabled={!canNext} onClick={() => setStep(step + 1)}>
              {t("pay.next")}
            </Button>
          ) : (
            <Button type="button" disabled={busy || !name.trim() || priceMinor < 100 || grants.length === 0} onClick={save}>
              {busy ? t("common.loading") : t("pay.publish")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
