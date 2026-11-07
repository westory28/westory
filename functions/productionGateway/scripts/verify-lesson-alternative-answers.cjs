const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  buildLessonAnswerKey,
  normalizeLessonAnswerPayload,
  createLessonAnswerCommandAdapter,
} = require("../lessonAnswers");
const {
  normalizeLessonPayload,
  createLessonCommandAdapter,
} = require("../lessonManagement");
const { buildEnrollmentSlotId } = require("../archiveEnrollment");

const root = "years/2026/semesters/2";
const studentUid = "student-one";
const lessonPath = `${root}/lessons/lesson-one`;
const progressPath = `${root}/lesson_progress/${studentUid}/units/unit-one`;
const blank = (fields = {}) => ({
  id: "blank-one",
  page: 1,
  leftRatio: 0.1,
  topRatio: 0.1,
  widthRatio: 0.2,
  heightRatio: 0.05,
  answer: "조선 태조",
  ...fields,
});
const savePayload = (document) => ({
  semesterId: "2026-2",
  unitId: "unit-one",
  expectedSemesterRevision: 1,
  expectedRevision: 2,
  assetUploadIds: [],
  document,
});
const answerPayload = (answers) => ({
  semesterId: "2026-2",
  unitId: "unit-one",
  expectedSemesterRevision: 1,
  expectedContentRevision: 2,
  expectedAnswerRevision: 4,
  answers,
});

function fixture(lessonFields = {}) {
  const docs = new Map(
    Object.entries({
      "site_settings/semester_active": { semesterId: "2026-2", revision: 1 },
      "semester_manifests/2026-2": { status: "ACTIVE", revision: 1 },
      [`semester_enrollment_slots/${buildEnrollmentSlotId("2026-2", studentUid)}`]:
        {
          activeEnrollmentId: "enrollment-one",
        },
      "semester_enrollments/enrollment-one": {
        studentUid,
        semesterId: "2026-2",
        enrollmentStatus: "ACTIVE",
        classId: "class-one",
      },
      [`${root}/curriculum/tree`]: {
        tree: [{ id: "unit-one", title: "단원", children: [] }],
      },
      [lessonPath]: {
        unitId: "unit-one",
        contentRevision: 2,
        isVisibleToStudents: true,
        contentHtml: "[고려] [fn:footnote-one]",
        worksheetBlanks: [
          blank({ alternativeAnswers: ["이성계", "태조 이성계"] }),
        ],
        ...lessonFields,
      },
      [progressPath]: {
        answerRevision: 4,
        corePointFinds: ["core-one"],
        rewardClaimed: true,
      },
    }),
  );
  const writes = [];
  const get = async (path) => ({
    path,
    exists: docs.has(path),
    data: structuredClone(docs.get(path)),
  });
  const transaction = {
    get,
    getAll: (paths) => Promise.all(paths.map(get)),
    query: async (path, { field, value }) =>
      Promise.all(
        [...docs]
          .filter(
            ([key, data]) =>
              key.startsWith(`${path}/`) &&
              !key.slice(path.length + 1).includes("/") &&
              data[field] === value,
          )
          .map(([key]) => get(key)),
      ),
    set: (path, value) => {
      writes.push(path);
      docs.set(path, structuredClone(value));
    },
  };
  const grade = (
    answers,
    overrides = {},
    actor = { actorUid: studentUid, actorRole: "student" },
  ) =>
    createLessonAnswerCommandAdapter().apply({
      transaction,
      payload: { ...answerPayload(answers), ...overrides },
      actor,
      timestamp: 123,
    });
  return { docs, writes, transaction, grade };
}

test("teacher save preserves canonical answer and normalizes alternatives without mutating input", async () => {
  const document = {
    worksheetBlanks: [
      blank({
        alternativeAnswers: [
          " 이성계 ",
          "이 성계",
          "조선태조",
          "",
          "   ",
          "태조 이성계",
        ],
      }),
    ],
  };
  const payload = normalizeLessonPayload(
    "saveLessonDocument",
    savePayload(document),
  );
  assert.deepEqual(payload.document.worksheetBlanks[0].alternativeAnswers, [
    "이성계",
    "태조 이성계",
  ]);
  assert.equal(payload.document.worksheetBlanks[0].answer, "조선 태조");
  assert.equal(document.worksheetBlanks[0].alternativeAnswers[0], " 이성계 ");
  const f = fixture();
  await createLessonCommandAdapter().apply({
    transaction: f.transaction,
    payload,
    actor: { actorUid: "teacher-one", actorRole: "teacher" },
    commandType: "saveLessonDocument",
    commandId: "save-one",
    timestamp: 123,
  });
  const saved = f.docs.get(lessonPath);
  assert.equal(saved.worksheetBlanks[0].answer, "조선 태조");
  assert.deepEqual(saved.worksheetBlanks[0].alternativeAnswers, [
    "이성계",
    "태조 이성계",
  ]);
  assert.equal(saved.contentRevision, 3);
});

test("missing or cleared alternatives remain compatible with old blanks", () => {
  for (const alternatives of [undefined, [], ["", "조선태조"]]) {
    const payload = normalizeLessonPayload(
      "saveLessonDocument",
      savePayload({
        worksheetBlanks: [blank({ alternativeAnswers: alternatives })],
      }),
    );
    assert.equal(
      Object.hasOwn(payload.document.worksheetBlanks[0], "alternativeAnswers"),
      false,
    );
    assert.deepEqual(buildLessonAnswerKey(payload.document).get("blank-one"), [
      "조선 태조",
    ]);
  }
});

test("teacher cannot persist malformed or unbounded alternative answers", () => {
  for (const alternatives of [
    null,
    "이성계",
    {},
    [2],
    [null],
    Array(21).fill("답"),
    ["가".repeat(2001)],
  ]) {
    assert.throws(
      () =>
        normalizeLessonPayload(
          "saveLessonDocument",
          savePayload({
            worksheetBlanks: [blank({ alternativeAnswers: alternatives })],
          }),
        ),
      (error) => error.details?.reason === "LESSON_PAYLOAD_INVALID",
    );
    assert.throws(
      () =>
        buildLessonAnswerKey({
          worksheetBlanks: [blank({ alternativeAnswers: alternatives })],
        }),
      (error) => error.details?.reason === "LESSON_BLANKS_INVALID",
    );
  }
  const accepted = normalizeLessonPayload(
    "saveLessonDocument",
    savePayload({
      worksheetBlanks: [
        blank({
          alternativeAnswers: Array.from(
            { length: 20 },
            (_, index) => `${index}${"가".repeat(1998)}`,
          ),
        }),
      ],
    }),
  );
  assert.equal(
    accepted.document.worksheetBlanks[0].alternativeAnswers.length,
    20,
  );
});

test("server grades canonical and every teacher alternative with existing whitespace matching", async () => {
  for (const value of [
    "조선태조",
    "조선 태조",
    "이성계",
    "  이 성계  ",
    "태조 이성계",
  ]) {
    const f = fixture();
    const { result } = await f.grade({ "blank-one": value, 0: "고려" });
    assert.equal(result.answers["blank-one"].status, "correct");
    assert.equal(result.answers["blank-one"].value, value);
    assert.equal(result.correctCount, 2);
    assert.equal(result.totalCount, 2);
    assert.equal(result.answerRevision, 5);
    assert.deepEqual(f.docs.get(progressPath).corePointFinds, ["core-one"]);
    assert.equal(f.docs.get(progressPath).rewardClaimed, true);
    assert.deepEqual(f.writes, [progressPath]);
  }
});

test("incorrect, empty, and removed alternatives are rejected while legacy canonical answers still grade", async () => {
  for (const value of ["정도전", "", "   "]) {
    const { result } = await fixture().grade({ "blank-one": value });
    assert.equal(result.answers["blank-one"].status, "wrong");
    assert.equal(result.answers["0"].status, "wrong");
  }
  const legacy = fixture({ worksheetBlanks: [blank()] });
  assert.equal(
    (await legacy.grade({ "blank-one": "조선태조" })).result.answers[
      "blank-one"
    ].status,
    "correct",
  );
  const removed = fixture({ worksheetBlanks: [blank()] });
  assert.equal(
    (await removed.grade({ "blank-one": "이성계" })).result.answers["blank-one"]
      .status,
    "wrong",
  );
});

test("student payload cannot supply alternatives, statuses, or nonexistent blank IDs", async () => {
  for (const forged of [
    { ...answerPayload({}), alternativeAnswers: ["가짜"] },
    answerPayload({ "blank-one": { value: "가짜", status: "correct" } }),
  ]) {
    assert.throws(
      () => normalizeLessonAnswerPayload("saveLessonAnswers", forged),
      (error) => error.details?.reason === "LESSON_ANSWERS_INVALID",
    );
  }
  const f = fixture();
  await assert.rejects(
    f.grade({ "removed-blank": "이성계" }),
    (error) => error.details?.reason === "LESSON_BLANKS_CHANGED",
  );
  assert.equal(f.writes.length, 0);
});

test("answer changes retain content, answer revision, enrollment and visibility safeguards", async () => {
  for (const overrides of [
    { expectedContentRevision: 1 },
    { expectedAnswerRevision: 3 },
    { expectedSemesterRevision: 0 },
  ]) {
    const f = fixture();
    await assert.rejects(f.grade({ "blank-one": "이성계" }, overrides));
    assert.equal(f.writes.length, 0);
  }
  for (const fields of [
    { isVisibleToStudents: false },
    { deletedAt: 1 },
    { assignedClassIds: ["class-two"] },
  ]) {
    const f = fixture(fields);
    await assert.rejects(f.grade({ "blank-one": "이성계" }));
    assert.equal(f.writes.length, 0);
  }
  const unenrolled = fixture();
  unenrolled.docs.delete("semester_enrollments/enrollment-one");
  await assert.rejects(unenrolled.grade({ "blank-one": "이성계" }));
  assert.equal(unenrolled.writes.length, 0);
  const teacher = fixture();
  await assert.rejects(
    teacher.grade(
      { "blank-one": "이성계" },
      {},
      { actorUid: "teacher-one", actorRole: "teacher" },
    ),
  );
  assert.equal(teacher.writes.length, 0);
});
