import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { colors, spacing } from "@majlis/shared";
import { actions, api, errorMessage, useApp, useT } from "./store";
import { Btn, Field, Screen, T } from "./ui";

export function AuthScreen({ mode }: { mode: "login" | "register" }) {
  const t = useT();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const status = useApp((s) => s.status);
  const locale = useApp((s) => s.prefs.locale);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "ready") return <Redirect href={(next as "/servers") || "/servers"} />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await api.login({ email, password })
          : await api.register({ email, username, displayName, password, locale });
      await actions.signIn(res.token, res.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.lg }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View>
              <T bold size={36} style={{ color: colors.brand }}>
                {t("appName")}
              </T>
              <T muted>{t("tagline")}</T>
            </View>
            <Pressable onPress={() => void actions.setPrefs({ locale: locale === "ar" ? "en" : "ar" })}>
              <T muted size={13}>
                {locale === "ar" ? "English" : "العربية"}
              </T>
            </Pressable>
          </View>

          <Field
            label={t("auth.email")}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
          {mode === "register" && (
            <>
              <Field label={t("auth.displayName")} value={displayName} onChangeText={setDisplayName} maxLength={64} />
              <Field
                label={t("auth.usernameOptional")}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
              />
            </>
          )}
          <Field
            label={t("auth.password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType={mode === "login" ? "password" : "newPassword"}
          />
          {error && <T style={{ color: colors.danger }}>{error}</T>}
          <Btn title={mode === "login" ? t("auth.login") : t("auth.register")} onPress={submit} loading={busy} />
          <Pressable
            onPress={() =>
              router.replace({ pathname: mode === "login" ? "/register" : "/login", params: next ? { next } : {} })
            }
          >
            <T muted style={{ textAlign: "center" }}>
              {mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
              <T style={{ color: colors.brand }}>{mode === "login" ? t("auth.register") : t("auth.login")}</T>
            </T>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
