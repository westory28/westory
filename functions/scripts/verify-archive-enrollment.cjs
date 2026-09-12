const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");

const {
  ADMIN_EMAIL,
  AUDIT_COLLECTION,
  COMMAND_TYPES,
  RECEIPT_COLLECTION,
  createCommandGatewayCore,
} = require("../commandGateway");
const semesterCore = require("../semesterCore");
const archiveEnrollment = require("../archiveEnrollment");

const clone = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

class MemoryStore {
  constructor(seed = {}) {
    this.documents = new Map(
      Object.entries(seed).map(([path, data]) => [path, clone(data)]),
    );
    this.committedWrites = new Map();
    this.transactionCalls = 0;
    this.lock = Promise.resolve();
  }

  get writeCount() {
    return [...this.committedWrites.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
  }

  async get(path) {
    return {
      exists: this.documents.has(path),
      data: clone(this.documents.get(path) || null),
      path,
    };
  }

  async query(collectionPath, filter = null) {
    return this.#query(this.documents, collectionPath, filter);
  }

  #query(documents, collectionPath, filter = null) {
    const prefix = `${collectionPath}/`;
    return [...documents.entries()]
      .filter(
        ([path, data]) =>
          path.startsWith(prefix) &&
          !path.slice(prefix.length).includes("/") &&
          (!filter ||
            (filter.operator === "==" &&
              data?.[filter.field] === filter.value)),
      )
      .map(([path, data]) => ({ exists: true, data: clone(data), path }));
  }

  async runTransaction(callback) {
    this.transactionCalls += 1;
    let release;
    const previous = this.lock;
    this.lock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const working = new Map(
      [...this.documents.entries()].map(([path, data]) => [path, clone(data)]),
    );
    const writes = [];
    const transaction = {
      get: async (path) => ({
        exists: working.has(path),
        data: clone(working.get(path) || null),
        path,
      }),
      getAll: async (paths) =>
        paths.map((path) => ({
          exists: working.has(path),
          data: clone(working.get(path) || null),
          path,
        })),
      query: async (collectionPath, filter = null) =>
        this.#query(working, collectionPath, filter),
      set: (path, data, options) => {
        working.set(
          path,
          options?.merge
            ? { ...(working.get(path) || {}), ...clone(data) }
            : clone(data),
        );
        writes.push(path);
      },
      create: (path, data) => {
        if (working.has(path))
          throw new Error(`Document already exists: ${path}`);
        working.set(path, clone(data));
        writes.push(path);
      },
      delete: (path) => {
        working.delete(path);
        writes.push(path);
      },
    };
    try {
      const result = await callback(transaction);
      this.documents = working;
      writes.forEach((path) =>
        this.committedWrites.set(
          path,
          (this.committedWrites.get(path) || 0) + 1,
        ),
      );
      return result;
    } finally {
      release();
    }
  }

  data(path) {
    return clone(this.documents.get(path));
  }

  collection(collectionPath) {
    return this.#query(this.documents, collectionPath);
  }
}

const assertSession = async (request, options) => {
  if (!request.auth?.uid || request.auth.uid === "expired") {
    throw new HttpsError("unauthenticated", "Session expired.", {
      reason: "SESSION_EXPIRED",
    });
  }
  return {
    uid: request.auth.uid,
    email: request.auth.token.email,
    authTime: request.auth.token.auth_time,
    sessionRef: {
      path: `application_sessions/${request.auth.uid}/sessions/test`,
    },
    session: {
      authorityGeneration: "test-generation",
      protocolVersion: 2,
      sessionRevision: request.data?._session?.revision || "test-revision",
    },
    options,
  };
};

const requestFor = ({
  commandId,
  commandType,
  payload,
  uid = "admin-uid",
  email = ADMIN_EMAIL,
  extra = {},
}) => ({
  auth: { uid, token: { email, auth_time: 1_786_400_000 } },
  data: {
    commandId,
    commandType,
    payload,
    _session: {
      authorityGeneration: "test-generation",
      protocolVersion: 2,
      revision: "test-revision",
    },
    ...extra,
  },
});

const queryRequest = (data, uid = "admin-uid", email = ADMIN_EMAIL) => ({
  auth: { uid, token: { email, auth_time: 1_786_400_000 } },
  data: {
    ...data,
    _session: {
      authorityGeneration: "test-generation",
      protocolVersion: 2,
      revision: "test-revision",
    },
  },
});

const reasonFrom = async (operation) => {
  try {
    await operation();
  } catch (error) {
    return error?.details?.reason || error?.code || error?.message;
  }
  throw new Error("Expected rejection.");
};

const commandId = (value) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

const main = async () => {
  const semesterId = "2026-2";
  const manifestPath = `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${semesterId}`;
  const store = new MemoryStore({
    [manifestPath]: {
      semesterId,
      schoolYear: "2026",
      term: "2",
      displayName: "2026학년도 2학기",
      status: "ACTIVE",
      provenance: "CURRENT",
      revision: 1,
      stateRevision: 1,
      schemaVersion: 1,
      readinessPolicyVersion: semesterCore.READINESS_POLICY_VERSION,
      startAt: "2026-08-01",
      endAt: "2026-12-31",
      blockingIssues: [],
    },
    [semesterCore.ACTIVE_SEMESTER_POINTER_PATH]: { semesterId, revision: 1 },
    "site_settings/config": {
      year: "2026",
      semester: "2",
      activeSemesterId: semesterId,
      activeSemesterRevision: 1,
      semesterLifecycleStatus: "ACTIVE",
      semesterWritesEnabled: true,
    },
    "users/admin-uid": { role: "teacher", teacherPortalEnabled: true },
    "users/teacher-1": { role: "teacher", teacherPortalEnabled: true },
    "users/student-1": { role: "student", studentName: "가학생" },
    "users/student-2": { role: "student", studentName: "나학생" },
  });
  const readinessAdapter =
    archiveEnrollment.createArchiveEnrollmentReadinessAdapter();
  const w4Adapter = archiveEnrollment.createArchiveEnrollmentCommandAdapter();
  const semesterAdapter = semesterCore.createSemesterCoreCommandAdapter({
    readinessAdapters: [readinessAdapter],
  });
  const adapters = Object.fromEntries(
    Object.values(archiveEnrollment.ARCHIVE_ENROLLMENT_COMMAND_TYPES).map(
      (type) => [type, w4Adapter],
    ),
  );
  Object.values(semesterCore.SEMESTER_COMMAND_TYPES).forEach((type) => {
    adapters[type] = semesterAdapter;
  });
  const gateway = createCommandGatewayCore({
    store,
    assertSession,
    commandAdapters: adapters,
    semesterCoreResolver: ({
      store: resolverStore,
      semesterId: selectedSemesterId,
    }) =>
      semesterCore.resolveSemesterCoreState({
        store: resolverStore,
        semesterId: selectedSemesterId,
        readinessAdapters: [readinessAdapter],
      }),
    serverTimestamp: () => "2026-08-11T00:00:00.000Z",
    projectId: "demo-westory-session-w4",
  });
  const queries = archiveEnrollment.createArchiveEnrollmentQueryCore({
    store,
    assertSession,
    projectId: "demo-westory-session-w4",
  });

  const roster = {
    semesterId,
    expectedSemesterRevision: 1,
    rosterId: "approved-roster-2026-2-v1",
    importRevision: 1,
    sourceLabel: "승인 명단 fixture",
    sourceHash: "a".repeat(64),
    effectiveFrom: "2026-08-01",
    expectedStudentUids: ["student-1", "student-2"],
    classes: [
      {
        grade: "1",
        classNumber: "1",
        displayName: "1학년 1반",
        homeroomTeacherUid: "teacher-1",
      },
    ],
    entries: [
      {
        studentUid: "student-1",
        displayName: "가학생",
        classKey: "1::1",
        studentNumber: "1",
      },
      {
        studentUid: "student-2",
        displayName: "나학생",
        classKey: "1::1",
        studentNumber: "2",
      },
    ],
    reason: "W4 승인 명단 반영",
  };
  const writesBeforePreview = store.writeCount;
  const preview = await queries.previewEnrollmentRoster(queryRequest(roster));
  assert.equal(preview.passed, true);
  assert.equal(preview.summary.orphanStudentCount, 0);
  assert.equal(preview.summary.orphanTeacherCount, 0);
  assert.equal(store.writeCount, writesBeforePreview);
  // A valid administrator/receipt does not make a non-student roster entry
  // valid. Recheck the target profile at import even after a valid preview.
  const originalStudentProfile = store.data("users/student-1");
  const nonStudentProfiles = [
    ["teacher", { ...originalStudentProfile, role: "teacher" }],
    ["staff", { ...originalStudentProfile, role: "staff" }],
    ["missing-role", { studentName: originalStudentProfile.studentName }],
  ];
  for (const [index, [label, profile]] of nonStudentProfiles.entries()) {
    store.documents.set("users/student-1", profile);
    const beforeDocuments = clone([...store.documents]);
    const beforeWrites = store.writeCount;
    try {
      const rejectedPreview = await queries.previewEnrollmentRoster(
        queryRequest(roster),
      );
      assert.equal(rejectedPreview.passed, false, `${label} preview must fail`);
      assert.equal(rejectedPreview.summary.orphanStudentCount, 1);
      assert.equal(
        await reasonFrom(() => gateway.execute(requestFor({
          commandId: commandId(100 + index),
          commandType: COMMAND_TYPES.IMPORT_ENROLLMENT_ROSTER,
          payload: { ...roster, validationHash: preview.validationHash },
        }))),
        "ROSTER_VALIDATION_FAILED",
        `${label} import must fail despite an earlier valid preview`,
      );
      assert.equal(store.writeCount, beforeWrites);
      assert.deepEqual([...store.documents], beforeDocuments);
    } finally {
      store.documents.set("users/student-1", originalStudentProfile);
    }
  }
  const invalidPreview = await queries.previewEnrollmentRoster(
    queryRequest({
      ...roster,
      rosterId: "invalid-roster",
      expectedStudentUids: [
        "student-1",
        "student-1",
        "student-2",
        "not-in-roster",
      ],
      classes: [roster.classes[0], roster.classes[0]],
      entries: [
        roster.entries[0],
        roster.entries[0],
        {
          ...roster.entries[1],
          studentUid: "missing-student",
          classKey: "9::9",
        },
      ],
    }),
  );
  assert.equal(invalidPreview.passed, false);
  assert.equal(invalidPreview.summary.duplicateClassCount, 1);
  assert.equal(invalidPreview.summary.duplicateStudentCount, 1);
  assert.equal(invalidPreview.summary.duplicateExpectedStudentCount, 1);
  assert.equal(invalidPreview.summary.orphanStudentCount, 1);
  assert.equal(invalidPreview.summary.orphanClassCount, 1);
  assert.ok(invalidPreview.summary.missingStudentCount > 0);

  const importPayload = { ...roster, validationHash: preview.validationHash };
  const importRequest = requestFor({
    commandId: commandId(1),
    commandType: COMMAND_TYPES.IMPORT_ENROLLMENT_ROSTER,
    payload: importPayload,
  });
  const [first, replay] = await Promise.all([
    gateway.execute(importRequest),
    gateway.execute(importRequest),
  ]);
  assert.deepEqual(first.result, replay.result);
  assert.deepEqual([first.replayed, replay.replayed].sort(), [false, true]);
  assert.equal(first.result.createdEnrollmentCount, 2);
  assert.equal(
    store.collection(archiveEnrollment.STUDENT_IDENTITY_COLLECTION).length,
    2,
  );
  assert.equal(
    store.collection(archiveEnrollment.SEMESTER_CLASS_COLLECTION).length,
    1,
  );
  assert.equal(
    store.collection(archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION).length,
    2,
  );
  assert.equal(
    store.collection(archiveEnrollment.ENROLLMENT_SLOT_COLLECTION).length,
    2,
  );
  assert.equal(
    store.collection(archiveEnrollment.ROSTER_IMPORT_COLLECTION).length,
    1,
  );
  assert.equal(store.collection(RECEIPT_COLLECTION).length, 1);
  assert.equal(store.collection(AUDIT_COLLECTION).length, 1);
  const receipt = store.collection(RECEIPT_COLLECTION)[0].data;
  assert.equal(receipt.commandType, COMMAND_TYPES.IMPORT_ENROLLMENT_ROSTER);
  assert.equal(receipt.payloadHashAlgorithm, "sha256");
  assert.equal(receipt.result.createdEnrollmentCount, 2);

  const sameRoster = await gateway.execute(
    requestFor({
      commandId: commandId(2),
      commandType: COMMAND_TYPES.IMPORT_ENROLLMENT_ROSTER,
      payload: importPayload,
    }),
  );
  assert.equal(sameRoster.result.replayedImport, true);
  assert.equal(
    store.collection(archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION).length,
    2,
  );

  const checks = await store.runTransaction((transaction) =>
    readinessAdapter.evaluate({
      transaction,
      manifest: store.data(manifestPath),
    }),
  );
  assert.deepEqual(
    checks.map((check) => [check.checkId, check.status]),
    [
      ["archive_readiness", "PASS"],
      ["class_readiness", "PASS"],
      ["enrollment_readiness", "PASS"],
    ],
  );
  const teacherDocument = store.data("users/teacher-1");
  store.documents.set("users/teacher-1", {
    ...teacherDocument,
    role: "student",
  });
  const invalidTeacherChecks = await store.runTransaction((transaction) =>
    readinessAdapter.evaluate({
      transaction,
      manifest: store.data(manifestPath),
    }),
  );
  assert.equal(
    invalidTeacherChecks.find((check) => check.checkId === "class_readiness")
      .status,
    "FAIL",
  );
  store.documents.set("users/teacher-1", teacherDocument);

  const rosterPath = `${archiveEnrollment.ROSTER_IMPORT_COLLECTION}/${roster.rosterId}`;
  const rosterDocument = store.data(rosterPath);
  store.documents.set(rosterPath, {
    ...rosterDocument,
    expectedStudentUids: [
      ...rosterDocument.expectedStudentUids,
      "missing-student",
    ],
  });
  const missingEnrollmentChecks = await store.runTransaction((transaction) =>
    readinessAdapter.evaluate({
      transaction,
      manifest: store.data(manifestPath),
    }),
  );
  assert.equal(
    missingEnrollmentChecks.find(
      (check) => check.checkId === "enrollment_readiness",
    ).status,
    "FAIL",
  );
  store.documents.set(rosterPath, rosterDocument);

  store.documents.set(semesterCore.ACTIVE_SEMESTER_POINTER_PATH, {
    semesterId: "2026-1",
    revision: 1,
  });
  const missingArchiveChecks = await store.runTransaction((transaction) =>
    readinessAdapter.evaluate({
      transaction,
      manifest: store.data(manifestPath),
    }),
  );
  assert.equal(
    missingArchiveChecks.find((check) => check.checkId === "archive_readiness")
      .status,
    "FAIL",
  );

  const cutoverSourceSemesterId = "2025-2";
  const cutoverPlanId = "cutplan_" + "1".repeat(64);
  const cutoverAttemptId = "cutattempt_" + "2".repeat(64);
  const cutoverEvidenceId = "cutevidence_" + "3".repeat(64);
  const cutoverDependencyHash = "4".repeat(64);
  store.documents.set(
    `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${cutoverSourceSemesterId}`,
    {
      semesterId: cutoverSourceSemesterId,
      revision: 1,
      status: "ARCHIVED",
      provenance: "ARCHIVE",
    },
  );
  store.documents.set(
    `${archiveEnrollment.ARCHIVE_MANIFEST_COLLECTION}/${cutoverSourceSemesterId}`,
    {
      semesterId: cutoverSourceSemesterId,
      archiveStatus: "FROZEN",
      writeFenceVersion: "w4-v1",
      unresolvedBlockingCount: 0,
      integrityHash: "5".repeat(64),
    },
  );
  store.documents.set(`semester_cutover_targets/${semesterId}`, {
    schemaVersion: 1,
    policyVersion: "w11-v1",
    targetSemesterId: semesterId,
    status: "VERIFIED",
    latestPlanId: cutoverPlanId,
    latestAttemptId: cutoverAttemptId,
    latestEvidenceId: cutoverEvidenceId,
    manifestHash: "6".repeat(64),
    targetManifestRevision: 1,
    dependencyHash: cutoverDependencyHash,
  });
  store.documents.set(`semester_cutover_plans/${cutoverPlanId}`, {
    schemaVersion: 1,
    policyVersion: "w11-v1",
    planId: cutoverPlanId,
    status: "VERIFIED",
    sourceSemesterId: cutoverSourceSemesterId,
    targetSemesterId: semesterId,
    sourceManifestRevision: 1,
    targetManifestRevision: 1,
    manifestHash: "6".repeat(64),
    dependencyHash: cutoverDependencyHash,
  });
  store.documents.set(`semester_cutover_attempts/${cutoverAttemptId}`, {
    schemaVersion: 1,
    policyVersion: "w11-v1",
    attemptId: cutoverAttemptId,
    planId: cutoverPlanId,
    status: "VERIFIED",
    sourceSemesterId: cutoverSourceSemesterId,
    targetSemesterId: semesterId,
    sourceManifestRevision: 1,
    targetManifestRevision: 1,
    manifestHash: "6".repeat(64),
    dependencyHash: cutoverDependencyHash,
  });
  store.documents.set(`semester_cutover_evidence/${cutoverEvidenceId}`, {
    schemaVersion: 1,
    policyVersion: "w11-v1",
    evidenceId: cutoverEvidenceId,
    planId: cutoverPlanId,
    attemptId: cutoverAttemptId,
    status: "PASS",
    sourceSemesterId: cutoverSourceSemesterId,
    targetSemesterId: semesterId,
    sourceManifestRevision: 1,
    targetManifestRevision: 1,
    sourceStatus: "ARCHIVED",
    manifestHash: "6".repeat(64),
    dependencyHash: cutoverDependencyHash,
  });
  const verifiedCutoverArchiveChecks = await store.runTransaction(
    (transaction) =>
      readinessAdapter.evaluate({
        transaction,
        manifest: store.data(manifestPath),
      }),
  );
  const verifiedCutoverArchive = verifiedCutoverArchiveChecks.find(
    (check) => check.checkId === "archive_readiness",
  );
  assert.equal(verifiedCutoverArchive.status, "PASS");
  assert.match(verifiedCutoverArchive.evidence, /source=VERIFIED_CUTOVER_PLAN/u);
  assert.match(
    verifiedCutoverArchive.evidence,
    new RegExp(`semester=${cutoverSourceSemesterId}`, "u"),
  );

  store.documents.set(`semester_cutover_evidence/${cutoverEvidenceId}`, {
    ...store.data(`semester_cutover_evidence/${cutoverEvidenceId}`),
    dependencyHash: "7".repeat(64),
  });
  const staleCutoverArchiveChecks = await store.runTransaction((transaction) =>
    readinessAdapter.evaluate({
      transaction,
      manifest: store.data(manifestPath),
    }),
  );
  const staleCutoverArchive = staleCutoverArchiveChecks.find(
    (check) => check.checkId === "archive_readiness",
  );
  assert.equal(staleCutoverArchive.status, "FAIL");
  assert.match(staleCutoverArchive.evidence, /source=ACTIVE_POINTER/u);
  store.documents.set(semesterCore.ACTIVE_SEMESTER_POINTER_PATH, {
    semesterId,
    revision: 1,
  });

  const currentBefore = store.writeCount;
  const current = await queries.getArchiveEnrollmentState(
    queryRequest({
      source: "CURRENT",
      callSite: "verify-w4-unit-current",
    }),
  );
  assert.equal(current.legacy, false);
  assert.equal(current.enrollments.length, 2);
  assert.equal(store.writeCount, currentBefore);

  store.documents.set(
    `${semesterCore.SEMESTER_READINESS_REPORT_COLLECTION}/${semesterId}`,
    {
      semesterId,
      status: "PASS",
      stale: false,
      evaluatedRevision: 1,
      policyVersion: semesterCore.READINESS_POLICY_VERSION,
      dependencyHash: "b".repeat(64),
      checks: [],
    },
  );
  const secondClassRequest = requestFor({
    commandId: commandId(3),
    commandType: COMMAND_TYPES.CREATE_SEMESTER_CLASS,
    payload: {
      semesterId,
      expectedSemesterRevision: 1,
      grade: "1",
      classNumber: "2",
      displayName: "1학년 2반",
      homeroomTeacherUid: "teacher-1",
      reason: "전입 학급 준비",
    },
    extra: { _testDropResponseAfterCommit: true },
  });
  assert.equal(
    await reasonFrom(() => gateway.execute(secondClassRequest)),
    "TEST_RESPONSE_LOSS",
  );
  const secondClassStatus = await gateway.getStatus(
    requestFor({
      commandId: commandId(3),
      commandType: COMMAND_TYPES.CREATE_SEMESTER_CLASS,
      payload: {},
    }),
  );
  assert.equal(secondClassStatus.status, "SUCCEEDED");
  const secondClass = await gateway.execute(secondClassRequest);
  assert.equal(secondClass.replayed, true);
  assert.equal(
    store.data(
      `${semesterCore.SEMESTER_READINESS_REPORT_COLLECTION}/${semesterId}`,
    ).status,
    "STALE",
  );
  const thirdClass = await gateway.execute(
    requestFor({
      commandId: commandId(11),
      commandType: COMMAND_TYPES.CREATE_SEMESTER_CLASS,
      payload: {
        semesterId,
        expectedSemesterRevision: 1,
        grade: "1",
        classNumber: "3",
        displayName: "1학년 3반",
        homeroomTeacherUid: "teacher-1",
        reason: "동시 이동 검증 학급",
      },
    }),
  );
  const studentSlot = store
    .collection(archiveEnrollment.ENROLLMENT_SLOT_COLLECTION)
    .find((document) => document.data.studentUid === "student-1").data;
  const movePayload = (targetClassId) => ({
    semesterId,
    studentUid: "student-1",
    activeEnrollmentId: studentSlot.activeEnrollmentId,
    expectedRevision: 1,
    targetClassId,
    studentNumber: "3",
    effectiveAt: "2026-09-01",
    reason: "동시 학급 이동",
  });
  const moveResults = await Promise.allSettled([
    gateway.execute(
      requestFor({
        commandId: commandId(4),
        commandType: COMMAND_TYPES.MOVE_ENROLLMENT,
        payload: movePayload(secondClass.result.semesterClass.classId),
      }),
    ),
    gateway.execute(
      requestFor({
        commandId: commandId(12),
        commandType: COMMAND_TYPES.MOVE_ENROLLMENT,
        payload: movePayload(thirdClass.result.semesterClass.classId),
      }),
    ),
  ]);
  assert.equal(
    moveResults.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    moveResults.filter((result) => result.status === "rejected").length,
    1,
  );
  const moved = moveResults.find(
    (result) => result.status === "fulfilled",
  ).value;
  assert.notEqual(moved.result.enrollmentId, studentSlot.activeEnrollmentId);
  assert.equal(
    store.data(
      `${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${studentSlot.activeEnrollmentId}`,
    ).enrollmentStatus,
    "TRANSFERRED",
  );
  assert.equal(
    store.collection(archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION).length,
    3,
  );
  assert.equal(
    store
      .collection(archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION)
      .filter(
        (document) =>
          document.data.studentUid === "student-1" &&
          document.data.enrollmentStatus === "ACTIVE",
      ).length,
    1,
  );

  await gateway.execute(
    requestFor({
      commandId: commandId(5),
      commandType: COMMAND_TYPES.CLOSE_ENROLLMENT,
      payload: {
        semesterId,
        studentUid: "student-1",
        activeEnrollmentId: moved.result.enrollmentId,
        expectedRevision: 1,
        targetStatus: "WITHDRAWN",
        effectiveTo: "2026-10-01",
        reason: "전출",
      },
    }),
  );
  assert.equal(
    store.data(
      `${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${moved.result.enrollmentId}`,
    ).enrollmentStatus,
    "WITHDRAWN",
  );

  store.documents.set(manifestPath, {
    ...store.data(manifestPath),
    status: "CLOSED",
    provenance: "ARCHIVE",
  });
  store.documents.set(semesterCore.ACTIVE_SEMESTER_POINTER_PATH, {
    semesterId: null,
    revision: 1,
    previousSemesterId: semesterId,
  });
  const prepared = await gateway.execute(
    requestFor({
      commandId: commandId(6),
      commandType: COMMAND_TYPES.PREPARE_SEMESTER_ARCHIVE,
      payload: {
        semesterId,
        expectedRevision: 1,
        accessPolicy: "ADMIN_ONLY",
        sourcePaths: [
          archiveEnrollment.SEMESTER_CLASS_COLLECTION,
          archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION,
          archiveEnrollment.ROSTER_IMPORT_COLLECTION,
        ],
        unresolvedLegacyItems: [],
        reason: "학기 자료 무결성 준비",
      },
    }),
  );
  assert.equal(prepared.result.archiveStatus, "PREPARED");
  const frozen = await gateway.execute(
    requestFor({
      commandId: commandId(7),
      commandType: COMMAND_TYPES.FREEZE_SEMESTER_ARCHIVE,
      payload: {
        semesterId,
        expectedRevision: 1,
        expectedIntegrityHash: prepared.result.integrityHash,
        reason: "학기 자료 동결",
      },
    }),
  );
  assert.equal(frozen.result.archiveStatus, "FROZEN");
  assert.equal(
    store.data(`${archiveEnrollment.ARCHIVE_MANIFEST_COLLECTION}/${semesterId}`)
      .archivedBy,
    "admin-uid",
  );

  const archived = await gateway.execute(
    requestFor({
      commandId: commandId(8),
      commandType: COMMAND_TYPES.TRANSITION_SEMESTER_STATUS,
      payload: {
        semesterId,
        expectedRevision: 1,
        targetStatus: "ARCHIVED",
        reason: "보관 완료",
      },
    }),
  );
  assert.equal(archived.result.status, "ARCHIVED");
  assert.equal(store.data(manifestPath).status, "ARCHIVED");
  assert.equal(
    await reasonFrom(() =>
      gateway.execute(
        requestFor({
          commandId: commandId(9),
          commandType: COMMAND_TYPES.CREATE_SEMESTER_CLASS,
          payload: {
            semesterId,
            expectedSemesterRevision: 1,
            grade: "2",
            classNumber: "1",
            displayName: "2학년 1반",
            homeroomTeacherUid: "teacher-1",
            reason: "보관 학기 쓰기 시도",
          },
        }),
      ),
    ),
    "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
  );

  const legacyWritesBefore = store.writeCount;
  const legacy = await queries.getArchiveEnrollmentState(
    queryRequest({
      source: "LEGACY",
      semesterId: "2026-1",
      callSite: "verify-w4-unit-legacy",
    }),
  );
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.readOnly, true);
  assert.equal(legacy.schemaVersion, 0);
  assert.equal(store.writeCount, legacyWritesBefore);

  assert.equal(
    await reasonFrom(() =>
      gateway.execute(
        requestFor({
          commandId: commandId(10),
          commandType: COMMAND_TYPES.PREPARE_SEMESTER_ARCHIVE,
          payload: {
            semesterId,
            expectedRevision: 1,
            accessPolicy: "ADMIN_ONLY",
            sourcePaths: [archiveEnrollment.SEMESTER_CLASS_COLLECTION],
            unresolvedLegacyItems: [],
            reason: "권한 없는 요청",
          },
          uid: "student-1",
          email: "student@yongshin-ms.ms.kr",
        }),
      ),
    ),
    "COMMAND_ADMIN_REQUIRED",
  );

  console.log(
    JSON.stringify({
      suite: "archive-enrollment-core",
      passed: true,
      cases: [
        "ROSTER_PREVIEW_QUERY_ZERO_WRITE",
        "ROSTER_EXPLICIT_STUDENT_ROLE_REQUIRED_PREVIEW_AND_IMPORT",
        "ROSTER_NON_STUDENT_ROLE_CHANGE_AFTER_PREVIEW_ZERO_WRITE",
        "ROSTER_DUPLICATE_ORPHAN_MISSING_DRY_RUN_FAIL",
        "ROSTER_CONCURRENT_REPLAY_EFFECT_ONCE",
        "ROSTER_SOURCE_REPLAY_NO_DUPLICATE_BUSINESS_DOCS",
        "RECEIPT_AUDIT_SCHEMA",
        "W4_REQUIRED_READINESS_THREE_PASS",
        "W4_REQUIRED_READINESS_THREE_FAIL_CLOSED",
        "W4_VERIFIED_CUTOVER_SOURCE_ARCHIVE_OVERRIDES_GLOBAL_ACTIVE_POINTER",
        "W4_STALE_CUTOVER_EVIDENCE_FALLS_BACK_TO_ACTIVE_POINTER",
        "W4_DEPENDENCY_CHANGE_STALES_READINESS",
        "W4_RESPONSE_LOSS_STATUS_AND_REPLAY_RECOVERY",
        "CURRENT_EXPLICIT_PROVENANCE_QUERY_ZERO_WRITE",
        "ENROLLMENT_MOVE_PRESERVES_HISTORY",
        "CONCURRENT_ENROLLMENT_MOVE_EXACTLY_ONE_ACTIVE",
        "ENROLLMENT_CLOSE_CLEARS_ACTIVE_SLOT",
        "ARCHIVE_PREPARE_AND_FREEZE_INTEGRITY",
        "ARCHIVED_TRANSITION_REQUIRES_FREEZE",
        "ARCHIVED_SEMESTER_WRITE_FENCE",
        "LEGACY_EXPLICIT_READ_ONLY_QUERY_ZERO_WRITE",
        "UNAUTHORIZED_PRE_BUSINESS_REJECTION",
      ],
      productionAccess: 0,
    }),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
