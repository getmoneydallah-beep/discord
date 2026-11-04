"use client";

import Link from "next/link";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { parseInviteCode } from "@majlis/api-client";
import { actions, api, errorMessage, useApp, useT } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { Button, Input, Modal } from "./ui";
import { ChannelSettingsModal, CreateChannelModal } from "./ChannelModals";

export function Modals() {
  const modal = useUi((s) => s.modal);
  const modalArg = useUi((s) => s.modalArg);
  const close = () => useUi.getState().openModal(null);
  return (
    <>
      {modal === "createServer" && <CreateServer onClose={close} />}
      {modal === "joinServer" && <JoinServer onClose={close} />}
      {modal === "invite" && <InviteModal onClose={close} />}
      {modal === "createChannel" && <CreateChannelModal onClose={close} />}
      {modal === "createCourse" && <CreateChannelModal onClose={close} initial="course" />}
      {modal === "channelSettings" && modalArg && <ChannelSettingsModal channelId={modalArg} onClose={close} />}
      {modal === "settings" && <Settings onClose={close} />}
    </>
  );
}

function useSubmit(fn: (f: FormData) => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn(new FormData(e.currentTarget));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, onSubmit };
}

function CreateServer({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const { error, busy, onSubmit } = useSubmit(async (f) => {
    const d = await actions.createServer(String(f.get("name")));
    onClose();
    router.push(`/s/${d.server.id}/manage`);
  });
  return (
    <Modal open onClose={onClose} title={t("server.create")}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Input name="name" label={t("server.name")} required maxLength={100} autoFocus dir="auto" />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy}>{t("common.create")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function JoinServer({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const { error, busy, onSubmit } = useSubmit(async (f) => {
    const d = await actions.joinInvite(parseInviteCode(String(f.get("code"))));
    onClose();
    router.push(`/s/${d.server.id}`);
  });
  return (
    <Modal open onClose={onClose} title={t("server.join")}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Input name="code" label={t("server.inviteCode")} required autoFocus dir="ltr" placeholder="https://majlis.app/invite/AbC123xy" />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy}>{t("server.join")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { serverId } = useParams<{ serverId: string }>();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .createInvite(serverId, { expiresInHours: 24 * 7 })
      // Build the link from the current origin so it works on any deployment.
      .then((inv) => setUrl(`${window.location.origin}/invite/${inv.code}`))
      .catch((err) => setError(errorMessage(err)));
  }, [serverId]);

  return (
    <Modal open onClose={onClose} title={t("server.invite")}>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Input readOnly value={url ?? t("common.loading")} dir="ltr" onFocus={(e) => e.currentTarget.select()} />
        <Button
          disabled={!url}
          onClick={async () => {
            await navigator.clipboard.writeText(url!);
            setCopied(true);
          }}
        >
          {t("common.copy")}
        </Button>
      </div>
      {copied && <p className="text-sm text-success">{t("server.inviteCopied")}</p>}
    </Modal>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const prefs = useApp((s) => s.prefs);
  const { serverId } = useParams<{ serverId?: string }>();
  const myRole = useApp((s) => (serverId ? s.serverState[serverId]?.myRole : undefined));

  async function guard(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  return (
    <Modal open onClose={onClose} title={t("common.settings")}>
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">👤 {t("settingsGroups.account")}</h3>
        <label className="flex items-center justify-between">
          <span>{t("common.language")}</span>
          <select
            value={prefs.locale}
            onChange={(e) => void actions.setPrefs({ locale: e.target.value as "ar" | "en" })}
            className="rounded-md border border-line bg-bg px-2 py-1"
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex items-center justify-between">
          <span>١٢٣ / 123</span>
          <input
            type="checkbox"
            checked={prefs.easternDigits}
            onChange={(e) => void actions.setPrefs({ easternDigits: e.target.checked })}
            className="h-5 w-5 accent-brand"
          />
        </label>

        <h3 className="border-t border-line pt-4 text-xs font-semibold uppercase tracking-wide text-muted">🎓 {t("settingsGroups.teaching")}</h3>
        <nav className="-mt-2 flex flex-col gap-1 text-sm">
          {[
            ["/s/billing", "⭐", t("pay.billing")],
            ["/s/whop", "🔗", t("pay.whop")],
            ["/s/sales", "🧾", t("pay.sales")],
          ].map(([href, icon, label]) => (
            <Link key={href} href={href!} onClick={onClose} className="rounded-md px-2 py-2 hover:bg-surface-hover">
              {icon} {label}
            </Link>
          ))}
        </nav>

        {serverId && myRole && (
          <div className="border-t border-line pt-4">
            {myRole === "owner" ? (
              <Button
                variant="danger"
                className="w-full"
                onClick={() =>
                  confirm(`${t("server.delete")}?`) &&
                  guard(async () => {
                    await actions.deleteServer(serverId);
                    onClose();
                    router.push("/s");
                  })
                }
              >
                {t("server.delete")}
              </Button>
            ) : (
              <Button
                variant="danger"
                className="w-full"
                onClick={() =>
                  guard(async () => {
                    await actions.leaveServer(serverId);
                    onClose();
                    router.push("/s");
                  })
                }
              >
                {t("server.leave")}
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <Button
            variant="ghost"
            onClick={() =>
              guard(async () => {
                onClose();
                await actions.signOut();
                router.push("/login");
              })
            }
          >
            {t("auth.logout")}
          </Button>
          <Button
            variant="ghost"
            className="text-danger"
            onClick={() =>
              confirm(t("auth.deleteAccountConfirm")) &&
              guard(async () => {
                onClose();
                await actions.deleteAccount();
                router.push("/register");
              })
            }
          >
            {t("auth.deleteAccount")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
