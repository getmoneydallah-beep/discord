import { FlatList, Pressable, View } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { colors, radii, spacing } from "@majlis/shared";
import { useApp, useT } from "@/store";
import { Btn, Screen, T, usePalette } from "@/ui";

export default function Servers() {
  const t = useT();
  const router = useRouter();
  const p = usePalette();
  const status = useApp((s) => s.status);
  const servers = useApp((s) => s.servers);
  const connection = useApp((s) => s.connection);

  if (status === "signedOut") return <Redirect href="/login" />;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: t("appName"),
          headerRight: () => (
            <Pressable onPress={() => router.push("/settings")} hitSlop={12}>
              <T size={20}>⚙</T>
            </Pressable>
          ),
        }}
      />
      {connection !== "open" && status === "ready" && (
        <View style={{ backgroundColor: colors.accent, padding: 4 }}>
          <T size={12} style={{ textAlign: "center", color: "#000" }}>
            {t("common.loading")}
          </T>
        </View>
      )}
      <FlatList
        data={servers}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.md }}>
            <T size={48}>🏕️</T>
            <T muted style={{ textAlign: "center" }}>
              {t("server.empty")}
            </T>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/server/${item.id}`)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              padding: spacing.md,
              borderRadius: radii.lg,
              backgroundColor: pressed ? p.surfaceHover : p.surface,
            })}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                backgroundColor: colors.brand,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <T bold size={20} style={{ color: "#fff" }}>
                {[...item.name.trim()][0]}
              </T>
            </View>
            <T bold style={{ flex: 1 }} numberOfLines={1}>
              {item.name}
            </T>
          </Pressable>
        )}
      />
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Btn title={t("server.create")} onPress={() => router.push({ pathname: "/new-server", params: { mode: "create" } })} />
        <Btn title={t("server.join")} variant="ghost" onPress={() => router.push({ pathname: "/new-server", params: { mode: "join" } })} />
      </View>
    </Screen>
  );
}
