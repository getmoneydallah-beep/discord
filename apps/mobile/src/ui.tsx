import { forwardRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
} from "react-native";
import { colors, radii, spacing } from "@majlis/shared";

export function usePalette() {
  const scheme = useColorScheme();
  return scheme === "light" ? colors.light : colors.dark;
}

/**
 * Text that aligns by its own content: Arabic right, English left.
 * `writingDirection: "auto"` lets the platform pick per string.
 */
export function T({ style, muted, bold, size, ...props }: TextProps & { muted?: boolean; bold?: boolean; size?: number }) {
  const p = usePalette();
  return (
    <Text
      {...props}
      style={[
        { color: muted ? p.textMuted : p.text, fontSize: size ?? 16, writingDirection: "auto", textAlign: "auto" },
        bold && { fontWeight: "700" },
        style,
      ]}
    />
  );
}

export const Field = forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps & { label?: string }>(function Field({ label, style, ...props }, ref) {
  const p = usePalette();
  return (
    <View style={{ gap: 4 }}>
      {label && (
        <T muted size={12} bold>
          {label}
        </T>
      )}
      <TextInput
        ref={ref}
        placeholderTextColor={p.textMuted}
        {...props}
        style={[
          {
            borderWidth: 1,
            borderColor: p.border,
            backgroundColor: p.bg,
            color: p.text,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            paddingVertical: 10,
            fontSize: 16,
            textAlign: "auto",
            writingDirection: "auto",
          },
          style,
        ]}
      />
    </View>
  );
});

export function Btn({
  title,
  variant = "primary",
  loading,
  style,
  ...props
}: PressableProps & { title: string; variant?: "primary" | "ghost" | "danger"; loading?: boolean }) {
  const p = usePalette();
  const bg = variant === "primary" ? colors.brand : variant === "danger" ? colors.danger : "transparent";
  return (
    <Pressable
      {...props}
      disabled={props.disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radii.md,
          paddingVertical: 12,
          alignItems: "center",
          opacity: pressed || props.disabled ? 0.7 : 1,
        },
        typeof style === "function" ? style({ pressed }) : style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={{ color: variant === "ghost" ? p.text : "#fff", fontWeight: "600", fontSize: 16 }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Avatar({ name, size = 40, online }: { name: string; size?: number; online?: boolean }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `hsl(${h}, 45%, 40%)`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.42 }}>{[...name.trim()][0] ?? "?"}</Text>
      </View>
      {online !== undefined && (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            end: 0,
            width: 12,
            height: 12,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: "#1B1F23",
            backgroundColor: online ? colors.success : "#6b7280",
          }}
        />
      )}
    </View>
  );
}

export function Screen({ children, style }: { children: React.ReactNode; style?: object }) {
  const p = usePalette();
  return <View style={[{ flex: 1, backgroundColor: p.bg }, style]}>{children}</View>;
}

export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  pad: { padding: spacing.lg },
});
