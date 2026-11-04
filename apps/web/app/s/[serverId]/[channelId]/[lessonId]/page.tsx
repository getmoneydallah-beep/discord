"use client";

import { useParams } from "next/navigation";
import { LessonView } from "@/components/course/LessonView";

export default function LessonPage() {
  const { serverId, channelId, lessonId } = useParams<{ serverId: string; channelId: string; lessonId: string }>();
  return <LessonView serverId={serverId} courseId={channelId} lessonId={lessonId} />;
}
