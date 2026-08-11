const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const archiveEnrollment = require("../archiveEnrollment");
const assessment = require("../assessmentLifecycle");
const commandGateway = require("../commandGateway");
const grade = require("../gradeEvidence");

const clone = (value) => structuredClone(value);

class MemoryStore {
  constructor(seed = {}) {
    this.documents = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]));
    this.writeCount = 0;
    this.getLog = [];
    this.queryLog = [];
    this.queue = Promise.resolve();
  }

  snapshot(path) {
    const exists = this.documents.has(path);
    return { exists, path, data: exists ? clone(this.documents.get(path)) : null };
  }

  async get(path) {
    this.getLog.push(path);
    return this.snapshot(path);
  }

  async query(collectionPath, filter = null) {
    this.queryLog.push({ collectionPath, filter: clone(filter) });
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
      this.queryLog.push({ collectionPath, filter: clone(filter) });
      const prefix = `${collectionPath}/`;
      return [...staged.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .filter(([, data]) => !filter || data?.[filter.field] === filter.value)
        .map(([path, data]) => ({ exists: true, path, data: clone(data) }));
    };
    const transaction = {
      get: async (path) => {
        this.getLog.push(path);
        return read(path);
      },
      getAll: async (paths) => {
        this.getLog.push(...paths);
        return paths.map(read);
      },
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
const attemptId = `attempt_${"a".repeat(64)}`;
const definitionId = "quiz:2026-2:unit-one:formative";
const sourceHash = "b".repeat(64);
const enrollmentId = "enrollment_student_2026_2";
const classId = "class_one";
const studentUid = "student-uid";
const teacherUid = "teacher-uid";
const otherStudentUid = "other-student-uid";
const manifestPath = `semester_manifests/${semesterId}`;
const enrollmentSlotId = archiveEnrollment.buildEnrollmentSlotId(semesterId, studentUid);

const baseSeed = {
  [manifestPath]: {
    semesterId,
    status: "ACTIVE",
    revision: 7,
    schemaVersion: 1,
  },
  [`users/${teacherUid}`]: {
    role: "teacher",
    teacherPortalEnabled: true,
    staffPermissions: ["quiz_read"],
  },
  [`users/${studentUid}`]: { role: "student", teacherPortalEnabled: false },
  [`users/${otherStudentUid}`]: { role: "student", teacherPortalEnabled: false },
  [`${archiveEnrollment.SEMESTER_CLASS_COLLECTION}/${classId}`]: {
    classId,
    semesterId,
    status: "ACTIVE",
    grade: "3",
    classNumber: "1",
    displayName: "3학년 1반",
  },
  [`${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${enrollmentId}`]: {
    enrollmentId,
    semesterId,
    classId,
    studentUid,
    studentNumber: "7",
    enrollmentStatus: "ACTIVE",
    snapshot: {
      displayName: "학생 한 명",
      grade: "3",
      classNumber: "1",
      classDisplayName: "3학년 1반",
      studentNumber: "7",
    },
  },
  [`${archiveEnrollment.ENROLLMENT_SLOT_COLLECTION}/${enrollmentSlotId}`]: {
    semesterId,
    studentUid,
    activeEnrollmentId: enrollmentId,
    status: "ACTIVE",
  },
  [`${assessment.DEFINITION_COLLECTION}/${definitionId}`]: {
    definitionId,
    semesterId,
    title: "형성 평가",
    status: "PUBLISHED",
    revision: 3,
  },
  [`${assessment.ATTEMPT_COLLECTION}/${attemptId}`]: {
    attemptId,
    definitionId,
    definitionRevision: 3,
    semesterId,
    assessmentKind: "QUIZ",
    studentUid,
    enrollmentId,
    classId,
    attemptNumber: 1,
    status: "SUBMITTED",
    revision: 2,
    answers: { q1: "1", q2: "wrong" },
    questionIds: ["q1", "q2"],
    gradingSnapshot: [
      { id: "q1", answer: "1" },
      { id: "q2", answer: "2" },
    ],
    sourceHash,
    submittedAtIso: "2026-08-12T00:00:00.000Z",
    submissionRef: `${assessment.SUBMISSION_COLLECTION}/${attemptId}`,
    resultRef: `${assessment.RESULT_COLLECTION}/${attemptId}`,
  },
  [`${assessment.SUBMISSION_COLLECTION}/${attemptId}`]: {
    schemaVersion: 1,
    policyVersion: "w6a-v1",
    submissionId: attemptId,
    attemptId,
    definitionId,
    semesterId,
    studentUid,
    answers: { q1: "1", q2: "wrong" },
    attemptRevision: 2,
    sourceHash,
    submittedAtIso: "2026-08-12T00:00:00.000Z",
  },
  [`${assessment.RESULT_COLLECTION}/${attemptId}`]: {
    schemaVersion: 1,
    policyVersion: "w6a-v1",
    resultId: attemptId,
    attemptId,
    definitionId,
    semesterId,
    assessmentKind: "QUIZ",
    studentUid,
    enrollmentId,
    classId,
    score: 1,
    total: 2,
    percent: 50,
    answerChecks: [
      { id: "q1", correct: true },
      { id: "q2", correct: false },
    ],
    sourceHash,
    submittedAtIso: "2026-08-12T00:00:00.000Z",
    submissionRef: `${assessment.SUBMISSION_COLLECTION}/${attemptId}`,
  },
};

let commandSequence = 1;
const nextCommandId = () =>
  `00000000-0000-4000-8000-${String(commandSequence++).padStart(12, "0")}`;

const requestFor = (uid, payload, extra = {}) => ({
  auth: {
    uid,
    token: {
      email: uid === teacherUid
        ? "teacher@yongshin-ms.ms.kr"
        : `${uid}@yongshin-ms.ms.kr`,
    },
  },
  data: payload,
  ...extra,
});

const makeCore = (store) => {
  const adapter = grade.createGradeCommandAdapter();
  return commandGateway.createCommandGatewayCore({
    store,
    assertSession: async (request) => ({
      uid: request.auth.uid,
      email: request.auth.token.email,
      authTime: 1,
      authorityMode: "APPLICATION_SESSION",
      session: { sessionRevision: "test", authorityGeneration: "test", protocolVersion: 1 },
      sessionRef: { path: `application_sessions/${request.auth.uid}` },
    }),
    authorizeCommand: async ({ request, commandType }) => ({
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email,
      actorRole: grade.STUDENT_COMMAND_TYPES.has(commandType) ? "student" : "teacher",
      actorCapability: grade.STUDENT_COMMAND_TYPES.has(commandType) ? `grade:${commandType}` : "quiz_read",
    }),
    commandAdapters: Object.fromEntries(
      Object.values(grade.GRADE_COMMAND_TYPES).map((type) => [type, adapter]),
    ),
    serverTimestamp: () => "server-timestamp",
    projectId: "demo-westory-session-w6b",
  });
};

const execute = (core, uid, commandType, payload, options = {}) =>
  core.execute(requestFor(uid, {
    commandId: options.commandId || nextCommandId(),
    commandType,
    payload,
    ...(options.dropResponse ? { _testDropResponseAfterCommit: true } : {}),
  }));

const assertReason = async (promise, reason) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.details?.reason, reason, JSON.stringify({
      name: error?.name,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      stack: error?.stack,
    }));
    return true;
  });
};

const common = { semesterId, expectedSemesterRevision: 7 };

(async () => {
  assert.equal(Object.keys(grade.GRADE_COMMAND_TYPES).length, 8);
  assert.equal(grade.GRADE_RECORD_COLLECTION, "semester_grade_records");
  assert.equal(grade.GRADE_VERSION_COLLECTION, "semester_grade_versions");
  assert.equal(grade.GRADE_REQUEST_COLLECTION, "semester_grade_requests");
  assert.equal(grade.GRADE_ATTESTATION_COLLECTION, "semester_grade_attestations");
  assert.deepEqual(grade.SUPPORTED_RUBRIC_VERSIONS, [
    "rubric-v1",
    "w6b-rubric-v1",
    "w6b-assessment-v1",
  ]);
  assert.equal(grade.GRADE_STATEMENT_VERSION, "w6b-grade-statement-v1");
  assert.deepEqual(
    Object.keys(grade.createGradeCallableExports({
      core: { getGradeEvidenceState: async () => ({ status: "EMPTY" }) },
    })),
    ["getGradeEvidenceState"],
  );
  assert.equal(
    Object.values(grade.GRADE_COMMAND_TYPES).every((commandType) =>
      Object.values(commandGateway.COMMAND_TYPES).includes(commandType)),
    true,
  );
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  for (const exportName of [
    "notifyPerformanceScoreObjectionRequested",
    "notifyPerformanceScoreAnswerSheetRequested",
    "reviewPerformanceScoreObjection",
  ]) {
    const start = indexSource.indexOf(`exports.${exportName} =`);
    const end = indexSource.indexOf("\nexports.", start + 1);
    const callableSource = indexSource.slice(start, end < 0 ? undefined : end);
    assert.notEqual(start, -1, `${exportName} must remain an explicit retired callable`);
    assert.match(callableSource, /CLIENT_UPDATE_REQUIRED/);
    assert.match(callableSource, /executeCommand/);
  }

  const store = new MemoryStore(baseSeed);
  const core = makeCore(store);
  const queryCore = grade.createGradeQueryCore({
    store,
    assertSession: async (request) => ({
      uid: request.auth.uid,
      email: request.auth.token.email,
    }),
  });

  const teacherBefore = await queryCore.getGradeEvidenceState(requestFor(teacherUid, {
    audience: "teacher",
    semesterId,
    scoreKind: "performance",
    provenance: "CURRENT",
    _session: { sessionRevision: "test", authorityGeneration: "test", protocolVersion: 1 },
  }));
  assert.equal(teacherBefore.records.length, 0);
  assert.equal(teacherBefore.pendingSources.length, 1);
  assert.equal(teacherBefore.pendingSources[0].attemptId, attemptId);
  assert.equal(teacherBefore.pendingSources[0].enrollmentSnapshot.displayName, "학생 한 명");
  assert.equal(teacherBefore.manifestRevision, 7);
  assert.equal(teacherBefore.writeCount, 0);

  const createPayload = {
    ...common,
    sourceKind: "ASSESSMENT_RESULT",
    scoreKind: "performance",
    attemptId,
    title: "형성 평가 공식 성적",
    rubricVersion: "rubric-v1",
    reason: "W6A 결과를 채점 초안으로 가져옵니다.",
  };
  const lostCommandId = nextCommandId();
  await assertReason(
    execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT, createPayload, {
      commandId: lostCommandId,
      dropResponse: true,
    }),
    "TEST_RESPONSE_LOSS",
  );
  const recovered = await execute(
    core,
    teacherUid,
    grade.GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT,
    createPayload,
    { commandId: lostCommandId },
  );
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.result.status, "DRAFT");
  const { recordId } = recovered.result;
  const firstVersionId = recovered.result.versionId;
  const originalAttempt = clone(store.documents.get(`${assessment.ATTEMPT_COLLECTION}/${attemptId}`));
  const originalSubmission = clone(store.documents.get(`${assessment.SUBMISSION_COLLECTION}/${attemptId}`));
  const originalResult = clone(store.documents.get(`${assessment.RESULT_COLLECTION}/${attemptId}`));
  const draft = store.snapshot(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`).data;
  assert.equal(draft.scoreKind, "performance");
  assert.equal(draft.totalScore, 1);
  assert.equal(draft.totalMaxScore, 2);
  assert.equal(draft.enrollmentSnapshot.classDisplayName, "3학년 1반");

  const studentDraftView = await queryCore.getGradeEvidenceState(requestFor(studentUid, {
    audience: "student",
    semesterId,
    scoreKind: "performance",
    provenance: "CURRENT",
  }));
  assert.equal(studentDraftView.records.length, 0);

  await assertReason(
    execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.REVIEW_GRADE_DRAFT, {
      ...common,
      recordId,
      expectedRevision: 99,
      expectedGradeRevision: 1,
      items: [
        { itemId: "q1", maxScore: 1, awardedScore: 1, evaluationKind: "AUTO", evidence: "W6A", reason: "" },
        { itemId: "q2", maxScore: 1, awardedScore: 0.5, evaluationKind: "TEACHER", evidence: "rubric", reason: "부분 점수" },
      ],
      reason: "교사 검토",
    }),
    "GRADE_REVISION_CONFLICT",
  );

  const reviewed = await execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.REVIEW_GRADE_DRAFT, {
    ...common,
    recordId,
    expectedRevision: 1,
    expectedGradeRevision: 1,
    items: [
      { itemId: "q1", maxScore: 1, awardedScore: 1, evaluationKind: "AUTO", evidence: "W6A", reason: "" },
      { itemId: "q2", maxScore: 1, awardedScore: 0.5, evaluationKind: "TEACHER", evidence: "rubric", reason: "부분 점수" },
    ],
    reason: "교사 검토",
  });
  assert.equal(reviewed.result.status, "REVIEWED");
  assert.equal(reviewed.result.gradeRevision, 2);
  assert.equal(store.snapshot(`${grade.GRADE_VERSION_COLLECTION}/${firstVersionId}`).data.gradeRevision, 1);

  const finalized = await execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.FINALIZE_GRADE_EVIDENCE, {
    ...common,
    recordId,
    expectedRevision: 2,
    expectedGradeRevision: 2,
    expectedVersionId: reviewed.result.versionId,
    reason: "근거 확정",
  });
  assert.equal(finalized.result.status, "EVIDENCE_LOCKED");

  const published = await execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.PUBLISH_OFFICIAL_GRADE, {
    ...common,
    recordId,
    expectedRevision: 3,
    expectedGradeRevision: 2,
    expectedVersionId: reviewed.result.versionId,
    signatureRequired: true,
    reason: "학생 확인 요청",
  });
  assert.equal(published.result.status, "OFFICIAL_PENDING_SIGNATURE");

  store.queryLog = [];
  const studentPublishedView = await queryCore.getGradeEvidenceState(requestFor(studentUid, {
    audience: "student",
    semesterId,
    scoreKind: "performance",
    provenance: "CURRENT",
  }));
  assert.equal(studentPublishedView.records.length, 1);
  assert.equal(studentPublishedView.records[0].recordId, recordId);
  assert.equal(
    store.queryLog.some(({ collectionPath, filter }) =>
      collectionPath === grade.GRADE_RECORD_COLLECTION
      && filter?.field === "studentUid"
      && filter?.value === studentUid),
    true,
  );
  assert.equal(
    store.queryLog.some(({ collectionPath, filter }) =>
      collectionPath === grade.GRADE_RECORD_COLLECTION && filter?.field === "semesterId"),
    false,
  );
  store.getLog = [];
  store.queryLog = [];
  const publishedDetail = await queryCore.getGradeEvidenceState(requestFor(studentUid, {
    audience: "student",
    semesterId,
    recordId,
    scoreKind: "performance",
    provenance: "CURRENT",
  }));
  assert.deepEqual(publishedDetail.detail.sourceEvidence.answers, { q1: "1", q2: "wrong" });
  assert.deepEqual(publishedDetail.detail.sourceEvidence.answerChecks, [
    { itemId: "q1", correct: true },
    { itemId: "q2", correct: false },
  ]);
  assert.equal(publishedDetail.detail.sourceEvidence.answerKeyIncluded, false);
  assert.equal(publishedDetail.detail.version.sourceSnapshotHash, draft.sourceSnapshotHash);
  assert.equal(store.getLog.includes(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`), true);
  assert.equal(
    store.queryLog.some(({ collectionPath }) => collectionPath === grade.GRADE_RECORD_COLLECTION),
    false,
  );
  const otherStudentDetail = await queryCore.getGradeEvidenceState(requestFor(otherStudentUid, {
    audience: "student",
    semesterId,
    recordId,
    scoreKind: "performance",
    provenance: "CURRENT",
  }));
  assert.equal(otherStudentDetail.records.length, 0);
  assert.equal(otherStudentDetail.detail, null);

  const requested = await execute(core, studentUid, grade.GRADE_COMMAND_TYPES.REQUEST_GRADE_REVIEW, {
    ...common,
    recordId,
    expectedRevision: 4,
    expectedGradeRevision: 2,
    requestKind: "OBJECTION",
    reason: "두 번째 문항의 부분 점수 근거를 확인하고 싶습니다.",
  });
  assert.equal(requested.result.status, "PENDING");

  const acknowledged = await execute(core, studentUid, grade.GRADE_COMMAND_TYPES.ACKNOWLEDGE_GRADE_EVIDENCE, {
    ...common,
    recordId,
    expectedRevision: 4,
    expectedGradeRevision: 2,
    statementVersion: grade.GRADE_STATEMENT_VERSION,
  });
  assert.match(acknowledged.result.attestationId, /^gradeatt_/);

  await assertReason(
    execute(core, studentUid, grade.GRADE_COMMAND_TYPES.SIGN_OFFICIAL_GRADE, {
      ...common,
      recordId,
      expectedRevision: 4,
      expectedGradeRevision: 2,
      signatureName: "학생 한 명",
      statementVersion: "wrong-statement",
    }),
    "GRADE_STATEMENT_VERSION_UNSUPPORTED",
  );
  const signed = await execute(core, studentUid, grade.GRADE_COMMAND_TYPES.SIGN_OFFICIAL_GRADE, {
    ...common,
    recordId,
    expectedRevision: 4,
    expectedGradeRevision: 2,
    signatureName: "학생 한 명",
    statementVersion: grade.GRADE_STATEMENT_VERSION,
  });
  assert.equal(signed.result.status, "OFFICIAL");
  const signaturePath = `${grade.GRADE_ATTESTATION_COLLECTION}/${signed.result.attestationId}`;
  const signatureBeforeCorrection = store.snapshot(signaturePath).data;
  assert.equal(signatureBeforeCorrection.signatureImage, undefined);
  assert.equal(signatureBeforeCorrection.gradeRevision, 2);
  const signedDetail = await queryCore.getGradeEvidenceState(requestFor(studentUid, {
    audience: "student",
    semesterId,
    recordId,
    scoreKind: "performance",
    provenance: "CURRENT",
  }));
  assert.equal(signedDetail.detail.attestations.length, 2);
  assert.equal(signedDetail.detail.attestations.every((item) => item.createdAt === "server-timestamp"), true);
  assert.equal(signedDetail.detail.requests[0].createdBy, studentUid);
  assert.equal(signedDetail.detail.requests[0].createdAt, "server-timestamp");

  const corrected = await execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.CORRECT_OFFICIAL_GRADE, {
    ...common,
    recordId,
    expectedRevision: 5,
    expectedGradeRevision: 2,
    resolution: "CORRECT",
    requestId: requested.result.requestId,
    items: [
      { itemId: "q1", maxScore: 1, awardedScore: 1, evaluationKind: "AUTO", evidence: "W6A", reason: "" },
      { itemId: "q2", maxScore: 1, awardedScore: 1, evaluationKind: "TEACHER", evidence: "rubric", reason: "이의 검토 반영" },
    ],
    reason: "이의 신청을 검토해 부분 점수를 정정했습니다.",
  });
  assert.equal(corrected.result.gradeRevision, 3);
  assert.equal(corrected.result.status, "REVIEWED");
  assert.equal(store.snapshot(signaturePath).exists, true);
  assert.deepEqual(store.snapshot(signaturePath).data, signatureBeforeCorrection);
  assert.equal(store.snapshot(`${grade.GRADE_REQUEST_COLLECTION}/${requested.result.requestId}`).data.status, "ACCEPTED");
  const correctedRecord = store.snapshot(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`).data;
  assert.equal(correctedRecord.officialVersionId, null);
  assert.equal(correctedRecord.signedAttestationId, null);
  assert.equal(correctedRecord.signedBy, null);
  assert.equal(correctedRecord.signedAt, null);
  const correctedDetail = await queryCore.getGradeEvidenceState(requestFor(teacherUid, {
    audience: "teacher",
    semesterId,
    recordId,
    scoreKind: "performance",
    provenance: "CURRENT",
  }));
  assert.equal(correctedDetail.detail.attestations.length, 0);
  assert.equal(correctedDetail.detail.requests[0].resolvedBy, teacherUid);
  assert.equal(correctedDetail.detail.requests[0].resolvedAt, "server-timestamp");

  const correctedFinalized = await execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.FINALIZE_GRADE_EVIDENCE, {
    ...common,
    recordId,
    expectedRevision: 6,
    expectedGradeRevision: 3,
    expectedVersionId: corrected.result.versionId,
    reason: "정정 근거 확정",
  });
  assert.equal(correctedFinalized.result.status, "EVIDENCE_LOCKED");
  const republished = await execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.PUBLISH_OFFICIAL_GRADE, {
    ...common,
    recordId,
    expectedRevision: 7,
    expectedGradeRevision: 3,
    expectedVersionId: corrected.result.versionId,
    signatureRequired: false,
    reason: "정정 성적 재공개",
  });
  assert.equal(republished.result.status, "OFFICIAL");
  const republishedRecord = store.snapshot(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`).data;
  assert.equal(republishedRecord.officialVersionId, corrected.result.versionId);
  assert.equal(republishedRecord.signedAttestationId, null);

  const answerRequest = await execute(core, studentUid, grade.GRADE_COMMAND_TYPES.REQUEST_GRADE_REVIEW, {
    ...common,
    recordId,
    expectedRevision: 8,
    expectedGradeRevision: 3,
    requestKind: "ANSWER_SHEET",
    reason: "정정된 답안 근거를 다시 확인하고 싶습니다.",
  });
  const versionCountBeforeReject = (await store.query(grade.GRADE_VERSION_COLLECTION, {
    field: "semesterId",
    value: semesterId,
  })).length;
  const rejected = await execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.CORRECT_OFFICIAL_GRADE, {
    ...common,
    recordId,
    expectedRevision: 8,
    expectedGradeRevision: 3,
    resolution: "REJECT",
    requestId: answerRequest.result.requestId,
    reason: "공개된 근거와 점수 계산이 일치해 정정하지 않습니다.",
  });
  assert.equal(rejected.result.requestStatus, "REJECTED");
  assert.equal(rejected.result.revision, 8);
  assert.equal((await store.query(grade.GRADE_VERSION_COLLECTION, {
    field: "semesterId",
    value: semesterId,
  })).length, versionCountBeforeReject);
  assert.equal(store.snapshot(`${grade.GRADE_REQUEST_COLLECTION}/${answerRequest.result.requestId}`).data.status, "REJECTED");

  assert.deepEqual(store.snapshot(`${assessment.ATTEMPT_COLLECTION}/${attemptId}`).data, originalAttempt);
  assert.deepEqual(store.snapshot(`${assessment.SUBMISSION_COLLECTION}/${attemptId}`).data, originalSubmission);
  assert.deepEqual(store.snapshot(`${assessment.RESULT_COLLECTION}/${attemptId}`).data, originalResult);

  assert.throws(
    () => grade.normalizeGradePayload(grade.GRADE_COMMAND_TYPES.REVIEW_GRADE_DRAFT, {
      ...common,
      recordId,
      expectedRevision: 1,
      expectedGradeRevision: 1,
      items: [{
        itemId: "invalid-range",
        maxScore: 1,
        awardedScore: 2,
        evaluationKind: "TEACHER",
        evidence: "rubric",
        reason: "",
      }],
      reason: "range fixture",
    }),
    (error) => error?.details?.reason === "GRADE_ITEMS_INVALID",
  );
  assert.throws(
    () => grade.normalizeGradePayload(grade.GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT, {
      ...createPayload,
      rubricVersion: "unsupported-rubric-v999",
    }),
    (error) => error?.details?.reason === "GRADE_RUBRIC_VERSION_UNSUPPORTED",
  );

  const concurrentStore = new MemoryStore(baseSeed);
  const concurrentCore = makeCore(concurrentStore);
  const concurrentResults = await Promise.allSettled([
    execute(concurrentCore, teacherUid, grade.GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT, createPayload),
    execute(concurrentCore, teacherUid, grade.GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT, createPayload),
  ]);
  assert.equal(concurrentResults.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(concurrentResults.filter((item) => item.status === "rejected").length, 1);
  assert.equal(
    concurrentResults.find((item) => item.status === "rejected").reason?.details?.reason,
    "GRADE_RECORD_EXISTS",
  );
  assert.equal((await concurrentStore.query(grade.GRADE_RECORD_COLLECTION)).length, 1);
  assert.equal((await concurrentStore.query(grade.GRADE_VERSION_COLLECTION)).length, 1);

  const readiness = grade.createGradeReadinessAdapter();
  const readinessChecks = await store.runTransaction((transaction) => readiness.evaluate({
    transaction,
    manifest: store.snapshot(manifestPath).data,
  }));
  assert.equal(readinessChecks.length, 1);
  assert.equal(readinessChecks[0].checkId, "grade_evidence_readiness");
  assert.equal(readinessChecks[0].status, "PASS");
  assert.match(readinessChecks[0].evidence, /pendingRequests=0/);
  assert.match(readinessChecks[0].evidence, /unsupportedVersions=0/);

  const currentRecord = store.snapshot(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`).data;
  const currentVersionPath = `${grade.GRADE_VERSION_COLLECTION}/${currentRecord.currentVersionId}`;
  const supportedCurrentVersion = store.snapshot(currentVersionPath).data;
  store.documents.set(currentVersionPath, { ...supportedCurrentVersion, rubricVersion: "unsupported-rubric-v999" });
  const unsupportedReadiness = await store.runTransaction((transaction) => readiness.evaluate({
    transaction,
    manifest: store.snapshot(manifestPath).data,
  }));
  assert.equal(unsupportedReadiness[0].status, "FAIL");
  assert.match(unsupportedReadiness[0].evidence, /unsupportedVersions=1/);
  store.documents.set(currentVersionPath, supportedCurrentVersion);

  const supportedCurrentRecord = store.snapshot(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`).data;
  store.documents.set(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`, {
    ...supportedCurrentRecord,
    enrollmentSnapshot: { ...supportedCurrentRecord.enrollmentSnapshot, displayName: "변조된 이름" },
  });
  const snapshotMismatchReadiness = await store.runTransaction((transaction) => readiness.evaluate({
    transaction,
    manifest: store.snapshot(manifestPath).data,
  }));
  assert.equal(snapshotMismatchReadiness[0].status, "FAIL");
  assert.match(snapshotMismatchReadiness[0].evidence, /orphanEnrollments=1/);
  store.documents.set(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`, supportedCurrentRecord);

  store.documents.set(`${assessment.RESULT_COLLECTION}/${attemptId}`, {
    ...store.documents.get(`${assessment.RESULT_COLLECTION}/${attemptId}`),
    sourceHash: "c".repeat(64),
  });
  await assertReason(
    queryCore.getGradeEvidenceState(requestFor(teacherUid, {
      audience: "teacher",
      semesterId,
      recordId,
      scoreKind: "performance",
      provenance: "CURRENT",
    })),
    "GRADE_SOURCE_EVIDENCE_INVALID",
  );
  store.documents.set(`${assessment.RESULT_COLLECTION}/${attemptId}`, clone(originalResult));

  const activeManifest = clone(store.documents.get(manifestPath));
  store.documents.set(manifestPath, { ...activeManifest, status: "PREPARING" });
  const preparingProjection = await queryCore.getGradeEvidenceState(requestFor(studentUid, {
    audience: "student",
    semesterId,
    scoreKind: "performance",
    provenance: "CURRENT",
  }));
  assert.equal(preparingProjection.provenance, "PREPARING");
  assert.equal(preparingProjection.readOnly, true);
  store.documents.set(manifestPath, { ...activeManifest, status: "CLOSING" });
  const closingProjection = await queryCore.getGradeEvidenceState(requestFor(studentUid, {
    audience: "student",
    semesterId,
    scoreKind: "performance",
    provenance: "CURRENT",
  }));
  assert.equal(closingProjection.provenance, "CURRENT");
  assert.equal(closingProjection.readOnly, true);
  store.documents.set(manifestPath, activeManifest);
  const activeProjection = await queryCore.getGradeEvidenceState(requestFor(studentUid, {
    audience: "student",
    semesterId,
    scoreKind: "performance",
    provenance: "CURRENT",
  }));
  assert.equal(activeProjection.provenance, "CURRENT");
  assert.equal(activeProjection.readOnly, false);

  const mismatchStore = new MemoryStore(baseSeed);
  mismatchStore.documents.set(`${assessment.RESULT_COLLECTION}/${attemptId}`, {
    ...mismatchStore.documents.get(`${assessment.RESULT_COLLECTION}/${attemptId}`),
    sourceHash: "c".repeat(64),
  });
  await assertReason(
    execute(makeCore(mismatchStore), teacherUid, grade.GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT, createPayload),
    "ASSESSMENT_GRADE_SOURCE_MISMATCH",
  );
  assert.equal((await mismatchStore.query(grade.GRADE_RECORD_COLLECTION)).length, 0);
  const mismatchQueryCore = grade.createGradeQueryCore({
    store: mismatchStore,
    assertSession: async (request) => ({ uid: request.auth.uid, email: request.auth.token.email }),
  });
  const mismatchQueue = await mismatchQueryCore.getGradeEvidenceState(requestFor(teacherUid, {
    audience: "teacher",
    semesterId,
    scoreKind: "performance",
    provenance: "CURRENT",
  }));
  assert.equal(mismatchQueue.pendingSources.length, 0);

  await assertReason(
    queryCore.getGradeEvidenceState(requestFor(studentUid, {
      audience: "student",
      semesterId,
      scoreKind: "performance",
      provenance: "ARCHIVE",
    })),
    "GRADE_PROVENANCE_MISMATCH",
  );

  store.documents.set(manifestPath, {
    ...store.documents.get(manifestPath),
    status: "ARCHIVED",
  });
  await assertReason(
    execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT, {
      ...common,
      sourceKind: "MANUAL_IMPORT",
      scoreKind: "performance",
      manualSourceId: "manual-one",
      studentUid,
      enrollmentId,
      classId,
      sourceHash: "d".repeat(64),
      title: "수행평가",
      rubricVersion: "rubric-v1",
      items: [{ itemId: "item-one", maxScore: 10, awardedScore: 9, evaluationKind: "TEACHER", evidence: "rubric", reason: "" }],
      reason: "archive denial test",
    }),
    "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
  );

  const writesBeforeArchiveQuery = store.writeCount;
  const archived = await queryCore.getGradeEvidenceState(requestFor(studentUid, {
    audience: "student",
    semesterId,
    scoreKind: "performance",
    provenance: "ARCHIVE",
  }));
  assert.equal(archived.status, "ARCHIVED");
  assert.equal(archived.readOnly, true);
  assert.equal(archived.records.length, 1);
  assert.equal(archived.provenance, "ARCHIVE");
  const archivedDetail = await queryCore.getGradeEvidenceState(requestFor(studentUid, {
    audience: "student",
    semesterId,
    recordId,
    scoreKind: "performance",
    provenance: "ARCHIVE",
  }));
  assert.equal(archivedDetail.detail.record.provenance, "ARCHIVE");
  assert.equal(archivedDetail.detail.record.readOnly, true);
  const legacy = await queryCore.getGradeEvidenceState(requestFor(studentUid, {
    audience: "student",
    semesterId,
    scoreKind: "performance",
    provenance: "LEGACY",
  }));
  assert.equal(legacy.status, "LEGACY");
  assert.equal(legacy.records.length, 0);
  assert.equal(store.writeCount, writesBeforeArchiveQuery);

  store.documents.set(`${grade.GRADE_LEGACY_ISSUE_COLLECTION}/issue-one`, {
    semesterId,
    status: "OPEN",
  });
  const failingReadiness = await store.runTransaction((transaction) => readiness.evaluate({
    transaction,
    manifest: store.snapshot(manifestPath).data,
  }));
  assert.equal(failingReadiness[0].status, "FAIL");
  assert.match(failingReadiness[0].evidence, /blockingLegacyIssues=1/);

  console.log(JSON.stringify({
    suite: "grade-evidence-core",
    cases: 67,
    commandTypes: Object.values(grade.GRADE_COMMAND_TYPES),
    queryCallable: "getGradeEvidenceState",
    readinessCheckId: "grade_evidence_readiness",
    status: "PASS",
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
