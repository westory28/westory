const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const archiveEnrollment = require("../archiveEnrollment");
const assessment = require("../assessmentLifecycle");
const commandGateway = require("../commandGateway");
const grade = require("../gradeEvidence");

const clone = (value) => structuredClone(value);

const queryMemoryDocuments = (documents, collectionPath, filter = null) => {
  const prefix = `${collectionPath}/`;
  const clauses = Array.isArray(filter?.filters)
    ? filter.filters
    : filter?.field
      ? [filter]
      : [];
  let matches = [...documents.entries()]
    .filter(
      ([path]) =>
        path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
    )
    .filter(([, data]) =>
      clauses.every(
        (clause) =>
          clause.operator === "==" && data?.[clause.field] === clause.value,
      ),
    );
  if (filter?.documentIdOrder) {
    const direction = filter.documentIdOrder === "desc" ? -1 : 1;
    matches.sort((left, right) =>
      left[0].slice(prefix.length).localeCompare(right[0].slice(prefix.length)) *
      direction,
    );
    if (filter.startAfterId) {
      const cursorIndex = matches.findIndex(
        ([path]) => path.slice(prefix.length) === filter.startAfterId,
      );
      matches = cursorIndex >= 0 ? matches.slice(cursorIndex + 1) : [];
    }
  }
  if (Number.isSafeInteger(filter?.limit) && filter.limit > 0) {
    matches = matches.slice(0, filter.limit);
  }
  return matches.map(([path, data]) => ({
    exists: true,
    path,
    data: clone(data),
  }));
};

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
    return {
      exists,
      path,
      data: exists ? clone(this.documents.get(path)) : null,
    };
  }

  async get(path) {
    this.getLog.push(path);
    return this.snapshot(path);
  }

  async query(collectionPath, filter = null) {
    this.queryLog.push({ collectionPath, filter: clone(filter) });
    return queryMemoryDocuments(this.documents, collectionPath, filter);
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
      return queryMemoryDocuments(staged, collectionPath, filter);
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
        const next = options?.merge && staged.has(path) ? { ...clone(staged.get(path)), ...clone(data) } : clone(data);
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
const delegatedUid = "delegated-grade-reader";
const otherStudentUid = "other-student-uid";
const manifestPath = `semester_manifests/${semesterId}`;
const enrollmentSlotId = archiveEnrollment.buildEnrollmentSlotId(semesterId, studentUid);

const baseSeed = {
  "site_settings/semester_active": {
    semesterId,
    revision: 7,
  },
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
  [`users/${delegatedUid}`]: {
    role: "student",
    teacherPortalEnabled: true,
    staffPermissions: ["quiz_read"],
  },
  [`users/${studentUid}`]: { role: "student", teacherPortalEnabled: false },
  [`users/${otherStudentUid}`]: {
    role: "student",
    teacherPortalEnabled: false,
  },
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
const nextCommandId = () => `00000000-0000-4000-8000-${String(commandSequence++).padStart(12, "0")}`;

const requestFor = (uid, payload, extra = {}) => ({
  auth: {
    uid,
    token: {
      email: uid === teacherUid ? "teacher@yongshin-ms.ms.kr" : `${uid}@yongshin-ms.ms.kr`,
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
      session: {
        sessionRevision: "test",
        authorityGeneration: "test",
        protocolVersion: 1,
      },
      sessionRef: { path: `application_sessions/${request.auth.uid}` },
    }),
    authorizeCommand: async ({ request, commandType }) => {
      const profile = store.snapshot(`users/${request.auth.uid}`).data || {};
      return {
        actorUid: request.auth.uid,
        actorEmail: request.auth.token.email,
        actorRole: profile.role || "",
        actorCapability: grade.STUDENT_COMMAND_TYPES.has(commandType) ? `grade:${commandType}` : "quiz_read",
      };
    },
    commandAdapters: Object.fromEntries(Object.values(grade.GRADE_COMMAND_TYPES).map((type) => [type, adapter])),
    serverTimestamp: () => "server-timestamp",
    projectId: "demo-westory-session-w6b",
  });
};

const execute = (core, uid, commandType, payload, options = {}) =>
  core.execute(
    requestFor(uid, {
      commandId: options.commandId || nextCommandId(),
      commandType,
      payload,
      ...(options.dropResponse ? { _testDropResponseAfterCommit: true } : {}),
    }),
  );

const assertReason = async (promise, reason) => {
  await assert.rejects(promise, (error) => {
    assert.equal(
      error?.details?.reason,
      reason,
      JSON.stringify({
        name: error?.name,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        stack: error?.stack,
      }),
    );
    return true;
  });
};

const common = { semesterId, expectedSemesterRevision: 7 };

const legacyWarningHash = (value) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const buildLegacyRosterPayload = ({ rosterId = "legacy-roster-one", records = null, rows = null } = {}) => {
  const baseItem = {
    name: "역사 탐구 보고서",
    itemKey: "history-report",
    score: 9,
    maxScore: 10,
    ratio: 100,
    scoreEntered: true,
    feedback: "근거 확인 완료",
  };
  const baseRecord = {
    uid: studentUid,
    grade: "3",
    class: "1",
    number: "7",
    studentName: "학생 한 명",
    items: [baseItem],
    enteredScoreCount: 1,
    totalScore: 9,
    totalMaxScore: 10,
    feedback: "근거 확인 완료",
    evidence: "교사 채점표",
  };
  const normalizedRecords = records || [baseRecord];
  const normalizedRows =
    rows ||
    normalizedRecords.map((record, index) => ({
      rowNumber: index + 1,
      ...record,
      matchStatus: "matched",
      matchMessage: "",
    }));
  return {
    ...common,
    rosterId,
    expectedRosterRevision: 0,
    mode: "CREATE",
    roster: {
      scoreKind: "performance",
      title: "역사 탐구 보고서",
      subject: "역사",
      targetGrade: "3",
      targetClass: "1",
      classes: ["1"],
      items: [{ ...baseItem, score: 0, scoreEntered: false }],
      totalMaxScore: 10,
      rowCount: normalizedRows.length,
      matchedCount: normalizedRows.filter((row) => row.uid).length,
      unmatchedCount: normalizedRows.filter((row) => !row.uid).length,
      sourceFileName: "history-report.xlsx",
      rows: normalizedRows,
      uploadedByEmail: "teacher@yongshin-ms.ms.kr",
    },
    records: normalizedRecords,
    reason: "레거시 수행평가를 W6B 원장에 저장합니다.",
  };
};

(async () => {
  assert.equal(Object.keys(grade.GRADE_COMMAND_TYPES).length, 16);
  assert.equal(grade.GRADE_RECORD_COLLECTION, "semester_grade_records");
  assert.equal(grade.GRADE_VERSION_COLLECTION, "semester_grade_versions");
  assert.equal(grade.GRADE_REQUEST_COLLECTION, "semester_grade_requests");
  assert.equal(grade.GRADE_ATTESTATION_COLLECTION, "semester_grade_attestations");
  assert.deepEqual(grade.SUPPORTED_RUBRIC_VERSIONS, ["rubric-v1", "w6b-rubric-v1", "w6b-assessment-v1"]);
  assert.equal(grade.GRADE_STATEMENT_VERSION, "w6b-grade-statement-v1");
  assert.deepEqual(
    Object.keys(
      grade.createGradeCallableExports({
        core: { getGradeEvidenceState: async () => ({ status: "EMPTY" }) },
      }),
    ),
    ["getGradeEvidenceState"],
  );
  assert.equal(
    Object.values(grade.GRADE_COMMAND_TYPES).every((commandType) => Object.values(commandGateway.COMMAND_TYPES).includes(commandType)),
    true,
  );
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const gradeAuthorizationStart = indexSource.indexOf(
    "if (gradeCommandTypes.includes(commandType))",
  );
  const gradeAuthorizationEnd = indexSource.indexOf(
    "if (assessmentCommandTypes.includes(commandType))",
    gradeAuthorizationStart,
  );
  const gradeAuthorizationSource = indexSource.slice(
    gradeAuthorizationStart,
    gradeAuthorizationEnd,
  );
  assert.match(gradeAuthorizationSource, /if \(role !== "teacher"\)/u);
  assert.match(gradeAuthorizationSource, /actorCapability: "teacher_role"/u);
  assert.doesNotMatch(gradeAuthorizationSource, /quiz_read/u);
  const historySource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "src",
      "pages",
      "student",
      "History.tsx",
    ),
    "utf8",
  );
  assert.match(historySource, /getReleasedExamAnswers/u);
  assert.doesNotMatch(historySource, /getDoc|exam_config/u);
  for (const marker of [
    "student-exam-answers-permission",
    "student-exam-answers-error",
    "student-exam-answers-not-released",
    "student-exam-answers-empty",
    "student-exam-answers-ready",
  ]) {
    assert.match(historySource, new RegExp(marker, "u"));
  }
  assert.match(historySource, /다시 불러오기/u);
  const omrConfigSource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "src",
      "pages",
      "teacher",
      "components",
      "ExamOmrConfig.tsx",
    ),
    "utf8",
  );
  assert.match(omrConfigSource, /w6b-answer-release-v1/u);
  assert.match(omrConfigSource, /학생에게 공개/u);
  for (const exportName of ["notifyPerformanceScoreObjectionRequested", "notifyPerformanceScoreAnswerSheetRequested", "reviewPerformanceScoreObjection"]) {
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

  await assertReason(
    queryCore.getGradeEvidenceState(
      requestFor(delegatedUid, {
        audience: "teacher",
        semesterId,
        scoreKind: "performance",
        provenance: "CURRENT",
      }),
    ),
    "GRADE_MANAGE_REQUIRED",
  );
  const normalTeacherProfile = store.documents.get(`users/${teacherUid}`);
  store.documents.set(`users/${teacherUid}`, { role: "teacher" });
  const teacherWithoutLegacyFlags = await queryCore.getGradeEvidenceState(
    requestFor(teacherUid, {
      audience: "teacher",
      semesterId,
      scoreKind: "performance",
      provenance: "CURRENT",
    }),
  );
  assert.equal(teacherWithoutLegacyFlags.pendingSources.length, 1);
  store.documents.set(`users/${teacherUid}`, normalTeacherProfile);

  const teacherBefore = await queryCore.getGradeEvidenceState(
    requestFor(teacherUid, {
      audience: "teacher",
      semesterId,
      scoreKind: "performance",
      provenance: "CURRENT",
      _session: {
        sessionRevision: "test",
        authorityGeneration: "test",
        protocolVersion: 1,
      },
    }),
  );
  assert.equal(teacherBefore.records.length, 0);
  assert.equal(teacherBefore.pendingSources.length, 1);
  assert.equal(teacherBefore.pendingSources[0].attemptId, attemptId);
  assert.equal(teacherBefore.pendingSources[0].enrollmentSnapshot.displayName, "학생 한 명");
  assert.equal(teacherBefore.activeStudents.length, 1);
  assert.equal(teacherBefore.activeStudents[0].studentUid, studentUid);
  assert.equal(teacherBefore.activeStudents[0].enrollmentSnapshot.displayName, "학생 한 명");
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
  const recovered = await execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT, createPayload, {
    commandId: lostCommandId,
  });
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

  const studentDraftView = await queryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      audience: "student",
      semesterId,
      scoreKind: "performance",
      provenance: "CURRENT",
    }),
  );
  assert.equal(studentDraftView.records.length, 0);

  await assertReason(
    execute(core, teacherUid, grade.GRADE_COMMAND_TYPES.REVIEW_GRADE_DRAFT, {
      ...common,
      recordId,
      expectedRevision: 99,
      expectedGradeRevision: 1,
      items: [
        {
          itemId: "q1",
          maxScore: 1,
          awardedScore: 1,
          evaluationKind: "AUTO",
          evidence: "W6A",
          reason: "",
        },
        {
          itemId: "q2",
          maxScore: 1,
          awardedScore: 0.5,
          evaluationKind: "TEACHER",
          evidence: "rubric",
          reason: "부분 점수",
        },
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
      {
        itemId: "q1",
        maxScore: 1,
        awardedScore: 1,
        evaluationKind: "AUTO",
        evidence: "W6A",
        reason: "",
      },
      {
        itemId: "q2",
        maxScore: 1,
        awardedScore: 0.5,
        evaluationKind: "TEACHER",
        evidence: "rubric",
        reason: "부분 점수",
      },
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
  const studentPublishedView = await queryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      audience: "student",
      semesterId,
      scoreKind: "performance",
      provenance: "CURRENT",
    }),
  );
  assert.equal(studentPublishedView.records.length, 1);
  assert.equal(studentPublishedView.records[0].recordId, recordId);
  assert.equal(
    store.queryLog.some(
      ({ collectionPath, filter }) => collectionPath === grade.GRADE_RECORD_COLLECTION && filter?.field === "studentUid" && filter?.value === studentUid,
    ),
    true,
  );
  assert.equal(
    store.queryLog.some(({ collectionPath, filter }) => collectionPath === grade.GRADE_RECORD_COLLECTION && filter?.field === "semesterId"),
    false,
  );
  store.getLog = [];
  store.queryLog = [];
  const publishedDetail = await queryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      audience: "student",
      semesterId,
      recordId,
      scoreKind: "performance",
      provenance: "CURRENT",
    }),
  );
  assert.deepEqual(publishedDetail.detail.sourceEvidence.answers, {
    q1: "1",
    q2: "wrong",
  });
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
  const otherStudentDetail = await queryCore.getGradeEvidenceState(
    requestFor(otherStudentUid, {
      audience: "student",
      semesterId,
      recordId,
      scoreKind: "performance",
      provenance: "CURRENT",
    }),
  );
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
  const signedDetail = await queryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      audience: "student",
      semesterId,
      recordId,
      scoreKind: "performance",
      provenance: "CURRENT",
    }),
  );
  assert.equal(signedDetail.detail.attestations.length, 2);
  assert.equal(
    signedDetail.detail.attestations.every((item) => item.createdAt === "server-timestamp"),
    true,
  );
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
      {
        itemId: "q1",
        maxScore: 1,
        awardedScore: 1,
        evaluationKind: "AUTO",
        evidence: "W6A",
        reason: "",
      },
      {
        itemId: "q2",
        maxScore: 1,
        awardedScore: 1,
        evaluationKind: "TEACHER",
        evidence: "rubric",
        reason: "이의 검토 반영",
      },
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
  const correctedDetail = await queryCore.getGradeEvidenceState(
    requestFor(teacherUid, {
      audience: "teacher",
      semesterId,
      recordId,
      scoreKind: "performance",
      provenance: "CURRENT",
    }),
  );
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
  const versionCountBeforeReject = (
    await store.query(grade.GRADE_VERSION_COLLECTION, {
      field: "semesterId",
      value: semesterId,
    })
  ).length;
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
  assert.equal(
    (
      await store.query(grade.GRADE_VERSION_COLLECTION, {
        field: "semesterId",
        value: semesterId,
      })
    ).length,
    versionCountBeforeReject,
  );
  assert.equal(store.snapshot(`${grade.GRADE_REQUEST_COLLECTION}/${answerRequest.result.requestId}`).data.status, "REJECTED");

  assert.deepEqual(store.snapshot(`${assessment.ATTEMPT_COLLECTION}/${attemptId}`).data, originalAttempt);
  assert.deepEqual(store.snapshot(`${assessment.SUBMISSION_COLLECTION}/${attemptId}`).data, originalSubmission);
  assert.deepEqual(store.snapshot(`${assessment.RESULT_COLLECTION}/${attemptId}`).data, originalResult);

  assert.throws(
    () =>
      grade.normalizeGradePayload(grade.GRADE_COMMAND_TYPES.REVIEW_GRADE_DRAFT, {
        ...common,
        recordId,
        expectedRevision: 1,
        expectedGradeRevision: 1,
        items: [
          {
            itemId: "invalid-range",
            maxScore: 1,
            awardedScore: 2,
            evaluationKind: "TEACHER",
            evidence: "rubric",
            reason: "",
          },
        ],
        reason: "range fixture",
      }),
    (error) => error?.details?.reason === "GRADE_ITEMS_INVALID",
  );
  assert.throws(
    () =>
      grade.normalizeGradePayload(grade.GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT, {
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
  assert.equal(concurrentResults.find((item) => item.status === "rejected").reason?.details?.reason, "GRADE_RECORD_EXISTS");
  assert.equal((await concurrentStore.query(grade.GRADE_RECORD_COLLECTION)).length, 1);
  assert.equal((await concurrentStore.query(grade.GRADE_VERSION_COLLECTION)).length, 1);

  const relatedRosterId = "legacy-roster-related";
  const relatedRosterPath = `years/2026/semesters/2/performance_score_rosters/${relatedRosterId}`;
  const relatedTemplate = buildLegacyRosterPayload({
    rosterId: relatedRosterId,
  }).roster;
  const relatedManualRow = {
    rowNumber: 2,
    uid: "",
    grade: "3",
    class: "1",
    number: "20",
    studentName: "수동 학생 이전",
    items: relatedTemplate.items,
    enteredScoreCount: 0,
    totalScore: 0,
    totalMaxScore: 10,
    feedback: "",
    evidence: "",
    matchStatus: "unmatched",
    matchMessage: "수동으로 추가한 학생입니다.",
    isManual: true,
  };
  const storedRelatedRoster = {
    ...relatedTemplate,
    revision: 3,
    academicYear: "2026",
    semester: "2",
    rows: [relatedTemplate.rows[0], relatedManualRow],
    rowCount: 2,
    matchedCount: 1,
    unmatchedCount: 1,
  };
  const relatedStore = new MemoryStore({
    ...baseSeed,
    [relatedRosterPath]: storedRelatedRoster,
  });
  const relatedCore = makeCore(relatedStore);
  const primaryWithRelated = buildLegacyRosterPayload({
    rosterId: "legacy-roster-primary-related",
  });
  const nextRelatedRoster = {
    ...relatedTemplate,
    rows: [
      relatedTemplate.rows[0],
      {
        ...relatedManualRow,
        number: "21",
        studentName: "수동 학생 변경",
      },
    ],
    rowCount: 2,
    matchedCount: 1,
    unmatchedCount: 1,
  };
  primaryWithRelated.relatedRosters = [
    {
      rosterId: relatedRosterId,
      expectedRosterRevision: 3,
      roster: nextRelatedRoster,
    },
  ];
  const protectedRelatedPayload = clone(primaryWithRelated);
  protectedRelatedPayload.rosterId = "legacy-roster-primary-protected";
  protectedRelatedPayload.relatedRosters[0].roster.rows[0].studentName = "변조된 등록 학생";
  const relatedWriteCountBefore = relatedStore.writeCount;
  await assertReason(
    execute(relatedCore, teacherUid, grade.GRADE_COMMAND_TYPES.UPSERT_LEGACY_GRADE_ROSTER, protectedRelatedPayload),
    "GRADE_ROSTER_SYNC_PROTECTED_DATA",
  );
  assert.equal(relatedStore.writeCount, relatedWriteCountBefore);
  assert.equal(relatedStore.snapshot("years/2026/semesters/2/performance_score_rosters/legacy-roster-primary-protected").exists, false);
  const relatedSaved = await execute(relatedCore, teacherUid, grade.GRADE_COMMAND_TYPES.UPSERT_LEGACY_GRADE_ROSTER, primaryWithRelated);
  assert.deepEqual(relatedSaved.result.relatedRosterRevisions, [{ rosterId: relatedRosterId, revision: 4 }]);
  assert.equal(relatedStore.snapshot(relatedRosterPath).data.revision, 4);
  assert.equal(relatedStore.snapshot(relatedRosterPath).data.rows[1].number, "21");
  assert.equal(relatedStore.snapshot(relatedRosterPath).data.rows[0].studentName, relatedTemplate.rows[0].studentName);

  const pointerMismatchPayload = {
    ...common,
    configKind: "OMR",
    configId: "final_exam",
    expectedRevision: 0,
    operation: "UPSERT",
    data: { objective: [], subjective: [] },
    reason: "canonical active pointer fixture",
  };
  for (const pointer of [
    { semesterId: "2026-1", revision: 7 },
    { semesterId, revision: 6 },
  ]) {
    const pointerMismatchStore = new MemoryStore({
      ...baseSeed,
      "site_settings/semester_active": pointer,
    });
    const pointerWriteCount = pointerMismatchStore.writeCount;
    await assertReason(
      execute(
        makeCore(pointerMismatchStore),
        teacherUid,
        grade.GRADE_COMMAND_TYPES.SAVE_LEGACY_GRADE_CONFIG,
        pointerMismatchPayload,
      ),
      "GRADE_SEMESTER_NOT_ACTIVE",
    );
    assert.equal(pointerMismatchStore.writeCount, pointerWriteCount);
    assert.equal(
      pointerMismatchStore.snapshot(
        "years/2026/semesters/2/exam_config/final_exam",
      ).exists,
      false,
    );
  }

  const boundaryBase = buildLegacyRosterPayload({
    rosterId: "legacy-roster-101-boundary",
  });
  const boundaryRecords = Array.from({ length: 101 }, (_, index) => ({
    ...boundaryBase.records[0],
    uid: `boundary-student-${String(index + 1).padStart(3, "0")}`,
    number: String(index + 1),
    studentName: `경계 학생 ${index + 1}`,
  }));
  const boundaryRows = boundaryRecords.map((record, index) => ({
    rowNumber: index + 1,
    ...record,
    matchStatus: "matched",
    matchMessage: "",
  }));
  const boundary101Payload = buildLegacyRosterPayload({
    rosterId: "legacy-roster-101-boundary",
    records: boundaryRecords,
    rows: boundaryRows,
  });
  assert.throws(
    () =>
      grade.normalizeGradePayload(
        grade.GRADE_COMMAND_TYPES.UPSERT_LEGACY_GRADE_ROSTER,
        boundary101Payload,
      ),
    (error) => error?.details?.reason === "GRADE_ROSTER_LIMIT_EXCEEDED",
  );

  const rows240 = Array.from({ length: 240 }, (_, index) => ({
    rowNumber: index + 1,
    uid: `roster-only-student-${String(index + 1).padStart(3, "0")}`,
  }));
  const roster240Path =
    "years/2026/semesters/2/performance_score_rosters/legacy-roster-240";
  const roster240Store = new MemoryStore({
    ...baseSeed,
    [roster240Path]: {
      revision: 1,
      academicYear: "2026",
      semester: "2",
      scoreKind: "performance",
      rows: rows240,
    },
  });
  const roster240Deleted = await execute(
    makeCore(roster240Store),
    teacherUid,
    grade.GRADE_COMMAND_TYPES.DELETE_LEGACY_GRADE_ROSTER,
    {
      ...common,
      rosterId: "legacy-roster-240",
      expectedRosterRevision: 1,
      reason: "240행 빈 projection 원자 삭제",
    },
  );
  assert.equal(roster240Deleted.result.status, "DELETED");
  assert.equal(roster240Store.snapshot(roster240Path).exists, false);

  const atomicRows = Array.from({ length: 150 }, (_, index) => ({
    rowNumber: index + 1,
    uid: `atomic-student-${String(index + 1).padStart(3, "0")}`,
  }));
  const atomicRosterId = "legacy-roster-atomic-limit";
  const atomicRosterPath = `years/2026/semesters/2/performance_score_rosters/${atomicRosterId}`;
  const atomicSeed = {
    ...baseSeed,
    [atomicRosterPath]: {
      revision: 1,
      academicYear: "2026",
      semester: "2",
      scoreKind: "performance",
      rows: atomicRows,
    },
  };
  atomicRows.forEach((row, index) => {
    const recordId = `grade_${(index + 1).toString(16).padStart(64, "0")}`;
    atomicSeed[`users/${row.uid}/performance_scores/${atomicRosterId}`] = {
      uid: row.uid,
      rosterId: atomicRosterId,
      academicYear: "2026",
      semester: "2",
      scoreKind: "performance",
      gradeRecordId: recordId,
    };
    atomicSeed[
      `users/${row.uid}/performance_scores/${atomicRosterId}/confirmations/${row.uid}`
    ] = { uid: row.uid };
    atomicSeed[`${grade.GRADE_RECORD_COLLECTION}/${recordId}`] = {
      recordId,
      semesterId,
      studentUid: row.uid,
      sourceKind: "MANUAL_IMPORT",
      sourceId: atomicRosterId,
      revision: 1,
    };
  });
  const atomicStore = new MemoryStore(atomicSeed);
  const atomicWriteCount = atomicStore.writeCount;
  await assertReason(
    execute(
      makeCore(atomicStore),
      teacherUid,
      grade.GRADE_COMMAND_TYPES.DELETE_LEGACY_GRADE_ROSTER,
      {
        ...common,
        rosterId: atomicRosterId,
        expectedRosterRevision: 1,
        reason: "500-write 경계 거부",
      },
    ),
    "GRADE_ROSTER_ATOMIC_LIMIT_EXCEEDED",
  );
  assert.equal(atomicStore.writeCount, atomicWriteCount);
  assert.equal(atomicStore.snapshot(atomicRosterPath).exists, true);
  assert.equal(
    atomicStore.snapshot(
      `users/${atomicRows[0].uid}/performance_scores/${atomicRosterId}`,
    ).exists,
    true,
  );

  const projectionCollisionPayload = buildLegacyRosterPayload({
    rosterId: "legacy-roster-projection-collision",
  });
  const projectionCollisionPath = `users/${studentUid}/performance_scores/${projectionCollisionPayload.rosterId}`;
  const projectionCollisionStore = new MemoryStore({
    ...baseSeed,
    [projectionCollisionPath]: {
      uid: studentUid,
      rosterId: projectionCollisionPayload.rosterId,
      academicYear: "2025",
      semester: "2",
      scoreKind: "performance",
    },
  });
  const projectionCollisionWrites = projectionCollisionStore.writeCount;
  await assertReason(
    execute(
      makeCore(projectionCollisionStore),
      teacherUid,
      grade.GRADE_COMMAND_TYPES.UPSERT_LEGACY_GRADE_ROSTER,
      projectionCollisionPayload,
    ),
    "GRADE_PROJECTION_SCOPE_MISMATCH",
  );
  assert.equal(projectionCollisionStore.writeCount, projectionCollisionWrites);
  assert.deepEqual(
    projectionCollisionStore.snapshot(projectionCollisionPath).data,
    projectionCollisionStore.documents.get(projectionCollisionPath),
  );
  const deleteCollisionRosterId = "legacy-roster-delete-collision";
  const deleteCollisionRosterPath = `years/2026/semesters/2/performance_score_rosters/${deleteCollisionRosterId}`;
  const deleteCollisionProjectionPath = `users/${studentUid}/performance_scores/${deleteCollisionRosterId}`;
  const deleteCollisionStore = new MemoryStore({
    ...baseSeed,
    [deleteCollisionRosterPath]: {
      revision: 1,
      academicYear: "2026",
      semester: "2",
      scoreKind: "performance",
      rows: [{ rowNumber: 1, uid: studentUid }],
    },
    [deleteCollisionProjectionPath]: {
      uid: otherStudentUid,
      rosterId: deleteCollisionRosterId,
      academicYear: "2026",
      semester: "2",
      scoreKind: "performance",
    },
  });
  const deleteCollisionWrites = deleteCollisionStore.writeCount;
  await assertReason(
    execute(
      makeCore(deleteCollisionStore),
      teacherUid,
      grade.GRADE_COMMAND_TYPES.DELETE_LEGACY_GRADE_ROSTER,
      {
        ...common,
        rosterId: deleteCollisionRosterId,
        expectedRosterRevision: 1,
        reason: "collision delete denial",
      },
    ),
    "GRADE_PROJECTION_SCOPE_MISMATCH",
  );
  assert.equal(deleteCollisionStore.writeCount, deleteCollisionWrites);
  assert.equal(deleteCollisionStore.snapshot(deleteCollisionRosterPath).exists, true);

  const largeQueueSeed = { ...baseSeed };
  for (let index = 1; index <= 1001; index += 1) {
    const recordId = `grade_${index.toString(16).padStart(64, "0")}`;
    largeQueueSeed[`${grade.GRADE_RECORD_COLLECTION}/${recordId}`] = {
      schemaVersion: grade.GRADE_SCHEMA_VERSION,
      policyVersion: grade.GRADE_POLICY_VERSION,
      recordId,
      currentVersionId: `gradever_${index.toString(16).padStart(64, "0")}`,
      revision: 1,
      gradeRevision: 1,
      status: "DRAFT",
      semesterId,
      studentUid: `large-student-${index}`,
      enrollmentId: `large-enrollment-${index}`,
      classId,
      sourceKind: "MANUAL_IMPORT",
      sourceId: `large-source-${index}`,
      scoreKind: "performance",
      title: `대형 큐 ${String(index).padStart(4, "0")}`,
      rubricVersion: "w6b-rubric-v1",
      totalScore: 1,
      totalMaxScore: 1,
      percent: 100,
      evidenceHash: "a".repeat(64),
      signatureRequired: true,
      enrollmentSnapshot: {},
    };
  }
  const largeQueueStore = new MemoryStore(largeQueueSeed);
  const largeQueueCore = grade.createGradeQueryCore({
    store: largeQueueStore,
    assertSession: async (request) => ({
      uid: request.auth.uid,
      email: request.auth.token.email,
    }),
  });
  let largeQueueCursor = "";
  let largeQueueRecordCount = 0;
  let largeQueuePageCount = 0;
  do {
    const page = await largeQueueCore.getGradeEvidenceState(
      requestFor(teacherUid, {
        audience: "teacher",
        semesterId,
        scoreKind: "performance",
        provenance: "CURRENT",
        ...(largeQueueCursor ? { cursor: largeQueueCursor } : {}),
      }),
    );
    assert.ok(page.records.length <= 25);
    assert.ok(page.pendingSources.length <= 25);
    assert.ok(page.activeStudents.length <= 25);
    largeQueueRecordCount += page.records.length;
    largeQueuePageCount += 1;
    largeQueueCursor = page.nextCursor;
  } while (largeQueueCursor && largeQueuePageCount < 60);
  assert.equal(largeQueueRecordCount, 1001);
  assert.equal(largeQueuePageCount, 41);
  assert.equal(largeQueueCursor, "");
  const boundedCollections = new Set([
    grade.GRADE_RECORD_COLLECTION,
    assessment.ATTEMPT_COLLECTION,
    archiveEnrollment.ENROLLMENT_SLOT_COLLECTION,
  ]);
  assert.equal(
    largeQueueStore.queryLog
      .filter(({ collectionPath }) => boundedCollections.has(collectionPath))
      .every(
        ({ filter }) =>
          filter?.limit === 26 && filter?.documentIdOrder === "asc",
      ),
    true,
  );
  assert.equal(
    largeQueueStore.queryLog.some(({ collectionPath }) =>
      [
        assessment.DEFINITION_COLLECTION,
        assessment.SUBMISSION_COLLECTION,
        assessment.RESULT_COLLECTION,
        archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION,
        archiveEnrollment.SEMESTER_CLASS_COLLECTION,
      ].includes(collectionPath),
    ),
    false,
  );
  const boundedReadiness = grade.createGradeReadinessAdapter();
  const largeReadinessChecks = await largeQueueStore.runTransaction(
    (transaction) =>
      boundedReadiness.evaluate({
        transaction,
        manifest: largeQueueStore.snapshot(manifestPath).data,
      }),
  );
  assert.equal(largeReadinessChecks[0].status, "FAIL");
  assert.equal(
    largeReadinessChecks[0].failureReason,
    "GRADE_EVIDENCE_READINESS_BOUNDED_LIMIT_EXCEEDED",
  );
  assert.match(
    largeReadinessChecks[0].evidence,
    /boundedOverflow=semester_grade_records; observedAtLeast=1001; maximum=1000/,
  );
  const readinessRecordQuery = largeQueueStore.queryLog.findLast(
    ({ collectionPath }) => collectionPath === grade.GRADE_RECORD_COLLECTION,
  );
  assert.equal(readinessRecordQuery.filter.limit, 1001);

  const legacyStore = new MemoryStore(baseSeed);
  const legacyCore = makeCore(legacyStore);
  const legacyQueryCore = grade.createGradeQueryCore({
    store: legacyStore,
    assertSession: async (request) => ({
      uid: request.auth.uid,
      email: request.auth.token.email,
    }),
  });
  const legacyPayload = buildLegacyRosterPayload();
  const writesBeforePermissionDenial = legacyStore.writeCount;
  await assertReason(execute(legacyCore, studentUid, grade.GRADE_COMMAND_TYPES.UPSERT_LEGACY_GRADE_ROSTER, legacyPayload), "GRADE_MANAGE_REQUIRED");
  assert.equal(legacyStore.writeCount, writesBeforePermissionDenial);

  const invalidSecondRecord = {
    ...legacyPayload.records[0],
    uid: otherStudentUid,
    number: "8",
    studentName: "학적 없는 학생",
  };
  const invalidBulkPayload = buildLegacyRosterPayload({
    rosterId: "legacy-roster-invalid",
    records: [legacyPayload.records[0], invalidSecondRecord],
  });
  const invalidWriteCount = legacyStore.writeCount;
  const invalidDocumentCount = legacyStore.documents.size;
  await assertReason(execute(legacyCore, teacherUid, grade.GRADE_COMMAND_TYPES.UPSERT_LEGACY_GRADE_ROSTER, invalidBulkPayload), "GRADE_ENROLLMENT_MISMATCH");
  assert.equal(legacyStore.writeCount, invalidWriteCount);
  assert.equal(legacyStore.documents.size, invalidDocumentCount);
  assert.equal(legacyStore.snapshot(`years/2026/semesters/2/performance_score_rosters/${invalidBulkPayload.rosterId}`).exists, false);

  const legacyLostCommandId = nextCommandId();
  await assertReason(
    execute(legacyCore, teacherUid, grade.GRADE_COMMAND_TYPES.UPSERT_LEGACY_GRADE_ROSTER, legacyPayload, {
      commandId: legacyLostCommandId,
      dropResponse: true,
    }),
    "TEST_RESPONSE_LOSS",
  );
  const legacyRecovered = await execute(legacyCore, teacherUid, grade.GRADE_COMMAND_TYPES.UPSERT_LEGACY_GRADE_ROSTER, legacyPayload, {
    commandId: legacyLostCommandId,
  });
  assert.equal(legacyRecovered.replayed, true);
  assert.equal(legacyRecovered.result.recordCount, 1);
  assert.equal(legacyRecovered.result.records.length, 1);
  assert.equal((await legacyStore.query(grade.GRADE_RECORD_COLLECTION)).length, 1);
  assert.equal((await legacyStore.query(grade.GRADE_VERSION_COLLECTION)).length, 1);
  const legacyRecordMeta = legacyRecovered.result.records[0];
  const legacyRecordPath = `${grade.GRADE_RECORD_COLLECTION}/${legacyRecordMeta.recordId}`;
  const legacyScorePath = `users/${studentUid}/performance_scores/${legacyPayload.rosterId}`;
  const legacyRosterPath = `years/2026/semesters/2/performance_score_rosters/${legacyPayload.rosterId}`;
  const importedHead = legacyStore.snapshot(legacyRecordPath).data;
  const importedProjection = legacyStore.snapshot(legacyScorePath).data;
  assert.equal(importedHead.status, "OFFICIAL_PENDING_SIGNATURE");
  assert.equal(importedHead.studentUid, studentUid);
  assert.equal(importedProjection.gradeRecordId, legacyRecordMeta.recordId);
  assert.equal(importedProjection.gradeVersionId, legacyRecordMeta.versionId);
  assert.equal(importedProjection.gradeRecordRevision, 1);
  assert.equal(importedProjection.gradeRevision, 1);
  assert.equal(importedProjection.projectionRevision, 1);
  assert.equal(legacyStore.snapshot(legacyRosterPath).data.revision, 1);

  const warningText = "본인 성적만 확인하고 본인 이름으로 서명해 주세요.";
  const warningTextHash = legacyWarningHash(warningText);
  const warningVersion = `warning-${warningTextHash}`;
  const warningSaved = await execute(legacyCore, teacherUid, grade.GRADE_COMMAND_TYPES.SAVE_LEGACY_GRADE_CONFIG, {
    ...common,
    configKind: "WARNING",
    configId: "performance_score",
    expectedRevision: 0,
    operation: "UPSERT",
    data: { warningText, warningVersion, warningTextHash },
    reason: "학생 확인 경고 설정",
  });
  assert.equal(warningSaved.result.revision, 1);
  const warningAcknowledged = await execute(legacyCore, studentUid, grade.GRADE_COMMAND_TYPES.ACKNOWLEDGE_LEGACY_GRADE_WARNING, {
    ...common,
    warningVersion,
    warningTextHash,
  });
  assert.equal(warningAcknowledged.result.status, "ACKNOWLEDGED");

  const legacyRecordRef = {
    recordId: legacyRecordMeta.recordId,
    scoreId: legacyPayload.rosterId,
    expectedRevision: 1,
    expectedGradeRevision: 1,
    targetDetails: "역사 탐구 보고서 채점 근거",
  };
  const answerSheetRequested = await execute(legacyCore, studentUid, grade.GRADE_COMMAND_TYPES.SUBMIT_LEGACY_GRADE_REQUEST, {
    ...common,
    requestKind: "ANSWER_SHEET",
    records: [legacyRecordRef],
    reason: "답안 근거를 확인하고 싶습니다.",
  });
  assert.equal(answerSheetRequested.result.requestCount, 1);
  const reviewedAnswerSheet = await execute(legacyCore, teacherUid, grade.GRADE_COMMAND_TYPES.REVIEW_LEGACY_GRADE_REQUEST, {
    ...common,
    requestId: answerSheetRequested.result.requestId,
    expectedRequestRevision: 1,
    resolution: "REVIEWED",
    changedTotalScore: null,
    reviewMemo: "채점 근거를 확인했습니다.",
  });
  assert.equal(reviewedAnswerSheet.result.status, "ACCEPTED");
  assert.equal(reviewedAnswerSheet.result.projectionStatus, "reviewed");

  const signedLegacy = await execute(legacyCore, studentUid, grade.GRADE_COMMAND_TYPES.SIGN_LEGACY_GRADE_RECORDS, {
    ...common,
    records: [legacyRecordRef],
    signatureName: "학생 한 명",
    signatureImage: "data:image/png;base64,aGVsbG8=",
    statementVersion: grade.GRADE_STATEMENT_VERSION,
  });
  assert.equal(signedLegacy.result.signedCount, 1);
  assert.equal(legacyStore.snapshot(legacyRecordPath).data.status, "OFFICIAL");
  assert.equal(legacyStore.snapshot(legacyScorePath).data.gradeRecordRevision, 2);
  const confirmationPath = `${legacyScorePath}/confirmations/${studentUid}`;
  assert.equal(legacyStore.snapshot(confirmationPath).exists, true);

  const rejectedSignature = await execute(legacyCore, teacherUid, grade.GRADE_COMMAND_TYPES.REJECT_LEGACY_GRADE_SIGNATURES, {
    ...common,
    studentUid,
    records: [
      {
        ...legacyRecordRef,
        expectedRevision: 2,
        targetDetails: "",
      },
    ],
    reason: "서명 이미지를 다시 확인해야 합니다.",
  });
  assert.equal(rejectedSignature.result.rejectedCount, 1);
  assert.equal(legacyStore.snapshot(legacyRecordPath).data.status, "OFFICIAL_PENDING_SIGNATURE");
  assert.equal(legacyStore.snapshot(legacyRecordPath).data.gradeRevision, 2);
  assert.equal(legacyStore.snapshot(legacyScorePath).data.gradeRecordRevision, 3);
  assert.equal(legacyStore.snapshot(legacyScorePath).data.gradeRevision, 2);
  assert.equal(legacyStore.snapshot(confirmationPath).exists, false);

  const gradingPlanSaved = await execute(legacyCore, teacherUid, grade.GRADE_COMMAND_TYPES.SAVE_LEGACY_GRADE_CONFIG, {
    ...common,
    configKind: "GRADING_PLAN",
    configId: "history-plan",
    expectedRevision: 0,
    operation: "UPSERT",
    data: {
      subject: "역사",
      targetGrade: "3",
      items: [
        { type: "정기", name: "지필평가", maxScore: 100, ratio: 60 },
        { type: "수행", name: "탐구 보고서", maxScore: 10, ratio: 40 },
      ],
    },
    reason: "평가 반영 비율 저장",
  });
  assert.equal(gradingPlanSaved.result.revision, 1);
  const omrSaved = await execute(legacyCore, teacherUid, grade.GRADE_COMMAND_TYPES.SAVE_LEGACY_GRADE_CONFIG, {
    ...common,
    configKind: "OMR",
    configId: "final_exam",
    expectedRevision: 0,
    operation: "UPSERT",
    data: {
      objective: [
        { score: 4, answer: 0 },
        { score: 4, answer: 3 },
      ],
      subjective: [{ subItems: [{ score: 5, answer: "고구려" }] }],
    },
    reason: "정기시험 답안 설정 저장",
  });
  assert.equal(omrSaved.result.revision, 1);
  assert.equal(legacyStore.snapshot("years/2026/semesters/2/exam_config/final_exam").data.objective[0].answer, 0);
  const hiddenExamAnswers = await legacyQueryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      mode: "STUDENT_EXAM_ANSWERS",
      audience: "student",
      semesterId,
      scoreKind: "written_exam_essay",
      provenance: "CURRENT",
    }),
  );
  assert.equal(hiddenExamAnswers.status, "NOT_RELEASED");
  assert.equal(hiddenExamAnswers.examAnswers, null);
  await assertReason(
    legacyQueryCore.getGradeEvidenceState(
      requestFor(otherStudentUid, {
        mode: "STUDENT_EXAM_ANSWERS",
        audience: "student",
        semesterId,
        scoreKind: "written_exam_essay",
        provenance: "CURRENT",
      }),
    ),
    "GRADE_STUDENT_ANSWER_SCOPE_REQUIRED",
  );
  const omrReleased = await execute(
    legacyCore,
    teacherUid,
    grade.GRADE_COMMAND_TYPES.SAVE_LEGACY_GRADE_CONFIG,
    {
      ...common,
      configKind: "OMR",
      configId: "final_exam",
      expectedRevision: 1,
      operation: "UPSERT",
      data: {
        objective: [
          { score: 4, answer: 1 },
          { score: 4, answer: 3 },
        ],
        subjective: [{ subItems: [{ score: 5, answer: "고구려" }] }],
        releaseStatus: "RELEASED",
        releasePolicyVersion: "w6b-answer-release-v1",
      },
      reason: "시험 종료 후 학생에게 정답 공개",
    },
  );
  assert.equal(omrReleased.result.revision, 2);
  const releasedExamAnswers = await legacyQueryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      mode: "STUDENT_EXAM_ANSWERS",
      audience: "student",
      semesterId,
      scoreKind: "written_exam_essay",
      provenance: "CURRENT",
    }),
  );
  assert.equal(releasedExamAnswers.status, "RELEASED");
  assert.equal(releasedExamAnswers.examAnswers.objective[0].answer, 1);
  assert.equal(
    releasedExamAnswers.examAnswers.subjective[0].subItems[0].answer,
    "고구려",
  );
  legacyStore.documents.set("site_settings/semester_active", {
    semesterId,
    revision: 8,
  });
  await assertReason(
    legacyQueryCore.getGradeEvidenceState(
      requestFor(studentUid, {
        mode: "STUDENT_EXAM_ANSWERS",
        audience: "student",
        semesterId,
        scoreKind: "written_exam_essay",
        provenance: "CURRENT",
      }),
    ),
    "GRADE_SEMESTER_NOT_ACTIVE",
  );
  legacyStore.documents.set("site_settings/semester_active", {
    semesterId,
    revision: 7,
  });

  const deletedRoster = await execute(legacyCore, teacherUid, grade.GRADE_COMMAND_TYPES.DELETE_LEGACY_GRADE_ROSTER, {
    ...common,
    rosterId: legacyPayload.rosterId,
    expectedRosterRevision: 1,
    reason: "점수표 삭제",
  });
  assert.equal(deletedRoster.result.status, "DELETED");
  assert.equal(legacyStore.snapshot(legacyRosterPath).exists, false);
  assert.equal(legacyStore.snapshot(legacyScorePath).exists, false);
  assert.equal(legacyStore.snapshot(`users/${studentUid}`).exists, true);
  assert.equal(legacyStore.snapshot(legacyRecordPath).data.status, "WITHDRAWN");

  const readiness = grade.createGradeReadinessAdapter();
  const readinessChecks = await store.runTransaction((transaction) =>
    readiness.evaluate({
      transaction,
      manifest: store.snapshot(manifestPath).data,
    }),
  );
  assert.equal(readinessChecks.length, 1);
  assert.equal(readinessChecks[0].checkId, "grade_evidence_readiness");
  assert.equal(readinessChecks[0].status, "PASS");
  assert.match(readinessChecks[0].evidence, /pendingRequests=0/);
  assert.match(readinessChecks[0].evidence, /unsupportedVersions=0/);

  const currentRecord = store.snapshot(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`).data;
  const currentVersionPath = `${grade.GRADE_VERSION_COLLECTION}/${currentRecord.currentVersionId}`;
  const supportedCurrentVersion = store.snapshot(currentVersionPath).data;
  store.documents.set(currentVersionPath, {
    ...supportedCurrentVersion,
    rubricVersion: "unsupported-rubric-v999",
  });
  const unsupportedReadiness = await store.runTransaction((transaction) =>
    readiness.evaluate({
      transaction,
      manifest: store.snapshot(manifestPath).data,
    }),
  );
  assert.equal(unsupportedReadiness[0].status, "FAIL");
  assert.match(unsupportedReadiness[0].evidence, /unsupportedVersions=1/);
  store.documents.set(currentVersionPath, supportedCurrentVersion);

  const supportedCurrentRecord = store.snapshot(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`).data;
  store.documents.set(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`, {
    ...supportedCurrentRecord,
    enrollmentSnapshot: {
      ...supportedCurrentRecord.enrollmentSnapshot,
      displayName: "변조된 이름",
    },
  });
  const snapshotMismatchReadiness = await store.runTransaction((transaction) =>
    readiness.evaluate({
      transaction,
      manifest: store.snapshot(manifestPath).data,
    }),
  );
  assert.equal(snapshotMismatchReadiness[0].status, "FAIL");
  assert.match(snapshotMismatchReadiness[0].evidence, /orphanEnrollments=1/);
  store.documents.set(`${grade.GRADE_RECORD_COLLECTION}/${recordId}`, supportedCurrentRecord);

  store.documents.set(`${assessment.RESULT_COLLECTION}/${attemptId}`, {
    ...store.documents.get(`${assessment.RESULT_COLLECTION}/${attemptId}`),
    sourceHash: "c".repeat(64),
  });
  await assertReason(
    queryCore.getGradeEvidenceState(
      requestFor(teacherUid, {
        audience: "teacher",
        semesterId,
        recordId,
        scoreKind: "performance",
        provenance: "CURRENT",
      }),
    ),
    "GRADE_SOURCE_EVIDENCE_INVALID",
  );
  store.documents.set(`${assessment.RESULT_COLLECTION}/${attemptId}`, clone(originalResult));

  const activeManifest = clone(store.documents.get(manifestPath));
  store.documents.set(manifestPath, { ...activeManifest, status: "PREPARING" });
  const preparingProjection = await queryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      audience: "student",
      semesterId,
      scoreKind: "performance",
      provenance: "CURRENT",
    }),
  );
  assert.equal(preparingProjection.provenance, "PREPARING");
  assert.equal(preparingProjection.readOnly, true);
  store.documents.set(manifestPath, { ...activeManifest, status: "CLOSING" });
  const closingProjection = await queryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      audience: "student",
      semesterId,
      scoreKind: "performance",
      provenance: "CURRENT",
    }),
  );
  assert.equal(closingProjection.provenance, "CURRENT");
  assert.equal(closingProjection.readOnly, true);
  store.documents.set(manifestPath, activeManifest);
  const activeProjection = await queryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      audience: "student",
      semesterId,
      scoreKind: "performance",
      provenance: "CURRENT",
    }),
  );
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
    assertSession: async (request) => ({
      uid: request.auth.uid,
      email: request.auth.token.email,
    }),
  });
  const mismatchQueue = await mismatchQueryCore.getGradeEvidenceState(
    requestFor(teacherUid, {
      audience: "teacher",
      semesterId,
      scoreKind: "performance",
      provenance: "CURRENT",
    }),
  );
  assert.equal(mismatchQueue.pendingSources.length, 0);

  await assertReason(
    queryCore.getGradeEvidenceState(
      requestFor(studentUid, {
        audience: "student",
        semesterId,
        scoreKind: "performance",
        provenance: "ARCHIVE",
      }),
    ),
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
      items: [
        {
          itemId: "item-one",
          maxScore: 10,
          awardedScore: 9,
          evaluationKind: "TEACHER",
          evidence: "rubric",
          reason: "",
        },
      ],
      reason: "archive denial test",
    }),
    "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
  );

  const writesBeforeArchiveQuery = store.writeCount;
  const archived = await queryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      audience: "student",
      semesterId,
      scoreKind: "performance",
      provenance: "ARCHIVE",
    }),
  );
  assert.equal(archived.status, "ARCHIVED");
  assert.equal(archived.readOnly, true);
  assert.equal(archived.records.length, 1);
  assert.equal(archived.provenance, "ARCHIVE");
  const archivedDetail = await queryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      audience: "student",
      semesterId,
      recordId,
      scoreKind: "performance",
      provenance: "ARCHIVE",
    }),
  );
  assert.equal(archivedDetail.detail.record.provenance, "ARCHIVE");
  assert.equal(archivedDetail.detail.record.readOnly, true);
  const legacy = await queryCore.getGradeEvidenceState(
    requestFor(studentUid, {
      audience: "student",
      semesterId,
      scoreKind: "performance",
      provenance: "LEGACY",
    }),
  );
  assert.equal(legacy.status, "LEGACY");
  assert.equal(legacy.records.length, 0);
  assert.equal(store.writeCount, writesBeforeArchiveQuery);

  store.documents.set(`${grade.GRADE_LEGACY_ISSUE_COLLECTION}/issue-one`, {
    semesterId,
    status: "OPEN",
  });
  const failingReadiness = await store.runTransaction((transaction) =>
    readiness.evaluate({
      transaction,
      manifest: store.snapshot(manifestPath).data,
    }),
  );
  assert.equal(failingReadiness[0].status, "FAIL");
  assert.match(failingReadiness[0].evidence, /blockingLegacyIssues=1/);

  console.log(
    JSON.stringify({
      suite: "grade-evidence-core",
      cases: 122,
      commandTypes: Object.values(grade.GRADE_COMMAND_TYPES),
      queryCallable: "getGradeEvidenceState",
      readinessCheckId: "grade_evidence_readiness",
      status: "PASS",
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
