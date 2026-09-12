import React, { useMemo } from "react";
import LessonContent from "../../student/lesson/components/LessonContent";
import { normalizeLessonData, type LessonData } from "../../../lib/lessonData";

export default function ArchivedLessonPreview({
  lesson,
  semesterId,
}: {
  lesson: Partial<LessonData>;
  semesterId: string;
}) {
  const snapshot = useMemo(() => normalizeLessonData(lesson), [lesson]);
  return (
    <LessonContent
      key={`${semesterId}/${snapshot.unitId || "archive"}/${snapshot.contentRevision}`}
      unitId={snapshot.unitId || null}
      fallbackTitle={snapshot.title}
      lessonOverride={snapshot}
      disablePersistence
      allowHiddenAccess
    />
  );
}
