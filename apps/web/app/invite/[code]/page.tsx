"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { Invite } from "@majlis/shared";
import { actions, api, errorMessage, useApp, useT } from "@/lib/store";
import { Button, Splash } from "@/components/ui";
import { LanguageToggle } from "@/components/LanguageToggle";

export default function InvitePage() {
  return (
    <Suspense>
      <InviteCard />
    </Suspense>
  );
}

/**
 * Works logged out: shows what the student is joining, then sends them to
 * sign up / log in and back here with ?join=1 to join automatically.
 */
function InviteCard() {
  const { code } = useParams<{ code: string }>();
  const params = useSearchParams();
  const autoJoin = params.get("join") === "1";
  const status = useApp((s) => s.status);
  const router = useRouter();
  const t = useT();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    if (status === "booting") return;
    api.getInvite(code).then(setInvite, (e) => setError(errorMessage(e)));
  }, [status, code]);

  async function join() {
    setBusy(true);
    try {
      const d = await actions.joinInvite(code);
      router.replace(`/s/${d.server.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  useEffect(() => {
    if (status === "ready" && autoJoin && invite && !tried.current) {
      tried.current = true;
      // Only auto-join right after signing up / logging in from this invite in this tab;
      // a crafted ?join=1 link sent to a logged-in user just shows the card.
      let pending: string | null = null;
      try {
        pending = sessionStorage.getItem("majlis.pendingJoin");
        sessionStorage.removeItem("majlis.pendingJoin");
      } catch {
        /* private mode */
      }
      if (pending === code) void join();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, autoJoin, invite]);

  if (status === "booting") return <Splash label={t("common.loading")} />;
  const next = encodeURIComponent(`/invite/${code}?join=1`);

  return (
    <main className="flex min-h-full items-center justify-center bg-rail p-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-line bg-sidebar p-8 text-center shadow-xl">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark-192.png" alt="" width={22} height={22} className="h-[22px] w-[22px] rounded-md" />
            {t("appName")}
          </span>
          <LanguageToggle />
        </div>
        {error && <p className="text-danger">{error}</p>}
        {!invite && !error && <p className="text-muted">{t("common.loading")}</p>}
        {invite && (
          <>
            <p className="text-sm text-muted">{t("invite.title")}</p>
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-brand text-3xl font-bold text-white">
              {[...invite.serverName][0]}
            </div>
            <h1 className="text-2xl font-bold" dir="auto">
              {invite.serverName}
            </h1>
            <p className="flex justify-center gap-3 text-sm text-muted">
              <span>👥 {t("home.members", { n: invite.memberCount })}</span>
              {invite.courseCount ? <span>🎓 {t("invite.courses", { n: invite.courseCount })}</span> : null}
            </p>
            {status === "ready" ? (
              <Button className="w-full py-3 text-base" disabled={busy} onClick={join}>
                {busy ? t("invite.joining") : t("server.join")}
              </Button>
            ) : (
              <div className="space-y-2">
                <Link href={`/register?next=${next}`} className="block w-full rounded-lg bg-brand py-3 font-medium text-white hover:bg-brand-hover">
                  {t("invite.createAndJoin")}
                </Link>
                <Link href={`/login?next=${next}`} className="block w-full rounded-lg py-2 text-sm font-medium text-brand hover:bg-brand/10">
                  {t("invite.haveAccount")}
                </Link>
              </div>
            )}
            <p className="text-xs text-muted">✓ {t("invite.free")}</p>
          </>
        )}
      </div>
    </main>
  );
}
