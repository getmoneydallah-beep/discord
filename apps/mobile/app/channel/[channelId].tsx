import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { can, colors, radii, spacing, toEasternDigits, type Message } from "@majlis/shared";
import type { PendingMessage } from "@majlis/api-client/store";
import { formatTime } from "@majlis/i18n";
import { actions, api, errorMessage, useApp, useT } from "@/store";
import { Avatar, Screen, T, usePalette } from "@/ui";

const QUICK = ["👍", "❤️", "😂", "🤲", "🔥"];

export default function ChannelScreen() {
  const { channelId, serverId } = useLocalSearchParams<{ channelId: string; serverId: string }>();
  const t = useT();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const channel = useApp((s) => s.serverState[serverId]?.channels.find((c) => c.id === channelId));
  const data = useApp((s) => s.messages[channelId]);
  const typing = useApp((s) => s.typing[channelId]);
  const meId = useApp((s) => s.me?.id);
  const myRole = useApp((s) => s.serverState[serverId]?.myRole ?? "member");
  const locale = useApp((s) => s.prefs.locale);
  const eastern = useApp((s) => s.prefs.easternDigits);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const lastTyping = useRef(0);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    void actions.loadMessages(channelId);
  }, [channelId]);

  // Inverted list: newest at the bottom, index 0 = newest.
  const items = useMemo(() => [...((data?.items ?? []) as PendingMessage[])].reverse(), [data?.items]);
  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);
  const typers = Object.values(typing ?? {});

  async function send() {
    const content = text.trim();
    if (!content) return;
    setText("");
    lastTyping.current = 0;
    try {
      if (editing) {
        await actions.editMessage(editing, content);
        setEditing(null);
      } else {
        const reply = replyTo?.id;
        setReplyTo(null);
        await actions.sendMessage(channelId, serverId, content, reply);
      }
    } catch (err) {
      Alert.alert(errorMessage(err));
    }
  }

  function openActions(m: PendingMessage) {
    if (m.pending) return;
    const mine = m.author.id === meId;
    const options: { label: string; run: () => void; destructive?: boolean }[] = [
      ...QUICK.map((e) => ({ label: e, run: () => void actions.toggleReaction(m, e) })),
      { label: t("message.reply"), run: () => (setReplyTo(m), input.current?.focus()) },
    ];
    if (mine) options.push({ label: t("message.edit"), run: () => (setEditing(m), setText(m.content), input.current?.focus()) });
    if (!mine)
      options.push({
        label: t("message.report"),
        run: () =>
          api
            .reportMessage(m.id, "reported from mobile")
            .then(() => Alert.alert(t("message.reported")))
            .catch((e: unknown) => Alert.alert(errorMessage(e))),
      });
    if (mine || can(myRole, "message.deleteOthers"))
      options.push({
        label: t("message.delete"),
        destructive: true,
        run: () =>
          Alert.alert(t("message.deleteConfirm"), undefined, [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("message.delete"), style: "destructive", onPress: () => void actions.deleteMessage(m).catch(() => {}) },
          ]),
      });

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options.map((o) => o.label), t("common.cancel")],
          cancelButtonIndex: options.length,
          destructiveButtonIndex: options.findIndex((o) => o.destructive),
        },
        (i) => options[i]?.run(),
      );
    } else {
      Alert.alert("", undefined, [
        ...options.slice(QUICK.length).map((o) => ({ text: o.label, onPress: o.run, style: o.destructive ? ("destructive" as const) : ("default" as const) })),
        { text: t("common.cancel"), style: "cancel" as const },
      ]);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: channel ? `# ${channel.name}` : "" }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
        <FlatList
          inverted
          data={items}
          keyExtractor={(m) => m.nonce ?? m.id}
          onEndReached={() => void actions.loadOlder(channelId)}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ paddingVertical: spacing.sm }}
          renderItem={({ item: m, index }) => {
            const older = items[index + 1];
            const grouped =
              !!older &&
              older.author.id === m.author.id &&
              !m.replyToId &&
              new Date(m.createdAt).getTime() - new Date(older.createdAt).getTime() < 5 * 60_000;
            const reply = m.replyToId ? byId.get(m.replyToId) : undefined;
            return (
              <Pressable
                onLongPress={() => openActions(m)}
                delayLongPress={250}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  gap: spacing.md,
                  paddingHorizontal: spacing.lg,
                  paddingTop: grouped ? 2 : spacing.md,
                  backgroundColor: pressed ? p.surface : "transparent",
                  opacity: m.pending ? 0.6 : 1,
                })}
              >
                <View style={{ width: 40 }}>{!grouped && <Avatar name={m.author.displayName} />}</View>
                <View style={{ flex: 1 }}>
                  {reply && (
                    <T muted size={12} numberOfLines={1}>
                      ↱ {reply.author.displayName}: {reply.content}
                    </T>
                  )}
                  {!grouped && (
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm }}>
                      <T bold>{m.author.displayName}</T>
                      <T muted size={11}>
                        {formatTime(m.createdAt, locale, { easternDigits: eastern })}
                      </T>
                    </View>
                  )}
                  <T style={m.failed ? { color: colors.danger } : undefined}>
                    {eastern ? toEasternDigits(m.content) : m.content}
                    {m.editedAt ? <T muted size={10}> {t("message.edited")}</T> : null}
                  </T>
                  {m.reactions.length > 0 && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {m.reactions.map((r) => (
                        <Pressable
                          key={r.emoji}
                          onPress={() => void actions.toggleReaction(m, r.emoji)}
                          style={{
                            flexDirection: "row",
                            gap: 4,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: radii.full,
                            borderWidth: 1,
                            borderColor: r.me ? colors.brand : p.border,
                            backgroundColor: r.me ? "rgba(15,138,95,0.15)" : p.surface,
                          }}
                        >
                          <T size={14}>{r.emoji}</T>
                          <T size={12}>{eastern ? toEasternDigits(String(r.count)) : r.count}</T>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              </Pressable>
            );
          }}
          ListFooterComponent={
            data && !data.hasMore && channel ? (
              <View style={{ padding: spacing.lg }}>
                <T bold size={22}>
                  {t("channel.welcome", { name: channel.name })}
                </T>
                <T muted>{t("channel.welcomeSub")}</T>
              </View>
            ) : undefined
          }
        />

        <View style={{ height: 18, paddingHorizontal: spacing.lg }}>
          {typers.length > 0 && (
            <T muted size={12}>
              {typers.length === 1 ? t("message.typingOne", { name: typers[0]!.name }) : t("message.typingMany")}
            </T>
          )}
        </View>

        {(replyTo || editing) && (
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: 6, backgroundColor: p.surface }}>
            <T muted size={12}>
              {editing ? t("message.edit") : t("message.replyingTo", { name: replyTo!.author.displayName })}
            </T>
            <Pressable onPress={() => (setReplyTo(null), editing && setText(""), setEditing(null))} hitSlop={10}>
              <T muted>✕</T>
            </Pressable>
          </View>
        )}

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: spacing.sm,
            padding: spacing.sm,
            paddingBottom: Math.max(insets.bottom, spacing.sm),
            borderTopWidth: 1,
            borderTopColor: p.border,
          }}
        >
          <TextInput
            ref={input}
            value={text}
            multiline
            maxLength={4000}
            placeholder={channel ? t("message.placeholder", { channel: channel.name }) : ""}
            placeholderTextColor={p.textMuted}
            onChangeText={(v) => {
              setText(v);
              const now = Date.now();
              if (v && now - lastTyping.current > 3000) {
                lastTyping.current = now;
                actions.sendTyping(channelId);
              }
            }}
            style={{
              flex: 1,
              maxHeight: 120,
              minHeight: 40,
              backgroundColor: p.surface,
              color: p.text,
              borderRadius: radii.lg,
              paddingHorizontal: spacing.md,
              paddingVertical: 10,
              fontSize: 16,
              textAlign: "auto",
              writingDirection: "auto",
            }}
          />
          <Pressable
            onPress={send}
            disabled={!text.trim()}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: text.trim() ? colors.brand : p.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Mirrors automatically under I18nManager RTL via scaleX. */}
            <T style={{ color: "#fff", transform: [{ scaleX: locale === "ar" ? -1 : 1 }] }}>➤</T>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
