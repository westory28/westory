const assert = require("node:assert/strict");

const commandGateway = require("../commandGateway");
const assessment = require("../assessmentLifecycle");
const archiveEnrollment = require("../archiveEnrollment");

const clone = (value) => structuredClone(value);

class MemoryStore {
  constructor(seed = {}) {
    this.documents = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]));
    this.writeCount = 0;
    this.queue = Promise.resolve();
  }

  snapshot(path) {
    const exists = this.documents.has(path);
    return { exists, path, data: exists ? clone(this.documents.get(path)) : null };
  }

  async get(path) {
    return this.snapshot(path);
  }

  async query(collectionPath, filter = null) {
    const prefix = `${collectionPath}/`;
    return [...this.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .filter(([, data]) => !filter || data?.[filter.field] === filter.value)
      .map(([path, data]) => ({ exists: true, path, data: clone(data) }));
  }

  async runTransaction(callback) {
    let release;
    const previous = this.queue;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const staged = new Map(this.documents);
    let localWrites = 0;
    const read = (path) => {
      const exists = staged.has(path);
      return { exists, path, data: exists ? clone(staged.get(path)) : null };
    };
    const query = async (collectionPath, filter = null) => {
      const prefix = `${collectionPath}/`;
      return [...staged.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .filter(([, data]) => !filter || data?.[filter.field] === filter.value)
        .map(([path, data]) => ({ exists: true, path, data: clone(data) }));
    };
    const transaction = {
      get: async (path) => read(path),
      getAll: async (paths) => paths.map(read),
      query,
      set: (path, data, options) => {
        const next = options?.merge && staged.has(path)
          ? { ...clone(staged.get(path)), ...clone(data) }
          : clone(data);
        staged.set(path, next);
        localWrites += 1;
      },
      create: (path, data) => {
        if (staged.has(path)) throw new Error(`already exists: ${path}`);
        staged.set(path, clone(data));
        localWrites += 1;
      },
      delete: (path) => {
        staged.delete(path);
        localWrites += 1;
      },
    };
    try {
      const result = await callback(transaction);
      this.documents = staged;
      this.writeCount += localWrites;
      return result;
    } finally {
      release();
    }
  }
}

const semesterId = "2026-2";
const enrollmentSlotId = archiveEnrollment.buildEnrollmentSlotId(
  semesterId,
  "student-uid",
);
const manifest = {
  semesterId,
  status: "ACTIVE",
  revision: 7,
  schemaVersion: 1,
  readinessPolicyVersion: "w3-v1",
};
const seed = {
  "site_settings/config": { year: semesterId.split("-")[0], semester: semesterId.split("-")[1], activeSemesterId: semesterId },
  "site_settings/semester_active": { semesterId, revision: 7 },
  [`semester_manifests/${semesterId}`]: manifest,
  "users/admin-uid": { role: "admin", teacherPortalEnabled: true },
  "users/student-uid": { role: "student" },
  "student_identities/student-uid": { studentUid: "student-uid" },
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
    studentUid: "student-uid",
    classId: "class_one",
    enrollmentStatus: "ACTIVE",
  },
  [`semester_enrollment_slots/${enrollmentSlotId}`]: {
    semesterId,
    studentUid: "student-uid",
    activeEnrollmentId: "enrollment_one",
  },
  "years/2026/semesters/2/quiz_questions/q1": {
    id: 1,
    unitId: "unit-one",
    category: "formative",
    answer: "정답",
  },
  "years/2026/semesters/2/quiz_questions/q2": {
    id: 2,
    unitId: "unit-one",
    category: "formative",
    answer: "2",
  },
  "years/2026/semesters/2/history_classrooms/history-one": {
    title: "역사교실",
    isPublished: true,
    targetStudentUids: ["student-uid"],
    blanks: [
      { id: "blank-1", answer: "고려" },
      { id: "blank-2", answer: "조선" },
    ],
  },
  "years/2026/semesters/2/map_resources/map-one": {
    title: "합성 지도",
    pdfBlanks: [],
    answerOptions: [],
    contentRevision: 0,
  },
};

const store = new MemoryStore(seed);
let nowMs = Date.parse("2026-08-11T00:00:00.000Z");
const adapter = assessment.createAssessmentCommandAdapter({
  now: () => new Date(nowMs),
  // Reward integration has its own real Wis/production-planner suite. Keep this
  // lifecycle fixture isolated from financial setup, with an explicit test double.
  wisRewards: { prepare: async () => ({ refs: [], result: { status: "DISABLED", awarded: false, amount: 0, bonusAmount: 0, totalAwarded: 0 }, apply() {} }) },
});
const core = commandGateway.createCommandGatewayCore({
  store,
  serverTimestamp: () => ({ __serverTimestamp: nowMs }),
  projectId: "demo-westory-session-w6a",
  assertSession: async (request, options) => ({
    uid: request.auth.uid,
    email: request.auth.token.email,
    sessionId: `session-${request.auth.uid}`,
    schemaVersion: 2,
    revision: 1,
    expiresAtMs: nowMs + 3_600_000,
    recentAuth: options.recentAuth,
  }),
  authorizeCommand: async ({ request, commandType }) => ({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    actorRole: request.auth.uid === "student-uid" ? "student" : "admin",
    actorCapability: `test:${commandType}`,
  }),
  commandAdapters: Object.fromEntries(
    Object.values(assessment.ASSESSMENT_COMMAND_TYPES).map((type) => [type, adapter]),
  ),
  getSessionOptions: (type) =>
    assessment.STUDENT_COMMAND_TYPES.has(type)
      ? { recentAuth: false, highRisk: false }
      : { recentAuth: true, highRisk: true },
});

const admin = { uid: "admin-uid", token: { email: "admin@example.test" } };
const student = { uid: "student-uid", token: { email: "student@example.test" } };
let commandSequence = 1;
const commandId = () => `00000000-0000-4000-8000-${String(commandSequence++).padStart(12, "0")}`;
const execute = (auth, commandType, payload, id = commandId()) =>
  core.execute({ auth, data: { commandId: id, commandType, payload } });

const definitionPayload = (kind) => ({
  definitionId: kind === "QUIZ" ? "quiz:2026-2:unit-one:formative" : "history_classroom:2026-2:history-one",
  semesterId,
  assessmentKind: kind,
  title: kind === "QUIZ" ? "형성평가" : "역사교실",
  sourceId: kind === "QUIZ" ? "unit-one" : "history-one",
  ...(kind === "QUIZ" ? {
    category: "formative",
    questionCount: 2,
    legacyConfigKey: "unit-one::formative",
    presentationSettings: {
      active: true,
      questionCount: 2,
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
  } : {}),
  durationSeconds: 600,
  maxAttempts: 2,
  cooldownMinutes: 0,
  opensAt: "",
  closesAt: "",
  assignedClassIds: kind === "QUIZ" ? ["3-1"] : [],
});

const runManagementContentCommands = async () => {
  await assert.rejects(
    execute(admin, "createAssessmentDefinition", {
      ...definitionPayload("QUIZ"),
      legacyConfigKey: "__proto__",
    }),
    (error) => error?.details?.reason === "ASSESSMENT_PAYLOAD_INVALID",
  );

  const quizQuestion = {
    id: "q3",
    unitId: "unit-one",
    subUnitId: null,
    category: "formative",
    type: "choice",
    question: "합성 문항",
    answer: "1",
    options: ["1", "2"],
    explanation: "",
  };
  const questionSaved = await execute(admin, "upsertQuizQuestion", {
    semesterId,
    questionId: "q3",
    question: quizQuestion,
    expectedRevision: 0,
    reason: "합성 문항 생성",
  });
  assert.equal(questionSaved.result.contentRevision, 1);
  await assert.rejects(
    execute(admin, "upsertQuizQuestion", {
      semesterId,
      questionId: "q3",
      question: quizQuestion,
      expectedRevision: 0,
      reason: "stale CAS",
    }),
    (error) => error?.details?.reason === "ASSESSMENT_CONTENT_REVISION_CONFLICT",
  );
  await execute(admin, "deleteQuizQuestion", {
    semesterId,
    questionId: "q3",
    expectedRevision: 1,
    reason: "합성 문항 삭제",
  });
  assert.equal(store.snapshot("years/2026/semesters/2/quiz_questions/q3").exists, false);

  const historySaved = await execute(admin, "upsertHistoryClassroomSource", {
    semesterId,
    sourceId: "history-two",
    source: {
      title: "합성 역사교실 2",
      description: "",
      mapResourceId: "map-one",
      mapTitle: "합성 지도",
      pdfPageImages: [],
      pdfRegions: [],
      blanks: [{ id: "blank-1", answer: "정답" }],
      answerOptions: ["정답"],
      timeLimitMinutes: 10,
      cooldownMinutes: 0,
      passThresholdPercent: 80,
      dueWindowDays: 7,
      targetGrade: "3",
      targetClass: "1",
      targetStudentUid: "student-uid",
      targetStudentUids: ["student-uid"],
      targetStudentAccessMap: { "student-uid": true },
      targetStudentName: "합성 학생",
      targetStudentNames: ["합성 학생"],
      targetStudentReasons: {},
      targetStudentNumber: "1",
      isPublished: true,
      publishedAt: "2026-08-11T00:00:00.000Z",
      dueAt: "2026-08-18T00:00:00.000Z",
      retryResetByStudentUid: {},
    },
    expectedRevision: 0,
    reason: "합성 역사교실 생성",
  });
  assert.equal(historySaved.result.contentRevision, 1);
  const historyDeleted = await execute(admin, "deleteHistoryClassroomSource", {
    semesterId,
    sourceId: "history-two",
    expectedRevision: 1,
    reason: "합성 역사교실 삭제",
  });
  assert.equal(historyDeleted.result.contentRevision, 2);
  assert.ok(store.snapshot("years/2026/semesters/2/history_classrooms/history-two").data.deletedAt);

  const mapSaved = await execute(admin, "updateMapResourceBlanks", {
    semesterId,
    mapResourceId: "map-one",
    pdfBlanks: [{ id: "blank-one", page: 1, answer: "정답" }],
    answerOptions: ["정답"],
    expectedRevision: 0,
    reason: "합성 지도 빈칸 수정",
  });
  assert.equal(mapSaved.result.contentRevision, 1);

  const originalManifest = clone(store.documents.get(`semester_manifests/${semesterId}`));
  store.documents.set(`semester_manifests/${semesterId}`, {
    ...originalManifest,
    status: "ARCHIVED",
  });
  const writesBeforeArchiveAttempt = store.writeCount;
  await assert.rejects(
    execute(admin, "updateMapResourceBlanks", {
      semesterId,
      mapResourceId: "map-one",
      pdfBlanks: [],
      answerOptions: [],
      expectedRevision: 1,
      reason: "보관 학기 수정 시도",
    }),
    (error) => error?.details?.reason === "ASSESSMENT_SEMESTER_NOT_ACTIVE",
  );
  assert.equal(store.writeCount, writesBeforeArchiveAttempt);
  store.documents.set(`semester_manifests/${semesterId}`, originalManifest);
};

const runKind = async (kind) => {
  const definition = definitionPayload(kind);
  const create = await execute(admin, "createAssessmentDefinition", definition);
  assert.equal(create.result.definition.status, "DRAFT");
  assert.equal(create.result.definition.revision, 1);
  if (kind === "QUIZ") {
    assert.deepEqual(create.result.definition.assignedClassIds, ["class_one"]);
  }
  const publish = await execute(admin, "transitionAssessmentDefinition", {
    definitionId: definition.definitionId,
    expectedRevision: 1,
    targetStatus: "PUBLISHED",
    reason: "synthetic W6A verification",
  });
  assert.equal(publish.result.status, "PUBLISHED");

  const queryCore = assessment.createAssessmentQueryCore({
    store,
    serverTimestamp: () => ({ __serverTimestamp: nowMs }),
    now: () => new Date(nowMs),
    assertSession: async (request) => ({ uid: request.auth.uid }),
  });
  const writesBeforePreflight = store.writeCount;
  const preflight = await queryCore.getAssessmentState({
    auth: student,
    data: { definitionId: definition.definitionId },
  });
  assert.equal(preflight.status, "READY");
  assert.equal(preflight.attempt, null);
  assert.equal(store.writeCount, writesBeforePreflight, `${kind} preflight must write zero documents`);

  const startId = commandId();
  const startPayload = {
    definitionId: definition.definitionId,
  };
  if (kind === "QUIZ") {
    await assert.rejects(
      execute(student, "startAssessmentAttempt", {
        ...startPayload,
        questionIds: ["1"],
      }),
      (error) => error?.details?.reason === "ASSESSMENT_PAYLOAD_INVALID",
    );
  }
  if (kind === "QUIZ") {
    const questionPath = "years/2026/semesters/2/quiz_questions/q1";
    const originalQuestion = clone(store.documents.get(questionPath));
    store.documents.set(questionPath, { ...originalQuestion, answer: "changed" });
    await assert.rejects(
      execute(student, "startAssessmentAttempt", startPayload),
      (error) => error?.details?.reason === "ASSESSMENT_SOURCE_STALE",
    );
    store.documents.set(questionPath, originalQuestion);
  }
  const activeManifest = clone(store.documents.get(`semester_manifests/${semesterId}`));
  store.documents.set(`semester_manifests/${semesterId}`, {
    ...activeManifest,
    status: "ARCHIVED",
  });
  const writesBeforeArchivedStart = store.writeCount;
  await assert.rejects(
    execute(student, "startAssessmentAttempt", startPayload),
    (error) => error?.details?.reason === "ASSESSMENT_SEMESTER_NOT_ACTIVE",
  );
  assert.equal(store.writeCount, writesBeforeArchivedStart);
  store.documents.set(`semester_manifests/${semesterId}`, activeManifest);
  const [firstStart, replayStart] = await Promise.all([
    execute(student, "startAssessmentAttempt", startPayload, startId),
    execute(student, "startAssessmentAttempt", startPayload, startId),
  ]);
  assert.equal(firstStart.result.attemptId, replayStart.result.attemptId);
  const attemptId = firstStart.result.attemptId;
  assert.equal(
    [...store.documents.values()].filter((value) => value?.attemptId === attemptId).length,
    1,
    `${kind} concurrent start must create one attempt`,
  );

  const answerMap = kind === "QUIZ"
    ? { 1: "정답", 2: "오답" }
    : { "blank-1": "고려", "blank-2": "오답" };
  const save = await queryCore.saveAssessmentProgress({
    auth: student,
    data: {
      attemptId,
      expectedRevision: 1,
      answers: answerMap,
      currentItemId: kind === "QUIZ" ? "2" : "2",
      saveId: `save-${kind.toLowerCase()}`,
    },
  });
  assert.equal(save.revision, 2);
  nowMs += 700_000;
  await assert.rejects(
    queryCore.saveAssessmentProgress({
      auth: student,
      data: {
        attemptId,
        expectedRevision: 2,
        answers: answerMap,
        currentItemId: "2",
        saveId: `late-save-${kind.toLowerCase()}`,
      },
    }),
    (error) => error?.details?.reason === "ASSESSMENT_DEADLINE_EXPIRED",
  );
  nowMs -= 700_000;
  const replaySave = await queryCore.saveAssessmentProgress({
    auth: student,
    data: {
      attemptId,
      expectedRevision: 1,
      answers: answerMap,
      currentItemId: "2",
      saveId: `save-${kind.toLowerCase()}`,
    },
  });
  assert.equal(replaySave.replayed, true);

  const submitId = commandId();
  const submitPayload = {
    attemptId,
    expectedRevision: 2,
    answers: answerMap,
    submitReason: "STUDENT",
  };
  nowMs += 700_000;
  await assert.rejects(
    execute(student, "submitAssessmentAttempt", submitPayload),
    (error) => error?.details?.reason === "ASSESSMENT_DEADLINE_EXPIRED",
  );
  nowMs -= 700_000;
  const [submitted, replayed] = await Promise.all([
    execute(student, "submitAssessmentAttempt", submitPayload, submitId),
    execute(student, "submitAssessmentAttempt", submitPayload, submitId),
  ]);
  assert.equal(submitted.result.percent, 50);
  assert.equal(replayed.result.resultRef, submitted.result.resultRef);
  assert.equal(store.snapshot(`semester_assessment_submissions/${attemptId}`).exists, true);
  assert.equal(store.snapshot(`semester_assessment_results/${attemptId}`).exists, true);

  const afterRelogin = await queryCore.getAssessmentState({
    auth: student,
    data: { definitionId: definition.definitionId },
  });
  assert.equal(afterRelogin.attempt.attemptId, attemptId);
  assert.equal(afterRelogin.attempt.status, "SUBMITTED");
  assert.equal(afterRelogin.attempt.deadlineAtIso, firstStart.result.deadlineAtIso);

  const foreignDefinitionId = definition.definitionId.replace("2026-2", "2027-1");
  store.documents.set(`${assessment.DEFINITION_COLLECTION}/${foreignDefinitionId}`, {
    ...store.snapshot(`${assessment.DEFINITION_COLLECTION}/${definition.definitionId}`).data,
    definitionId: foreignDefinitionId, semesterId: "2027-1",
  });
  await assert.rejects(queryCore.getAssessmentState({ auth: student, data: { definitionId: foreignDefinitionId, attemptId } }),
    error => error?.details?.reason === "ASSESSMENT_QUERY_SCOPE_MISMATCH");
  store.documents.delete(`${assessment.DEFINITION_COLLECTION}/${foreignDefinitionId}`);

  const pointerPath = "site_settings/semester_active";
  const savedPointer = clone(store.documents.get(pointerPath));
  for (const inactiveReason of ["ARCHIVED", "POINTER_CHANGED"]) {
    if (inactiveReason === "ARCHIVED") {
      store.documents.set(`semester_manifests/${semesterId}`, { ...activeManifest, status: "ARCHIVED" });
    } else {
      store.documents.set(pointerPath, { ...savedPointer, semesterId: "2027-1" });
    }
    const writesBefore = store.writeCount;
    const rejectInactive = (promise) => assert.rejects(promise, error => error?.details?.reason === "ASSESSMENT_SEMESTER_NOT_ACTIVE");
    await rejectInactive(queryCore.getAssessmentState({ auth: student, data: { definitionId: definition.definitionId } }));
    await rejectInactive(queryCore.getAssessmentState({ auth: student, data: { attemptId } }));
    await rejectInactive(queryCore.saveAssessmentProgress({ auth: student, data: { attemptId, expectedRevision: 1, answers: answerMap, currentItemId: "2", saveId: `save-${kind.toLowerCase()}` } }));
    await rejectInactive(execute(student, "submitAssessmentAttempt", submitPayload));
    await rejectInactive(execute(admin, "resetAssessmentAttempt", { definitionId: definition.definitionId, studentUid: student.uid, reason: "archive guard verification" }));
    await rejectInactive(execute(admin, "resetAssessmentAttemptsByClassV2", { definitionId: definition.definitionId, classId: "class_one", reason: "archive guard verification" }));
    const teacherRead = await queryCore.getAssessmentState({ auth: admin, data: { definitionId: definition.definitionId } });
    assert.equal(teacherRead.definition.definitionId, definition.definitionId);
    assert.equal(store.writeCount, writesBefore, "Inactive semester reads and denied writes must not mutate data");
    store.documents.set(pointerPath, savedPointer);
    store.documents.set(`semester_manifests/${semesterId}`, activeManifest);
  }


  const boundaryAttempt = await execute(
    student,
    "startAssessmentAttempt",
    startPayload,
  );
  const boundaryDeadlineMs = Date.parse(boundaryAttempt.result.deadlineAtIso);
  nowMs = boundaryDeadlineMs - 1;
  const boundaryMinusOne = await queryCore.saveAssessmentProgress({
    auth: student,
    data: {
      attemptId: boundaryAttempt.result.attemptId,
      expectedRevision: 1,
      answers: answerMap,
      currentItemId: "1",
      saveId: `deadline-minus-one-${kind.toLowerCase()}`,
    },
  });
  assert.equal(boundaryMinusOne.revision, 2);
  nowMs = boundaryDeadlineMs;
  const boundaryExact = await queryCore.saveAssessmentProgress({
    auth: student,
    data: {
      attemptId: boundaryAttempt.result.attemptId,
      expectedRevision: 2,
      answers: answerMap,
      currentItemId: "2",
      saveId: `deadline-exact-${kind.toLowerCase()}`,
    },
  });
  assert.equal(boundaryExact.revision, 3);
  nowMs = boundaryDeadlineMs + 1;
  await assert.rejects(
    queryCore.saveAssessmentProgress({
      auth: student,
      data: {
        attemptId: boundaryAttempt.result.attemptId,
        expectedRevision: 3,
        answers: answerMap,
        currentItemId: "2",
        saveId: `deadline-plus-one-${kind.toLowerCase()}`,
      },
    }),
    (error) => error?.details?.reason === "ASSESSMENT_DEADLINE_EXPIRED",
  );
  nowMs = boundaryDeadlineMs - 600_000;

  await execute(admin, "transitionAssessmentDefinition", {
    definitionId: definition.definitionId,
    expectedRevision: 2,
    targetStatus: "CLOSED",
    reason: "synthetic close verification",
  });
  const writesBeforeClosedStart = store.writeCount;
  await assert.rejects(
    execute(student, "startAssessmentAttempt", startPayload),
    (error) => error?.details?.reason === "ASSESSMENT_NOT_PUBLISHED",
  );
  assert.equal(store.writeCount, writesBeforeClosedStart);
};

(async () => {
  await runManagementContentCommands();
  await runKind("QUIZ");
  await runKind("HISTORY_CLASSROOM");

  const originalManifest = clone(store.documents.get(`semester_manifests/${semesterId}`));
  store.documents.set(`semester_manifests/${semesterId}`, {
    ...originalManifest,
    status: "ARCHIVED",
  });
  const writesBeforeArchivedDefinition = store.writeCount;
  await assert.rejects(
    execute(admin, "updateAssessmentDefinition", {
      ...definitionPayload("QUIZ"),
      expectedRevision: 2,
      reason: "보관 학기 정의 수정 시도",
    }),
    (error) => error?.details?.reason === "ASSESSMENT_SEMESTER_NOT_WRITABLE",
  );
  assert.equal(store.writeCount, writesBeforeArchivedDefinition);
  store.documents.set(`semester_manifests/${semesterId}`, originalManifest);

  const readiness = assessment.createAssessmentReadinessAdapter();
  const checks = await readiness.evaluate({
    transaction: {
      query: (...args) => store.query(...args),
    },
    manifest,
  });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].checkId, "assessment_readiness");
  assert.equal(checks[0].status, "PASS");
  assert.match(checks[0].evidence, /orphanClassRefs=0/);
  assert.match(checks[0].evidence, /duplicateKeys=0/);
  assert.match(checks[0].evidence, /blockingLegacyIssues=0/);

  const classOne = clone(store.documents.get("semester_classes/class_one"));
  store.documents.delete("semester_classes/class_one");
  const missingClassChecks = await readiness.evaluate({
    transaction: { query: (...args) => store.query(...args) },
    manifest,
  });
  assert.equal(missingClassChecks[0].status, "FAIL");
  assert.match(missingClassChecks[0].evidence, /orphanClassRefs=1/);
  store.documents.set("semester_classes/class_one", classOne);

  const duplicatePath = `${assessment.DEFINITION_COLLECTION}/duplicate-logical-key`;
  store.documents.set(duplicatePath, {
    ...clone(store.documents.get(`${assessment.DEFINITION_COLLECTION}/quiz:2026-2:unit-one:formative`)),
    definitionId: "quiz:2026-2:unit-one:formative-duplicate",
  });
  const duplicateChecks = await readiness.evaluate({
    transaction: { query: (...args) => store.query(...args) },
    manifest,
  });
  assert.equal(duplicateChecks[0].status, "FAIL");
  assert.match(duplicateChecks[0].evidence, /duplicateKeys=1/);
  store.documents.delete(duplicatePath);

  store.documents.set(`${assessment.LEGACY_ISSUE_COLLECTION}/open-legacy-assessment`, {
    semesterId,
    status: "OPEN",
  });
  const legacyChecks = await readiness.evaluate({
    transaction: { query: (...args) => store.query(...args) },
    manifest,
  });
  assert.equal(legacyChecks[0].status, "FAIL");
  assert.match(legacyChecks[0].evidence, /blockingLegacyIssues=1/);
  store.documents.delete(`${assessment.LEGACY_ISSUE_COLLECTION}/open-legacy-assessment`);

  const optionalEmptyChecks = await readiness.evaluate({
    transaction: { query: (...args) => store.query(...args) },
    manifest: { ...manifest, semesterId: "2027-1" },
  });
  assert.equal(optionalEmptyChecks[0].status, "PASS");
  assert.match(optionalEmptyChecks[0].evidence, /applicability=NOT_APPLICABLE/);

  const productionQueryCore = assessment.createAssessmentQueryCore({
    store,
    projectId: "history-quiz-yongsin",
    serverTimestamp: () => ({ __serverTimestamp: nowMs }),
    now: () => new Date(nowMs),
    assertSession: async (request) => ({ uid: request.auth.uid }),
  });
  const writesBeforeProductionFaultAttempt = store.writeCount;
  await assert.rejects(
    productionQueryCore.saveAssessmentProgress({
      auth: student,
      data: {
        attemptId: "att_test",
        expectedRevision: 1,
        answers: {},
        currentItemId: "1",
        saveId: "production-fault-injection",
        _testDelayAfterSessionMs: 1,
        _testAuthorizedSignalId: "production-signal",
      },
    }),
    (error) => error?.details?.reason === "TEST_FAULT_INJECTION_FORBIDDEN",
  );
  assert.equal(store.writeCount, writesBeforeProductionFaultAttempt);

  console.log(JSON.stringify({
    suite: "assessment-lifecycle-core",
    passed: true,
    cases: [
      "QUIZ_PREFLIGHT_ZERO_WRITE",
      "HISTORY_PREFLIGHT_ZERO_WRITE",
      "EXPLICIT_START_ONLY",
      "CANONICAL_ENROLLMENT_TARGET",
      "CANONICAL_CLASS_TARGET_RESOLUTION",
      "CLIENT_QUESTION_SELECTION_REJECTED",
      "SOURCE_HASH_STALE_REJECTION",
      "CONCURRENT_START_EFFECT_ONCE",
      "SAVE_REVISION_AND_REPLAY",
      "SERVER_DEADLINE_PRESERVED",
      "SERVER_DEADLINE_MINUS_ONE_ZERO_PLUS_ONE_BOTH_KINDS",
      "SERVER_DEADLINE_TAMPER_REJECTED",
      "CLOSED_AND_ARCHIVED_START_REJECTED_BOTH_KINDS",
      "ATOMIC_SUBMISSION_RESULT_RECEIPT",
      "CONCURRENT_SUBMIT_EFFECT_ONCE",
      "SAME_UID_RELOGIN_RECOVERY",
      "TEACHER_CONTENT_COMMAND_CAS_AND_AUDIT_BOUNDARY",
      "ARCHIVE_SOURCE_AND_DEFINITION_WRITE_FENCE",
      "INACTIVE_SEMESTER_STUDENT_QUERY_SAVE_SUBMIT_RESET_DENIED_BOTH_KINDS",
      "TEACHER_ARCHIVE_QUERY_PRESERVED",
      "LEGACY_CONFIG_KEY_VALIDATION",
      "W6A_REQUIRED_READINESS",
      "W6A_READINESS_CLASS_WINDOW_SCHEMA_DUPLICATE_LEGACY_MATRIX",
      "W6A_OPTIONAL_ASSESSMENT_NOT_APPLICABLE_PASS",
      "W6A_TEST_FAULT_INJECTION_PRODUCTION_FORBIDDEN",
    ],
    productionAccess: 0,
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
