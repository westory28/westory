import { buildAssessmentDefinitionId } from "../../../lib/assessmentLifecycle";
import {
  getHistoryClassroomAssignedStudentUids,
  normalizeHistoryClassroomResult,
  type HistoryClassroomAssignment,
  type HistoryClassroomResult,
} from "../../../lib/historyClassroom";

export interface TeacherHistoryClassroomResult extends HistoryClassroomResult {
  canonicalSubmissionRef?: string;
  canonicalDefinitionId?: string;
  canonicalSemesterId?: string;
  canonicalAnswerChecks?: Record<string, boolean>;
}

const resultTime = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value) || 0;
  const timestamp = value as { toMillis?: () => number; seconds?: number };
  return timestamp?.toMillis?.() || Number(timestamp?.seconds || 0) * 1000;
};

// The canonical outcome is immutable: changing today's threshold must never
// regrade a previously submitted attempt or turn an approved ticket into a test.
export const normalizeTeacherCanonicalHistoryResult = (
  id: string,
  raw: Record<string, unknown>,
  semesterId: string,
  assignments: HistoryClassroomAssignment[],
): TeacherHistoryClassroomResult | null => {
  if (raw.assessmentKind !== "HISTORY_CLASSROOM") return null;
  const assignment = assignments.find(
    (item) =>
      buildAssessmentDefinitionId(semesterId, "HISTORY_CLASSROOM", item.id) ===
      raw.definitionId,
  );
  if (!assignment || raw.semesterId !== semesterId) return null;
  const uid = String(raw.studentUid || "").trim();
  if (!getHistoryClassroomAssignedStudentUids(assignment).includes(uid))
    return null;
  const percent = Number(raw.percent);
  const submittedMs = Date.parse(String(raw.submittedAtIso || ""));
  const exempted = raw.completionSource === "exemption";
  if (
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100 ||
    !Number.isFinite(submittedMs) ||
    (!exempted &&
      (raw.attemptId !== id ||
        raw.submissionRef !== `semester_assessment_submissions/${id}`)) ||
    (exempted &&
      (raw.resultId !== id ||
        raw.uid !== uid ||
        !raw.exemptionId ||
        !raw.exemptionRequestId ||
        raw.passed !== true))
  )
    throw new Error("역사교실 제출 결과를 확인할 수 없습니다.");

  const savedThreshold = raw.passThresholdPercent;
  const threshold =
    typeof savedThreshold === "number" &&
    Number.isFinite(savedThreshold) &&
    savedThreshold >= 0 &&
    savedThreshold <= 100
      ? savedThreshold
      : assignment.passThresholdPercent;
  const passed =
    exempted ||
    (typeof raw.passed === "boolean" ? raw.passed : percent >= threshold);
  const checks = Array.isArray(raw.answerChecks) ? raw.answerChecks : [];
  return {
    ...normalizeHistoryClassroomResult(id, {
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      uid,
      studentName: String(raw.studentName || ""),
      score: Number(raw.score),
      total: Number(raw.total),
      percent,
      passThresholdPercent: threshold,
      passed,
      status: passed ? "passed" : "failed",
      completionSource: exempted ? "exemption" : "attempt",
      exemptionId: String(raw.exemptionId || ""),
      exemptionRequestId: String(raw.exemptionRequestId || ""),
      createdAt: new Date(submittedMs).toISOString(),
    }),
    ...(exempted
      ? {}
      : {
          canonicalSubmissionRef: String(raw.submissionRef),
          canonicalDefinitionId: String(raw.definitionId),
          canonicalSemesterId: semesterId,
          canonicalAnswerChecks: Object.fromEntries(
            checks.map((check) => [String(check.id), check.correct === true]),
          ),
        }),
  };
};

export const mergeTeacherHistoryResults = (
  legacy: HistoryClassroomResult[],
  canonical: TeacherHistoryClassroomResult[],
) => {
  const grouped: Record<string, TeacherHistoryClassroomResult[]> = {};
  const byId = new Map<string, TeacherHistoryClassroomResult>();
  legacy.forEach((result) => byId.set(result.id, result));
  canonical.forEach((result) => {
    // The projection may carry the full submitted answer snapshot. Preserve it
    // while taking the immutable canonical outcome when both records exist.
    const projection = byId.get(result.id);
    byId.set(result.id, {
      ...projection,
      ...result,
      studentName: result.studentName || projection?.studentName || "",
      answers: projection?.answers || result.answers,
      answerChecks: projection?.answerChecks.length
        ? projection.answerChecks
        : result.answerChecks,
    });
  });
  byId.forEach((result) => {
    grouped[result.assignmentId] = [
      ...(grouped[result.assignmentId] || []),
      result,
    ];
  });
  Object.values(grouped).forEach((results) =>
    results.sort(
      (left, right) =>
        resultTime(right.createdAt) - resultTime(left.createdAt) ||
        left.id.localeCompare(right.id),
    ),
  );
  return grouped;
};

export const getTeacherHistoryCompletion = (
  results: HistoryClassroomResult[],
) =>
  results.find((result) => result.status === "passed" || result.passed) ||
  results[0];

export const getTeacherHistoryCompletionsByUid = (
  results: HistoryClassroomResult[],
  assignedUids: string[],
) => {
  const latest = new Map<string, HistoryClassroomResult>();
  assignedUids.forEach((uid) => {
    const result = getTeacherHistoryCompletion(
      results.filter((item) => item.uid === uid),
    );
    if (result) latest.set(uid, result);
  });
  return latest;
};

export const readTeacherHistorySubmissionAnswers = (
  result: TeacherHistoryClassroomResult,
  submission: Record<string, unknown> | undefined,
): Record<string, string> => {
  if (
    !submission ||
    submission.attemptId !== result.id ||
    submission.studentUid !== result.uid ||
    submission.semesterId !== result.canonicalSemesterId ||
    submission.definitionId !== result.canonicalDefinitionId ||
    !submission.answers ||
    typeof submission.answers !== "object" ||
    Array.isArray(submission.answers)
  )
    throw new Error("제출 답안을 확인할 수 없습니다.");
  return Object.fromEntries(
    Object.entries(submission.answers).map(([id, answer]) => [
      id,
      String(answer ?? ""),
    ]),
  );
};
