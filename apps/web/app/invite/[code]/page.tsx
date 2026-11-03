"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Invite } from "@majlis/shared";
import { actions, api, errorMessage, useApp, useT } from "@/lib/store";
import { Button, Splash } from "@/components/ui";

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const status = useApp((s) => s.status);
  const router = useRouter();
  const t = useT();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "signedOut") router.replace(`/register?next=${encodeURIComponent(`/invite/${code}`)}`);
    if (status === "ready") api.getInvite(code).then(setInvite, (e) => setError(errorMessage(e)));
  }, [status, code, router]);

  if (status !== "ready") return <Splash label={t("common.loading")} />;

  return (
    <main className="flex min-h-full items-center justify-center bg-rail p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-sidebar p-8 text-center">
        {error && <p className="text-danger">{error}</p>}
        {!invite && !error && <p className="text-muted">{t("common.loading")}</p>}
        {invite && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-2xl font-bold text-white">
              {[...invite.serverName][0]}
            </div>
            <h1 className="text-xl font-bold" dir="auto">
              {invite.serverName}
            </h1>
            <p className="text-sm text-muted">
              {invite.memberCount} {t("server.members")}
            </p>
            <Button
              className="w-full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const d = await actions.joinInvite(code);
                  router.replace(`/s/${d.server.id}`);
                } catch (e) {
                  setError(errorMessage(e));
                  setBusy(false);
                }
              }}
            >
              {t("server.join")}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
