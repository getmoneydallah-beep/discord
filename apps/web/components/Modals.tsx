"use client";


import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { parseInviteCode } from "@majlis/api-client";
import { actions, api, errorMessage, useT } from "@/lib/store";
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
