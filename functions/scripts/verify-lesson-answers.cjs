const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const gateway = require("../commandGateway");
const lesson = require("../lessonAnswers");
const enrollment = require("../archiveEnrollment");

// A serial transaction store that rejects reads after writes and rolls back
// every staged document on failure, including receipts and audits.
class Store {
  constructor(seed) {
    this.docs = new Map(Object.entries(seed));
    this.queue = Promise.resolve();
  }
  async get(path) {
    return {
      path,
      exists: this.docs.has(path),
      data: structuredClone(this.docs.get(path) || null),
    };
  }
  async runTransaction(callback) {
    const previous = this.queue;
    let release;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const staged = new Map(this.docs);
    let written = false;
    const get = async (path) => {
      assert.equal(written, false, "Firestore reads must precede writes");
      return {
        path,
        exists: staged.has(path),
        data: structuredClone(staged.get(path) || null),
      };
    };
    try {
      const result = await callback({
        get,
        getAll: (paths) => Promise.all(paths.map(get)),
        query: async (path, filter) => {
          assert.equal(written, false);
          const prefix = `${path}/`;
          return [...staged]
            .filter(
              ([key, value]) =>
                key.startsWith(prefix) &&
                !key.slice(prefix.length).includes("/") &&
                value[filter.field] === filter.value,
            )
            .slice(0, filter.limit || Infinity)
            .map(([key, value]) => ({
              path: key,
              exists: true,
              data: structuredClone(value),
            }));
        },
        set: (path, value, options) => {
          written = true;
          staged.set(
            path,
            structuredClone(
              options?.merge ? { ...staged.get(path), ...value } : value,
            ),
          );
        },
        create: (path, value) => {
          written = true;
          assert.equal(staged.has(path), false);
          staged.set(path, structuredClone(value));
        },
      });
      this.docs = staged;
      return result;
    } finally {
      release();
    }
  }
}
const root = "years/2026/semesters/2";
const sourcePath = `${root}/lessons/lesson-one`;
const progressPath = `${root}/lesson_progress/student-one/units/unit-one`;
const slotPath = `${enrollment.ENROLLMENT_SLOT_COLLECTION}/${enrollment.buildEnrollmentSlotId("2026-2", "student-one")}`;
const seed = () => ({
  "site_settings/config": { year: "2026", semester: "2", activeSemesterId: "2026-2" },
  "site_settings/semester_active": { semesterId: "2026-2", revision: 4 },
  "semester_manifests/2026-2": { semesterId: "2026-2", status: "ACTIVE", revision: 4 },
  [slotPath]: { activeEnrollmentId: "enroll-one" },
  [`${enrollment.SEMESTER_ENROLLMENT_COLLECTION}/enroll-one`]: {
    studentUid: "student-one",
    semesterId: "2026-2",
    enrollmentStatus: "ACTIVE",
    classId: "class-one",
  },
  [sourcePath]: {
    unitId: "unit-one",
    contentRevision: 2,
    contentHtml: "[고려] [fn:photo] [조선]",
    worksheetBlanks: [
      { id: "pdf-page-1", answer: "삼 국" },
      { id: "pdf-page-2", answer: "통일" },
    ],
    isVisibleToStudents: true,
  },
  [progressPath]: {
    answers: { obsolete: { value: "old", status: "correct" } },
    corePointFinds: ["point-one"],
    corePointRewardClaimed: true,
  },
});
const payload = () => ({
  semesterId: "2026-2",
  unitId: "unit-one",
  expectedSemesterRevision: 4,
  expectedContentRevision: 2,
  expectedAnswerRevision: 0,
  answers: { 0: "고려", 1: "틀림", "pdf-page-1": "삼국", "pdf-page-2": "통일" },
});
let checks = 0;
const setup = (mutate = () => {}) => {
  const data = seed();
  mutate(data);
  const store = new Store(data);
  const core = gateway.createCommandGatewayCore({
    store,
    projectId: "demo-westory-session-lesson-answers",
    serverTimestamp: () => 123,
    concreteTimestamp: () => 123,
    assertSession: async (request, options) => {
      assert.deepEqual(options, { recentAuth: false, highRisk: false });
      return {
        uid: request.auth.uid,
        email: request.auth.token.email,
        sessionId: "test-session",
        revision: 1,
        schemaVersion: 2,
        expiresAtMs: 999999,
      };
    },
    authorizeCommand: async ({ request }) => ({
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email,
      actorRole: request.auth.uid === "student-one" ? "student" : "teacher",
    }),
    commandAdapters: {
      saveLessonAnswers: lesson.createLessonAnswerCommandAdapter(),
    },
  });
  const execute = (
    value = payload(),
    id = randomUUID(),
    uid = "student-one",
    drop = false,
  ) =>
    core.execute({
      auth: { uid, token: { email: `${uid}@example.test` } },
      data: {
        commandType: "saveLessonAnswers",
        commandId: id,
        payload: value,
        ...(drop ? { _testDropResponseAfterCommit: true } : {}),
      },
    });
  return { store, execute };
};
const denied = async (reason, value = payload(), mutate, uid) => {
  const { store, execute } = setup(mutate);
  const before = structuredClone([...store.docs]);
  await assert.rejects(
    execute(value, randomUUID(), uid),
    (error) => error.details?.reason === reason,
  );
  assert.deepEqual([...store.docs], before, "Rejected command must not write");
  checks++;
};
module.exports = { Store };
if (require.main === module)
  (async () => {
    const { store, execute } = setup();
    const id = randomUUID();
    const saved = await execute(payload(), id);
    assert.equal(saved.result.correctCount, 3);
    assert.equal(saved.result.totalCount, 4);
    assert.equal(saved.result.answerRevision, 1);
    assert.deepEqual(store.docs.get(progressPath).corePointFinds, [
      "point-one",
    ]);
    assert.equal(store.docs.get(progressPath).corePointRewardClaimed, true);
    assert.equal(
      Object.hasOwn(store.docs.get(progressPath).answers, "obsolete"),
      false,
    );
    assert.equal((await execute(payload(), id)).replayed, true);
    checks += 6;
    await assert.rejects(
      execute({ ...payload(), answers: {} }, id),
      (error) => error.details?.reason === "COMMAND_ID_CONFLICT",
    );
    checks++;
    const races = await Promise.allSettled([
      execute({ ...payload(), expectedAnswerRevision: 1 }),
      execute({ ...payload(), expectedAnswerRevision: 1 }),
    ]);
    assert.equal(
      races.filter((entry) => entry.status === "fulfilled").length,
      1,
    );
    checks++;
    const lost = setup();
    const lostId = randomUUID();
    await assert.rejects(
      lost.execute(payload(), lostId, "student-one", true),
      (error) => error.details?.reason === "TEST_RESPONSE_LOSS",
    );
    assert.equal((await lost.execute(payload(), lostId)).replayed, true);
    assert.equal(lost.store.docs.get(progressPath).answerRevision, 1);
    checks++;
    await denied(
      "LESSON_STUDENT_REQUIRED",
      payload(),
      undefined,
      "teacher-one",
    );
    await denied("LESSON_ANSWERS_INVALID", {
      ...payload(),
      studentUid: "victim",
    });
    await denied("LESSON_ANSWERS_INVALID", {
      ...payload(),
      answers: { 0: { value: "bad", status: "correct" } },
    });
    await denied("LESSON_ANSWERS_INVALID", {
      ...payload(),
      unitId: "../../victim",
    });
    await denied("LESSON_SEMESTER_NOT_ACTIVE", {
      ...payload(),
      expectedSemesterRevision: 3,
    });
    await denied("LESSON_SEMESTER_NOT_ACTIVE", payload(), (data) => {
      data["semester_manifests/2026-2"].status = "CLOSED";
    });
    await denied("LESSON_ENROLLMENT_REQUIRED", payload(), (data) => {
      delete data[slotPath];
    });
    await denied("LESSON_ENROLLMENT_REQUIRED", payload(), (data) => {
      data[
        `${enrollment.SEMESTER_ENROLLMENT_COLLECTION}/enroll-one`
      ].studentUid = "victim";
    });
    await denied("LESSON_NOT_VISIBLE", payload(), (data) => {
      data[sourcePath].isVisibleToStudents = false;
    });
    await denied("LESSON_CLASS_NOT_ASSIGNED", payload(), (data) => {
      data[sourcePath].assignedClassIds = ["other-class"];
    });
    await denied("LESSON_CONTENT_CONFLICT", {
      ...payload(),
      expectedContentRevision: 1,
    });
    await denied("LESSON_ANSWER_CONFLICT", {
      ...payload(),
      expectedAnswerRevision: 1,
    });
    await denied("LESSON_BLANKS_CHANGED", {
      ...payload(),
      answers: { unknown: "answer" },
    });
    await denied("LESSON_SOURCE_AMBIGUOUS", payload(), (data) => {
      data[`${root}/lessons/duplicate`] = data[sourcePath];
    });
    await denied("LESSON_BLANKS_INVALID", payload(), (data) => {
      data[sourcePath].worksheetBlanks.push({ id: "0", answer: "collision" });
    });
    await denied("LESSON_SOURCE_AMBIGUOUS", payload(), (data) => {
      data["lessons/old-source"] = data[sourcePath];
      data["years/2026/semesters/1/lessons/old-source"] = data[sourcePath];
      delete data[sourcePath];
    });
    console.log(
      JSON.stringify({
        passed: true,
        checks,
        networkAccess: 0,
        coverage:
          "server grading, hidden pages, reward preservation, replay, lost response, concurrent CAS, role, enrollment, scope, semester-only sources; prior-semester and global sources denied",
      }),
    );
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
