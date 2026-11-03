import { useEffect, useState } from "react";
import { View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { colors, spacing, type Invite } from "@majlis/shared";
import { actions, api, errorMessage, useApp, useT } from "@/store";
import { Btn, Screen, T } from "@/ui";

/** Deep link target: majlis://invite/CODE and https://majlis.app/invite/CODE */
export default function InviteScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const t = useT();
  const router = useRouter();
  const status = useApp((s) => s.status);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "ready") api.getInvite(code).then(setInvite, (e: unknown) => setError(errorMessage(e)));
  }, [status, code]);

  if (status === "signedOut") return <Redirect href={{ pathname: "/register", params: { next: `/invite/${code}` } }} />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t("server.join") }} />
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl, gap: spacing.lg }}>
        {error && <T style={{ color: colors.danger }}>{error}</T>}
        {invite && (
          <>
            <T bold size={24}>
              {invite.serverName}
            </T>
            <T muted>
              {invite.memberCount} {t("server.members")}
            </T>
            <Btn
              title={t("server.join")}
              loading={busy}
              style={{ alignSelf: "stretch" }}
              onPress={async () => {
                setBusy(true);
                try {
                  const d = await actions.joinInvite(code);
                  router.replace(`/server/${d.server.id}`);
                } catch (e) {
                  setError(errorMessage(e));
                  setBusy(false);
                }
              }}
            />
          </>
        )}
      </View>
    </Screen>
  );
}
