import { useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { colors, spacing } from "@majlis/shared";
import { parseInviteCode } from "@majlis/api-client";
import { actions, errorMessage, useT } from "@/store";
import { Btn, Field, Screen, T } from "@/ui";

/** Modal for creating a server or joining one with an invite link/code. */
export default function NewServer() {
  const t = useT();
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode: "create" | "join" }>();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCreate = mode !== "join";

  async function submit() {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const d = isCreate ? await actions.createServer(value.trim()) : await actions.joinInvite(parseInviteCode(value));
      router.dismiss();
      router.push(`/server/${d.server.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ presentation: "modal", title: isCreate ? t("server.create") : t("server.join") }} />
      <View style={{ padding: spacing.xl, gap: spacing.lg }}>
        <Field
          label={isCreate ? t("server.name") : t("server.inviteCode")}
          value={value}
          onChangeText={setValue}
          autoFocus
          autoCapitalize="none"
          maxLength={isCreate ? 100 : 200}
          onSubmitEditing={submit}
        />
        {error && <T style={{ color: colors.danger }}>{error}</T>}
        <Btn title={isCreate ? t("common.create") : t("server.join")} onPress={submit} loading={busy} />
      </View>
    </Screen>
  );
}
