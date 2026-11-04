import { useEffect } from "react";
import { Alert, Pressable, SectionList, Share, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { can, colors, radii, spacing, type Channel, type Member } from "@majlis/shared";
import { actions, api, errorMessage, useApp, useT } from "@/store";
import { Avatar, Screen, T, usePalette } from "@/ui";

type Row =
  | { kind: "channel"; channel: Channel }
  | { kind: "course"; channel: Channel }
  | { kind: "member"; member: Member; online: boolean };

export default function ServerScreen() {
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const t = useT();
  const router = useRouter();
  const p = usePalette();
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const st = useApp((s) => s.serverState[serverId]);
  const online = useApp((s) => s.online);
  const locale = useApp((s) => s.prefs.locale);

  useEffect(() => {
    actions.loadServer(serverId).catch(() => router.back());
  }, [serverId, router]);

  // Removed from the server (kicked / deleted) while viewing it.
  useEffect(() => {
    if (st && !server) router.back();
  }, [st, server, router]);

  async function invite() {
    try {
      const inv = await api.createInvite(serverId, { expiresInHours: 24 * 7 });
      const url = (inv as typeof inv & { url?: string }).url ?? inv.code;
      await Share.share({ message: url });
    } catch (err) {
      Alert.alert(errorMessage(err));
    }
  }

  function newChannel() {
    // Alert.prompt is iOS-only; Android falls back to the web for now.
    if (!Alert.prompt) return Alert.alert(t("channel.create"));
    Alert.prompt(t("channel.create"), t("channel.name"), async (name) => {
      if (!name?.trim()) return;
      try {
        const c = await actions.createChannel(serverId, name);
        router.push(`/channel/${c.id}?serverId=${serverId}`);
      } catch (err) {
        Alert.alert(errorMessage(err));
      }
    });
  }

  if (!st || !server) return <Screen>{null}</Screen>;

  const sections: { title: string; data: Row[] }[] = [
    {
      title: t("channel.textChannels"),
      data: st.channels.filter((c) => c.type === "text").map((channel) => ({ kind: "channel", channel })),
    },
    ...(st.channels.some((c) => c.type === "course")
      ? [
          {
            title: t("course.courses"),
            data: st.channels.filter((c) => c.type === "course").map((channel): Row => ({ kind: "course", channel })),
          },
        ]
      : []),
    {
      title: `${t("server.members")} — ${st.members.length}`,
      data: [...st.members]
        .sort((a, b) => Number(Boolean(online[b.user.id])) - Number(Boolean(online[a.user.id])))
        .map((member) => ({ kind: "member", member, online: Boolean(online[member.user.id]) })),
    },
  ];

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: server.name,
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: spacing.lg }}>
              {can(st.myRole, "channel.manage") && (
                <Pressable onPress={newChannel} hitSlop={12}>
                  <T size={22}>＋</T>
                </Pressable>
              )}
              <Pressable onPress={invite} hitSlop={12}>
                <T style={{ color: colors.brand }}>{t("server.invite")}</T>
              </Pressable>
            </View>
          ),
        }}
      />
      <SectionList
        sections={sections}
        keyExtractor={(r) => (r.kind === "member" ? r.member.user.id : r.channel.id)}
        contentContainerStyle={{ padding: spacing.md }}
        renderSectionHeader={({ section }) => (
          <T muted bold size={12} style={{ marginTop: spacing.lg, marginBottom: spacing.xs, paddingHorizontal: spacing.sm }}>
            {section.title}
          </T>
        )}
        renderItem={({ item }) =>
          item.kind === "course" ? (
            <Pressable
              onPress={() => router.push(`/course/${item.channel.id}?serverId=${serverId}`)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
                padding: spacing.md,
                marginVertical: 2,
                borderRadius: radii.lg,
                backgroundColor: pressed ? p.surfaceHover : p.surface,
              })}
            >
              <T size={26}>🎓</T>
              <T bold style={{ flex: 1 }}>
                {item.channel.name}
              </T>
              {item.channel.locked && <T size={14}>🔒</T>}
              <T muted size={20}>{locale === "ar" ? "‹" : "›"}</T>
            </Pressable>
          ) : item.kind === "channel" ? (
            <Pressable
              onPress={() => router.push(`/channel/${item.channel.id}?serverId=${serverId}`)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                padding: spacing.md,
                borderRadius: radii.md,
                backgroundColor: pressed ? p.surfaceHover : "transparent",
              })}
            >
              <T muted size={item.channel.postPolicy === "staff" ? 16 : 20}>
                {item.channel.postPolicy === "staff" ? "📢" : "#"}
              </T>
              <T style={{ flex: 1 }}>{item.channel.name}</T>
              {item.channel.locked && <T size={14}>🔒</T>}
            </Pressable>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, opacity: item.online ? 1 : 0.5 }}>
              <Avatar name={item.member.user.displayName} size={32} online={item.online} />
              <T style={{ flex: 1 }}>{item.member.nickname ?? item.member.user.displayName}</T>
              {item.member.role !== "member" && (
                <T size={11} style={{ color: item.member.role === "owner" ? colors.accent : colors.brand }}>
                  {t(`roles.${item.member.role}`)}
                </T>
              )}
            </View>
          )
        }
      />
    </Screen>
  );
}
