import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { can, colors, formatDuration, radii, spacing, toEasternDigits } from "@majlis/shared";
import { actions, errorMessage, useApp, useT } from "@/store";
import { Screen, T, usePalette } from "@/ui";

/** Course overview: one big Start/Continue button and a checklist of lessons. */
export default function CourseScreen() {
  const { courseId, serverId } = useLocalSearchParams<{ courseId: string; serverId: string }>();
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const course = useApp((s) => s.courses[courseId]);
  const myRole = useApp((s) => s.serverState[serverId]?.myRole ?? "member");
  const eastern = useApp((s) => s.prefs.easternDigits);
  const locale = useApp((s) => s.prefs.locale);
  const [error, setError] = useState<string | null>(null);
  const num = (n: number | string) => (eastern ? toEasternDigits(String(n)) : String(n));

  useEffect(() => {
    actions.loadCourse(courseId).catch((e: unknown) => setError(errorMessage(e)));
  }, [courseId]);

  if (!course)
    return (
      <Screen>
        <Stack.Screen options={{ title: "" }} />
        <T muted style={{ padding: spacing.xl }}>
          {error ?? t("common.loading")}
        </T>
      </Screen>
    );

  const { completed, total, nextLessonId } = course.progress;
  const flat = course.sections.flatMap((s) => s.lessons);
  const finished = total > 0 && completed === total;
  const target = finished ? flat[0]?.id : nextLessonId;
  const targetTitle = flat.find((l) => l.id === target)?.title;
  const started = completed > 0 || course.progress.lastLessonId;
  const pct = total ? completed / total : 0;
  const open = (lessonId: string) => router.push(`/lesson/${lessonId}?courseId=${courseId}&serverId=${serverId}`);
  let counter = 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: course.name }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 48 }}>
        <View style={{ borderRadius: radii.lg, overflow: "hidden", backgroundColor: p.sidebar, borderWidth: 1, borderColor: p.border }}>
          <View style={{ aspectRatio: 3, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
            {course.cover ? (
              <Image source={{ uri: course.cover.url }} style={{ position: "absolute", width: "100%", height: "100%" }} />
            ) : (
              <T size={48}>🎓</T>
            )}
          </View>
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <View>
              <T bold size={24}>
                {course.name}
              </T>
              <T muted size={13}>
                {total === 1 ? t("course.lessonsOne") : t("course.lessons", { count: num(total) })}
                {course.totalDurationSeconds > 0 ? ` · ⏱ ${num(formatDuration(course.totalDurationSeconds))}` : ""}
              </T>
            </View>
            {course.description ? <T>{course.description}</T> : null}
            {total > 0 && (
              <View style={{ gap: 6 }}>
                <T size={13} bold={finished} style={finished ? { color: colors.success } : undefined}>
                  {finished ? t("course.finished") : t("course.progress", { done: num(completed), total: num(total) })}
                </T>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: p.border, overflow: "hidden" }}>
                  <View style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: colors.brand }} />
                </View>
              </View>
            )}
            {target ? (
              <Pressable
                onPress={() => open(target)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: spacing.lg,
                  borderRadius: radii.lg,
                  backgroundColor: colors.brand,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <View style={{ flex: 1 }}>
                  <T bold size={18} style={{ color: "#fff" }}>
                    {finished ? t("course.review") : started ? t("course.continue") : t("course.start")}
                  </T>
                  {targetTitle && !finished ? (
                    <T size={13} numberOfLines={1} style={{ color: "#fff", opacity: 0.9 }}>
                      {targetTitle}
                    </T>
                  ) : null}
                </View>
                <T size={22} style={{ color: "#fff", transform: [{ scaleX: locale === "ar" ? -1 : 1 }] }}>
                  ▶
                </T>
              </Pressable>
            ) : (
              <T muted style={{ textAlign: "center", padding: spacing.md }}>
                {t("course.empty")}
              </T>
            )}
            {can(myRole, "channel.manage") && (
              <T muted size={12} style={{ textAlign: "center" }}>
                {t("course.adminOnlyMobile")}
              </T>
            )}
          </View>
        </View>

        {total > 0 && <T bold size={18}>{t("course.content")}</T>}
        {course.sections.map((section, si) => (
          <View key={section.id} style={{ borderRadius: radii.lg, borderWidth: 1, borderColor: p.border, backgroundColor: p.sidebar, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: p.border }}>
              <T bold style={{ flex: 1 }}>
                {num(si + 1)}. {section.title}
              </T>
              <T muted size={12}>
                {num(section.lessons.filter((l) => l.completed).length)}/{num(section.lessons.length)}
              </T>
            </View>
            {section.lessons.map((lesson) => {
              counter++;
              const isNext = lesson.id === target && !finished;
              return (
                <Pressable
                  key={lesson.id}
                  onPress={() => open(lesson.id)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                    padding: spacing.md,
                    backgroundColor: pressed ? p.surfaceHover : isNext ? "rgba(15,138,95,0.10)" : "transparent",
                  })}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: lesson.completed ? colors.success : isNext ? colors.brand : "transparent",
                      borderWidth: lesson.completed || isNext ? 0 : 2,
                      borderColor: p.border,
                    }}
                  >
                    <T bold size={13} style={{ color: lesson.completed || isNext ? "#fff" : p.textMuted }}>
                      {lesson.completed ? "✓" : num(counter)}
                    </T>
                  </View>
                  <View style={{ flex: 1 }}>
                    <T numberOfLines={2} bold={isNext} style={isNext ? { color: colors.brand } : undefined}>
                      {lesson.title}
                    </T>
                    <T muted size={12}>
                      {[lesson.hasVideo ? `▶ ${t("course.video")}` : null, lesson.attachmentCount ? `📎 ${num(lesson.attachmentCount)}` : null]
                        .filter(Boolean)
                        .join("  ")}
                    </T>
                  </View>
                  {lesson.durationSeconds ? (
                    <T muted size={12}>
                      {num(formatDuration(lesson.durationSeconds))}
                    </T>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
