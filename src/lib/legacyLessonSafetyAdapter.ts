import type { SystemConfig } from "../types";
import {
  W8DomainError,
  getLearningProgressForContent,
  getW8DomainState,
  recordLearningProgress,
} from "./w8Domains";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

export const LEGACY_LESSON_READ_ONLY_MESSAGE =
  "이전 수업자료는 안전한 조회만 지원합니다. 변경은 새 학습 운영 화면에서 진행해 주세요.";

export const blockLegacyLessonMutation = (): never => {
  throw new Error(LEGACY_LESSON_READ_ONLY_MESSAGE);
};

export const blockLegacyLessonMutationAsync = async <T = never>(
  ..._ignored: unknown[]
): Promise<T> => blockLegacyLessonMutation();

export const recordLegacyLessonCompletion = async (params: {
  config: ConfigLike;
  studentUid: string;
  unitId: string;
}) => {
  const studentUid = String(params.studentUid || "").trim();
  const unitId = String(params.unitId || "").trim();
  if (!studentUid || !unitId) {
    throw new W8DomainError(
      "VALIDATION",
      "학습 기록에 필요한 정보를 확인할 수 없습니다.",
    );
  }

  const state = await getW8DomainState({
    config: params.config,
    domain: "LEARNING",
    audience: "student",
    source: "CURRENT",
    contentId: unitId,
    studentUid,
  });
  if (state.source !== "CURRENT" || state.readOnly) {
    throw new W8DomainError(
      "PERMISSION",
      "지난 학기 또는 읽기 전용 자료에는 학습 완료를 기록할 수 없습니다.",
    );
  }

  const content = state.learningContents.find(
    (item) => item.contentId === unitId,
  );
  if (!content) {
    throw new W8DomainError(
      "VALIDATION",
      "이전 수업자료가 새 학습 기록과 연결되지 않았습니다. 새 학습 화면에서 완료 상태를 확인해 주세요.",
    );
  }
  if (!state.enrollmentId) {
    throw new W8DomainError(
      "PERMISSION",
      "현재 학기의 수강 정보를 확인할 수 없어 완료 상태를 기록하지 않았습니다.",
    );
  }

  const progress = getLearningProgressForContent(state, content.contentId);
  if (progress?.status === "COMPLETED") {
    return { alreadyCompleted: true, state, progress };
  }

  await recordLearningProgress({
    semesterId: state.semesterId,
    expectedSemesterRevision: state.manifestRevision,
    contentId: content.contentId,
    expectedContentRevision: content.revision,
    enrollmentId: progress?.enrollmentId || state.enrollmentId,
    expectedProgressRevision: progress?.revision ?? null,
    event: "COMPLETE",
  });
  return { alreadyCompleted: false, state, progress };
};
