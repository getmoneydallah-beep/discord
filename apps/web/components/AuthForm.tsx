"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { safeNextPath } from "@majlis/shared";
import { actions, api, errorMessage, useApp, useT } from "@/lib/store";
import { Button, Input } from "./ui";
import { LanguageToggle } from "./LanguageToggle";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  // Never redirect off-site after login (open redirect).
  const next = safeNextPath(params.get("next"));
  const status = useApp((s) => s.status);
  const locale = useApp((s) => s.prefs.locale);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUsername, setShowUsername] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  // Coming from an invite link: show which majlis they're about to join.
  const inviteCode = next.match(/^\/invite\/([^/?]+)/)?.[1];
  useEffect(() => {
    if (inviteCode) api.getInvite(inviteCode).then((inv) => setJoining(inv.serverName), () => undefined);
  }, [inviteCode]);

  useEffect(() => {
    if (status === "ready") router.replace(next);
  }, [status, router, next]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await api.login({ email: String(f.get("email")), password: String(f.get("password")) })
          : await api.register({
              email: String(f.get("email")),
              username: String(f.get("username") ?? ""),
              displayName: String(f.get("displayName")),
              password: String(f.get("password")),
              locale,
            });
      // Lets the invite page auto-join only when the visitor came through this form (not a crafted ?join=1 link).
      if (inviteCode) {
        try {
          sessionStorage.setItem("majlis.pendingJoin", inviteCode);
        } catch {
          /* private mode */
        }
      }
      await actions.signIn(res.token, res.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const otherHref = `${mode === "login" ? "/register" : "/login"}${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <main className="flex min-h-full items-center justify-center bg-rail p-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-line bg-sidebar p-8 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold text-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/mark-192.png" alt="" width={40} height={40} className="h-10 w-10 rounded-xl" />
              {t("appName")}
            </h1>
            <p className="mt-1 text-sm text-muted">{t("tagline")}</p>
          </div>
          <LanguageToggle />
        </div>
        {joining && (
          <div className="flex items-center gap-3 rounded-xl bg-brand/10 p-3 text-sm">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand font-bold text-white">{[...joining][0]}</span>
            <span className="font-medium" dir="auto">
              {t("auth.joiningTitle", { name: joining })}
            </span>
          </div>
        )}
        <form onSubmit={onSubmit} className="space-y-4">
          <Input name="email" type="email" dir="ltr" label={t("auth.email")} required autoComplete="email" />
          {mode === "register" && (
            <>
              <Input name="displayName" label={t("auth.displayName")} required maxLength={64} dir="auto" autoComplete="name" />
            </>
          )}
          <Input
            name="password"
            type="password"
            dir="ltr"
            label={t("auth.password")}
            required
            minLength={mode === "register" ? 8 : 1}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {mode === "register" && <p className="-mt-2 text-xs text-muted">{t("auth.passwordHint")}</p>}
          {mode === "register" &&
            (showUsername ? (
              <div className="space-y-1">
                <Input name="username" dir="ltr" label={t("auth.username")} pattern="[a-zA-Z0-9_.]{3,32}" autoComplete="username" autoFocus />
                <p className="text-xs text-muted">{t("auth.usernameHint")}</p>
              </div>
            ) : (
              <button type="button" onClick={() => setShowUsername(true)} className="text-xs text-brand hover:underline">
                + {t("auth.usernameOptional")}
              </button>
            ))}
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {mode === "login" ? t("auth.login") : t("auth.register")}
          </Button>
        </form>
        <p className="text-center text-sm text-muted">
          {mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
          <Link href={otherHref} className="font-medium text-brand hover:underline">
            {mode === "login" ? t("auth.register") : t("auth.login")}
          </Link>
        </p>
      </div>
    </main>
  );
}
