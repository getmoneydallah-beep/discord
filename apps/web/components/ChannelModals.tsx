"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@majlis/api-client";
import { actions, api, errorMessage, useApp, useT } from "@/lib/store";
import { Button, FieldLabel, Input, Modal, OptionCard } from "./ui";

type Kind = "chat" | "announcements" | "course";

/** One dialog for every kind of channel: chat, announcements (staff-only posting) or course. */
export function CreateChannelModal({ onClose, initial = "chat" }: { onClose: () => void; initial?: Kind }) {
  const t = useT();
  const router = useRouter();
  const { serverId } = useParams<{ serverId: string }>();
  const [kind, setKind] = useState<Kind>(initial);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (kind === "course") {
        const c = await api.createCourse(serverId, { name: name.trim(), description: description.trim() });
        actions.applyChannel(c);
        onClose();
        router.push(`/s/${serverId}/${c.id}?edit=1`);
      } else {
        const c = await api.createChannel(serverId, { name: name.trim(), postPolicy: kind === "announcements" ? "staff" : "everyone" });
        actions.applyChannel(c);
        onClose();
        router.push(`/s/${serverId}/${c.id}`);
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("channel.new")}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2" role="radiogroup" aria-label={t("channel.kind")}>
          <OptionCard selected={kind === "chat"} onSelect={() => setKind("chat")} icon="💬" title={t("channel.typeChat")} hint={t("channel.typeChatHint")} />
          <OptionCard
            selected={kind === "announcements"}
            onSelect={() => setKind("announcements")}
            icon="📢"
            title={t("channel.typeAnnouncements")}
            hint={t("channel.typeAnnouncementsHint")}
          />
          <OptionCard selected={kind === "course"} onSelect={() => setKind("course")} icon="🎓" title={t("channel.typeCourse")} hint={t("channel.typeCourseHint")} />
        </div>
        <Input
          label={kind === "course" ? t("course.name") : t("channel.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          dir="auto"
          autoFocus
        />
        {kind === "course" && (
          <label className="block space-y-1">
            <FieldLabel>{t("course.description")}</FieldLabel>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              dir="auto"
              rows={3}
              maxLength={5000}
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-brand"
            />
          </label>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy || !name.trim()}>{t("common.create")}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Name, topic, who can see (free/paid), who can post (everyone/staff), delete. */
export function ChannelSettingsModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const { serverId } = useParams<{ serverId: string }>();
  const channel = useApp((s) => s.serverState[serverId]?.channels.find((c) => c.id === channelId));
  const [name, setName] = useState(channel?.name ?? "");
  const [topic, setTopic] = useState(channel?.topic ?? "");
  const [postPolicy, setPostPolicy] = useState(channel?.postPolicy ?? "everyone");
  const [access, setAccess] = useState(channel?.access ?? "free");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPlan, setNeedsPlan] = useState(false);
  if (!channel) return null;
  const isText = channel.type === "text";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNeedsPlan(false);
    try {
      if (channel!.type === "course") {
        if (name.trim() !== channel!.name) await api.updateCourse(channel!.id, { name: name.trim() });
      } else {
        await api.updateChannel(channel!.id, { name: name.trim(), topic: topic.trim() || null, postPolicy });
      }
      if (access !== channel!.access) await api.setChannelAccess(channel!.id, access);
      await actions.refreshAccess(serverId);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "tier_cannot_sell") setNeedsPlan(true);
      else setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t("channel.deleteConfirm"))) return;
    try {
      await api.deleteChannel(channel!.id);
      onClose();
      router.push(`/s/${serverId}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal open onClose={onClose} title={t("channel.settings")}>
      <form onSubmit={save} className="max-h-[75vh] space-y-5 overflow-y-auto pe-1">
        <Input label={channel.type === "course" ? t("course.name") : t("channel.name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} dir="auto" />
        {isText && <Input label={t("channel.topic")} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1024} dir="auto" />}

        {isText && (
          <fieldset className="space-y-2">
            <FieldLabel>{t("channel.whoCanPost")}</FieldLabel>
            <OptionCard selected={postPolicy === "everyone"} onSelect={() => setPostPolicy("everyone")} icon="💬" title={t("channel.postEveryone")} hint={t("channel.typeChatHint")} />
            <OptionCard selected={postPolicy === "staff"} onSelect={() => setPostPolicy("staff")} icon="📢" title={t("channel.postStaff")} hint={t("channel.typeAnnouncementsHint")} />
          </fieldset>
        )}

        <fieldset className="space-y-2">
          <FieldLabel>{t("channel.whoCanSee")}</FieldLabel>
          <OptionCard selected={access === "free"} onSelect={() => setAccess("free")} icon="🟢" title={t("channel.seeFree")} />
          <OptionCard selected={access === "paid"} onSelect={() => setAccess("paid")} icon="🔒" title={t("channel.seePaid")} hint={t("channel.seePaidHint")} />
          {needsPlan && (
            <p className="rounded-lg bg-brand/10 p-3 text-sm">
              {t("channel.needsPlan")}{" "}
              <Link href="/s/billing" onClick={onClose} className="font-semibold text-brand hover:underline">
                {t("pay.seePlans")}
              </Link>
            </p>
          )}
        </fieldset>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" className="text-danger" onClick={remove}>
            🗑️ {t("channel.delete")}
          </Button>
          <div className="flex-1" />
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy || !name.trim()}>{t("common.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}
