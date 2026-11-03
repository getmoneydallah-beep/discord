import { Alert, Switch, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { colors, spacing } from "@majlis/shared";
import { actions, errorMessage, useApp, useT } from "@/store";
import { Avatar, Btn, Screen, T } from "@/ui";

export default function Settings() {
  const t = useT();
  const router = useRouter();
  const me = useApp((s) => s.me);
  const prefs = useApp((s) => s.prefs);

  return (
    <Screen>
      <Stack.Screen options={{ title: t("common.settings") }} />
      <View style={{ padding: spacing.xl, gap: spacing.xl }}>
        {me && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Avatar name={me.displayName} size={56} />
            <View>
              <T bold size={18}>
                {me.displayName}
              </T>
              <T muted>@{me.username}</T>
            </View>
          </View>
        )}

        <View style={{ gap: spacing.sm }}>
          <T muted bold size={12}>
            {t("common.language")}
          </T>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Btn title="العربية" style={{ flex: 1 }} variant={prefs.locale === "ar" ? "primary" : "ghost"} onPress={() => void actions.setPrefs({ locale: "ar" })} />
            <Btn title="English" style={{ flex: 1 }} variant={prefs.locale === "en" ? "primary" : "ghost"} onPress={() => void actions.setPrefs({ locale: "en" })} />
          </View>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T>١٢٣ / 123</T>
          <Switch
            value={prefs.easternDigits}
            onValueChange={(v) => void actions.setPrefs({ easternDigits: v })}
            trackColor={{ true: colors.brand }}
          />
        </View>

        <View style={{ gap: spacing.sm }}>
          <Btn
            title={t("auth.logout")}
            variant="ghost"
            onPress={async () => {
              await actions.signOut();
              router.replace("/login");
            }}
          />
          {/* Required by App Store guideline 5.1.1(v) and Google Play. */}
          <Btn
            title={t("auth.deleteAccount")}
            variant="danger"
            onPress={() =>
              Alert.alert(t("auth.deleteAccount"), t("auth.deleteAccountConfirm"), [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("common.confirm"),
                  style: "destructive",
                  onPress: async () => {
                    try {
                      await actions.deleteAccount();
                      router.replace("/register");
                    } catch (err) {
                      Alert.alert(errorMessage(err));
                    }
                  },
                },
              ])
            }
          />
        </View>
      </View>
    </Screen>
  );
}
