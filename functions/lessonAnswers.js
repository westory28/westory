const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const semesterCore = require("./semesterCore");
const archiveEnrollment = require("./archiveEnrollment");

const LESSON_ANSWER_COMMAND_TYPES = Object.freeze({
  SAVE_LESSON_ANSWERS: "saveLessonAnswers",
});
const fail = (code, message, reason) => {
  throw new HttpsError(code, message, { reason });
};
const invalid = () =>
  fail(
    "invalid-argument",
    "학습 답안 요청을 확인해 주세요.",
    "LESSON_ANSWERS_INVALID",
  );
const safeKey = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const normalizeLessonAnswerPayload = (_commandType, value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const keys = [
    "semesterId",
    "unitId",
    "expectedSemesterRevision",
    "expectedContentRevision",
    "expectedAnswerRevision",
    "answers",
  ];
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
  if (
    !safeKey(value.unitId) ||
    !revision(value.expectedSemesterRevision) ||
    !revision(value.expectedContentRevision) ||
    !revision(value.expectedAnswerRevision)
  )
    invalid();
  if (
    !value.answers ||
    typeof value.answers !== "object" ||
    Array.isArray(value.answers) ||
    Object.keys(value.answers).length > 1000
  )
    invalid();
  const answers = Object.fromEntries(
    Object.entries(value.answers).map(([key, answer]) => {
      if (!safeKey(key) || typeof answer !== "string" || answer.length > 2000)
        invalid();
      return [key, answer];
    }),
  );
  return {
    semesterId: semesterCore.normalizeSemesterId(value.semesterId),
    unitId: value.unitId,
    expectedSemesterRevision: value.expectedSemesterRevision,
    expectedContentRevision: value.expectedContentRevision,
    expectedAnswerRevision: value.expectedAnswerRevision,
    answers,
  };
};

// The server grades from the same persisted bracket tokens and worksheet IDs as
// the renderer. Clients never submit grades, rewards, a UID, or a write path.
const buildLessonAnswerKey = (lesson) => {
  const entries = [];
  let index = 0;
  for (const match of String(lesson.contentHtml || "").matchAll(/\[(.*?)\]/g)) {
    const answer = match[1].trim();
    if (!answer.startsWith("fn:")) entries.push([String(index++), answer]);
  }
  for (const blank of Array.isArray(lesson.worksheetBlanks)
    ? lesson.worksheetBlanks
    : []) {
    if (!safeKey(blank?.id) || typeof blank.answer !== "string")
      fail(
        "failed-precondition",
        "수업자료의 빈칸 정보를 확인해 주세요.",
        "LESSON_BLANKS_INVALID",
      );
    entries.push([blank.id, blank.answer]);
  }
  if (
    entries.length > 1000 ||
    new Set(entries.map(([key]) => key)).size !== entries.length
  )
    fail(
      "failed-precondition",
      "수업자료의 빈칸 식별자가 중복되거나 너무 많습니다.",
      "LESSON_BLANKS_INVALID",
    );
  return new Map(entries);
};
const normalizeAnswer = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "");
const createLessonAnswerCommandAdapter = () => ({
  apply: async ({ transaction, payload, actor, timestamp }) => {
    if (!actor?.actorUid || actor.actorRole !== "student")
      fail(
        "permission-denied",
        "학생 계정으로 답안을 저장해 주세요.",
        "LESSON_STUDENT_REQUIRED",
      );
    const [year, term] = payload.semesterId.split("-");
    const root = `years/${year}/semesters/${term}`;
    const slotId = archiveEnrollment.buildEnrollmentSlotId(
      payload.semesterId,
      actor.actorUid,
    );
    const [pointer, manifest, slot] = await transaction.getAll([
      semesterCore.ACTIVE_SEMESTER_POINTER_PATH,
      `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${payload.semesterId}`,
      `${archiveEnrollment.ENROLLMENT_SLOT_COLLECTION}/${slotId}`,
    ]);
    if (
      !pointer.exists ||
      !manifest.exists ||
      pointer.data?.semesterId !== payload.semesterId ||
      manifest.data?.status !== "ACTIVE" ||
      pointer.data?.revision !== manifest.data?.revision ||
      manifest.data?.revision !== payload.expectedSemesterRevision
    )
      fail(
        "failed-precondition",
        "현재 학기가 변경되었습니다. 화면을 새로 열어 주세요.",
        "LESSON_SEMESTER_NOT_ACTIVE",
      );
    const enrollmentId = slot.data?.activeEnrollmentId;
    if (!slot.exists || !safeKey(enrollmentId))
      fail(
        "permission-denied",
        "현재 학기의 수강 정보를 확인할 수 없습니다.",
        "LESSON_ENROLLMENT_REQUIRED",
      );
    const enrollment = await transaction.get(
      `${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${enrollmentId}`,
    );
    if (
      !enrollment.exists ||
      enrollment.data?.studentUid !== actor.actorUid ||
      enrollment.data?.semesterId !== payload.semesterId ||
      enrollment.data?.enrollmentStatus !== "ACTIVE"
    )
      fail(
        "permission-denied",
        "현재 학기의 수강 정보를 확인할 수 없습니다.",
        "LESSON_ENROLLMENT_REQUIRED",
      );
    let lessons = await transaction.query(`${root}/lessons`, {
      field: "unitId",
      operator: "==",
      value: payload.unitId,
      limit: 2,
    });
    // Preserve legacy fallback reads; every write stays in the active semester.
    if (!lessons.length)
      lessons = await transaction.query("lessons", {
        field: "unitId",
        operator: "==",
        value: payload.unitId,
        limit: 2,
      });
    if (lessons.length !== 1)
      fail(
        "failed-precondition",
        "수업자료를 하나로 확인할 수 없습니다.",
        "LESSON_SOURCE_AMBIGUOUS",
      );
    const lesson = lessons[0].data;
    if (lesson.isVisibleToStudents === false || lesson.deletedAt)
      fail(
        "permission-denied",
        "현재 공개된 수업자료만 저장할 수 있습니다.",
        "LESSON_NOT_VISIBLE",
      );
    if (
      Array.isArray(lesson.assignedClassIds) &&
      lesson.assignedClassIds.length &&
      !lesson.assignedClassIds.includes(enrollment.data.classId)
    )
      fail(
        "permission-denied",
        "이 학급에 배정되지 않은 수업자료입니다.",
        "LESSON_CLASS_NOT_ASSIGNED",
      );
    if ((lesson.contentRevision ?? 0) !== payload.expectedContentRevision)
      fail(
        "aborted",
        "수업자료가 수정되었습니다. 입력 내용을 보관한 뒤 자료를 다시 열어 주세요.",
        "LESSON_CONTENT_CONFLICT",
      );
    const answerKey = buildLessonAnswerKey(lesson);
    if (Object.keys(payload.answers).some((key) => !answerKey.has(key)))
      fail(
        "aborted",
        "수업자료의 빈칀이 변경되었습니다. 자료를 다시 열어 주세요.",
        "LESSON_BLANKS_CHANGED",
      );
    const path = `${root}/lesson_progress/${actor.actorUid}/units/${payload.unitId}`;
    const progress = await transaction.get(path);
    const currentRevision = progress.data?.answerRevision ?? 0;
    if (currentRevision !== payload.expectedAnswerRevision)
      fail(
        "aborted",
        "다른 화면에서 답안을 저장했습니다. 입력 내용을 보관한 뒤 다시 열어 주세요.",
        "LESSON_ANSWER_CONFLICT",
      );
    const answers = Object.fromEntries(
      [...answerKey].map(([key, answer]) => {
        const value = payload.answers[key] ?? "";
        return [
          key,
          {
            value,
            status:
              normalizeAnswer(value) === normalizeAnswer(answer)
                ? "correct"
                : "wrong",
          },
        ];
      }),
    );
    const correctCount = Object.values(answers).filter(
      (answer) => answer.status === "correct",
    ).length;
    const result = {
      unitId: payload.unitId,
      answers,
      answerRevision: currentRevision + 1,
      contentRevision: payload.expectedContentRevision,
      correctCount,
      totalCount: answerKey.size,
    };
    // Replace the answer map while preserving core-point finds/reward fields.
    transaction.set(path, {
      ...(progress.data || {}),
      ...result,
      studentUid: actor.actorUid,
      semesterId: payload.semesterId,
      completed: true,
      updatedAt: timestamp,
    });
    return {
      target: { kind: "lesson-answers", id: payload.unitId, refs: [path] },
      sourceHash: createHash("sha256")
        .update(JSON.stringify([...answerKey]))
        .digest("hex"),
      result,
    };
  },
});

module.exports = {
  LESSON_ANSWER_COMMAND_TYPES,
  normalizeLessonAnswerPayload,
  buildLessonAnswerKey,
  createLessonAnswerCommandAdapter,
};
