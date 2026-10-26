const assert = require("node:assert/strict");
const learning = require("../assessmentLearning");
const assessment = require("../assessmentLifecycle");
const commandGateway = require("../commandGateway");
const { buildEnrollmentSlotId } = require("../archiveEnrollment");

// Synthetic unit/integration store; this suite never opens a production connection.
class MemoryStore {
  constructor(seed) {
    this.documents = new Map(Object.entries(seed));
    this.writes = 0;
  }
  async get(path) {
    return {
      exists: this.documents.has(path),
      path,
      data: structuredClone(this.documents.get(path) || null),
    };
  }
  async query(collection, filter) {
    return Promise.all(
      [...this.documents.keys()]
        .filter(
          (path) =>
            path.startsWith(`${collection}/`) &&
            !path.slice(collection.length + 1).includes("/"),
        )
        .filter(
          (path) =>
            !filter ||
            (filter.filters || [filter]).every(clause => this.documents.get(path)?.[clause.field] === clause.value),
        )
        .map((path) => this.get(path)),
    );
  }
  async runTransaction(callback) {
    const staged = new Map(this.documents);
    const before = this.documents;
    const beforeWrites = this.writes;
    this.documents = staged;
    try {
      return await callback({
        get: (path) => this.get(path),
        getAll: (paths) => Promise.all(paths.map((path) => this.get(path))),
        query: (...args) => this.query(...args),
        set: (path, value, options) => {
          this.documents.set(
            path,
            structuredClone(
              options?.merge
                ? { ...this.documents.get(path), ...value }
                : value,
            ),
          );
          this.writes++;
        },
        create: (path, value) => {
          assert.equal(
            this.documents.has(path),
            false,
            "Immutable IDs must remain unique",
          );
          this.documents.set(path, structuredClone(value));
          this.writes++;
        },
        delete: (path) => {
          this.documents.delete(path);
          this.writes++;
        },
      });
    } catch (error) {
      this.documents = before;
      this.writes = beforeWrites;
      throw error;
    }
  }
}

const completeItem = (overrides = {}) => ({
  activeMs: 100,
  hiddenMs: 20,
  firstResponseMs: 40,
  finalResponseMs: 80,
  answerChangeCount: 1,
  revisitCount: 0,
  hintViewed: false,
  quality: "complete",
  ...overrides,
});
const analytics = (questions) => ({
  version: 1,
  quality: "complete",
  questions,
});
const boundAttempt = {
  questionIds: ["1", "2"],
  startedAtIso: new Date(0).toISOString(),
};

const runNormalizerCases = () => {
  for (const invalid of [
    undefined,
    null,
    2,
    [],
    "bad",
    {},
    { version: 2, questions: {} },
    { version: 1, questions: [] },
  ]) {
    assert.equal(
      learning.normalizeAnalytics(invalid, boundAttempt, 1000),
      null,
    );
  }
  const oversized = analytics(
    Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [`q${index}`, completeItem()]),
    ),
  );
  assert.equal(
    learning.normalizeAnalytics(oversized, boundAttempt, 1000),
    null,
  );
  const valid = learning.normalizeAnalytics(
    analytics({ 1: completeItem(), 2: completeItem() }),
    boundAttempt,
    1000,
    { 1: "a", 2: "" },
  );
  assert.equal(valid.quality, "complete");
  assert.equal(valid.questions[1].firstResponseMs, 40);
  assert.equal(
    valid.questions[2].firstResponseMs,
    null,
    "No response must not become a zero-ms response",
  );
  assert.equal(valid.questions[2].finalResponseMs, null);
  assert.equal("confidence" in valid.questions[2], false);
  const legacy = learning.normalizeAnalytics(analytics({ 1: completeItem({ confidence: "unsure", confidenceMs: Infinity }) }), boundAttempt, 1000, {1: "a"});
  assert.equal(JSON.stringify(legacy).includes("confidence"), false, "Legacy self-reports are ignored, not persisted again");
  const unvisited = learning.normalizeAnalytics(analytics({1: completeItem()}), boundAttempt, 1000, {1: "a"});
  assert.equal(unvisited.quality, "complete", "An unvisited unanswered question does not imply collection loss");
  assert.equal(unvisited.questions[2], undefined);
  const restoredPartial = learning.normalizeAnalytics(analytics({1: completeItem({firstResponseMs: null, finalResponseMs: 80, quality: "partial"})}), boundAttempt, 1000, {1: "a"});
  assert.equal(restoredPartial.questions[1].firstResponseMs, null);
  assert.equal(restoredPartial.questions[1].finalResponseMs, 80, "Known final response can survive an unknown original response time");
  assert.equal(restoredPartial.quality, "partial");
  const foreign = learning.normalizeAnalytics(
    analytics({ 1: completeItem(), other: completeItem() }),
    boundAttempt,
    1000,
  );
  assert.equal(foreign.questions.other, undefined);
  assert.equal(foreign.quality, "partial");
  const missing = learning.normalizeAnalytics(
    analytics({ 1: completeItem() }),
    boundAttempt,
    1000,
    { 1: "a", 2: "b" },
  );
  assert.equal(
    missing.quality,
    "partial",
    "An answered question without observations cannot be complete observation",
  );
  for (const invalidValue of [NaN, Infinity, -1, "100", 1001]) {
    const value = learning.normalizeAnalytics(
      analytics({ 1: completeItem({ activeMs: invalidValue }) }),
      boundAttempt,
      1000,
    );
    assert.equal(value.questions[1], undefined);
    assert.equal(value.quality, "partial");
  }
  const overTotal = learning.normalizeAnalytics(
    analytics({
      1: completeItem({ activeMs: 9000 }),
      2: completeItem({ activeMs: 9000 }),
    }),
    boundAttempt,
    10000,
  );
  assert.ok(
    overTotal === null || overTotal.quality === "partial",
    "Total duration exceeding server elapsed time must be unavailable or partial",
  );
  const impossibleTimes = learning.normalizeAnalytics(
    analytics({
      1: completeItem({ firstResponseMs: 80, finalResponseMs: 20 }),
    }),
    boundAttempt,
    1000,
  );
  assert.equal(impossibleTimes.questions[1].firstResponseMs, null);
  assert.equal(impossibleTimes.questions[1].finalResponseMs, null);
  assert.equal(impossibleTimes.quality, "partial");
  const unspecifiedTimes = learning.normalizeAnalytics(
    analytics({
      1: completeItem({
        firstResponseMs: undefined,
        finalResponseMs: undefined,
      }),
    }),
    boundAttempt,
    1000,
  );
  assert.equal(unspecifiedTimes.questions[1].firstResponseMs, null);
  assert.equal(unspecifiedTimes.questions[1].quality, "partial");
  const emptyTimes = learning.normalizeAnalytics(
    analytics({
      1: completeItem({ firstResponseMs: null, finalResponseMs: null }),
    }),
    boundAttempt,
    1000,
  );
  assert.equal(emptyTimes.questions[1].firstResponseMs, null);
  const unsafeKeys = analytics(
    JSON.parse('{"__proto__":{},"constructor":{},"prototype":{}}'),
  );
  assert.deepEqual(
    learning.normalizeAnalytics(unsafeKeys, boundAttempt, 1000).questions,
    {},
  );

  const normalized = learning.normalizeQuestionLearning({
    concepts: [
      "  개념  ",
      "개념",
      1,
      ...Array.from({ length: 12 }, (_, i) => `개념${i}`),
    ],
    cognitiveProcess: "a".repeat(100),
    familyId: "f".repeat(200),
    derivedFromQuestionId: "q".repeat(200),
    misconceptionTags: {
      선지: "  혼동 가능성  ",
      ["x".repeat(501)]: "invalid",
      blank: " ",
    },
    reviewLessonId: "l".repeat(200),
  });
  assert.equal(normalized.concepts.length, 8);
  assert.equal(normalized.concepts[0], "개념");
  assert.equal(normalized.cognitiveProcess.length, 60);
  assert.equal(normalized.familyId.length, 160);
  assert.equal(normalized.derivedFromQuestionId.length, 160);
  assert.equal(normalized.reviewLessonId.length, 160);
  assert.deepEqual(normalized.misconceptionTags, { 선지: "혼동 가능성" });
  const snap = learning.questionLearningSnapshot({
    path: "quiz_questions/q1",
    data: { id: 1, contentRevision: 4, refSmall: "small", concepts: ["개념"] },
  });
  assert.equal(snap.id, "1");
  assert.equal(snap.sourceRevision, "4");
  assert.equal(snap.refSmall, "small");
  const maximumMetadata = learning.questionLearningSnapshot({
    path: "quiz_questions/q1",
    data: {
      id: "가".repeat(160),
      unitId: "가".repeat(160),
      subUnitId: "가".repeat(160),
      refBig: "가".repeat(160),
      refMid: "가".repeat(160),
      refSmall: "가".repeat(160),
      concepts: Array.from(
        { length: 8 },
        (_, index) => String(index) + "가".repeat(59),
      ),
      familyId: "가".repeat(160),
      derivedFromQuestionId: "가".repeat(160),
      reviewLessonId: "가".repeat(160),
      misconceptionTags: Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          String(index) + "가".repeat(499),
          "가".repeat(120),
        ]),
      ),
    },
  });
  assert.ok(Buffer.byteLength(JSON.stringify(maximumMetadata), "utf8") <= 2048);
  assert.equal(maximumMetadata.metadataLimited, true);
  assert.equal(maximumMetadata.id, "가".repeat(160));

  const source = {
    answerKey: [1, 2, 3, 4].map((id) => ({ id: String(id) })),
    learningSnapshot: [
      { id: "1", concepts: ["개념A"] },
      { id: "2", concepts: ["개념A"] },
      { id: "3", concepts: ["개념B"] },
      { id: "4", concepts: ["개념B"] },
    ],
  };
  const prior = [
    {
      status: "SUBMITTED",
      submittedAtIso: "2026-10-01",
      questionIds: ["1", "4"],
      answers: { 1: "오답", 4: "정답" },
      gradingSnapshot: [
        { id: "1", answer: "정답" },
        { id: "4", answer: "정답" },
      ],
      learningSnapshot: source.learningSnapshot,
    },
  ];
  assert.deepEqual(
    [...learning.rankLearningCandidates(source, prior)],
    [
      ["1", 2],
      ["2", 0],
      ["3", 1],
      ["4", 3],
    ],
  );
  const latestCorrect = {
    ...prior[0],
    submittedAtIso: "2026-10-02",
    questionIds: ["1"],
    gradingSnapshot: [{ id: "1", answer: "정답" }],
    answers: { 1: "정답" },
  };
  assert.equal(
    learning.rankLearningCandidates(source, [latestCorrect, ...prior]).get("2"),
    1,
    "Latest answer replaces older error",
  );
  assert.equal(
    learning
      .rankLearningCandidates(source, [
        ...prior,
        {
          ...latestCorrect,
          analytics: analytics({ 1: completeItem({ confidence: "unsure" }) }),
        },
      ])
      .get("2"),
    1,
    "Legacy uncertainty does not prioritize new questions",
  );
  assert.equal(
    learning
      .rankLearningCandidates(source, [
        ...prior,
        {
          ...latestCorrect,
          analytics: analytics({ 1: completeItem({ hintViewed: true }) }),
        },
      ])
      .get("2"),
    0,
    "A correct response with a hint still needs an independent question",
  );
};

const runQuestionSnapshotCases = () => {
  const doc = (id, value = {}) => ({ path: `quiz_questions/${id}`, data: {id, type: "choice", question: "  당시 발문\n원문 공백  ", options: ["하나", "둘"], answer: "둘", explanation: "당시 해설", passage: "자료", image: "https://example.invalid/source.png", hintEnabled: true, hint: "참고", privateNote: "never expose", ...value} });
  const documents = [doc("1"), doc("2", {type: "matching", answer: "왕=>조선||장군=>고려", matchingPairs: [{left: "왕", right: "조선"}, {left: "장군", right: "고려", rightImage: "image"}]}), doc("3", {type: "order", options: undefined, answer: "다||가||나"})];
  const captured = learning.captureQuestionSnapshots(documents, ["1", "2", "3"], {});
  assert.equal(captured.questionSnapshots[0].question, documents[0].data.question, "Original source must not be trimmed");
  assert.equal("privateNote" in captured.questionSnapshots[0], false);
  const presentation = learning.questionPresentation(captured.questionSnapshots);
  for (const item of presentation) for (const key of ["answer", "explanation", "matchingPairs"]) assert.equal(key in item, false, `${key} cannot be sent before submission`);
  assert.deepEqual(presentation[1].matchingLeftOptions, ["왕", "장군"]);
  assert.deepEqual(presentation[1].matchingRightOptions.map(item => item.right), ["고려", "조선"]);
  assert.deepEqual(presentation[2].options, ["가", "나", "다"]);
  assert.deepEqual(captured.questionSnapshots[2].options, ["다", "가", "나"]);
  for (const type of ["choice", "ox", "short", "word", "order", "matching"]) {
    const input = doc(type, {type, choiceOptionImages: [null, "option-image"], matchingPairs: [{left: "a", right: "b", rightImage: "matching-image"}], answer: type === "matching" ? "a=>b" : "둘"});
    const bounded = learning.captureQuestionSnapshots([input], [type]);
    const firstPresentation = learning.questionPresentation(bounded.questionSnapshots);
    assert.deepEqual(learning.questionPresentation(structuredClone(bounded.questionSnapshots)), firstPresentation, `${type}: restore uses the same presentation`);
    assert.equal(firstPresentation[0].type, type);
    assert.deepEqual(firstPresentation[0].choiceOptionImages, [null, "option-image"]);
    assert.equal(firstPresentation[0].image, input.data.image);
    assert.equal(firstPresentation[0].passage, input.data.passage);
    assert.equal(firstPresentation[0].hint, input.data.hint);
    if (type === "matching") assert.equal(firstPresentation[0].matchingRightOptions[0].rightImage, "matching-image");
    else assert.deepEqual(firstPresentation[0].options, type === "order" ? [...input.data.options].sort() : input.data.options);
  }
  const huge = learning.captureQuestionSnapshots([doc("huge", {passage: "가".repeat(20000)}), ...documents], ["huge", "1"], {});
  assert.deepEqual(huge.questionSnapshotOmittedIds, ["huge"]);
  assert.deepEqual(huge.questionSnapshots.map(item => item.id), ["1"], "An oversized item must not prevent another complete snapshot");
  const manyDocs = Array.from({length: 200}, (_, index) => doc(String(index), {passage: "x".repeat(20000)}));
  const bounded = learning.captureQuestionSnapshots(manyDocs, manyDocs.map(item => String(item.data.id)), {});
  assert.ok(Buffer.byteLength(JSON.stringify(bounded.questionSnapshots), "utf8") <= 128 * 1024);
  assert.ok(bounded.questionSnapshotOmittedIds.length > 0);
  const fullBase = learning.captureQuestionSnapshots(documents, ["1"], {reserved: "x".repeat(750000)});
  assert.deepEqual(fullBase.questionSnapshots, []);
  assert.deepEqual(fullBase.questionSnapshotOmittedIds, ["1"]);
};

const runLifecycleCases = async () => {
  const semesterId = "2026-2",
    studentUid = "student-uid",
    definitionId = "quiz:2026-2:learning:formative";
  let nowMs = Date.parse("2026-10-15T00:00:00Z"),
    commands = 1,
    rewardApplications = 0;
  const rewardPercents = [];
  const seed = {
    "site_settings/config": {
      year: "2026",
      semester: "2",
      activeSemesterId: semesterId,
    },
    "site_settings/semester_active": { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: {
      semesterId,
      status: "ACTIVE",
      revision: 1,
      schemaVersion: 1,
      readinessPolicyVersion: "w3-v1",
    },
    "users/admin-uid": { role: "admin", teacherPortalEnabled: true },
    [`users/${studentUid}`]: { role: "student" },
    [`student_identities/${studentUid}`]: { studentUid },
    "semester_classes/class_one": {
      classId: "class_one",
      semesterId,
      grade: "3",
      classNumber: "1",
      status: "ACTIVE",
    },
    "semester_enrollments/enrollment_one": {
      enrollmentId: "enrollment_one",
      semesterId,
      studentUid,
      classId: "class_one",
      enrollmentStatus: "ACTIVE",
    },
    [`semester_enrollment_slots/${buildEnrollmentSlotId(semesterId, studentUid)}`]:
      { semesterId, studentUid, activeEnrollmentId: "enrollment_one" },
  };
  for (const id of [1, 2, 3, 4])
    seed[`years/2026/semesters/2/quiz_questions/q${id}`] = {
      id,
      unitId: "learning",
      subUnitId: "small",
      category: "formative",
      type: "choice",
      question: `합성 문항 ${id}`,
      answer: "정답",
      options: ["정답", "오답"],
      concepts: ["같은 개념"],
      cognitiveProcess: "자료 해석",
      familyId: "family",
      reviewLessonId: "lesson",
      misconceptionTags: { 오답: "혼동 가능성" },
    };
  const store = new MemoryStore(seed);
  const adapter = assessment.createAssessmentCommandAdapter({
    now: () => new Date(nowMs),
    wisRewards: {
      prepare: async ({ percent }) => {
        rewardPercents.push(percent);
        return {
          refs: [],
          result: {
            status: "DISABLED",
            awarded: false,
            amount: 0,
            bonusAmount: 0,
            totalAwarded: 0,
          },
          apply() {
            rewardApplications++;
          },
        };
      },
    },
  });
  const core = commandGateway.createCommandGatewayCore({
    store,
    serverTimestamp: () => ({ __serverTimestamp: nowMs }),
    projectId: "demo-westory-learning",
    assertSession: async (request, options) => ({
      uid: request.auth.uid,
      email: request.auth.token.email,
      sessionId: `session-${request.auth.uid}`,
      schemaVersion: 2,
      revision: 1,
      expiresAtMs: nowMs + 3600000,
      recentAuth: options.recentAuth,
    }),
    authorizeCommand: async ({ request, commandType }) => ({
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email,
      actorRole: request.auth.uid === studentUid ? "student" : "admin",
      actorCapability: `test:${commandType}`,
    }),
    commandAdapters: Object.fromEntries(
      Object.values(assessment.ASSESSMENT_COMMAND_TYPES).map((type) => [
        type,
        adapter,
      ]),
    ),
    getSessionOptions: (type) => ({
      recentAuth: !assessment.STUDENT_COMMAND_TYPES.has(type),
      highRisk: !assessment.STUDENT_COMMAND_TYPES.has(type),
    }),
  });
  const student = { uid: studentUid, token: { email: "student@example.test" } },
    admin = { uid: "admin-uid", token: { email: "admin@example.test" } };
  const nextId = () =>
    `00000000-0000-4000-8000-${String(commands++).padStart(12, "0")}`;
  const execute = (auth, commandType, payload, commandId = nextId()) =>
    core.execute({ auth, data: { commandId, commandType, payload } });
  const query = assessment.createAssessmentQueryCore({
    store,
    serverTimestamp: () => ({ __serverTimestamp: nowMs }),
    now: () => new Date(nowMs),
    assertSession: async (request) => ({ uid: request.auth.uid }),
  });
  const compatibleQuestion = {
    id: "meta",
    unitId: "other-unit",
    category: "formative",
    type: "choice",
    question: "구형 편집 호환",
    answer: "정답",
    options: ["정답", "오답"],
  };
  await execute(admin, "upsertQuizQuestion", {
    semesterId,
    questionId: "meta",
    question: {
      ...compatibleQuestion,
      concepts: ["보존할 개념"],
      cognitiveProcess: "사료 해석",
    },
    expectedRevision: 0,
    reason: "synthetic metadata create",
  });
  await execute(admin, "upsertQuizQuestion", {
    semesterId,
    questionId: "meta",
    question: { ...compatibleQuestion, question: "구형 편집으로 발문 수정" },
    expectedRevision: 1,
    reason: "synthetic old-client edit",
  });
  assert.deepEqual(
    store.documents.get("years/2026/semesters/2/quiz_questions/meta").concepts,
    ["보존할 개념"],
    "An older editor must not erase existing learning metadata",
  );
  await execute(admin, "createAssessmentDefinition", {
    definitionId,
    semesterId,
    assessmentKind: "QUIZ",
    title: "합성 평가",
    sourceId: "learning",
    category: "formative",
    questionCount: 1,
    legacyConfigKey: "learning::formative",
    presentationSettings: {
      active: true,
      questionCount: 1,
      randomOrder: true,
      questionOrder: "random",
      timeLimit: 600,
      allowRetake: true,
      cooldown: 0,
      hintLimit: 0,
      visibleTargetGrade: "3",
      visibleClassIds: ["3-1"],
      visibilityVersion: 2,
    },
    durationSeconds: 600,
    maxAttempts: 20,
    cooldownMinutes: 0,
    opensAt: "",
    closesAt: "",
    assignedClassIds: ["3-1"],
  });
  await execute(admin, "transitionAssessmentDefinition", {
    definitionId,
    expectedRevision: 1,
    targetStatus: "PUBLISHED",
    reason: "synthetic verification",
  });
  const first = (
    await execute(student, "startAssessmentAttempt", { definitionId })
  ).result;
  const firstId = first.questionIds[0];
  assert.equal(first.questionIds.length, 1);
  assert.equal(first.questionPresentation[0].question, `합성 문항 ${firstId}`);
  assert.equal("questionSnapshots" in first, false);
  assert.equal("answer" in first.questionPresentation[0], false);
  assert.equal("explanation" in first.questionPresentation[0], false);
  const originalQuestionSnapshots = structuredClone(store.documents.get(`semester_assessment_attempts/${first.attemptId}`).questionSnapshots);
  assert.equal(originalQuestionSnapshots[0].answer, "정답");
  const startSnapshot = structuredClone(
    store.documents.get(`semester_assessment_attempts/${first.attemptId}`)
      .learningSnapshot,
  );
  assert.deepEqual(startSnapshot[0].concepts, ["같은 개념"]);
  nowMs += 10000;
  const rawAnalytics = analytics({ [firstId]: completeItem() });
  const progress = {
    attemptId: first.attemptId,
    expectedRevision: 1,
    answers: { [firstId]: "오답" },
    currentItemId: firstId,
    saveId: "progress-one",
    analytics: rawAnalytics,
  };
  const saved = await query.saveAssessmentProgress({
    auth: student,
    data: progress,
  });
  const savedState = structuredClone(
    store.documents.get(`semester_assessment_attempts/${first.attemptId}`),
  );
  const writesBeforeReplay = store.writes;
  const replay = await query.saveAssessmentProgress({
    auth: student,
    data: progress,
  });
  assert.equal(replay.replayed, true);
  assert.equal(store.writes, writesBeforeReplay);
  assert.deepEqual(
    store.documents.get(`semester_assessment_attempts/${first.attemptId}`)
      .analytics,
    savedState.analytics,
  );
  assert.equal(saved.revision, 2);

  // Post-start bank edits cannot rewrite the submitted diagnostic snapshot.
  store.documents.get(
    `years/2026/semesters/2/quiz_questions/q${firstId}`,
  ).concepts = ["나중 분류"];
  const changedBankQuestion = store.documents.get(`years/2026/semesters/2/quiz_questions/q${firstId}`);
  changedBankQuestion.question = "응시 시작 뒤 바뀐 발문";
  changedBankQuestion.answer = "바뀐 정답";
  changedBankQuestion.explanation = "바뀐 해설";
  const resumedAttempt = (await execute(student, "startAssessmentAttempt", {definitionId})).result;
  assert.deepEqual(resumedAttempt.questionPresentation, first.questionPresentation, "Resume uses frozen presentation after bank edits");
  assert.equal("answer" in resumedAttempt.questionPresentation[0], false);
  const queriedAttempt = await query.getAssessmentState({auth: student, data: {attemptId: first.attemptId}});
  assert.deepEqual(queriedAttempt.attempt.questionPresentation, first.questionPresentation);
  assert.equal("questionSnapshots" in queriedAttempt.attempt, false);
  const submitPayload = {
    attemptId: first.attemptId,
    expectedRevision: 2,
    answers: progress.answers,
    submitReason: "STUDENT",
    analytics: rawAnalytics,
  };
  const commandId = nextId();
  const submitted = (
    await execute(student, "submitAssessmentAttempt", submitPayload, commandId)
  ).result;
  const result = store.documents.get(
    `semester_assessment_results/${first.attemptId}`,
  );
  assert.equal(submitted.percent, 0);
  assert.deepEqual(result.questionSnapshots, originalQuestionSnapshots);
  assert.deepEqual(submitted.questionSnapshots, originalQuestionSnapshots);
  assert.equal(submitted.questionSnapshots[0].answer, "정답");
  changedBankQuestion.answer = "정답";
  assert.equal(result.analytics.questions[firstId].activeMs, 100);
  assert.deepEqual(result.learningSnapshot, startSnapshot);
  assert.deepEqual(
    store.documents.get(`semester_assessment_submissions/${first.attemptId}`)
      .analytics,
    result.analytics,
  );
  const rewardsBeforeReplay = rewardApplications;
  const repeatedSubmit = (await execute(student, "submitAssessmentAttempt", submitPayload, commandId)).result;
  assert.deepEqual(repeatedSubmit.questionSnapshots, originalQuestionSnapshots);
  const replayDifferentCommand = (await execute(student, "submitAssessmentAttempt", submitPayload)).result;
  assert.deepEqual(replayDifferentCommand.questionSnapshots, originalQuestionSnapshots, "New replay command returns the immutable result source");
  assert.equal(rewardApplications, rewardsBeforeReplay);
  assert.deepEqual(
    rewardPercents,
    [0],
    "Telemetry must not change grading or repeat reward evaluation",
  );

  // Snapshot overflow is optional and must not block start, save or scoring.
  for (const id of [1, 2, 3, 4]) store.documents.get(`years/2026/semesters/2/quiz_questions/q${id}`).passage = "가".repeat(20000);
  // A retry selects another question while preserving the authorized pool/count.
  const retry = (
    await execute(student, "startAssessmentAttempt", { definitionId })
  ).result;
  assert.equal(retry.questionIds.length, 1);
  assert.deepEqual(retry.questionPresentation, []);
  assert.deepEqual(retry.questionSnapshotOmittedIds, retry.questionIds);
  assert.notEqual(retry.questionIds[0], firstId);
  assert.ok(["1", "2", "3", "4"].includes(retry.questionIds[0]));
  nowMs += 10000;
  const invalidSubmitted = (
    await execute(student, "submitAssessmentAttempt", {
      attemptId: retry.attemptId,
      expectedRevision: 1,
      answers: { [retry.questionIds[0]]: "정답" },
      submitReason: "STUDENT",
      analytics: { version: 1, questions: new Array(1000) },
    })
  ).result;
  assert.equal(
    invalidSubmitted.percent,
    100,
    "Malformed optional analytics must not block the correct answer",
  );
  assert.equal(
    store.documents.get(`semester_assessment_results/${retry.attemptId}`)
      .analytics,
    null,
  );
  assert.deepEqual(invalidSubmitted.questionSnapshots, []);
  assert.deepEqual(invalidSubmitted.questionSnapshotOmittedIds, retry.questionIds);
  for (const id of [1, 2, 3, 4]) delete store.documents.get(`years/2026/semesters/2/quiz_questions/q${id}`).passage;
  const oversizedAttempt = (
    await execute(student, "startAssessmentAttempt", { definitionId })
  ).result;
  const oversized = analytics(
    Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [`q${index}`, completeItem()]),
    ),
  );
  const oversizedSave = await query.saveAssessmentProgress({
    auth: student,
    data: {
      attemptId: oversizedAttempt.attemptId,
      expectedRevision: 1,
      answers: { [oversizedAttempt.questionIds[0]]: "정답" },
      currentItemId: oversizedAttempt.questionIds[0],
      saveId: "oversized-observations",
      analytics: oversized,
    },
  });
  assert.equal(
    oversizedSave.revision,
    2,
    "Oversized observations cannot block answer autosave",
  );
  const oversizedSubmit = (
    await execute(student, "submitAssessmentAttempt", {
      attemptId: oversizedAttempt.attemptId,
      expectedRevision: 2,
      answers: { [oversizedAttempt.questionIds[0]]: "정답" },
      submitReason: "STUDENT",
      analytics: oversized,
    })
  ).result;
  assert.equal(
    oversizedSubmit.percent,
    100,
    "Oversized observations cannot block answer submission",
  );
  assert.equal(
    store.documents.get(
      `semester_assessment_results/${oversizedAttempt.attemptId}`,
    ).analytics,
    null,
  );
  const old = (
    await execute(student, "startAssessmentAttempt", { definitionId })
  ).result;
  // Previous attempts have no diagnostic fields and must still submit normally.
  delete store.documents.get(`semester_assessment_attempts/${old.attemptId}`).questionSnapshots;
  delete store.documents.get(`semester_assessment_attempts/${old.attemptId}`).questionSnapshotOmittedIds;
  const legacyQuery = await query.getAssessmentState({auth: student, data: {attemptId: old.attemptId}});
  assert.equal(legacyQuery.attempt.questionPresentation.length, old.questionIds.length, "Legacy attempt presentation is restored without exposing the bank");
  assert.ok(legacyQuery.attempt.questionPresentation.every(item => !("answer" in item) && !("explanation" in item)));
  assert.equal("questionSnapshots" in store.documents.get(`semester_assessment_attempts/${old.attemptId}`), false, "Response fallback must not rewrite historical snapshots");
  delete store.documents.get(`semester_assessment_attempts/${old.attemptId}`)
    .learningSnapshot;
  await execute(student, "submitAssessmentAttempt", {
    attemptId: old.attemptId,
    expectedRevision: 1,
    answers: {},
    submitReason: "STUDENT",
  });
  assert.equal(
    store.documents.get(`semester_assessment_results/${old.attemptId}`)
      .analytics,
    null,
  );
  assert.deepEqual(
    store.documents.get(`semester_assessment_results/${old.attemptId}`)
      .learningSnapshot,
    [],
  );
  assert.equal("questionSnapshots" in store.documents.get(`semester_assessment_results/${old.attemptId}`), false, "Legacy absence must not be repaired with the current bank");
  assert.deepEqual(rewardPercents, [0, 100, 100, 0]);
};

const runPresentationOrderCases = async () => {
  const { createHash } = require("node:crypto");
  const { canonicalDetail } = require("../../studentQuizHistory");
  const semesterId = "2026-2", studentUid = "order-student";
  const definitionId = "quiz:2026-2:order-unit:formative";
  const ids = ["2", "4", "10", "21", "30"];
  const unitById = { 2: "small-a", 4: "small-b", 10: "small-b", 21: "small-a", 30: "small-a" };
  const rank = id => createHash("sha256").update(`${studentUid}\n${definitionId}\n1\n${id}`).digest("hex");
  const selected = [...ids].sort((a, b) => rank(a).localeCompare(rank(b))).slice(0, 4);
  for (const mode of ["random", "created", "unit", "legacy-created"]) {
    const seed = {
      [`users/${studentUid}`]: { role: "student" },
      "site_settings/semester_active": { semesterId, revision: 1 },
      [`semester_manifests/${semesterId}`]: { semesterId, status: "ACTIVE", revision: 1 },
      "semester_classes/class_order": { classId: "class_order", semesterId, grade: "3", classNumber: "1", status: "ACTIVE" },
      "semester_enrollments/order-enrollment": { semesterId, studentUid, enrollmentId: "order-enrollment", classId: "class_order", enrollmentStatus: "ACTIVE" },
      [`semester_enrollment_slots/${buildEnrollmentSlotId(semesterId, studentUid)}`]: { semesterId, studentUid, activeEnrollmentId: "order-enrollment" },
      "years/2026/semesters/2/curriculum/tree": { tree: [{ id: "order-unit", children: [{ id: "small-b" }, { id: "small-a" }] }] },
    };
    for (const id of ids) seed[`years/2026/semesters/2/quiz_questions/q${id}`] = {
      id: Number(id), unitId: "order-unit", subUnitId: unitById[id], category: "formative",
      type: "choice", question: `Frozen question ${id}`, answer: `Answer ${id}`, options: [`Answer ${id}`, "Other"],
    };
    const store = new MemoryStore(seed);
    const now = () => new Date("2026-10-26T01:00:00Z");
    let commandNumber = 0;
    const adapter = assessment.createAssessmentCommandAdapter({ now,
      wisRewards: { prepare: async () => ({ refs: [], result: { awarded: false }, apply() {} }) } });
    const apply = async (commandType, payload, role = "student") => (await store.runTransaction(transaction => adapter.apply({
      transaction, commandType, payload, actor: { actorUid: role === "student" ? studentUid : "order-teacher", actorRole: role },
      commandId: `order-${++commandNumber}`, receiptId: `receipt-${commandNumber}`, timestamp: { seconds: now().getTime() / 1000 },
    }))).result;
    await apply("createAssessmentDefinition", {
      definitionId, semesterId, assessmentKind: "QUIZ", title: "Order fixture", sourceId: "order-unit", category: "formative",
      questionCount: 4, durationSeconds: 600, maxAttempts: 2, cooldownMinutes: 0, assignedClassIds: ["class_order"],
      legacyConfigKey: "order-unit::formative", presentationSettings: mode === "legacy-created" ? { randomOrder: false } : { questionOrder: mode },
    }, "teacher");
    await apply("transitionAssessmentDefinition", { definitionId, expectedRevision: 1, targetStatus: "PUBLISHED", reason: "test" }, "teacher");
    const first = await apply("startAssessmentAttempt", { definitionId });
    const expected = mode === "random" ? selected : [...selected].sort((a, b) =>
      mode === "unit" ? Number(unitById[a] === "small-a") - Number(unitById[b] === "small-a") || Number(a) - Number(b) : Number(a) - Number(b));
    assert.deepEqual(first.questionIds, expected, `${mode}: freeze the configured order after selecting the same question set`);
    assert.deepEqual([...first.questionIds].sort(), [...selected].sort(), `${mode}: ordering cannot change the selected set`);
    assert.deepEqual(first.questionPresentation.map(q => q.id), expected);
    const rawAttempt = store.documents.get(`semester_assessment_attempts/${first.attemptId}`);
    assert.deepEqual(rawAttempt.gradingSnapshot.map(q => q.id), expected);
    assert.deepEqual(rawAttempt.questionSnapshots.map(q => q.id), expected);
    const query = assessment.createAssessmentQueryCore({ store, now, serverTimestamp: () => ({ seconds: now().getTime() / 1000 }),
      assertSession: async request => ({ uid: request.auth.uid }) });
    const answers = Object.fromEntries(expected.map((id, index) => [id, index === 1 ? "Other" : `Answer ${id}`]));
    await query.saveAssessmentProgress({ auth: { uid: studentUid }, data: {
      attemptId: first.attemptId, expectedRevision: 1, answers, currentItemId: expected[2], saveId: `saved-${mode}`,
    } });
    // Changing current settings and curriculum cannot reorder an existing attempt.
    store.documents.get(`semester_assessment_definitions/${definitionId}`).presentationSettings = { questionOrder: mode === "created" ? "random" : "created" };
    store.documents.set("years/2026/semesters/2/curriculum/tree", { tree: [{ id: "small-a" }, { id: "small-b" }] });
    const resumed = await apply("startAssessmentAttempt", { definitionId });
    assert.deepEqual(resumed.questionIds, expected);
    assert.equal(resumed.currentItemId, expected[2]);
    const restored = (await query.getAssessmentState({ auth: { uid: studentUid }, data: { attemptId: first.attemptId } })).attempt;
    assert.deepEqual(restored.questionIds, expected);
    assert.deepEqual(restored.questionPresentation.map(q => q.id), expected);
    assert.deepEqual(restored.answers, answers);
    for (const id of ids) store.documents.get(`years/2026/semesters/2/quiz_questions/q${id}`).question = "Edited current bank";
    const submitted = await apply("submitAssessmentAttempt", { attemptId: first.attemptId, expectedRevision: restored.revision, answers, submitReason: "MANUAL" });
    assert.equal(submitted.percent, 75);
    assert.deepEqual(submitted.answerChecks.map(q => q.id), expected);
    assert.deepEqual(submitted.questionSnapshots.map(q => q.id), expected);
    const result = store.documents.get(`semester_assessment_results/${first.attemptId}`);
    const history = canonicalDetail(first.attemptId, result, answers);
    assert.deepEqual(history.details.map(q => q.id), expected);
    assert.deepEqual(history.details.map(q => q.questionSnapshot.question), expected.map(id => `Frozen question ${id}`));
    assert.deepEqual(history.details.map(q => q.u), expected.map(id => answers[id]));
    assert.equal(history.details[1].correct, false);
    const replayed = await apply("submitAssessmentAttempt", { attemptId: first.attemptId, expectedRevision: restored.revision, answers, submitReason: "MANUAL" });
    assert.deepEqual(replayed.answerChecks, submitted.answerChecks);
    assert.deepEqual(replayed.questionSnapshots, submitted.questionSnapshots);
  }
};

(async () => {
  runNormalizerCases();
  runQuestionSnapshotCases();
  await runLifecycleCases();
  await runPresentationOrderCases();
  console.log(
    JSON.stringify({
      suite: "assessment-learning",
      passed: true,
      productionAccess: 0,
      cases: [
        "OPTIONAL_MALFORMED_AND_OVERSIZED_ANALYTICS",
        "QUESTION_ALLOWLIST_AND_DURATION_BOUNDS",
        "UNANSWERED_AND_MISSING_TIMES_NULL",
        "PARTIAL_OBSERVATION_NOT_COMPLETE",
        "QUESTION_METADATA_NORMALIZATION",
      "FROZEN_QUESTION_SNAPSHOTS_NO_PRE_SUBMIT_ANSWER_OR_PAIRING_LEAK",
      "OVERSIZED_SNAPSHOT_OMISSION_WITHOUT_TRUNCATION_OR_ANSWER_FAILURE",
      "SNAPSHOT_RESUME_BANK_EDIT_AND_RESULT_REPLAY_PRESERVATION",
        "LATEST_CONCEPT_ANSWER_IGNORES_LEGACY_SELF_REPORTS",
        "UNSEEN_WEAK_CONCEPT_THEN_UNSEEN_THEN_WRONG_REPEAT",
        "SAVE_REPLAY_NO_ACCUMULATION",
        "IMMUTABLE_METADATA_SNAPSHOT",
        "SUBMISSION_AND_RESULT_OBSERVATION_PRESERVATION",
        "GRADING_AND_REWARD_UNCHANGED",
        "LEGACY_ATTEMPT_COMPATIBILITY",
        "FROZEN_RANDOM_CREATED_UNIT_ORDER_THROUGH_RESUME_SUBMISSION_AND_HISTORY",
        "ORDER_SETTINGS_KEEP_SELECTION_GRADING_AND_REWARD_POLICY",
      ],
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
