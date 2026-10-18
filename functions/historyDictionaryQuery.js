const { HttpsError } = require("firebase-functions/v2/https");
const { FieldPath } = require("firebase-admin/firestore");
const { assertScoreWorkflowSession } = require("./scoreWorkflowGuard");
const { versionFor } = require("./productionGateway/historyDictionaryCommands");

const ADMIN_EMAIL = "westoria28@gmail.com";
const PAGE_SIZE = 200;
const text = (value, max) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const timestampMs = (value) =>
  typeof value?.toMillis === "function"
    ? value.toMillis()
    : typeof value?.toDate === "function"
      ? value.toDate().getTime()
      : Number(value?.seconds || 0) * 1000;

// Isolated from the 2026-09-17 deployed query. Preserve teacher/admin archive
// access and the session/maintenance/registration fences without exporting any
// old dictionary mutation handlers from the restored command closure.
const createHistoryDictionaryQueryHandler =
  ({ db, assertSession = assertScoreWorkflowSession }) =>
  async (request) => {
    await assertSession(request);
    const uid = request.auth?.uid,
      email = String(request.auth?.token?.email || "")
        .trim()
        .toLowerCase();
    if (
      !uid ||
      (!/@yongshin-ms\.ms\.kr$/i.test(email) && email !== ADMIN_EMAIL)
    )
      throw new HttpsError(
        "permission-denied",
        "사전을 조회할 수 있는 계정으로 로그인해 주세요.",
      );
    const profile =
      email === ADMIN_EMAIL
        ? {}
        : (await db.doc(`users/${uid}`).get()).data() || {};
    if (
      email !== ADMIN_EMAIL &&
      profile.role !== "teacher" &&
      !(
        profile.teacherPortalEnabled === true &&
        Array.isArray(profile.staffPermissions) &&
        profile.staffPermissions.includes("lesson_read")
      )
    )
      throw new HttpsError(
        "permission-denied",
        "학생 단어장을 조회할 권한이 없습니다.",
      );
    const year = request.data?.year,
      semester = request.data?.semester;
    if (
      typeof year !== "string" ||
      !/^\d{4}$/.test(year) ||
      !["1", "2"].includes(semester)
    )
      throw new HttpsError(
        "invalid-argument",
        "사전의 학기 정보를 확인해 주세요.",
      );
    const prefix = `years/${year}/semesters/${semester}/dictionary_students/`;
    const after = request.data?.after || "";
    if (
      typeof after !== "string" ||
      after.length > 1500 ||
      (after &&
        !new RegExp(
          `^(?:years/${year}/semesters/${semester}/dictionary_students|users)/[^/\\\\\\x00-\\x1f]+/history_dictionary_words/[^/\\\\\\x00-\\x1f]+$`,
        ).test(after))
    )
      throw new HttpsError(
        "invalid-argument",
        "학생 단어장 조회 위치를 확인해 주세요.",
      );
    if (email !== ADMIN_EMAIL && profile.role !== "teacher") {
      const [pointer, manifest] = await db.getAll(
        db.doc("site_settings/semester_active"),
        db.doc(`semester_manifests/${year}-${semester}`),
      );
      const p = pointer.data(),
        m = manifest.data();
      if (
        !pointer.exists ||
        !manifest.exists ||
        p.semesterId !== `${year}-${semester}` ||
        !Number.isSafeInteger(p.revision) ||
        p.revision < 1 ||
        m.semesterId !== `${year}-${semester}` ||
        p.revision !== m.revision ||
        m.status !== "ACTIVE" ||
        m.readOnly === true
      )
        throw new HttpsError(
          "permission-denied",
          "지난 학기 자료는 관리자 설정의 학기 조회에서 확인해 주세요.",
        );
    }
    let query = db
      .collectionGroup("history_dictionary_words")
      .where("year", "==", year)
      .where("semester", "==", semester)
      .where("status", "==", "saved")
      .orderBy(FieldPath.documentId());
    if (after) query = query.startAfter(db.doc(after));
    const snapshot = await query.limit(PAGE_SIZE).get();
    const words = snapshot.docs.flatMap((document) => {
      const parts = document.ref.path.split("/"),
        data = document.data() || {};
      if (
        !document.ref.path.startsWith(prefix) ||
        parts.length !== 8 ||
        parts[6] !== "history_dictionary_words" ||
        data.uid !== parts[5] ||
        data.year !== year ||
        data.semester !== semester ||
        data.status !== "saved" ||
        !["student", "teacher_reviewed"].includes(data.definitionSource)
      )
        return [];
      return [
        {
          id: `${data.uid}:${document.id}`,
          uid: data.uid,
          termId: text(data.termId || document.id, 80),
          word: text(data.word, 40),
          normalizedWord: text(
            data.normalizedWord || data.word,
            40,
          ).toLowerCase(),
          definition: text(data.definition, 1200),
          studentLevel: text(data.studentLevel, 80),
          tags: Array.isArray(data.tags)
            ? [
                ...new Set(
                  data.tags.map((tag) => text(tag, 24)).filter(Boolean),
                ),
              ].slice(0, 12)
            : [],
          status: "saved",
          requestId: text(data.requestId, 100),
          studentName: text(data.studentName || data.name, 40) || "학생",
          grade: text(data.grade, 8),
          class: text(data.class, 8),
          number: text(data.number, 8),
          definitionSource: data.definitionSource,
          memo: text(data.memo, 240),
          year,
          semester,
          reviewedBy: text(data.reviewedBy, 80),
          rewardTermId: text(data.rewardTermId, 80),
          rewardTransactionId: text(data.rewardTransactionId, 120),
          rewardAmount: Number(data.rewardAmount || 0),
          writeVersion: versionFor(data),
          createdAtMs: timestampMs(data.createdAt),
          updatedAtMs: timestampMs(data.updatedAt),
        },
      ];
    });
    return {
      words,
      nextCursor:
        snapshot.size === PAGE_SIZE ? snapshot.docs.at(-1).ref.path : "",
    };
  };
module.exports = { createHistoryDictionaryQueryHandler, PAGE_SIZE };
