const assert = require("node:assert/strict");
const path = require("node:path");
const assessment = require(process.env.ASSESSMENT_SAVE_MODULE
  ? path.resolve(process.env.ASSESSMENT_SAVE_MODULE) : "../assessmentLifecycle");
const clone = value => structuredClone(value);
const attemptId = `attempt_${"a".repeat(64)}`;
const attemptPath = `semester_assessment_attempts/${attemptId}`;
const nowMs = Date.parse("2026-11-10T12:00:00Z");
const attempt = {
  attemptId, studentUid: "synthetic-student", semesterId: "2026-2",
  definitionId: "quiz:2026-2:exam_prep:exam_prep:round_1", assessmentKind: "QUIZ",
  sourceId: "exam_prep", category: "exam_prep", examRound: "round_1", status: "STARTED", revision: 1,
  questionIds: ["q1"], questionDocumentIds: { q1: "q1" }, gradingSnapshot: [{ id: "q1", answer: "조선", answerLimit: 100 }],
  startedAtIso: new Date(nowMs - 10_000).toISOString(), deadlineAtIso: new Date(nowMs + 60_000).toISOString(),
  answers: {}, lastSavedAtIso: new Date(nowMs - 10_000).toISOString(),
  questionSnapshots: [{ id: "q1", type: "choice", answer: "조선", options: ["가".repeat(80)], passage: "합성 지문".repeat(5_000), image: "data:image/png;base64," + "x".repeat(300_000) }],
  learningSnapshot: [{ id: "q1", concepts: ["합성 개념"] }], paperHeader: { paperTitle: "보존할 합성 시험지" },
};
const seed = () => new Map([
  ["users/synthetic-student", { role: "student" }],
  ["site_settings/semester_active", { semesterId: "2026-2", revision: 1 }],
  ["semester_manifests/2026-2", { semesterId: "2026-2", revision: 1, status: "ACTIVE" }],
  [attemptPath, clone(attempt)],
]);
const fixture = (edit = () => {}) => {
  const documents = seed();
  edit(documents);
  const reads = [], writes = [];
  const read = (documentPath, fields) => {
    const value = documents.get(documentPath);
    const data = value ? fields?.length ? Object.fromEntries(fields.filter(field => Object.hasOwn(value, field)).map(field => [field, clone(value[field])])) : clone(value) : null;
    reads.push({ path: documentPath, fields, bytes: Buffer.byteLength(JSON.stringify(data)) });
    return { exists: Boolean(value), path: documentPath, data };
  };
  const store = {
    get: async documentPath => read(documentPath),
    runTransaction: async callback => {
      const staged = [];
      const result = await callback({
        get: async documentPath => read(documentPath),
        getAll: async (paths, options) => paths.map(documentPath => read(documentPath, options?.fieldMask)),
        query: async () => { throw Error("Round 1 must not query other students or prerequisites"); },
        set: (documentPath, fields, options) => staged.push({ path: documentPath, fields: clone(fields), options }),
      });
      for (const write of staged) {
        assert.deepEqual(Object.keys(write.fields).sort(), [...write.options.mergeFields].sort());
        documents.set(write.path, { ...documents.get(write.path), ...write.fields });
        writes.push(write);
      }
      return result;
    },
  };
  const core = assessment.createAssessmentQueryCore({ store,
    assertSession: async request => ({ uid: request.auth.uid }),
    now: () => new Date(nowMs), serverTimestamp: () => ({ millis: nowMs }),
  });
  const request = (answers = { q1: "조선" }, extra = {}) => ({
    auth: { uid: "synthetic-student" },
    data: { attemptId, expectedRevision: 1, answers, currentItemId: "q1", saveId: "synthetic-save", ...extra },
  });
  return { documents, reads, writes, core, request };
};

(async () => {
  const normal = fixture();
  const saved = await normal.core.saveAssessmentProgress(normal.request({ q1: "가".repeat(80) }));
  assert.equal(saved.revision, 2);
  const normalAttemptReads = normal.reads.filter(read => read.path === attemptPath);
  assert.equal(normalAttemptReads.length, 1);
  assert.equal(normal.reads.length, 4, "Profile, attempt, active pointer and semester manifest are still checked");
  assert.equal(normal.writes.length, 1);
  assert.ok(normalAttemptReads[0].fields.length);
  for (const excluded of ["questionSnapshots", "learningSnapshot", "paperHeader", "answers", "analytics"])
    assert.equal(normalAttemptReads[0].fields.includes(excluded), false);
  const fullBytes = Buffer.byteLength(JSON.stringify(attempt));
  const projectedBytes = normalAttemptReads[0].bytes;
  assert.ok(projectedBytes < fullBytes / 100, "Large frozen materials must stay out of a normal save read");
  assert.deepEqual(normal.documents.get(attemptPath).questionSnapshots, attempt.questionSnapshots);
  assert.deepEqual(normal.documents.get(attemptPath).paperHeader, attempt.paperHeader);
  assert.equal(normal.documents.get(attemptPath).answers.q1.length, 80);
  const replay = await normal.core.saveAssessmentProgress(normal.request({ q1: "가".repeat(80) }));
  assert.equal(replay.replayed, true);
  assert.equal(normal.writes.length, 1, "Lost-response retry never writes the answer twice");

  const legacy = fixture(documents => { delete documents.get(attemptPath).gradingSnapshot[0].answerLimit; });
  await legacy.core.saveAssessmentProgress(legacy.request({ q1: "가".repeat(80) }));
  const legacyReads = legacy.reads.filter(read => read.path === attemptPath);
  assert.equal(legacyReads.length, 2);
  assert.deepEqual(legacyReads[1].fields, ["questionSnapshots"]);
  assert.equal(legacy.writes.length, 1);
  const legacyShort = fixture(documents => { delete documents.get(attemptPath).gradingSnapshot[0].answerLimit; });
  await legacyShort.core.saveAssessmentProgress(legacyShort.request());
  assert.equal(legacyShort.reads.filter(read => read.path === attemptPath).length, 1,
    "A short legacy answer does not need a frozen-paper read");

  for (const scenario of [
    { name: "foreign owner", edit: documents => { documents.get(attemptPath).studentUid = "someone-else"; }, reason: "ASSESSMENT_ATTEMPT_FORBIDDEN" },
    { name: "archived semester", edit: documents => { documents.get("semester_manifests/2026-2").status = "ARCHIVED"; }, reason: "ASSESSMENT_SEMESTER_NOT_ACTIVE" },
    { name: "conflicting revision", edit: documents => { documents.get(attemptPath).revision = 2; }, reason: "ASSESSMENT_ATTEMPT_REVISION_CONFLICT" },
    { name: "expired deadline", edit: documents => { documents.get(attemptPath).deadlineAtIso = new Date(nowMs - 1).toISOString(); }, reason: "ASSESSMENT_DEADLINE_EXPIRED" },
    { name: "submitted attempt", edit: documents => { documents.get(attemptPath).status = "SUBMITTED"; }, reason: "ASSESSMENT_ATTEMPT_NOT_WRITABLE" },
  ]) {
    const denied = fixture(documents => { delete documents.get(attemptPath).gradingSnapshot[0].answerLimit; scenario.edit(documents); });
    await assert.rejects(denied.core.saveAssessmentProgress(denied.request({ q1: "가".repeat(80) })), error => error.details?.reason === scenario.reason, scenario.name);
    assert.equal(denied.writes.length, 0);
    assert.equal(denied.reads.filter(read => read.path === attemptPath).length, 1,
      "Access/revision/deadline denial must precede legacy material loading");
  }
  const overlong = fixture();
  await assert.rejects(overlong.core.saveAssessmentProgress(overlong.request({ q1: "가".repeat(101) })), error => error.details?.reason === "ASSESSMENT_ANSWER_TOO_LONG");
  assert.equal(overlong.writes.length, 0);
  const invalid = fixture();
  await assert.rejects(invalid.core.saveAssessmentProgress(invalid.request({ foreign: "가".repeat(80) })), error => error.details?.reason === "ASSESSMENT_ANSWERS_INVALID");
  assert.equal(invalid.writes.length, 0);
  const history = fixture(documents => { Object.assign(documents.get(attemptPath), { assessmentKind: "HISTORY_CLASSROOM", category: "", examRound: "" }); });
  await assert.rejects(history.core.saveAssessmentProgress(history.request({ q1: "가".repeat(21) })), error => error.details?.reason === "ASSESSMENT_ANSWER_TOO_LONG");
  assert.equal(history.reads.filter(read => read.path === attemptPath).length, 1);
  assert.equal(history.writes.length, 0);
  console.log(JSON.stringify({ suite: "assessment-save-read-budget", passed: true,
    syntheticFullAttemptBytes: fullBytes, projectedAttemptBytes: projectedBytes,
    normalAttemptReads: 1, normalTotalCoreReads: 4, normalWrites: 1, receiptReplayAdditionalWrites: 0,
    legacyLongAnswerAttemptReads: 2, productionDataAccess: 0,
    checks: "Projection, frozen material preservation, legacy typed limits, owner/semester/revision/deadline/status gates, invalid keys and receipt replay." }));
})().catch(error => { console.error(error); process.exitCode = 1; });
