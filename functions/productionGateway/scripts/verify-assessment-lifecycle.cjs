const assert = require("node:assert/strict");

const commandGateway = require("../commandGateway");
const assessment = require("../assessmentLifecycle");
const archiveEnrollment = require("../archiveEnrollment");
const mockProgress = require("../mockExamProgress");

const clone = (value) => structuredClone(value);
const matchesQuery = (data, filter) => !filter || (filter.filters || [filter]).every(clause =>
  clause.operator === "in" ? clause.value.includes(data?.[clause.field]) : data?.[clause.field] === clause.value);

class MemoryStore {
  constructor(seed = {}) {
    this.documents = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]));
    this.writeCount = 0;
    this.queryLog = [];
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
    this.queryLog.push({ collectionPath, filter: clone(filter) });
    const prefix = `${collectionPath}/`;
    return [...this.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .filter(([, data]) => matchesQuery(data, filter))
      .map(([path, data]) => ({ exists: true, path, data: clone(data) }))
      .slice(0, filter?.limit || Infinity);
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
      this.queryLog.push({ collectionPath, filter: clone(filter) });
      const prefix = `${collectionPath}/`;
      return [...staged.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .filter(([, data]) => matchesQuery(data, filter))
        .map(([path, data]) => ({ exists: true, path, data: clone(data) }))
        .slice(0, filter?.limit || Infinity);
    };
    const transaction = {
      get: async (path) => read(path),
      getAll: async (paths) => paths.map(read),
      query,
      set: (path, data, options) => {
        const next = (options?.merge || options?.mergeFields) && staged.has(path)
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

const runClassVisibilityCommands = async () => {
  const classStore = new MemoryStore({
    ...seed,
    "users/teacher-uid": { role: "teacher" },
    "users/staff-uid": { role: "staff", teacherPortalEnabled: true, staffPermissions: ["quiz_read"] },
    "users/other-staff-uid": { role: "staff", teacherPortalEnabled: true, staffPermissions: ["lesson_read"] },
    "semester_classes/class_two": { classId: "class_two", semesterId, grade: "3", classNumber: "2", status: "ACTIVE", homeroomTeacherUid: "private-teacher-uid" },
    "semester_classes/class_ten": { classId: "class_ten", semesterId, grade: "3", classNumber: "10", status: "ACTIVE" },
    "semester_classes/class_closed": { classId: "class_closed", semesterId, grade: "3", classNumber: "11", status: "CLOSED" },
    "semester_classes/class_read_only": { classId: "class_read_only", semesterId, grade: "test", classNumber: "1", status: "ACTIVE", readOnly: true },
    "semester_classes/class_prior": { classId: "class_prior", semesterId: "2026-1", grade: "test", classNumber: "2", status: "ACTIVE" },
  });
  let sessionChecks = 0;
  const queryCore = assessment.createAssessmentQueryCore({
    store: classStore,
    assertSession: async (request, options) => {
      sessionChecks += 1;
      assert.deepEqual(options, { recentAuth: false, highRisk: false });
      return { uid: request.auth.uid };
    },
  });
  const expectedClasses = [
    { classId: "class_one", grade: "3", classNumber: "1" },
    { classId: "class_two", grade: "3", classNumber: "2" },
    { classId: "class_ten", grade: "3", classNumber: "10" },
  ];
  for (const uid of [admin.uid, "teacher-uid", "staff-uid"]) {
    const result = await queryCore.getAssessmentState({ auth: { uid }, data: { semesterId, _session: { ignoredByPayloadNormalization: true } } });
    assert.deepEqual(result, { semesterId, classes: expectedClasses });
    assert.equal(classStore.writeCount, 0, "Class options are read-only and contain no staff or student profiles");
  }
  for (const uid of [student.uid, "other-staff-uid", "unknown-uid"]) {
    await assert.rejects(queryCore.getAssessmentState({ auth: { uid }, data: { semesterId } }),
      (error) => error?.details?.reason === "ASSESSMENT_MANAGE_REQUIRED");
  }
  await assert.rejects(queryCore.getAssessmentState({ auth: admin, data: { semesterId, definitionId: definitionPayload("QUIZ").definitionId } }),
    (error) => error?.details?.reason === "ASSESSMENT_PAYLOAD_INVALID");
  await assert.rejects(queryCore.getAssessmentState({ auth: admin, data: { semesterId: "2026-1" } }),
    (error) => error?.details?.reason === "ASSESSMENT_SEMESTER_NOT_ACTIVE");
  classStore.documents.set(`semester_manifests/${semesterId}`, { ...manifest, revision: 8 });
  await assert.rejects(queryCore.getAssessmentState({ auth: admin, data: { semesterId } }),
    (error) => error?.details?.reason === "ASSESSMENT_SEMESTER_NOT_ACTIVE");
  classStore.documents.set(`semester_manifests/${semesterId}`, manifest);
  classStore.documents.set("users/staff-uid", { role: "staff", teacherPortalEnabled: false, staffPermissions: ["quiz_read"] });
  await assert.rejects(queryCore.getAssessmentState({ auth: { uid: "staff-uid" }, data: { semesterId } }),
    (error) => error?.details?.reason === "ASSESSMENT_MANAGE_REQUIRED");
  assert.equal(sessionChecks, 10, "Every class query keeps the normal application session gate");
  const deniedSessionCore = assessment.createAssessmentQueryCore({ store: classStore, assertSession: async () => { throw new Error("session denied"); } });
  await assert.rejects(deniedSessionCore.getAssessmentState({ auth: admin, data: { semesterId } }), /session denied/);
  assert.equal(classStore.writeCount, 0);

  const base = {
    ...definitionPayload("QUIZ"), maxAttempts: 20, expectedRevision: 0, reason: "Class publication regression",
  };
  const save = (payload) => classStore.runTransaction((transaction) => adapter.apply({
    transaction, actor: { actorUid: admin.uid, actorRole: "admin" }, commandId: commandId(),
    commandType: "saveQuizAssessmentSettings",
    payload: assessment.normalizeAssessmentPayload("saveQuizAssessmentSettings", payload), timestamp: { __serverTimestamp: nowMs },
  }));
  for (const invalidId of ["3-11", "test-1", "test-2", "class_read_only", "class_prior"]) {
    await assert.rejects(save({ ...base, assignedClassIds: [invalidId], presentationSettings: { ...base.presentationSettings, visibleClassIds: [invalidId] } }),
      (error) => error?.details?.reason === "ASSESSMENT_CLASS_NOT_FOUND" && error.details.classId === invalidId && error.details.semesterId === semesterId);
    assert.equal(classStore.writeCount, 0, "Missing, inactive, read-only and foreign-semester classes must reject atomically");
  }
  await save(base);
  const definitionPath = `${assessment.DEFINITION_COLLECTION}/${base.definitionId}`;
  assert.deepEqual(classStore.snapshot(definitionPath).data.assignedClassIds, ["class_one"]);
  await save({ ...base, expectedRevision: 1, assignedClassIds: [], presentationSettings: { ...base.presentationSettings, active: false, visibleClassIds: [] } });
  const privateDefinition = classStore.snapshot(definitionPath).data;
  assert.equal(privateDefinition.status, "PAUSED");
  assert.deepEqual(privateDefinition.assignedClassIds, [], "Clearing publication classes also clears canonical assignments");
  assert.deepEqual(privateDefinition.presentationSettings.visibleClassIds, []);
  assert.equal(privateDefinition.presentationSettings.active, false);
};

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
      sourceType: "lesson", lessonUnitId: "unit-one", lessonTitle: "수업자료", lessonUnitPath: ["대단원", "중단원"],
      description: "",
      mapResourceId: "",
      mapTitle: "",
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
  assert.equal(store.snapshot("years/2026/semesters/2/history_classrooms/history-two").data.lessonUnitId, "unit-one");
  assert.deepEqual(store.snapshot("years/2026/semesters/2/history_classrooms/history-two").data.lessonUnitPath, ["대단원", "중단원"]);
  const metadataSource = { sourceType: "lesson", lessonUnitId: "unit-one", title: "생성 정보 검증",
    blanks: [{ id: "blank-1", answer: "정답" }], targetStudentReasons: { "student-uid": "직접 입력 사유" }, isPublished: false };
  const metadataPath = "years/2026/semesters/2/history_classrooms/history-metadata";
  const metadataDefinitionPath = "semester_assessment_definitions/history_classroom:2026-2:history-metadata";
  await execute(admin, "upsertHistoryClassroomSource", {
    semesterId, sourceId: "history-metadata", source: metadataSource, expectedRevision: 0, reason: "생성 정보 최초 저장",
  });
  const metadataCreated = clone(store.snapshot(metadataPath).data);
  assert.ok(metadataCreated.createdAt);
  assert.equal(metadataCreated.createdBy, "admin-uid");
  store.documents.set(metadataPath, { ...metadataCreated, createdBy: "original-teacher" });
  store.documents.set(metadataDefinitionPath, { createdAt: "2026-08-01T00:00:00.000Z", createdBy: "definition-teacher" });
  nowMs += 1000;
  await execute(admin, "upsertHistoryClassroomSource", {
    semesterId, sourceId: "history-metadata", source: metadataSource, expectedRevision: 1, reason: "작성자가 달라도 원본 생성 정보 유지",
  });
  assert.deepEqual(store.snapshot(metadataPath).data.createdAt, metadataCreated.createdAt);
  assert.equal(store.snapshot(metadataPath).data.createdBy, "original-teacher");
  const metadataMissing = clone(store.snapshot(metadataPath).data);
  delete metadataMissing.createdAt;
  delete metadataMissing.createdBy;
  store.documents.set(metadataPath, metadataMissing);
  await execute(admin, "upsertHistoryClassroomSource", {
    semesterId, sourceId: "history-metadata", source: metadataSource, expectedRevision: 2, reason: "과거 누락 생성 정보 보완",
  });
  assert.equal(store.snapshot(metadataPath).data.createdAt, "2026-08-01T00:00:00.000Z");
  assert.equal(store.snapshot(metadataPath).data.createdBy, "definition-teacher");
  assert.deepEqual(store.snapshot(metadataPath).data.targetStudentReasons, metadataSource.targetStudentReasons);
  assert.equal(store.snapshot(metadataPath).data.isPublished, false);
  store.documents.delete(metadataPath);
  store.documents.delete(metadataDefinitionPath);
  nowMs -= 1000;
  const historyDeleted = await execute(admin, "deleteHistoryClassroomSource", {
    semesterId,
    sourceId: "history-two",
    expectedRevision: 1,
    reason: "합성 역사교실 삭제",
  });
  assert.equal(historyDeleted.result.contentRevision, 2);
  assert.ok(store.snapshot("years/2026/semesters/2/history_classrooms/history-two").data.deletedAt);

  const mapBefore = clone(store.snapshot("years/2026/semesters/2/map_resources/map-one").data);
  await assert.rejects(execute(admin, "updateMapResourceBlanks", {
    semesterId,
    mapResourceId: "map-one",
    pdfBlanks: [{ id: "blank-one", page: 1, answer: "정답" }],
    answerOptions: ["정답"],
    expectedRevision: 0,
    reason: "합성 지도 빈칸 수정",
  }), (error) => error?.details?.reason === "ASSESSMENT_MAP_SOURCE_DISCONNECTED");
  assert.deepEqual(store.snapshot("years/2026/semesters/2/map_resources/map-one").data, mapBefore);

  const legacyPath = "years/2026/semesters/2/history_classrooms/legacy-map-snapshot";
  const legacySource = {
    title: "기존 과제", sourceType: "map", mapResourceId: "map-one", mapTitle: "과거 지도",
    pdfPageImages: [{ page: 1, width: 800, height: 600, url: "https://example.test/immutable-page.webp" }],
    pdfRegions: [], blanks: [{ id: "old-blank", answer: "고려" }], answerOptions: ["고려"], timeLimitMinutes: 10,
  };
  store.documents.set(legacyPath, clone(legacySource));
  const legacySaved = await execute(admin, "upsertHistoryClassroomSource", {
    semesterId, sourceId: "legacy-map-snapshot", source: { ...legacySource, blanks: legacySource.blanks.map((blank) => ({ ...blank, prompt: "", source: "manual" })), timeLimitMinutes: 20 }, expectedRevision: 0, reason: "기존 과제 설정만 수정",
  });
  assert.equal(legacySaved.result.contentRevision, 1);
  assert.deepEqual(store.snapshot(legacyPath).data.pdfPageImages, legacySource.pdfPageImages);
  assert.deepEqual(store.snapshot(legacyPath).data.blanks, legacySource.blanks);
  for (const source of [
    { ...legacySource, mapResourceId: "another-map" },
    { ...legacySource, pdfPageImages: [] },
    { ...legacySource, blanks: [{ id: "old-blank", answer: "바뀐 정답" }] },
    { ...legacySource, answerOptions: ["바뀐 선택지"] },
  ]) {
    await assert.rejects(execute(admin, "upsertHistoryClassroomSource", {
      semesterId, sourceId: "legacy-map-snapshot", source, expectedRevision: 1, reason: "지도 재연결 시도",
    }), (error) => error?.details?.reason === "ASSESSMENT_MAP_SOURCE_DISCONNECTED");
  }
  await assert.rejects(execute(admin, "upsertHistoryClassroomSource", {
    semesterId, sourceId: "new-map-assignment", source: legacySource, expectedRevision: 0, reason: "이전 클라이언트에서 지도 과제 생성",
  }), (error) => error?.details?.reason === "ASSESSMENT_MAP_SOURCE_DISCONNECTED");
  assert.equal(store.snapshot("years/2026/semesters/2/history_classrooms/new-map-assignment").exists, false);
  await assert.rejects(execute(admin, "upsertHistoryClassroomSource", {
    semesterId, sourceId: "hybrid-assignment", source: { ...legacySource, sourceType: "lesson", lessonUnitId: "unit-one" }, expectedRevision: 0, reason: "지도 연결 우회 시도",
  }), (error) => error?.details?.reason === "ASSESSMENT_LESSON_SOURCE_INVALID");

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
  if (kind === "HISTORY_CLASSROOM") {
    const tooLong = { "blank-1": "한".repeat(21) };
    const before = store.writeCount;
    const exceedsBlank = error => error.details?.reason === "ASSESSMENT_ANSWER_TOO_LONG" && error.details.limit === 20;
    await assert.rejects(queryCore.saveAssessmentProgress({ auth: student, data: {
      attemptId, expectedRevision: 1, answers: tooLong, saveId: "long-blank",
    } }), exceedsBlank);
    await assert.rejects(execute(student, "submitAssessmentAttempt", {
      attemptId, expectedRevision: 1, answers: tooLong, submitReason: "TIMEOUT",
    }), exceedsBlank);
    assert.equal(store.writeCount, before);
  }
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

  const originalResult = clone(store.snapshot(`semester_assessment_results/${attemptId}`).data);
  for (const resetCommand of ["resetAssessmentAttempt", "resetAssessmentAttemptsByClassV2"]) {
    await execute(admin, resetCommand, { definitionId: definition.definitionId,
      ...(resetCommand === "resetAssessmentAttempt" ? { studentUid: student.uid } : { classId: "class_one" }), reason: "reset ordinal regression" });
    const oldIds = new Set([...store.documents.entries()].filter(([path]) => path.startsWith("semester_assessment_attempts/")).map(([, data]) => data.attemptId));
    const [fresh, concurrent] = await Promise.all([
      execute(student, "startAssessmentAttempt", startPayload), execute(student, "startAssessmentAttempt", startPayload),
    ]);
    assert.equal(fresh.result.attemptNumber, 1, "Reset restores the displayed allowed attempt count");
    assert.equal(fresh.result.attemptId, concurrent.result.attemptId, "Concurrent restart resumes one attempt");
    assert.equal(oldIds.has(fresh.result.attemptId), false, "Reset must not reuse any immutable attempt ID");
    await execute(student, "submitAssessmentAttempt", { attemptId: fresh.result.attemptId, expectedRevision: 1, answers: answerMap, submitReason: "STUDENT" });
    assert.deepEqual(store.snapshot(`semester_assessment_results/${attemptId}`).data, originalResult, "Old result survives reset and restart");
  }

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

const runAnswerLimits = async () => {
  const unitId = "limits";
  const longOption = "긴".repeat(80);
  const questions = [
    { id: "word", type: "word", answer: "가" },
    { id: "short", type: "short", answer: "나" },
    { id: "essay", type: "essay", answer: "다" },
    { id: "choice", type: "choice", answer: "답", options: ["답", longOption] },
    { id: "order", type: "order", answer: "답||" + longOption, options: ["답", longOption] },
    { id: "matching", type: "matching", answer: "A=>짧음||B=>" + longOption },
  ];
  const sourcePath = id => `years/2026/semesters/2/quiz_questions/limit-${id}`;
  for (const question of questions) store.documents.set(sourcePath(question.id), {
    ...question, unitId, category: "formative", question: "합성 문항", contentRevision: 1,
  });
  const definition = definitionPayload("QUIZ");
  definition.sourceId = unitId;
  definition.definitionId = "quiz:2026-2:limits:formative";
  definition.legacyConfigKey = "limits::formative";
  definition.questionCount = definition.presentationSettings.questionCount = questions.length;
  await execute(admin, "createAssessmentDefinition", definition);
  await execute(admin, "transitionAssessmentDefinition", { definitionId: definition.definitionId,
    expectedRevision: 1, targetStatus: "PUBLISHED", reason: "answer limits" });
  const { attemptId } = (await execute(student, "startAssessmentAttempt", { definitionId: definition.definitionId })).result;
  const attemptPath = `semester_assessment_attempts/${attemptId}`;
  const attempt = store.documents.get(attemptPath);
  assert.ok(attempt.gradingSnapshot.every(item => Number.isInteger(item.answerLimit)));
  // Mix new frozen limits, old presentation snapshots, and omitted large-image
  // snapshots recovered from the same revision. A changed source may not grant more space.
  for (const id of ["short", "essay", "choice"]) delete attempt.gradingSnapshot.find(item => item.id === id).answerLimit;
  attempt.questionSnapshots = attempt.questionSnapshots.filter(item => item.id !== "choice");
  store.documents.get(sourcePath("word")).type = "essay";
  attempt.answers = { unassigned: longOption };

  const query = assessment.createAssessmentQueryCore({ store, now: () => new Date(nowMs),
    serverTimestamp: () => ({ __serverTimestamp: nowMs }), assertSession: async request => ({ uid: request.auth.uid }) });
  const save = (answers, saveId = "bounded") => query.saveAssessmentProgress({ auth: student, data: {
    attemptId, expectedRevision: 1, answers, saveId,
  } });
  const submit = (answers, revision = 1) => execute(student, "submitAssessmentAttempt", {
    attemptId, expectedRevision: revision, answers, submitReason: "STUDENT",
  });
  const rejected = async (answers, reason, limit) => {
    const before = store.writeCount;
    const matches = error => error.details?.reason === reason && error.details?.limit === limit;
    await assert.rejects(save(answers), matches);
    await assert.rejects(submit(answers), matches);
    assert.equal(store.writeCount, before, "Invalid input must create no progress, submission, receipt, reward, or audit");
  };
  await rejected({ word: "한".repeat(21) }, "ASSESSMENT_ANSWER_TOO_LONG", 20);
  await rejected({ short: "😀".repeat(10) + "가" }, "ASSESSMENT_ANSWER_TOO_LONG", 20);
  await rejected({ essay: "한".repeat(2001) }, "ASSESSMENT_ANSWER_TOO_LONG", 2000);
  await rejected({ choice: longOption + "초과" }, "ASSESSMENT_ANSWER_TOO_LONG", longOption.length);
  await rejected({ unassigned: "가짜" }, "ASSESSMENT_ANSWERS_INVALID");
  await rejected({ word: { type: "essay", answer: "위조" } }, "ASSESSMENT_ANSWERS_INVALID");
  await rejected(Object.fromEntries(Array.from({ length: 100 }, (_, index) => [index, "한".repeat(3000)])), "ASSESSMENT_ANSWERS_INVALID");
  store.documents.get(sourcePath("choice")).contentRevision = 2;
  await rejected({ choice: longOption }, "ASSESSMENT_ANSWER_TOO_LONG", 20);
  store.documents.get(sourcePath("choice")).contentRevision = 1;
  const answers = { word: "한".repeat(20), short: "😀".repeat(10), essay: "글".repeat(2000),
    choice: longOption, order: longOption + "||답", matching: `A=>${longOption}||B=>${longOption}` };
  assert.equal((await save(answers)).revision, 2);
  assert.deepEqual(store.documents.get(attemptPath).answers, answers);
  assert.equal((await save(answers)).replayed, true);
  assert.equal((await submit(answers, 2)).result.status, "SUBMITTED");
  assert.deepEqual(store.documents.get(`semester_assessment_submissions/${attemptId}`).answers, answers);
};

const runMockExamSetEditing = async () => {
  const setStore = new MemoryStore(seed);
  const path = id => `years/2026/semesters/2/quiz_questions/${id}`;
  const material = { id: "editable-set", instruction: "다음 자료를 읽고 답하시오.", passage: "공통 지문 원문", image: null };
  const question = (id, order, round = "round_1") => ({ id, unitId: "exam_prep", category: "exam_prep",
    type: "word", question: `합성 세트 문항 ${id}`, answer: "고려", options: [], examRound: round,
    paperOrder: order, points: 20, passageSet: material });
  const save = (value, revision = 0, role = "admin") => setStore.runTransaction(transaction => {
    let wrote = false;
    const checkedTransaction = { ...transaction,
      get: (...args) => { assert.equal(wrote, false, "All set reads precede writes"); return transaction.get(...args); },
      query: (...args) => { assert.equal(wrote, false, "All set queries precede writes"); return transaction.query(...args); },
      set: (...args) => { wrote = true; return transaction.set(...args); },
    };
    return adapter.apply({ transaction: checkedTransaction, commandId: commandId(), receiptId: "set-edit-test",
      timestamp: { __serverTimestamp: nowMs }, actor: { actorUid: role === "student" ? student.uid : admin.uid, actorRole: role },
      commandType: "upsertQuizQuestion", payload: assessment.normalizeAssessmentPayload("upsertQuizQuestion", {
        semesterId, questionId: String(value.id), question: value, expectedRevision: revision, reason: "Synthetic set edit regression",
      }) });
  });
  await save(question(9901, 1));
  await save(question(9902, 2));
  await save(question(9903, 3));
  await save(question(9904, 1, "round_2"));
  const individual = { ...question(9902, 2), question: "개별 발문 수정", explanation: "개별 해설 수정" };
  await save(individual, 1);
  assert.equal(setStore.snapshot(path(9902)).data.question, individual.question, "Ordinary editing of a registered set member succeeds");
  assert.equal(setStore.snapshot(path(9901)).data.contentRevision, 1, "Individual edits do not touch siblings");
  const frozen = { questionSnapshots: [clone(setStore.snapshot(path(9902)).data)], score: 20 };
  setStore.documents.set("semester_assessment_submissions/frozen-set-test", clone(frozen));
  const changed = { ...individual, passageSet: { ...material, passage: "수정한 공통 지문", instruction: "수정한 공통 발문" } };
  const updated = await save(changed, 2);
  for (const [id, revision] of [[9901, 2], [9902, 3], [9903, 2]]) {
    assert.deepEqual(setStore.snapshot(path(id)).data.passageSet, changed.passageSet);
    assert.equal(setStore.snapshot(path(id)).data.contentRevision, revision);
  }
  assert.deepEqual(updated.result.updatedSetQuestionIds, ["9901", "9903"]);
  assert.deepEqual(setStore.snapshot(path(9904)).data.passageSet, material, "Same set ID in another round is unchanged");
  assert.deepEqual(setStore.snapshot("semester_assessment_submissions/frozen-set-test").data, frozen, "Submitted answers and grades remain immutable");
  const noWrites = setStore.writeCount;
  await assert.rejects(save(question(9901, 1), 1), error => error.details?.reason === "ASSESSMENT_CONTENT_REVISION_CONFLICT");
  await assert.rejects(save(changed, 3, "student"), error => error.code === "permission-denied");
  await assert.rejects(save({ ...question(9905, 4), passageSet: material }), error => error.details?.reason === "ASSESSMENT_PAPER_SET_CONFLICT");
  await assert.rejects(save({ ...changed, paperOrder: 5 }, 3), error => error.details?.reason === "ASSESSMENT_PAPER_SET_ORDER_INVALID");
  assert.equal(setStore.writeCount, noWrites, "Stale, forbidden, conflicting joins and nonconsecutive edits write nothing");
  const sibling = { ...question(9901, 1), passageSet: changed.passageSet, question: "다른 교사의 개별 수정" };
  await save(sibling, 2);
  await save({ ...changed, passageSet: { ...changed.passageSet, image: "https://example.test/revised.png" } }, 3);
  assert.equal(setStore.snapshot(path(9901)).data.question, sibling.question, "Shared edits preserve the latest sibling stem");
  setStore.documents.get(`semester_manifests/${semesterId}`).status = "ARCHIVED";
  const beforeArchive = setStore.writeCount;
  await assert.rejects(save(changed, 4), error => error.details?.reason === "ASSESSMENT_SEMESTER_NOT_ACTIVE");
  assert.equal(setStore.writeCount, beforeArchive);
};

const runMockExamPaper = async () => {
  const paperStore = new MemoryStore(seed);
  const apply = (commandType, payload, studentActor = false) => paperStore.runTransaction(transaction => adapter.apply({
    transaction, commandId: commandId(), receiptId: "paper-test-receipt", timestamp: { __serverTimestamp: nowMs },
    actor: { actorUid: studentActor ? student.uid : admin.uid, actorRole: studentActor ? "student" : "admin" },
    commandType, payload: assessment.normalizeAssessmentPayload(commandType, payload),
  }));
  const question = (id, paperOrder, points, examRound = "round_1") => ({ id, unitId: "exam_prep", category: "exam_prep", type: "choice",
    hintEnabled: true, hint: "제공하면 안 되는 모의고사 힌트",
    question: `합성 문항 ${id}`, answer: "고려", options: ["대한 제국", "발해", "고려", "고구려", "신라"],
    choiceOptionImages: [null, null, "https://example.test/goryeo.png", null, null],
    explanation: "제출 전에는 공개하지 않는 해설Ω", passage: "공개 자료 {{blank:숨은정답Ξ}}", examRound, paperOrder, points, paperBreakBefore: paperOrder === 2,
    ...(examRound === "round_1" ? { examplePassage: "ㄱ. 보기 문장\nㄴ. 다른 보기",
      passageSet: { id: "set-one", instruction: "다음 자료를 읽고 답하시오.", passage: "{{blankbox:3.4|(가)}} 공통 본문",
        image: "https://example.test/shared.png" } } : {}) });
  const save = q => apply("upsertQuizQuestion", { semesterId, questionId: String(q.id), question: q, expectedRevision: 0, reason: "Synthetic paper test" });
  await save(question(902, 2, 70));
  await save(question(901, 1, 30));
  await save(question(903, 1, 100, "round_2"));
  const saved = paperStore.snapshot("years/2026/semesters/2/quiz_questions/901").data;
  assert.equal(saved.hintEnabled, false, "Mock authoring always disables hints even for older editors");
  assert.equal(saved.hint, "");
  assert.deepEqual(saved.options, ["고려", "발해", "신라", "고구려", "대한 제국"]);
  assert.equal(saved.choiceOptionImages[0], "https://example.test/goryeo.png");
  await assert.rejects(save(question(904, 1, 10)), error => error?.details?.reason === "ASSESSMENT_PAPER_ORDER_DUPLICATE");
  await assert.rejects(save({ ...question(904, 3, 10), options: ["고려"] }), error => error?.details?.reason === "ASSESSMENT_PAPER_QUESTION_INVALID");
  await assert.rejects(save({ ...question(904, 3, -1) }), error => error?.details?.reason === "ASSESSMENT_PAPER_QUESTION_INVALID");
  await assert.rejects(save({ ...question(904, 3, 0.001) }), error => error?.details?.reason === "ASSESSMENT_PAPER_QUESTION_INVALID");
  await assert.rejects(save({ ...question(904, 3, 10), passageSet: { ...question(904, 3, 10).passageSet, passage: "다른 본문" } }),
    error => error?.details?.reason === "ASSESSMENT_PAPER_SET_CONFLICT");
  await assert.rejects(save(question(904, 4, 10)), error => error?.details?.reason === "ASSESSMENT_PAPER_SET_ORDER_INVALID");
  await assert.rejects(save({ ...question(904, 3, 10), passageSet: { ...question(904, 3, 10).passageSet, answer: "숨긴 정답" } }),
    error => error?.details?.reason === "ASSESSMENT_PAPER_MATERIAL_INVALID");
  await assert.rejects(save({ ...question(904, 3, 10), passageSet: { ...question(904, 3, 10).passageSet, image: "javascript:alert(1)" } }),
    error => error?.details?.reason === "ASSESSMENT_PAPER_MATERIAL_INVALID");
  await save(question(904, 3, 10));
  await assert.rejects(apply("deleteQuizQuestion", { semesterId, questionId: "902", expectedRevision: 1, reason: "Synthetic set boundary test" }),
    error => error?.details?.reason === "ASSESSMENT_PAPER_SET_ORDER_INVALID");
  await assert.rejects(apply("upsertQuizQuestion", { semesterId, questionId: "902", expectedRevision: 1, reason: "Synthetic set boundary test",
    question: { ...question(902, 2, 70, "round_2"), passageSet: null } }),
    error => error?.details?.reason === "ASSESSMENT_PAPER_SET_ORDER_INVALID");
  const legacyEdit = { ...question(901, 5, 30) };
  delete legacyEdit.passageSet; delete legacyEdit.examplePassage;
  await assert.rejects(apply("upsertQuizQuestion", { semesterId, questionId: "901", expectedRevision: 1,
    reason: "Synthetic old editor merge test", question: legacyEdit }),
    error => error?.details?.reason === "ASSESSMENT_PAPER_SET_ORDER_INVALID");
  await apply("deleteQuizQuestion", { semesterId, questionId: "904", expectedRevision: 1, reason: "Synthetic set boundary cleanup" });
  await save({ ...question(905, 1, 3.2, "round_3"), type: "word", options: undefined, answer: "조선" });
  await save({ ...question(906, 2, 96.8, "round_3"), type: "short", options: undefined, answer: "고려" });
  paperStore.documents.set("years/2026/semesters/2/quiz_questions/legacy", { id: 900, unitId: "exam_prep", category: "exam_prep", type: "short", question: "이전 문항", answer: "정답" });
  const base = definitionPayload("QUIZ");
  const config = { ...base, sourceId: "exam_prep", category: "exam_prep", examRound: "round_1", definitionId: "quiz:2026-2:exam_prep:exam_prep:round_1",
    questionCount: 20, maxAttempts: 20, legacyConfigKey: "exam_prep_exam_prep__round_1", expectedRevision: 0, reason: "Synthetic paper test",
    presentationSettings: { ...base.presentationSettings, questionCount: 20,
      paperTitle: "3학년 역사과 초시", paperHeading: "2026학년도 역사 평가" } };
  for (const invalid of [{ paperTitle: "가".repeat(61) }, { paperHeading: "가".repeat(81) },
    { paperTitle: "제목\n추가 줄" }, { paperHeading: { html: "invalid" } }]) {
    assert.throws(() => assessment.normalizeAssessmentPayload("saveQuizAssessmentSettings", {
      ...config, presentationSettings: { ...config.presentationSettings, ...invalid },
    }), error => error?.details?.reason === "ASSESSMENT_PAPER_HEADER_INVALID");
  }
  await apply("saveQuizAssessmentSettings", config);
  const definition = paperStore.snapshot(`${assessment.DEFINITION_COLLECTION}/${config.definitionId}`).data;
  assert.equal(definition.questionCount, 2);
  assert.equal(definition.presentationSettings.randomOrder, false);
  assert.equal(definition.presentationSettings.paperTitle, "3학년 역사과 초시");
  assert.equal(definition.presentationSettings.paperHeading, "2026학년도 역사 평가");
  const count = paperStore.writeCount;
  await assert.rejects(apply("saveQuizAssessmentSettings", { ...config, definitionId: "quiz:2026-2:exam_prep:exam_prep:round_4", examRound: "round_4", legacyConfigKey: "exam_prep_exam_prep__round_4" }),
    error => error?.details?.reason === "ASSESSMENT_SOURCE_EMPTY");
  assert.equal(paperStore.writeCount, count, "An empty round never substitutes legacy or other-round questions");
  const query = assessment.createAssessmentQueryCore({ store: paperStore, now: () => new Date(nowMs),
    serverTimestamp: () => ({ __serverTimestamp: nowMs }), assertSession: async request => ({ uid: request.auth.uid }) });
  const second = { ...config, definitionId: "quiz:2026-2:exam_prep:exam_prep:round_2", examRound: "round_2", legacyConfigKey: "exam_prep_exam_prep__round_2" };
  const third = { ...config, definitionId: "quiz:2026-2:exam_prep:exam_prep:round_3", examRound: "round_3", legacyConfigKey: "exam_prep_exam_prep__round_3" };
  await apply("saveQuizAssessmentSettings", second);
  await apply("saveQuizAssessmentSettings", third);
  const overview = (auth = student, extra = {}) => query.getAssessmentState({ auth, data: { semesterId, mockExamOverview: true, ...extra } });
  const emptyOverview = await overview();
  assert.deepEqual(emptyOverview.rounds, [
    { examRound: "round_1", completed: false, prerequisiteMet: true, requiredRound: "", retakeBlocked: false },
    { examRound: "round_2", completed: false, prerequisiteMet: false, requiredRound: "round_1", retakeBlocked: false },
    { examRound: "round_3", completed: false, prerequisiteMet: false, requiredRound: "round_1", retakeBlocked: false },
  ]);
  assert.equal(emptyOverview.writeCount, 0);
  await assert.rejects(overview(admin), error => error?.details?.reason === "ASSESSMENT_STUDENT_REQUIRED");
  await assert.rejects(overview({ uid: "unassigned-student" }), error => error?.details?.reason === "ASSESSMENT_ENROLLMENT_REQUIRED");
  await assert.rejects(overview(student, { studentUid: "another-student" }), error => error?.details?.reason === "ASSESSMENT_PAYLOAD_INVALID");
  await assert.rejects(overview(student, { semesterId: "2025-2" }), error => error?.details?.reason === "ASSESSMENT_SEMESTER_NOT_ACTIVE");
  for (const definitionId of [second.definitionId, third.definitionId]) {
    const blocked = await query.getAssessmentState({ auth: student, data: { definitionId } });
    assert.equal(blocked.status, "PREREQUISITE_REQUIRED"); assert.equal(blocked.requiredRound, "round_1");
    assert.equal(blocked.attempt, null);
    for (const action of [
      () => apply("startAssessmentAttempt", { definitionId }, true),
      () => query.getAssessmentState({ auth: student, data: { definitionId, prepareAssets: true } }),
    ]) await assert.rejects(action(), error => error?.details?.reason === "ASSESSMENT_PREREQUISITE_REQUIRED");
  }
  // Other students, other semesters and ordinary unit results never unlock a round.
  for (const [key, raw] of Object.entries({
    otherStudent: { semesterId, studentUid: "another-student", definitionId: config.definitionId },
    otherSemester: { semesterId: "2025-2", studentUid: student.uid, definitionId: config.definitionId },
    formative: { semesterId, studentUid: student.uid, definitionId: "quiz:2026-2:exam_prep:formative" },
  })) paperStore.documents.set(`${assessment.RESULT_COLLECTION}/${key}`, raw);
  assert.equal((await overview()).rounds[1].prerequisiteMet, false);
  const newCount = paperStore.writeCount;
  const prepare = (auth = student) => query.getAssessmentState({ auth, data: { definitionId: config.definitionId, prepareAssets: true } });
  const prepared = await prepare();
  assert.equal(prepared.attempt, null);
  assert.equal(paperStore.writeCount, newCount, "Asset preparation does not create an attempt, start a clock or write anything");
  assert.deepEqual(prepared.preparedAssets.imageUrls.sort(), ["https://example.test/goryeo.png", "https://example.test/shared.png"]);
  assert.deepEqual(Object.keys(prepared.preparedAssets).sort(), ["fontCharacters", "imageUrls", "sourceHash"]);
  assert.equal(prepared.preparedAssets.fontCharacters.includes("Ω"), false, "Explanation glyphs are private");
  assert.equal(prepared.preparedAssets.fontCharacters.includes("Ξ"), false, "Legacy hidden blank glyphs are private");
  assert.equal(prepared.preparedAssets.fontCharacters, [...new Set(prepared.preparedAssets.fontCharacters)].sort().join(""));
  await assert.rejects(prepare(admin), error => error?.details?.reason === "ASSESSMENT_ASSET_PREPARATION_FORBIDDEN");
  await assert.rejects(prepare({ uid: "unassigned-student" }), error => error?.details?.reason === "ASSESSMENT_ASSET_PREPARATION_FORBIDDEN");
  await assert.rejects(apply("startAssessmentAttempt", { definitionId: config.definitionId, preparedSourceHash: "0".repeat(64) }, true),
    error => error?.details?.reason === "ASSESSMENT_PREPARED_SOURCE_STALE");
  assert.equal(paperStore.writeCount, newCount, "Preparation authorization and stale-version rejection leave zero writes");
  const started = (await apply("startAssessmentAttempt", { definitionId: config.definitionId,
    preparedSourceHash: prepared.preparedAssets.sourceHash }, true)).result;
  assert.equal(started.serverNowIso, new Date(nowMs).toISOString());
  assert.deepEqual(started.paperHeader, { paperTitle: "3학년 역사과 초시", paperHeading: "2026학년도 역사 평가" });
  const changedHeader = { ...definition, presentationSettings: { ...definition.presentationSettings,
    paperTitle: "바뀐 다음 시험 제목", paperHeading: "새 머리말" } };
  paperStore.documents.set(`${assessment.DEFINITION_COLLECTION}/${config.definitionId}`, changedHeader);
  const resumedHeader = await query.getAssessmentState({ auth: student, data: { definitionId: config.definitionId } });
  assert.deepEqual(resumedHeader.attempt.paperHeader, started.paperHeader, "An existing attempt preserves its own paper header after settings changes");
  paperStore.documents.set(`${assessment.DEFINITION_COLLECTION}/${config.definitionId}`, definition);
  assert.equal(Date.parse(started.deadlineAtIso) - Date.parse(started.startedAtIso), definition.durationSeconds * 1000);
  assert.deepEqual(started.questionIds, ["901", "902"]);
  assert.deepEqual(started.questionPresentation.map(q => q.points), [30, 70]);
  assert.equal(started.questionPresentation[1].paperBreakBefore, true);
  assert.ok(started.questionPresentation.every(q => !Object.hasOwn(q, "answer") && !Object.hasOwn(q, "explanation")));
  assert.deepEqual(started.questionPresentation[0].passageSet, question(901, 1, 30).passageSet);
  assert.equal(started.questionPresentation[0].examplePassage, question(901, 1, 30).examplePassage);
  assert.equal(started.questionPresentation[0].passage, "공개 자료 {{blank:_____}}");
  assert.ok(started.questionPresentation.every(item => !Object.hasOwn(item, "hint") && !Object.hasOwn(item, "hintEnabled")));
  const attemptPath = `${assessment.ATTEMPT_COLLECTION}/${started.attemptId}`;
  const originalAttempt = paperStore.snapshot(attemptPath).data;
  assert.equal((await overview()).rounds[1].prerequisiteMet, false, "Starting the first round is not submitting it");
  // An upper-round draft made before the policy is preserved, but cannot be
  // resumed, read as a live paper, saved or submitted until prerequisites pass.
  const bypassId = `attempt_${"b".repeat(64)}`;
  const bypassPath = `${assessment.ATTEMPT_COLLECTION}/${bypassId}`;
  const bypassDraft = { ...originalAttempt, attemptId: bypassId, definitionId: second.definitionId, examRound: "round_2" };
  paperStore.documents.set(bypassPath, bypassDraft);
  const blockedDraft = await query.getAssessmentState({ auth: student, data: { attemptId: bypassId } });
  assert.equal(blockedDraft.status, "PREREQUISITE_REQUIRED"); assert.equal(blockedDraft.attempt, null);
  await assert.rejects(query.saveAssessmentProgress({ auth: student, data: { attemptId: bypassId, expectedRevision: 1, answers: {}, saveId: "blocked-progress" } }),
    error => error?.details?.reason === "ASSESSMENT_PREREQUISITE_REQUIRED");
  await assert.rejects(apply("submitAssessmentAttempt", { attemptId: bypassId, expectedRevision: 1, answers: {}, submitReason: "STUDENT" }, true),
    error => error?.details?.reason === "ASSESSMENT_PREREQUISITE_REQUIRED");
  await assert.rejects(apply("startAssessmentAttempt", { definitionId: second.definitionId }, true),
    error => error?.details?.reason === "ASSESSMENT_PREREQUISITE_REQUIRED");
  assert.deepEqual(paperStore.snapshot(bypassPath).data, bypassDraft, "A blocked draft is never erased or rewritten");
  paperStore.documents.delete(bypassPath);
  const legacyAttempt = { ...originalAttempt, questionSnapshots: originalAttempt.questionSnapshots.map(item => {
    const { examRound: _examRound, ...legacy } = item;
    return { ...legacy, hintEnabled: true, hint: "기존 응시 스냅샷 힌트" };
  }) };
  paperStore.documents.set(attemptPath, legacyAttempt);
  const beforeHintRead = paperStore.writeCount;
  const restored = await query.getAssessmentState({ auth: student, data: { definitionId: config.definitionId } });
  const resumed = (await apply("startAssessmentAttempt", { definitionId: config.definitionId }, true)).result;
  for (const attempt of [restored.attempt, resumed])
    assert.ok(attempt.questionPresentation.every(item => !Object.hasOwn(item, "hint") && !Object.hasOwn(item, "hintEnabled")));
  assert.equal(paperStore.writeCount, beforeHintRead, "Reading/resuming filters hints without rewriting old attempts");
  assert.equal(paperStore.snapshot(attemptPath).data.questionSnapshots[0].hint, "기존 응시 스냅샷 힌트");
  paperStore.documents.set(attemptPath, originalAttempt);
  const altered = paperStore.snapshot("years/2026/semesters/2/quiz_questions/901").data;
  paperStore.documents.set("years/2026/semesters/2/quiz_questions/901", { ...altered, points: 99, answer: "신라", question: "수정된 문제", contentRevision: 2,
    examplePassage: "수정된 보기", passageSet: { ...altered.passageSet, passage: "수정된 공통 지문" } });
  const submit = { attemptId: started.attemptId, expectedRevision: 1, answers: { 901: "고려", 902: "신라" }, submitReason: "STUDENT" };
  const graded = (await apply("submitAssessmentAttempt", submit, true)).result;
  assert.equal(graded.score, 1); assert.equal(graded.total, 2);
  assert.deepEqual(graded.paperHeader, started.paperHeader);
  assert.equal(graded.percent, 30); assert.equal(graded.earnedPoints, 30); assert.equal(graded.maxPoints, 100);
  assert.equal(graded.questionSnapshots[0].question, "합성 문항 901");
  assert.equal(graded.questionSnapshots[0].answer, "고려");
  assert.equal(graded.questionSnapshots[0].points, 30);
  assert.deepEqual(graded.questionSnapshots[0].passageSet, question(901, 1, 30).passageSet);
  assert.equal(graded.questionSnapshots[0].examplePassage, question(901, 1, 30).examplePassage);
  assert.equal(graded.questionSnapshots[0].passage, question(901, 1, 30).passage, "Submitted review retains the immutable original passage");
  const persisted = paperStore.snapshot(graded.resultRef).data;
  assert.equal(persisted.percent, 30); assert.equal(persisted.earnedPoints, 30);
  assert.deepEqual(persisted.paperHeader, started.paperHeader);
  const replay = (await apply("submitAssessmentAttempt", submit, true)).result;
  assert.equal(replay.replayedSubmission, true); assert.equal(replay.earnedPoints, 30);
  assert.deepEqual(replay.questionSnapshots, graded.questionSnapshots);
  assert.deepEqual(replay.paperHeader, started.paperHeader);
  const definitionPath = `${assessment.DEFINITION_COLLECTION}/${config.definitionId}`;
  const beforeBlockedPreparation = paperStore.writeCount;
  paperStore.documents.set(definitionPath, { ...definition, maxAttempts: 1 });
  await assert.rejects(prepare(), error => error?.details?.reason === "ASSESSMENT_ATTEMPT_LIMIT_REACHED");
  paperStore.documents.set(definitionPath, { ...definition, cooldownMinutes: 5 });
  await assert.rejects(prepare(), error => error?.details?.reason === "ASSESSMENT_COOLDOWN_ACTIVE");
  paperStore.documents.set(definitionPath, { ...definition, status: "CLOSED" });
  await assert.rejects(prepare(), error => error?.details?.reason === "ASSESSMENT_ASSET_PREPARATION_FORBIDDEN");
  paperStore.documents.set(definitionPath, definition);
  assert.equal(paperStore.writeCount, beforeBlockedPreparation);
  const firstOverview = await overview();
  assert.equal(firstOverview.rounds[0].completed, true);
  assert.equal(firstOverview.rounds[1].prerequisiteMet, true);
  assert.equal(firstOverview.rounds[2].requiredRound, "round_2");
  await assert.rejects(apply("startAssessmentAttempt", { definitionId: third.definitionId }, true),
    error => error?.details?.requiredRound === "round_2");
  const secondAttempt = (await apply("startAssessmentAttempt", { definitionId: second.definitionId }, true)).result;
  await apply("submitAssessmentAttempt", { attemptId: secondAttempt.attemptId, expectedRevision: 1,
    answers: { 903: "고려" }, submitReason: "STUDENT" }, true);
  const decimalAttempt = (await apply("startAssessmentAttempt", { definitionId: third.definitionId }, true)).result;
  const decimal = (await apply("submitAssessmentAttempt", { attemptId: decimalAttempt.attemptId, expectedRevision: 1,
    answers: { 905: "조선", 906: "오답" }, submitReason: "STUDENT" }, true)).result;
  assert.equal(decimal.percent, 3.2); assert.equal(decimal.earnedPoints, 3.2); assert.equal(decimal.maxPoints, 100);
  assert.ok((await overview()).rounds.every(round => round.completed && round.prerequisiteMet));
  const resultReads = paperStore.queryLog.filter(row => /(^semester_assessment_results$|\/quiz_results$)/.test(row.collectionPath));
  assert.ok(resultReads.length > 0);
  for (const { collectionPath, filter } of resultReads) {
    assert.equal(filter.limit, 1, "Completion reads retrieve at most one matching result");
    assert.ok(filter.fieldMask.length && !filter.fieldMask.some(field => /answer|question|score/i.test(field)));
    assert.ok(filter.filters.some(clause => ["uid", "studentUid"].includes(clause.field) && clause.value === student.uid));
    assert.ok(collectionPath === "semester_assessment_results"
      ? filter.filters.some(clause => clause.field === "semesterId" && clause.value === semesterId)
      : collectionPath.startsWith("years/2026/semesters/2/"));
  }
  // Submitted result/replay remains available even if earlier evidence is
  // administratively removed later. This never enables a new upper-round start.
  paperStore.documents.delete(graded.resultRef);
  assert.equal((await query.getAssessmentState({ auth: student, data: { attemptId: decimalAttempt.attemptId } })).status, "SUBMITTED");
  assert.equal((await apply("submitAssessmentAttempt", { attemptId: decimalAttempt.attemptId, expectedRevision: 1,
    answers: {}, submitReason: "STUDENT" }, true)).result.replayedSubmission, true);
  // Both explicit legacy formats are accepted without reading untagged history.
  for (const legacy of [{ category: "exam_prep", examRound: "round_1" }, { category: "exam_prep__round_1" }]) {
    paperStore.documents.set("years/2026/semesters/2/quiz_results/round-one-legacy", { uid: student.uid, unitId: "exam_prep", ...legacy });
    assert.equal((await overview()).rounds[0].completed, true);
  }
};

const runMockRetakeOverview = async () => {
  const definitionId = `quiz:${semesterId}:exam_prep:exam_prep:round_1`;
  const definitionPath = `${assessment.DEFINITION_COLLECTION}/${definitionId}`;
  const uid = "student-uid", attemptPath = `${assessment.ATTEMPT_COLLECTION}/submitted`;
  const makeFixture = (maxAttempts = 1) => {
    const documents = new Map([
      [definitionPath, { definitionId, semesterId, maxAttempts, privateMetadata: "not selected" }],
      [`${assessment.RESULT_COLLECTION}/submitted`, { definitionId, semesterId, studentUid: uid, answers: { secret: "not selected" } }],
      [attemptPath, { definitionId, semesterId, studentUid: uid, status: "SUBMITTED", answers: { secret: "not selected" }, questionSnapshots: ["not selected"] }],
    ]);
    const calls = [];
    const project = (data, fields) => Object.fromEntries(fields.filter(field => Object.hasOwn(data, field)).map(field => [field, clone(data[field])]));
    const transaction = {
      getAll: async (paths, options) => {
        calls.push({ type: "getAll", paths, options });
        assert.deepEqual(options.fieldMask, ["definitionId", "semesterId", "maxAttempts"]);
        // Deliberately return a different order; definition identity controls the pairing.
        return paths.map(path => ({ path, exists: documents.has(path), data: documents.has(path) ? project(documents.get(path), options.fieldMask) : null })).reverse();
      },
      query: async (collectionPath, filter) => {
        calls.push({ type: "query", collectionPath, filter });
        assert.ok(filter.fieldMask.length && !filter.fieldMask.some(field => /answer|question|score|private/i.test(field)));
        if (collectionPath === assessment.ATTEMPT_COLLECTION) {
          assert.deepEqual(filter.fieldMask, ["studentUid", "semesterId", "definitionId", "resetAt", "status"]);
          assert.deepEqual(filter.filters.map(item => [item.field, item.operator]), [["definitionId", "=="], ["studentUid", "=="]]);
          assert.equal(filter.filters[1].value, uid);
          assert.ok(filter.filters[0].value.startsWith(`quiz:${semesterId}:exam_prep:exam_prep:round_`));
          assert.equal(filter.orderBy, undefined, "Reuse the existing exact query without a new ordered index");
        }
        const prefix = `${collectionPath}/`;
        return [...documents.entries()].filter(([path, data]) => path.startsWith(prefix)
          && !path.slice(prefix.length).includes("/") && matchesQuery(data, filter))
          .slice(0, filter.limit || Infinity)
          .map(([path, data]) => ({ exists: true, path, data: project(data, filter.fieldMask) }));
      },
    };
    return { documents, calls, overview: () => mockProgress.overview(transaction, semesterId, uid) };
  };
  const blocked = makeFixture();
  const blockedRounds = await blocked.overview();
  assert.equal(blockedRounds[0].retakeBlocked, true, "A submitted single permitted attempt blocks another start");
  assert.deepEqual(blockedRounds.map(item => item.completed), [true, false, false]);
  assert.deepEqual(blockedRounds.map(item => item.prerequisiteMet), [true, true, false]);
  assert.equal(blockedRounds[2].requiredRound, "round_2");
  assert.deepEqual(blocked.calls.filter(item => item.type === "getAll").map(item => item.paths), [[definitionPath]], "Only completed round definitions are read in one batch");
  assert.equal(blocked.calls.filter(item => item.collectionPath === assessment.ATTEMPT_COLLECTION).length, 1);

  const unused = makeFixture();
  unused.documents.delete(`${assessment.RESULT_COLLECTION}/submitted`);
  assert.ok((await unused.overview()).every(item => item.retakeBlocked === false));
  assert.equal(unused.calls.filter(item => item.type === "getAll" || item.collectionPath === assessment.ATTEMPT_COLLECTION).length, 0,
    "Unsubmitted rounds add no definition or attempt reads");

  const allowed = makeFixture(20);
  assert.equal((await allowed.overview())[0].retakeBlocked, false, "Nineteen remaining attempts stay available");
  for (let index = 1; index < 20; index++) allowed.documents.set(`${assessment.ATTEMPT_COLLECTION}/submitted-${index}`, clone(allowed.documents.get(attemptPath)));
  assert.equal((await allowed.overview())[0].retakeBlocked, true, "The actual twenty-attempt limit is enforced");
  allowed.documents.get(`${assessment.ATTEMPT_COLLECTION}/submitted-19`).resetAt = { seconds: 1 };
  assert.equal((await allowed.overview())[0].retakeBlocked, false, "Reset attempts are excluded from the count");

  for (const status of ["STARTED", "IN_PROGRESS", "RECOVERABLE"]) {
    const resumed = makeFixture();
    resumed.documents.set(`${assessment.ATTEMPT_COLLECTION}/active`, { ...resumed.documents.get(attemptPath), status });
    assert.equal((await resumed.overview())[0].retakeBlocked, false, `${status} remains resumable even at the attempt limit`);
  }
  const reset = makeFixture();
  const originalResult = clone(reset.documents.get(`${assessment.RESULT_COLLECTION}/submitted`));
  Object.assign(reset.documents.get(attemptPath), { status: "LOCKED", resetAt: { seconds: 1 } });
  assert.equal((await reset.overview())[0].retakeBlocked, false, "Teacher reset preserves another start despite immutable submission evidence");
  reset.documents.set(`${assessment.ATTEMPT_COLLECTION}/after-reset`, { definitionId, semesterId, studentUid: uid, status: "IN_PROGRESS" });
  const resetRounds = await reset.overview();
  assert.equal(resetRounds[0].completed, true);
  assert.equal(resetRounds[0].retakeBlocked, false, "The post-reset active attempt remains resumable");
  assert.equal(resetRounds[1].prerequisiteMet, true);
  assert.deepEqual(reset.documents.get(`${assessment.RESULT_COLLECTION}/submitted`), originalResult);
  reset.documents.get(`${assessment.ATTEMPT_COLLECTION}/after-reset`).status = "SUBMITTED";
  assert.equal((await reset.overview())[0].retakeBlocked, true, "The new submission consumes the restored single attempt");

  const scoped = makeFixture();
  scoped.documents.delete(attemptPath);
  for (const [id, update] of Object.entries({
    otherStudent: { studentUid: "another-student" },
    otherSemester: { semesterId: "2025-2", definitionId: "quiz:2025-2:exam_prep:exam_prep:round_1" },
    mismatchedSemester: { semesterId: "2025-2" },
    otherRound: { definitionId: `quiz:${semesterId}:exam_prep:exam_prep:round_2` },
  })) scoped.documents.set(`${assessment.ATTEMPT_COLLECTION}/${id}`, { definitionId, semesterId, studentUid: uid, status: "SUBMITTED", ...update });
  assert.equal((await scoped.overview())[0].retakeBlocked, false, "Another owner, semester or round never consumes this limit");
  scoped.documents.set(`${assessment.ATTEMPT_COLLECTION}/mine`, { definitionId, semesterId, studentUid: uid, status: "SUBMITTED" });
  scoped.documents.get(`${assessment.ATTEMPT_COLLECTION}/otherStudent`).status = "IN_PROGRESS";
  assert.equal((await scoped.overview())[0].retakeBlocked, true, "Another student's live attempt cannot reopen a completed limit");

  for (const legacy of [{ category: "exam_prep", examRound: "round_1" }, { category: "exam_prep__round_1" }]) {
    const migrated = makeFixture();
    migrated.documents.delete(`${assessment.RESULT_COLLECTION}/submitted`);
    migrated.documents.delete(attemptPath);
    migrated.documents.set("years/2026/semesters/2/quiz_results/legacy", { uid, unitId: "exam_prep", ...legacy });
    const rounds = await migrated.overview();
    assert.equal(rounds[0].completed, true);
    assert.equal(rounds[0].retakeBlocked, false, "Legacy result-only history has no canonical attempt to consume");
    assert.equal(rounds[1].prerequisiteMet, true);
  }
  const allCompleted = makeFixture();
  for (const round of ["round_2", "round_3"]) {
    const id = `quiz:${semesterId}:exam_prep:exam_prep:${round}`;
    allCompleted.documents.set(`${assessment.DEFINITION_COLLECTION}/${id}`, { definitionId: id, semesterId, maxAttempts: 20 });
    allCompleted.documents.set(`${assessment.RESULT_COLLECTION}/${round}`, { definitionId: id, semesterId, studentUid: uid });
  }
  assert.deepEqual((await allCompleted.overview()).map(item => item.retakeBlocked), [true, false, false]);
  assert.equal(allCompleted.calls.filter(item => item.type === "getAll").length, 1);
  assert.equal(allCompleted.calls.find(item => item.type === "getAll").paths.length, 3);
};

const runMockStateReadBounds = async () => {
  const definitionId = "quiz:2026-2:exam_prep:exam_prep:round_1";
  const definitionPath = `${assessment.DEFINITION_COLLECTION}/${definitionId}`;
  const pathFor = index => `${assessment.ATTEMPT_COLLECTION}/attempt_${String(index).padStart(64, "0")}`;
  const makeFixture = () => {
    const fixture = new MemoryStore({ ...seed, [definitionPath]: {
      ...definitionPayload("QUIZ"), definitionId, sourceId: "exam_prep", category: "exam_prep", examRound: "round_1",
      status: "PUBLISHED", revision: 1, assignedClassIds: ["class_one"], maxAttempts: 30,
    } });
    for (let index = 1; index <= 20; index++) fixture.documents.set(pathFor(index), {
      attemptId: pathFor(index).split("/").at(-1), definitionId, semesterId, assessmentKind: "QUIZ",
      category: "exam_prep", sourceId: "exam_prep", examRound: "round_1", studentUid: student.uid,
      attemptNumber: index, status: index === 20 ? "IN_PROGRESS" : "SUBMITTED", revision: 2,
      sourceHash: "fixture-source-hash", answers: { "1": "fixture response" }, questionIds: ["1"],
      startedAtIso: new Date(nowMs - 30_000).toISOString(), deadlineAtIso: new Date(nowMs + 300_000).toISOString(),
      submittedAtIso: index === 20 ? "" : new Date(nowMs - 60_000).toISOString(),
      questionSnapshots: [{ id: "1", type: "short", question: "synthetic material ".repeat(4000),
        answer: "private answer", explanation: "private explanation", image: "https://example.test/frozen.png" }],
    });
    fixture.documents.set(pathFor(21), { ...clone(fixture.documents.get(pathFor(20))), attemptNumber: 21, status: "LOCKED", resetAt: { seconds: 1 } });
    fixture.documents.set(pathFor(22), { ...clone(fixture.documents.get(pathFor(20))), studentUid: "other-student", attemptNumber: 22 });
    fixture.documents.set(pathFor(23), { ...clone(fixture.documents.get(pathFor(20))), definitionId: "quiz:2025-2:exam_prep:exam_prep:round_1", semesterId: "2025-2", attemptNumber: 23 });
    const reads = [], queries = [];
    const originalTransaction = fixture.runTransaction.bind(fixture);
    fixture.runTransaction = callback => originalTransaction(transaction => callback({ ...transaction,
      get: async path => { reads.push(path); return transaction.get(path); },
      getAll: async (paths, options) => { reads.push(...paths); return transaction.getAll(paths, options); },
      query: async (collectionPath, filter) => {
        const rows = await transaction.query(collectionPath, filter);
        const selected = filter?.fieldMask ? rows.map(row => ({ ...row,
          data: Object.fromEntries(filter.fieldMask.filter(field => Object.hasOwn(row.data, field)).map(field => [field, row.data[field]])),
        })) : rows;
        queries.push({ collectionPath, filter: clone(filter), bytes: Buffer.byteLength(JSON.stringify(selected)), rows: selected.length });
        return selected;
      },
    }));
    const query = assessment.createAssessmentQueryCore({ store: fixture, now: () => new Date(nowMs),
      assertSession: async request => ({ uid: request.auth.uid }) });
    const state = data => { reads.length = 0; queries.length = 0; return query.getAssessmentState({ auth: student, data: data || { definitionId } }); };
    const fullAttemptReads = () => reads.filter(path => path.startsWith(`${assessment.ATTEMPT_COLLECTION}/`));
    return { fixture, reads, queries, state, fullAttemptReads };
  };
  const f = makeFixture();
  const result = await f.state();
  assert.equal(result.status, "RECOVERABLE");
  assert.equal(result.attempt.attemptNumber, 20, "Ignore reset, other-owner and other-semester attempts");
  assert.deepEqual(result.attempt.answers, { "1": "fixture response" });
  assert.deepEqual(f.fullAttemptReads(), [pathFor(20)]);
  for (const path of ["site_settings/semester_active", `semester_manifests/${semesterId}`])
    assert.equal(f.reads.filter(value => value === path).length, 1, "Reuse validated semester snapshots in the same transaction");
  const historyQuery = f.queries.find(item => item.collectionPath === assessment.ATTEMPT_COLLECTION);
  assert.deepEqual(historyQuery.filter.filters.map(item => [item.field, item.operator]), [["definitionId", "=="], ["studentUid", "=="]]);
  assert.equal(historyQuery.filter.orderBy, undefined, "Do not introduce an ordered index");
  assert.deepEqual(historyQuery.filter.fieldMask, ["studentUid", "resetAt", "attemptNumber", "status", "submittedAtIso"]);
  assert.ok(historyQuery.bytes < 20_000, "Historical paper bodies are absent from the metadata query");
  assert.ok(Buffer.byteLength(JSON.stringify(result.attempt)) > 60_000, "The selected full paper is preserved");
  assert.ok(!JSON.stringify(result).includes("private answer") && !JSON.stringify(result).includes("private explanation"));
  assert.deepEqual(await f.state({ attemptId: result.attempt.attemptId }), result, "Explicit attempt recovery and definition lookup return identical data");
  assert.deepEqual(f.fullAttemptReads(), [pathFor(20)], "Explicit attempt lookup is not hydrated twice");
  const prepared = await f.state({ definitionId, prepareAssets: true });
  assert.deepEqual(prepared.attempt, result.attempt);
  assert.ok(JSON.stringify(prepared.preparedAssets).includes("https://example.test/frozen.png"));
  assert.deepEqual(f.fullAttemptReads(), [pathFor(20)], "Asset preparation and recovery share the one full read");

  f.fixture.documents.get(pathFor(20)).status = "SUBMITTED";
  assert.equal((await f.state()).status, "SUBMITTED");
  f.fixture.documents.get(definitionPath).maxAttempts = 20;
  await assert.rejects(f.state({ definitionId, prepareAssets: true }), error => error?.details?.reason === "ASSESSMENT_ATTEMPT_LIMIT_REACHED");
  assert.deepEqual(f.fullAttemptReads(), [], "Retry-limit rejection needs no paper body");
  f.fixture.documents.get(definitionPath).maxAttempts = 30;
  f.fixture.documents.get(definitionPath).cooldownMinutes = 30;
  f.fixture.documents.get(pathFor(20)).submittedAtIso = new Date(nowMs).toISOString();
  await assert.rejects(f.state({ definitionId, prepareAssets: true }), error => error?.details?.reason === "ASSESSMENT_COOLDOWN_ACTIVE");
  assert.deepEqual(f.fullAttemptReads(), []);
  for (let index = 1; index <= 20; index++) f.fixture.documents.get(pathFor(index)).resetAt = { seconds: 1 };
  const reset = await f.state();
  assert.equal(reset.status, "READY");
  assert.equal(reset.attempt, null);
  assert.deepEqual(f.fullAttemptReads(), [], "Reset history never loads an old paper");

  const blocked = makeFixture(), secondId = definitionId.replace("round_1", "round_2");
  blocked.fixture.documents.set(`${assessment.DEFINITION_COLLECTION}/${secondId}`, {
    ...blocked.fixture.documents.get(definitionPath), definitionId: secondId, examRound: "round_2",
  });
  for (const value of blocked.fixture.documents.values()) if (value.definitionId === definitionId) {
    value.definitionId = secondId;
    if (value.assessmentKind === "QUIZ") value.examRound = "round_2";
  }
  const gated = await blocked.state({ definitionId: secondId });
  assert.equal(gated.status, "PREREQUISITE_REQUIRED");
  assert.equal(gated.attempt, null);
  assert.deepEqual(blocked.fullAttemptReads(), [], "Prior-round gating does not hydrate a blocked attempt");

  const ordinary = makeFixture();
  ordinary.fixture.documents.get(definitionPath).category = "formative";
  assert.equal((await ordinary.state()).attempt.attemptNumber, 20);
  assert.equal(ordinary.queries.find(item => item.collectionPath === assessment.ATTEMPT_COLLECTION).filter.fieldMask, undefined,
    "Ordinary assessment history remains unchanged");
  assert.deepEqual(ordinary.fullAttemptReads(), []);
  assert.equal(f.fixture.writeCount + blocked.fixture.writeCount + ordinary.fixture.writeCount, 0);
};

const runMockSourceQueryBounds = async () => {
  const makeFixture = (questions) => {
    const boundedStore = new MemoryStore({ ...seed, ...Object.fromEntries(questions.map(q => [
      `years/2026/semesters/2/quiz_questions/${q.id}`, q,
    ])) });
    const apply = (commandType, payload) => boundedStore.runTransaction(transaction => adapter.apply({
      transaction, commandId: commandId(), receiptId: "source-query-test", timestamp: { __serverTimestamp: nowMs },
      actor: { actorUid: admin.uid, actorRole: "admin" }, commandType,
      payload: assessment.normalizeAssessmentPayload(commandType, payload),
    }));
    const config = (round, revision = 0, count = 1) => {
      const base = definitionPayload("QUIZ");
      return { ...base, definitionId: `quiz:2026-2:exam_prep:exam_prep:round_${round}`, sourceId: "exam_prep", category: "exam_prep", examRound: `round_${round}`,
        questionCount: count, maxAttempts: 20, legacyConfigKey: `exam_prep_exam_prep__round_${round}`, expectedRevision: revision, reason: "Synthetic source query test",
        presentationSettings: { ...base.presentationSettings, questionCount: count } };
    };
    return { store: boundedStore, apply, config, save: payload => apply("saveQuizAssessmentSettings", payload),
      questionReads: () => boundedStore.queryLog.filter(item => item.collectionPath.endsWith("/quiz_questions")) };
  };
  const question = (id, round) => ({ id, unitId: "exam_prep", category: "exam_prep", type: "short", question: "합성 자료", answer: "명, 명나라", contentRevision: 1,
    ...(round ? { examRound: `round_${round}`, paperOrder: 1, points: 3 } : {}) });
  const f = makeFixture([question(801, 1), question(802, 2), question(803, 3), question(804)]);
  const oldKeyConfig = { ...f.config(1), legacyConfigKey: "exam_prep_exam_prep" };
  const saved = await f.save(oldKeyConfig);
  const expectedHash = commandGateway.sha256(commandGateway.canonicalize([{ id: "801", answer: "명, 명나라", sourceRevision: "1", examRound: "round_1", paperOrder: 1, points: 3 }]));
  assert.equal(saved.result.sourceHash, expectedHash, "Selecting a round in Firestore preserves the published source hash");
  assert.equal(f.questionReads().length, 1);
  assert.equal(f.questionReads()[0].filter.limit, 201);
  assert.deepEqual(f.questionReads()[0].filter.filters.at(-1), { field: "examRound", operator: "==", value: "round_1" });
  const writesBeforeInvalidKey = f.store.writeCount;
  await assert.rejects(f.save({ ...f.config(1, 1), legacyConfigKey: "exam_prep_exam_prep__round_2" }),
    error => error?.details?.reason === "ASSESSMENT_IDENTITY_IMMUTABLE");
  assert.equal(f.store.writeCount, writesBeforeInvalidKey);
  const migrated = await f.save(f.config(1, 1));
  assert.equal(migrated.result.sourceHash, expectedHash);
  assert.equal(f.store.snapshot(`${assessment.DEFINITION_COLLECTION}/${f.config(1).definitionId}`).data.legacyConfigKey, "exam_prep_exam_prep__round_1");
  await assert.rejects(f.save({ ...oldKeyConfig, expectedRevision: 2 }), error => error?.details?.reason === "ASSESSMENT_IDENTITY_IMMUTABLE");
  f.store.documents.delete("years/2026/semesters/2/quiz_questions/802");
  f.store.queryLog.length = 0;
  const beforeEmpty = f.store.writeCount;
  await assert.rejects(f.save(f.config(2)), error => error?.details?.reason === "ASSESSMENT_SOURCE_EMPTY");
  assert.equal(f.store.writeCount, beforeEmpty);
  assert.equal(f.questionReads().length, 2, "An empty authored round uses one bounded probe, never the whole bank");
  assert.equal(f.questionReads()[1].filter.limit, 1);
  assert.deepEqual(f.questionReads()[1].filter.fieldMask, ["examRound"]);
  assert.equal(f.questionReads()[1].filter.filters.at(-1).operator, "in");
  for (const round of [1, 2, 3]) {
    const legacy = makeFixture([question(811), question(812)]);
    const result = await legacy.save(legacy.config(round, 0, 2));
    assert.equal(result.result.itemCount, 2, `Unassigned legacy bank remains available in round ${round}`);
    assert.equal(legacy.questionReads().length, 3);
    assert.equal(legacy.questionReads()[2].filter.filters.length, 2);
  }
  const encoded = makeFixture([{ ...question(821), category: "exam_prep__round_2" }]);
  await encoded.save({ ...encoded.config(2), definitionId: "quiz:2026-2:exam_prep:exam_prep__round_2", category: "exam_prep__round_2", examRound: "" });
  assert.equal(encoded.questionReads().length, 1, "Encoded legacy categories retain their existing exact category query");
  const malformed = makeFixture([{ ...question(831), examRound: "unexpected_round" }, question(832)]);
  await assert.rejects(malformed.save(malformed.config(2)), error => error?.details?.reason === "ASSESSMENT_SOURCE_EMPTY");
  const tooMany = makeFixture(Array.from({ length: 205 }, (_, index) => ({ ...question(2000 + index, 1), paperOrder: index + 1 })));
  await assert.rejects(tooMany.save(tooMany.config(1)), error => error?.details?.reason === "ASSESSMENT_PAPER_QUESTION_INVALID");
  assert.equal(tooMany.questionReads()[0].filter.limit, 201, "The 200-question validation needs at most one extra document");
};

const runShortAnswerAliases = async () => {
  // Each fixture uses the real authoring, publication, attempt and progress handlers.
  // Legacy attempts intentionally omit only the fields unavailable in that version.
  for (const mode of ["new", "legacy-typed", "legacy-untyped"]) {
    const aliasStore = new MemoryStore(seed);
    const apply = (commandType, payload, actor = admin) => aliasStore.runTransaction(transaction => adapter.apply({
      transaction, commandId: commandId(), receiptId: `aliases-${mode}`, timestamp: { __serverTimestamp: nowMs },
      actor: { actorUid: actor.uid, actorRole: actor.uid === admin.uid ? "admin" : "student" },
      commandType, payload: assessment.normalizeAssessmentPayload(commandType, payload),
    }));
    const question = (id, type, answer, points, extra = {}) => ({ id, type, answer, points,
      unitId: "exam_prep", category: "exam_prep", examRound: "round_1", paperOrder: id - 1000,
      question: `합성 허용 답안 문항 ${id}`, ...extra });
    const choices = ["ㄱ", "ㄴ", "ㄱ, ㄴ", "ㄱ, ㄷ", "ㄴ, ㄷ"];
    const longAlias = "가".repeat(20);
    const questions = [
      question(1001, "short", "명, 명나라", 3),
      question(1002, "word", "조선, 조선 왕조", 4),
      question(1003, "short", `${longAlias}, ${"나".repeat(20)}`, 5.5),
      question(1004, "choice", "ㄱ, ㄴ", 6, { options: choices }),
      question(1005, "short", " , 명, , 명나라, ", 2),
      question(1006, "short", "명, 명나라", 7),
      question(1007, "choice", "ㄱ, ㄴ", 8, { options: choices }),
    ];
    const saveQuestion = q => apply("upsertQuizQuestion", { semesterId, questionId: String(q.id), question: q,
      expectedRevision: 0, reason: "Synthetic accepted-answer verification" });
    for (const q of questions) await saveQuestion(q);
    const writesBeforeInvalid = aliasStore.writeCount;
    for (const answer of [", ,", "명, " + "나".repeat(21)]) {
      await assert.rejects(saveQuestion(question(1008, "short", answer, 1)),
        error => error?.details?.reason === "ASSESSMENT_PAPER_QUESTION_INVALID");
    }
    assert.equal(aliasStore.writeCount, writesBeforeInvalid, "Invalid alias keys create no question or audit writes");
    assert.equal(aliasStore.snapshot("years/2026/semesters/2/quiz_questions/1003").data.answer, questions[2].answer,
      "Each alias may use 20 characters even when their combined key exceeds 20");
    const base = definitionPayload("QUIZ");
    const config = { ...base, sourceId: "exam_prep", category: "exam_prep", examRound: "round_1",
      definitionId: "quiz:2026-2:exam_prep:exam_prep:round_1", questionCount: questions.length, maxAttempts: 20,
      legacyConfigKey: "exam_prep_exam_prep__round_1", expectedRevision: 0, reason: "Synthetic alias paper",
      presentationSettings: { ...base.presentationSettings, questionCount: questions.length } };
    await apply("saveQuizAssessmentSettings", config);
    const definitionPath = `${assessment.DEFINITION_COLLECTION}/${config.definitionId}`;
    const definition = aliasStore.snapshot(definitionPath).data;
    const writesBeforeBlocked = aliasStore.writeCount;
    aliasStore.documents.set(definitionPath, { ...definition, status: "CLOSED" });
    await assert.rejects(apply("startAssessmentAttempt", { definitionId: config.definitionId }, student),
      error => error?.details?.reason === "ASSESSMENT_NOT_PUBLISHED");
    aliasStore.documents.set(definitionPath, { ...definition, assignedClassIds: ["class_other"] });
    await assert.rejects(apply("startAssessmentAttempt", { definitionId: config.definitionId }, student),
      error => error?.details?.reason === "ASSESSMENT_CLASS_NOT_ASSIGNED");
    aliasStore.documents.set(definitionPath, definition);
    await assert.rejects(apply("startAssessmentAttempt", { definitionId: config.definitionId }, admin),
      error => error?.details?.reason === "ASSESSMENT_STUDENT_REQUIRED");
    assert.equal(aliasStore.writeCount, writesBeforeBlocked, "Aliases do not bypass publication, class or role boundaries");
    const started = (await apply("startAssessmentAttempt", { definitionId: config.definitionId }, student)).result;
    const attemptPath = `${assessment.ATTEMPT_COLLECTION}/${started.attemptId}`;
    const attempt = aliasStore.documents.get(attemptPath);
    assert.deepEqual(attempt.gradingSnapshot.map(item => item.type), questions.map(item => item.type));
    assert.ok(started.questionPresentation.every(item => !Object.hasOwn(item, "answer")), "Accepted keys remain private before submission");
    for (const item of attempt.gradingSnapshot) if (mode !== "new") delete item.type;
    if (mode === "legacy-untyped") for (const item of attempt.questionSnapshots) delete item.type;
    const frozenQuestions = clone(attempt.questionSnapshots);
    // A teacher editing the source later must not change the frozen aliases, type or points.
    for (const q of questions) aliasStore.documents.set(`years/2026/semesters/2/quiz_questions/${q.id}`,
      { ...q, type: "choice", answer: "다른 답", points: 99, contentRevision: 2 });
    const query = assessment.createAssessmentQueryCore({ store: aliasStore, now: () => new Date(nowMs),
      serverTimestamp: () => ({ __serverTimestamp: nowMs }), assertSession: async request => ({ uid: request.auth.uid }) });
    const answers = { 1001: "명", 1002: "조 선 왕 조", 1003: longAlias, 1004: "ㄱ, ㄴ", 1005: "명나라", 1006: "명, 명나라", 1007: "ㄱ" };
    const progress = { attemptId: started.attemptId, expectedRevision: 1, answers, saveId: `aliases-${mode}` };
    const saved = await query.saveAssessmentProgress({ auth: student, data: progress });
    assert.equal(saved.revision, 2);
    assert.equal((await query.saveAssessmentProgress({ auth: student, data: progress })).replayed, true);
    assert.deepEqual(aliasStore.snapshot(attemptPath).data.answers, answers);
    const submit = { attemptId: started.attemptId, expectedRevision: 2, answers, submitReason: "STUDENT" };
    const writesBeforeForeign = aliasStore.writeCount;
    await assert.rejects(apply("submitAssessmentAttempt", submit, { uid: "other-student" }),
      error => error?.details?.reason === "ASSESSMENT_ATTEMPT_FORBIDDEN");
    assert.equal(aliasStore.writeCount, writesBeforeForeign);
    const graded = (await apply("submitAssessmentAttempt", submit, student)).result;
    const correct = mode === "legacy-untyped" ? [false, false, false, true, false, true, false] : [true, true, true, true, true, false, false];
    assert.deepEqual(graded.answerChecks.map(item => item.correct), correct, mode);
    assert.equal(graded.earnedPoints, mode === "legacy-untyped" ? 13 : 20.5, mode);
    assert.equal(graded.maxPoints, 35.5);
    assert.equal(graded.score, correct.filter(Boolean).length);
    assert.deepEqual(graded.answers, answers, "Student answers are preserved verbatim, never split into aliases");
    assert.deepEqual(graded.questionSnapshots, frozenQuestions, "Submission uses the original question snapshot");
    const immutableResult = aliasStore.snapshot(graded.resultRef).data;
    const immutableSubmission = aliasStore.snapshot(graded.submissionRef).data;
    const replay = (await apply("submitAssessmentAttempt", { ...submit, answers: {} }, student)).result;
    assert.equal(replay.replayedSubmission, true);
    assert.deepEqual(replay.answerChecks, graded.answerChecks);
    assert.equal(replay.earnedPoints, graded.earnedPoints);
    assert.deepEqual(aliasStore.snapshot(graded.resultRef).data, immutableResult);
    assert.deepEqual(aliasStore.snapshot(graded.submissionRef).data, immutableSubmission);
    if (mode === "legacy-typed") {
      // Simulate a result graded before aliases existed. Replays must not regrade it.
      const historic = { ...immutableResult, score: 0, earnedPoints: 0, percent: 0,
        answerChecks: immutableResult.answerChecks.map(item => ({ ...item, correct: false })) };
      aliasStore.documents.set(graded.resultRef, historic);
      const historicalReplay = (await apply("submitAssessmentAttempt", submit, student)).result;
      assert.equal(historicalReplay.score, 0);
      assert.equal(historicalReplay.earnedPoints, 0);
      assert.deepEqual(historicalReplay.answerChecks, historic.answerChecks);
      assert.deepEqual(aliasStore.snapshot(graded.resultRef).data, historic);
    }
  }
};

const runLegacyReceiptHints = async () => {
  const cases = [
    { name: "mock-definition", category: "exam_prep", remove: [0, 1] },
    { name: "legacy-mock-definition", category: "exam_prep__round_2", remove: [0, 1] },
    { name: "mock-question-category", category: "formative", question: { category: "exam_prep" }, remove: [0] },
    { name: "mock-question-round", category: "formative", question: { examRound: "2" }, remove: [0] },
    { name: "diagnostic-hints", category: "diagnostic", remove: [] },
    { name: "formative-hints", category: "formative", remove: [] },
    { name: "other-assessment-kind", category: "exam_prep", kind: "HISTORY_CLASSROOM", remove: [] },
    { name: "other-command-result", category: "exam_prep", commandType: "submitAssessmentAttempt", remove: [] },
  ];
  for (const fixture of cases) {
    const type = fixture.commandType || "startAssessmentAttempt";
    const id = commandId();
    const attemptId = `attempt_${"a".repeat(64)}`;
    const definitionId = `quiz:${semesterId}:exam_prep:${fixture.category}`;
    const payload = type === "startAssessmentAttempt" ? { definitionId }
      : { attemptId, expectedRevision: 1, answers: { 1: "고려" }, submitReason: "STUDENT" };
    const result = {
      assessmentKind: fixture.kind || "QUIZ", definitionId, attemptId,
      answers: { 1: "고려" }, score: 3, total: 5, percent: 60,
      questionPresentation: [
        { id: "1", type: "matching", hint: "기존 힌트", hintEnabled: true,
          matchingLeftOptions: ["나", "가"], matchingRightOptions: [{ right: "조선", rightImage: "fixture.png" }, { right: "고려", rightImage: null }],
          matchingPairs: [{ left: "나", right: "조선" }], ...fixture.question },
        { id: "2", type: "order", hint: "일반 힌트", hintEnabled: true, options: ["나", "가"], passage: "그대로 보존" },
      ],
    };
    const receiptPath = `${commandGateway.RECEIPT_COLLECTION}/${commandGateway.buildReceiptId(student.uid, type, id)}`;
    const receipt = {
      commandId: id, commandType: type, status: "SUCCEEDED", actorUid: student.uid,
      payloadHash: commandGateway.sha256(commandGateway.canonicalize(assessment.normalizeAssessmentPayload(type, payload))),
      target: { refs: ["years/2026/semesters/2/quiz_questions/fixture"] }, result,
    };
    store.documents.set(receiptPath, clone(receipt));
    if (fixture.name === "legacy-mock-definition") {
      const denied = error => error?.details?.reason === "ASSESSMENT_PREREQUISITE_REQUIRED";
      await assert.rejects(execute(student, type, payload, id), denied);
      await assert.rejects(core.getStatus({ auth: student, data: { commandId: id, commandType: type } }), denied);
      store.documents.set(`${assessment.RESULT_COLLECTION}/receipt-prerequisite`, {
        studentUid: student.uid, semesterId, definitionId: `quiz:${semesterId}:exam_prep:exam_prep:round_1`,
      });
    }
    const expected = clone(result);
    for (const index of fixture.remove) {
      delete expected.questionPresentation[index].hint;
      delete expected.questionPresentation[index].hintEnabled;
    }
    const writesBefore = store.writeCount;
    const replay = await execute(student, type, payload, id);
    const status = await core.getStatus({ auth: student, data: { commandId: id, commandType: type } });
    assert.equal(replay.replayed, true, fixture.name);
    assert.equal(status.replayed, true, fixture.name);
    assert.deepEqual(replay.result, expected, `${fixture.name}: replay preserves all fields except mock hints`);
    assert.deepEqual(status.result, expected, `${fixture.name}: status preserves all fields except mock hints`);
    assert.deepEqual(store.documents.get(receiptPath), receipt, `${fixture.name}: receipt remains immutable`);
    assert.equal(store.writeCount, writesBefore, `${fixture.name}: no business or receipt writes`);
    store.documents.delete(receiptPath);
    store.documents.delete(`${assessment.RESULT_COLLECTION}/receipt-prerequisite`);
  }
};

(async () => {
  await runLegacyReceiptHints();
  await runMockExamPaper();
  await runMockExamSetEditing();
  await runMockRetakeOverview();
  await runMockStateReadBounds();
  await runShortAnswerAliases();
  await runMockSourceQueryBounds();
  await runClassVisibilityCommands();
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

  const emptyQuizId = `quiz:${semesterId}:unprepared-unit:formative`;
  const emptyQuizPayload = definitionPayload("QUIZ");
  await execute(admin, "saveQuizAssessmentSettings", {
    ...emptyQuizPayload,
    definitionId: emptyQuizId,
    sourceId: "unprepared-unit",
    legacyConfigKey: "unprepared-unit_formative",
    assignedClassIds: [],
    maxAttempts: 20,
    presentationSettings: { ...emptyQuizPayload.presentationSettings, active: false, visibleClassIds: [] },
    expectedRevision: 0,
    reason: "Save private quiz before adding its questions",
  });
  const emptyQuizPath = `${assessment.DEFINITION_COLLECTION}/${emptyQuizId}`;
  const emptyQuiz = clone(store.documents.get(emptyQuizPath));
  assert.equal(emptyQuiz.status, "DRAFT");
  assert.equal(emptyQuiz.sourceHash, "");
  assert.equal(emptyQuiz.itemCount, 0);
  const checkEmptyQuiz = () => readiness.evaluate({ transaction: { query: (...args) => store.query(...args) }, manifest });
  assert.equal((await checkEmptyQuiz())[0].status, "PASS", "Private quiz settings may precede source preparation");
  for (const invalidShape of [
    { status: "PUBLISHED" }, { status: "PAUSED" }, { status: "CLOSED" },
    { assessmentKind: "HISTORY_CLASSROOM" },
    { presentationSettings: { ...emptyQuiz.presentationSettings, active: true } },
    { sourceHash: undefined }, { itemCount: undefined },
    { sourceHash: "has-snapshot", itemCount: 0 }, { sourceHash: "", itemCount: 1 },
  ]) {
    store.documents.set(emptyQuizPath, { ...emptyQuiz, ...invalidShape });
    const invalidChecks = await checkEmptyQuiz();
    assert.equal(invalidChecks[0].status, "FAIL", JSON.stringify(invalidShape));
    assert.match(invalidChecks[0].evidence, /invalidPublication=1/);
  }
  store.documents.delete(emptyQuizPath);

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

  await runAnswerLimits();
  console.log(JSON.stringify({
    suite: "assessment-lifecycle-core",
    passed: true,
    cases: [
      "RESET_RESTART_BOTH_KINDS_AND_COMMANDS_WITH_IMMUTABLE_IDS",
      "MOCK_PAPER_ROUND_ISOLATION_ORDER_WEIGHTS_SNAPSHOTS_NO_ANSWER_LEAK_REPLAY",
      "MOCK_SET_EDIT_SHARED_ATOMIC_REVISIONS_SIBLING_PRESERVATION_STALE_AND_SCOPE_GATES",
      "MOCK_RETAKE_LIMIT_RESET_RESUME_LEGACY_OWNER_SEMESTER_AND_MASKED_READ_BOUNDS",
      "MOCK_STATE_PROJECTED_HISTORY_SINGLE_SELECTED_PAPER_SEMESTER_REUSE_AND_UNCHANGED_GATES",
      "SHORT_ANSWER_ALIASES_AUTHOR_PUBLISH_AUTOSAVE_GRADE_WEIGHTED_POINTS_LEGACY_TYPES_REPLAY_AND_SCOPE",
      "MOCK_SOURCE_EXACT_ROUND_BOUNDED_PROBE_LEGACY_FALLBACK_HASH_AND_FIRST_ROUND_KEY_MIGRATION",
      "LEGACY_MOCK_START_RECEIPT_REPLAY_STATUS_HINT_FILTER_IMMUTABLE_AND_NORMAL_HINTS_PRESERVED",
      "HISTORY_LESSON_METADATA_PRESERVED",
      "HISTORY_SOURCE_CREATION_PROVENANCE_PRESERVED_AND_REPAIRED",
      "QUIZ_PREFLIGHT_ZERO_WRITE",
      "HISTORY_PREFLIGHT_ZERO_WRITE",
      "EXPLICIT_START_ONLY",
      "CANONICAL_ENROLLMENT_TARGET",
      "CANONICAL_CLASS_TARGET_RESOLUTION",
      "CLIENT_QUESTION_SELECTION_REJECTED",
      "SOURCE_HASH_STALE_REJECTION",
      "CONCURRENT_START_EFFECT_ONCE",
      "SAVE_REVISION_AND_REPLAY",
      "TYPED_ANSWER_LIMITS_SAVE_SUBMIT_LEGACY_AND_UNKNOWN_KEYS",
      "SERVER_DEADLINE_PRESERVED",
      "SERVER_DEADLINE_MINUS_ONE_ZERO_PLUS_ONE_BOTH_KINDS",
      "SERVER_DEADLINE_TAMPER_REJECTED",
      "CLOSED_AND_ARCHIVED_START_REJECTED_BOTH_KINDS",
      "ATOMIC_SUBMISSION_RESULT_RECEIPT",
      "CONCURRENT_SUBMIT_EFFECT_ONCE",
      "SAME_UID_RELOGIN_RECOVERY",
      "TEACHER_CONTENT_COMMAND_CAS_AND_AUDIT_BOUNDARY",
      "TEACHER_CANONICAL_ACTIVE_CLASS_QUERY_SESSION_AND_PERMISSION",
      "QUIZ_CLASS_PUBLICATION_ATOMIC_VALIDATION_AND_CLEAR",
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
