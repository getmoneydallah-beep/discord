import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors, parseVideoEmbed, radii, spacing, toEasternDigits, type Lesson } from "@majlis/shared";
import { actions, api, errorMessage, useApp, useT } from "@/store";
import { Screen, T, usePalette } from "@/ui";
import { EmbedView, FileRow } from "@/media";

/** Watch a lesson: video, notes, files, then one big "I finished — next" button. */
export default function LessonScreen() {
  const { lessonId, courseId, serverId } = useLocalSearchParams<{ lessonId: string; courseId: string; serverId: string }>();
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const course = useApp((s) => s.courses[courseId]);
  const eastern = useApp((s) => s.prefs.easternDigits);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const num = (n: number) => (eastern ? toEasternDigits(String(n)) : String(n));

  useEffect(() => {
    setLesson(null);
    setJustFinished(false);
    api.getLesson(lessonId).then(setLesson, (e: unknown) => setError(errorMessage(e)));
    if (!course) void actions.loadCourse(courseId).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, courseId]);

  const flat = course?.sections.flatMap((s) => s.lessons) ?? [];
  const index = flat.findIndex((l) => l.id === lessonId);
  const completed = flat[index]?.completed ?? lesson?.completed ?? false;

  const complete = (value = true) => actions.setLessonCompleted(courseId, lessonId, value).catch(() => undefined);

  async function finishAndNext() {
    if (!completed) await complete(true);
    if (lesson?.nextLessonId) router.replace(`/lesson/${lesson.nextLessonId}?courseId=${courseId}&serverId=${serverId}`);
    else router.back();
  }

  const embed = lesson?.videoUrl ? parseVideoEmbed(lesson.videoUrl) : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: index >= 0 ? `${num(index + 1)} / ${num(flat.length)}` : "" }} />
      {!lesson ? (
        <T muted style={{ padding: spacing.xl }}>
          {error ?? t("common.loading")}
        </T>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
          {lesson.video ? (
            <LessonVideo key={lesson.id} lesson={lesson} onEnded={() => (void complete(true), setJustFinished(true))} />
          ) : embed ? (
            <EmbedView embed={embed} />
          ) : null}

          <View style={{ padding: spacing.lg, gap: spacing.lg }}>
            {justFinished && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderRadius: radii.md, backgroundColor: "rgba(45,165,103,0.12)" }}>
                <T bold style={{ color: colors.success }}>
                  {t("course.done")}
                </T>
                <Pressable onPress={finishAndNext} style={{ backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.md }}>
                  <T bold style={{ color: "#fff" }}>
                    {lesson.nextLessonId ? t("course.next") : t("course.finishCourse")}
                  </T>
                </Pressable>
              </View>
            )}

            <T bold size={22}>
              {lesson.title}
            </T>

            {lesson.body ? (
              <View style={{ gap: spacing.xs }}>
                <T muted bold size={13}>
                  {t("course.notes")}
                </T>
                <View style={{ backgroundColor: p.sidebar, borderRadius: radii.md, padding: spacing.md }}>
                  <T style={{ lineHeight: 26 }}>{lesson.body}</T>
                </View>
              </View>
            ) : null}

            {lesson.attachments.length > 0 && (
              <View style={{ gap: spacing.sm }}>
                <T muted bold size={13}>
                  📎 {t("course.files")}
                </T>
                {lesson.attachments.map((a) => (
                  <FileRow key={a.id} file={a} />
                ))}
              </View>
            )}

            <Pressable
              onPress={finishAndNext}
              style={({ pressed }) => ({
                marginTop: spacing.md,
                paddingVertical: 16,
                borderRadius: radii.lg,
                alignItems: "center",
                backgroundColor: completed ? colors.brand : colors.success,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <T bold size={18} style={{ color: "#fff" }}>
                {!completed
                  ? lesson.nextLessonId
                    ? t("course.markDone")
                    : t("course.finishCourse")
                  : lesson.nextLessonId
                    ? t("course.next")
                    : t("course.back")}
              </T>
            </Pressable>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              {lesson.prevLessonId ? (
                <Pressable onPress={() => router.replace(`/lesson/${lesson.prevLessonId}?courseId=${courseId}&serverId=${serverId}`)} hitSlop={10}>
                  <T muted>{t("course.prev")}</T>
                </Pressable>
              ) : (
                <View />
              )}
              {completed && (
                <Pressable onPress={() => void complete(false)} hitSlop={10}>
                  <T muted>{t("course.markUndone")}</T>
                </Pressable>
              )}
            </View>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

/** Native player (expo-video) that resumes where you stopped and saves progress. */
function LessonVideo({ lesson, onEnded }: { lesson: Lesson; onEnded: () => void }) {
  const lastSaved = useRef(0);
  const resumed = useRef(false);
  const player = useVideoPlayer(lesson.video!.url, (pl) => {
    pl.timeUpdateEventInterval = 5;
  });

  const save = (extra: { durationSeconds?: number } = {}) => {
    lastSaved.current = Date.now();
    void api.saveProgress(lesson.id, { positionSeconds: Math.floor(player.currentTime), ...extra }).catch(() => undefined);
  };

  useEventListener(player, "sourceLoad", ({ duration }) => {
    if (!resumed.current && lesson.positionSeconds > 5 && lesson.positionSeconds < duration - 10) {
      player.currentTime = lesson.positionSeconds;
    }
    resumed.current = true;
    if (!lesson.durationSeconds && duration > 0) save({ durationSeconds: Math.round(duration) });
  });
  useEventListener(player, "timeUpdate", () => {
    if (Date.now() - lastSaved.current > 10_000) save();
  });
  useEventListener(player, "playToEnd", () => {
    save();
    onEnded();
  });

  useEffect(() => () => save(), []); // save position when leaving

  return (
    <VideoView
      player={player}
      style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000" }}
      nativeControls
      allowsPictureInPicture
      contentFit="contain"
    />
  );
}
