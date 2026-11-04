import { useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useVideoPlayer, VideoView } from "expo-video";
import { WebView } from "react-native-webview";
import { colors, formatBytes, radii, spacing, UPLOAD_LIMITS, type Attachment, type UploadPurpose, type VideoEmbed } from "@majlis/shared";
import { api, errorMessage, useT } from "./store";
import { T, usePalette } from "./ui";

export function InlineVideo({ uri, aspect = 16 / 9 }: { uri: string; aspect?: number }) {
  const player = useVideoPlayer(uri);
  return (
    <VideoView
      player={player}
      style={{ width: "100%", aspectRatio: aspect, borderRadius: radii.md, backgroundColor: "#000" }}
      nativeControls
      allowsPictureInPicture
      contentFit="contain"
    />
  );
}

export function EmbedView({ embed }: { embed: VideoEmbed }) {
  return (
    <View style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radii.md, overflow: "hidden", backgroundColor: "#000" }}>
      <WebView
        source={{ uri: embed.embedUrl }}
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        style={{ flex: 1, backgroundColor: "#000" }}
      />
    </View>
  );
}

export function FileRow({ file }: { file: Attachment }) {
  const p = usePalette();
  const t = useT();
  return (
    <Pressable
      onPress={() => void Linking.openURL(file.url)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: p.border,
        backgroundColor: p.surface,
      }}
    >
      <T size={24}>📄</T>
      <View style={{ flex: 1 }}>
        <T numberOfLines={1}>{file.filename}</T>
        <T muted size={12}>
          {formatBytes(file.size)}
        </T>
      </View>
      <T size={13} style={{ color: colors.brand }}>
        {t("files.download")} ↓
      </T>
    </Pressable>
  );
}

export function Attachments({ items }: { items: Attachment[] }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: spacing.sm, marginTop: 4 }}>
      {items.map((a) =>
        a.kind === "image" ? (
          <Pressable key={a.id} onPress={() => void Linking.openURL(a.url)}>
            <Image source={{ uri: a.url }} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radii.md }} resizeMode="cover" />
          </Pressable>
        ) : a.kind === "video" ? (
          <InlineVideo key={a.id} uri={a.url} />
        ) : (
          <FileRow key={a.id} file={a} />
        ),
      )}
    </View>
  );
}

export interface MobilePending {
  key: string;
  name: string;
  progress: number;
  error?: string;
  attachment?: Attachment;
}

/** Pick files from the device and upload them to R2 with progress. */
export function useMobileUploader(serverId: string, purpose: UploadPurpose) {
  const t = useT();
  const [items, setItems] = useState<MobilePending[]>([]);
  const patch = (key: string, p: Partial<MobilePending>) => setItems((l) => l.map((i) => (i.key === key ? { ...i, ...p } : i)));

  async function pick() {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    await Promise.all(
      res.assets.map(async (asset) => {
        const key = `${asset.uri}-${Math.random()}`;
        const size = asset.size ?? 0;
        if (size > UPLOAD_LIMITS[purpose]) {
          setItems((l) => [...l, { key, name: asset.name, progress: 0, error: t("files.tooLarge", { max: formatBytes(UPLOAD_LIMITS[purpose]) }) }]);
          return;
        }
        setItems((l) => [...l, { key, name: asset.name, progress: 0 }]);
        try {
          const up = await api.uploadFile(
            serverId,
            { name: asset.name, type: asset.mimeType ?? "application/octet-stream", size, body: { uri: asset.uri } },
            purpose,
            { onProgress: (p) => patch(key, { progress: p }) },
          );
          patch(key, { progress: 1, attachment: up });
        } catch (err) {
          patch(key, { error: errorMessage(err) });
        }
      }),
    );
  }

  return {
    items,
    pick,
    remove: (key: string) => setItems((l) => l.filter((i) => i.key !== key)),
    clear: () => setItems([]),
    busy: items.some((i) => !i.attachment && !i.error),
    ready: items.filter((i) => i.attachment).map((i) => i.attachment!),
  };
}

export function PendingChips({ items, onRemove }: { items: MobilePending[]; onRemove: (key: string) => void }) {
  const p = usePalette();
  if (!items.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.sm }}>
      {items.map((i) => (
        <View
          key={i.key}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.md, backgroundColor: p.surface }}
        >
          {!i.attachment && !i.error ? <ActivityIndicator size="small" color={colors.brand} /> : null}
          <T size={12} numberOfLines={1} style={{ maxWidth: 140, color: i.error ? colors.danger : undefined }}>
            {i.error ? `⚠ ${i.name}` : i.attachment ? `✓ ${i.name}` : `${Math.round(i.progress * 100)}% ${i.name}`}
          </T>
          <Pressable onPress={() => onRemove(i.key)} hitSlop={8}>
            <T muted size={12}>
              ✕
            </T>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
