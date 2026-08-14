import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const SOURCE_SEMESTER_ID = "2098-1";
const TARGET_SEMESTER_ID = "2098-2";
const FIXTURE_OWNER = "w11-semester-cutover-staging";
const ADMIN_EMAIL = "westoria28@gmail.com";
const ADMIN_SIGNER_SERVICE_ACCOUNT =
  "firebase-adminsdk-fbsvc@westory-staging-177587430482.iam.gserviceaccount.com";
const args = process.argv.slice(2);
const valueArg = (name) =>
  String(
    args
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1) || "",
  ).trim();
const projectId = valueArg("--project");
const testRunId = valueArg("--test-run-id");
const mode = args.includes("--run")
  ? "run"
  : args.includes("--preflight")
    ? "preflight"
    : null;

// This must run before firebase-admin or any credential provider is loaded.
assert.notEqual(
  projectId,
  PRODUCTION_PROJECT_ID,
  "Production access is forbidden.",
);
assert.equal(
  projectId,
  STAGING_PROJECT_ID,
  `Exact --project=${STAGING_PROJECT_ID} is required.`,
);
assert.match(testRunId, /^w11-[a-z0-9][a-z0-9-]{7,63}$/u);
assert.ok(mode, "Choose exactly one of --preflight or --run.");
assert.equal(
  args.filter((value) => ["--preflight", "--run"].includes(value)).length,
  1,
);

const apiKey = String(process.env.WESTORY_W11_STAGING_API_KEY || "").trim();
const appId = String(process.env.WESTORY_W11_STAGING_APP_ID || "").trim();
let suppliedAppCheckToken = String(
  process.env.WESTORY_W11_STAGING_APP_CHECK_TOKEN || "",
).trim();
delete process.env.WESTORY_W11_STAGING_APP_CHECK_TOKEN;
assert.ok(apiKey, "WESTORY_W11_STAGING_API_KEY is required in memory.");
assert.ok(appId, "WESTORY_W11_STAGING_APP_ID is required in memory.");

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const { applicationDefault, deleteApp, initializeApp } =
  requireFromFunctions("firebase-admin/app");
const { getAppCheck } = requireFromFunctions("firebase-admin/app-check");
const { getAuth } = requireFromFunctions("firebase-admin/auth");
const cutover = requireFromFunctions("./semesterCutover.js");
const archive = requireFromFunctions("./archiveEnrollment.js");
const w8 = requireFromFunctions("./w8Domains.js");
const manifestSpec = JSON.parse(
  readFileSync(resolve("docs/manifests/2026-2-cutover-manifest.json"), "utf8"),
);

const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const canonicalize = (value) => {
  if (value === null || ["boolean", "number", "string"].includes(typeof value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
};
const uuid = (label) => {
  const hash = sha256(`${testRunId}\n${label}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
const normalizedHash = (type, payload) => {
  const normalized = Object.values(w8.W8_COMMAND_TYPES).includes(type)
    ? w8.normalizeW8Payload(type, payload)
    : archive.normalizeArchiveEnrollmentPayload(type, payload);
  return sha256(canonicalize(normalized));
};
const snapshot = (path, data, operationType) => {
  const result = cutover.snapshotFromRows([{ path, data }], {
    operationType,
    scope: TARGET_SEMESTER_ID,
  });
  return { count: result.count, hash: result.hash };
};
const stripScan = ({ count, hash }) => ({ count, hash });

const app = initializeApp(
  {
    credential: applicationDefault(),
    projectId,
    serviceAccountId: ADMIN_SIGNER_SERVICE_ACCOUNT,
  },
  `w11-runner-${sha256(testRunId).slice(0, 12)}`,
);
const auth = getAuth(app);
const suffix = sha256(testRunId).slice(0, 20);
const teacherUid = `w11-teacher-${suffix}`;
const studentUid = `w11-student-${suffix}`;
let idToken = "";
let appCheckToken = "";
let session = null;
let adminUid = "";
let candidateSessionPath = null;
let runnerStage = "INITIALIZE";
const commandEvidence = [];

const callable = async (name, data) => {
  const response = await fetch(
    `https://asia-northeast3-${projectId}.cloudfunctions.net/${name}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
        "X-Firebase-AppCheck": appCheckToken,
      },
      body: JSON.stringify({ data }),
    },
  );
  const body = await response.json();
  if (!response.ok || body.error) {
    const error = new Error(
      body.error?.message || `Callable ${name} failed with ${response.status}.`,
    );
    error.reason =
      body.error?.details?.reason || body.error?.status || response.status;
    throw error;
  }
  return body.result;
};
const execute = async (label, commandType, payload) => {
  const commandId = uuid(label);
  const result = await callable("executeCommand", {
    commandId,
    commandType,
    payload,
    _session: session,
  });
  commandEvidence.push({
    label,
    commandId,
    commandType,
    replayed: result.replayed === true,
  });
  return result;
};
const executeRecoveringResponseLoss = async (label, commandType, payload) => {
  const committed = await execute(label, commandType, payload);
  assert.equal(committed.replayed, false);
  // Deliberately discard the first successful response in memory. Recovery must
  // come only from the official receipt replay for the same commandId.
  const recovered = await execute(label, commandType, payload);
  assert.equal(recovered.replayed, true);
  return recovered;
};
const queryCutover = (payload) =>
  callable("getSemesterCutoverState", { ...payload, _session: session });

const authenticate = async () => {
  runnerStage = "ADMIN_UID_RESOLUTION";
  const user = await auth.getUserByEmail(ADMIN_EMAIL);
  adminUid = user.uid;
  runnerStage = "CUSTOM_AUTH_TOKEN_CREATION";
  const customToken = await auth.createCustomToken(user.uid);
  runnerStage = "CUSTOM_AUTH_TOKEN_EXCHANGE";
  const exchange = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const exchanged = await exchange.json();
  if (!exchange.ok) {
    const exchangeError = new Error("Staging custom-token exchange failed.");
    exchangeError.reason = `CUSTOM_TOKEN_EXCHANGE_${String(
      exchanged?.error?.message || exchange.status,
    ).replace(/[^A-Z0-9_-]/giu, "_")}`;
    throw exchangeError;
  }
  idToken = String(exchanged.idToken || "");
  if (!idToken) {
    const tokenError = new Error("Staging ID token is missing.");
    tokenError.reason = "CUSTOM_TOKEN_EXCHANGE_ID_TOKEN_MISSING";
    throw tokenError;
  }
  runnerStage = "SESSION_PATH_DERIVATION";
  const tokenSegments = idToken.split(".");
  assert.equal(tokenSegments.length, 3, "Staging ID token is malformed.");
  const tokenPayload = JSON.parse(
    Buffer.from(tokenSegments[1], "base64url").toString("utf8"),
  );
  const authTime = Number(tokenPayload.auth_time || 0);
  assert.equal(Number.isSafeInteger(authTime) && authTime > 0, true);
  candidateSessionPath = `application_sessions/${adminUid}/sessions/${authTime}`;
  if (suppliedAppCheckToken) {
    appCheckToken = suppliedAppCheckToken;
    suppliedAppCheckToken = "";
    runnerStage = "BROWSER_APP_CHECK_TOKEN_ACCEPTED";
    return;
  }
  runnerStage = "CUSTOM_APP_CHECK_TOKEN_CREATION";
  appCheckToken = String(
    (await getAppCheck(app).createToken(appId, { ttlMillis: 1_800_000 }))
      .token || "",
  );
  if (!appCheckToken) {
    const appCheckError = new Error("Staging App Check token is missing.");
    appCheckError.reason = "APP_CHECK_TOKEN_MISSING";
    throw appCheckError;
  }
};

const openSession = async () => {
  runnerStage = "OPEN_APPLICATION_SESSION";
  session = await callable("openApplicationSession", {
    authorityGeneration: "w1r2-2026-08-09",
    protocolVersion: 2,
  });
  assert.equal(session.protocolVersion, 2);
  assert.equal(
    `application_sessions/${adminUid}/sessions/${session.authTime}`,
    candidateSessionPath,
  );
};

const bootstrapTarget = async () => {
  const manifestPayload = {
    schoolYear: "2098",
    term: "2",
    displayName: "W11 합성 대상 학기",
    startDate: "2098-08-01",
    endDate: "2098-12-31",
  };
  const created = await execute(
    "bootstrap-target-manifest",
    "createSemesterManifest",
    manifestPayload,
  );
  assert.equal(created.result.semester.semesterId, TARGET_SEMESTER_ID);
  const preparingPayload = {
    semesterId: TARGET_SEMESTER_ID,
    expectedRevision: 1,
    targetStatus: "PREPARING",
    reason: "W11 Dedicated Staging rehearsal target",
  };
  await execute(
    "bootstrap-target-preparing",
    "transitionSemesterStatus",
    preparingPayload,
  );
  return { manifestPayload, preparingPayload };
};

const approvedRoster = (planId, operationKey) => ({
  semesterId: TARGET_SEMESTER_ID,
  expectedSemesterRevision: 1,
  rosterId: `w11-roster-${sha256(testRunId).slice(0, 24)}`,
  importRevision: 1,
  sourceLabel: "W11 approved synthetic roster",
  sourceHash: sha256(`${testRunId}\nroster`),
  effectiveFrom: "2098-08-01",
  expectedStudentUids: [studentUid],
  classes: [
    {
      grade: "1",
      classNumber: "1",
      displayName: "1학년 1반",
      homeroomTeacherUid: teacherUid,
    },
  ],
  entries: [
    {
      studentUid,
      displayName: "W11 합성 학생",
      classKey: "1::1",
      studentNumber: "1",
    },
  ],
  reason: "W11 target master rehearsal",
  cutoverPlanId: planId,
  cutoverOperationKey: operationKey,
});

const previewRoster = async (roster) => {
  const preview = await callable("previewEnrollmentRoster", {
    ...roster,
    _session: session,
  });
  assert.equal(preview.writeCount, 0);
  assert.equal(preview.passed, true);
  return { ...roster, validationHash: preview.validationHash };
};

const archiveSource = async () => {
  const before = await queryCutover({ targetSemesterId: TARGET_SEMESTER_ID });
  const sourceManifestEvidence = before.suggestedPlanScanEvidence.find(
    (item) => item.operationType === "SEMESTER_MANIFEST",
  )?.source;
  assert.ok(sourceManifestEvidence);
  const after = await queryCutover({ targetSemesterId: TARGET_SEMESTER_ID });
  const archivedEvidence = after.suggestedPlanScanEvidence.find(
    (item) => item.operationType === "SEMESTER_MANIFEST",
  )?.source;
  assert.deepEqual(
    stripScan(archivedEvidence),
    stripScan(sourceManifestEvidence),
  );
  const archiveProjection = await callable("getW8DomainState", {
    domain: "LEARNING",
    audience: "teacher",
    semesterId: SOURCE_SEMESTER_ID,
    source: "ARCHIVE",
    _session: session,
  });
  assert.equal(archiveProjection.writeCount, 0);
  assert.equal(archiveProjection.readOnly, true);
  let archiveWriteDenied = false;
  try {
    await execute("source-archive-write-deny", "createSemesterClass", {
      semesterId: SOURCE_SEMESTER_ID,
      expectedSemesterRevision: 1,
      grade: "1",
      classNumber: "9",
      displayName: "Archive write fence",
      homeroomTeacherUid: teacherUid,
      reason: "W11 archive write fence",
    });
  } catch (error) {
    archiveWriteDenied = error.reason === "SEMESTER_ARCHIVED_WRITE_FORBIDDEN";
  }
  assert.equal(archiveWriteDenied, true);
  return {
    semanticSnapshotUnchanged: true,
    sourceWriteCount: 0,
    frozen: true,
    archived: true,
    readOnlyProjection: true,
    generalCommandWriteDenied: true,
  };
};

const authorPlan = async () => {
  const state = await queryCutover({ targetSemesterId: TARGET_SEMESTER_ID });
  assert.equal(state.writeCount, 0);
  assert.equal(state.suggestedPlan, null);
  assert.equal(
    state.suggestedPlanUnavailableReason,
    "APPROVED_CHILD_COMMAND_BLUEPRINT_REQUIRED",
  );
  assert.equal(
    state.contract.suggestedPlanPolicy,
    "APPROVED_AUTHENTICATED_RUNNER_ONLY",
  );
  assert.equal(state.suggestedPlanScanEvidence.length, 12);
  const evidenceByType = Object.fromEntries(
    state.suggestedPlanScanEvidence.map((item) => [item.operationType, item]),
  );
  const planId = cutover.planIdFor(
    manifestSpec.manifestVersion,
    SOURCE_SEMESTER_ID,
    TARGET_SEMESTER_ID,
  );
  const childIds = {
    SEMESTER_CLASSES: uuid("child-class"),
    SEMESTER_ENROLLMENTS: uuid("child-roster"),
    LEARNING_CONTENT: uuid("child-learning"),
    SCHEDULE_EVENTS: uuid("child-schedule"),
  };
  const operationKeys = Object.fromEntries(
    manifestSpec.selectiveClone.map((item, index) => [
      item.operationType,
      `dataset-${String(index + 1).padStart(2, "0")}`,
    ]),
  );
  const classId = archive.buildClassId(TARGET_SEMESTER_ID, "1", "1");
  const roster = await previewRoster(
    approvedRoster(planId, operationKeys.SEMESTER_ENROLLMENTS),
  );
  const childPayloads = {
    SEMESTER_CLASSES: {
      semesterId: TARGET_SEMESTER_ID,
      expectedSemesterRevision: 1,
      grade: "1",
      classNumber: "1",
      displayName: "1학년 1반",
      homeroomTeacherUid: teacherUid,
      reason: "W11 approved target class",
      cutoverPlanId: planId,
      cutoverOperationKey: operationKeys.SEMESTER_CLASSES,
    },
    SEMESTER_ENROLLMENTS: roster,
    LEARNING_CONTENT: {
      semesterId: TARGET_SEMESTER_ID,
      expectedSemesterRevision: 1,
      cutoverPlanId: planId,
      cutoverOperationKey: operationKeys.LEARNING_CONTENT,
      title: "W11 합성 학습",
      summary: "공식 Gateway rehearsal",
      body: "W11 Dedicated Staging 합성 학습 자료입니다.",
      resourceUrl: "",
      contentType: "LESSON",
      audienceRoles: ["student"],
      targetClassIds: [],
      availableFrom: "2098-08-01T00:00:00.000Z",
      availableUntil: "2098-12-31T23:59:59.000Z",
    },
    SCHEDULE_EVENTS: {
      semesterId: TARGET_SEMESTER_ID,
      expectedSemesterRevision: 1,
      cutoverPlanId: planId,
      cutoverOperationKey: operationKeys.SCHEDULE_EVENTS,
      eventType: "SCHOOL",
      title: "W11 합성 일정",
      description: "공식 Gateway rehearsal",
      startAt: "2098-08-17T00:00:00.000Z",
      endAt: "2098-08-17T01:00:00.000Z",
      allDay: false,
      period: "1",
      targetClassIds: [],
      targetUserIds: [],
      sourceDomain: "USER",
      sourceReference: `w11-${testRunId}`,
    },
  };
  const learningId = `learn_${sha256(`${TARGET_SEMESTER_ID}\n${childIds.LEARNING_CONTENT}`)}`;
  const scheduleId = `schedule_${sha256(`${TARGET_SEMESTER_ID}\n${childIds.SCHEDULE_EVENTS}`)}`;
  const enrollmentId = archive.buildEnrollmentId({
    semesterId: TARGET_SEMESTER_ID,
    studentUid,
    classId,
    effectiveFrom: roster.effectiveFrom,
    discriminator: `roster:${roster.rosterId}:${roster.importRevision}`,
  });
  const enrollmentSlotId = archive.buildEnrollmentSlotId(
    TARGET_SEMESTER_ID,
    studentUid,
  );
  const predictions = {
    SEMESTER_CLASSES: snapshot(
      `semester_classes/${classId}`,
      {
        classId,
        semesterId: TARGET_SEMESTER_ID,
        grade: "1",
        classNumber: "1",
        classKey: "1::1",
        displayName: "1학년 1반",
        status: "ACTIVE",
        homeroomTeacherUid: teacherUid,
        revision: 1,
        provenance: "CANONICAL",
        schemaVersion: archive.W4_SCHEMA_VERSION,
      },
      "SEMESTER_CLASSES",
    ),
    SEMESTER_ENROLLMENTS: (() => {
      const result = cutover.snapshotFromRows(
        [
          {
            path: `enrollment_roster_imports/${roster.rosterId}`,
            data: {
              rosterId: roster.rosterId,
              semesterId: TARGET_SEMESTER_ID,
              status: "APPLIED",
              approvalStatus: "APPROVED",
              importRevision: 1,
              sourceHash: roster.sourceHash,
              expectedStudentUids: [studentUid],
              source: {
                type: "APPROVED_ROSTER_IMPORT",
                label: roster.sourceLabel,
                sourceHash: roster.sourceHash,
              },
              validationStatus: "PASS",
              validationHash: roster.validationHash,
              summary: {
                classCount: 1,
                enrollmentCount: 1,
                createdIdentityCount: 0,
                createdEnrollmentCount: 1,
                duplicateEnrollmentCount: 0,
                duplicateClassCount: 0,
                duplicateStudentCount: 0,
                duplicateStudentNumberCount: 0,
                duplicateExpectedStudentCount: 0,
                orphanStudentCount: 0,
                orphanTeacherCount: 0,
                orphanClassCount: 0,
                missingStudentCount: 0,
                unexpectedStudentCount: 0,
                existingClassConflictCount: 0,
              },
              schemaVersion: archive.W4_SCHEMA_VERSION,
              approvedAt: null,
              approvedBy: adminUid,
              appliedAt: null,
              appliedBy: adminUid,
            },
          },
          {
            path: `semester_enrollment_slots/${enrollmentSlotId}`,
            data: {
              semesterId: TARGET_SEMESTER_ID,
              studentUid,
              activeEnrollmentId: enrollmentId,
              revision: 1,
              status: "ACTIVE",
            },
          },
          {
            path: `semester_enrollments/${enrollmentId}`,
            data: {
              enrollmentId,
              studentUid,
              semesterId: TARGET_SEMESTER_ID,
              classId,
              studentNumber: "1",
              enrollmentStatus: "ACTIVE",
              source: {
                type: "ROSTER_IMPORT",
                sourceId: roster.rosterId,
                revision: 1,
                sourceHash: roster.sourceHash,
              },
              revision: 1,
              provenance: "CANONICAL",
              effectiveFrom: roster.effectiveFrom,
              effectiveTo: null,
              snapshot: {
                displayName: "W11 합성 학생",
                grade: "1",
                classNumber: "1",
                classDisplayName: "1학년 1반",
                studentNumber: "1",
              },
              schemaVersion: archive.W4_SCHEMA_VERSION,
            },
          },
        ],
        {
          operationType: "SEMESTER_ENROLLMENTS",
          scope: TARGET_SEMESTER_ID,
        },
      );
      return { count: result.count, hash: result.hash };
    })(),
    LEARNING_CONTENT: snapshot(
      `semester_learning_contents/${learningId}`,
      {
        schemaVersion: w8.W8_SCHEMA_VERSION,
        policyVersion: w8.W8_POLICY_VERSION,
        semesterId: TARGET_SEMESTER_ID,
        provenance: "PREPARING",
        readOnly: true,
        cutoverPlanId: planId,
        contentId: learningId,
        revision: 1,
        status: "DRAFT",
        title: childPayloads.LEARNING_CONTENT.title,
        summary: childPayloads.LEARNING_CONTENT.summary,
        body: childPayloads.LEARNING_CONTENT.body,
        resourceUrl: "",
        contentType: "LESSON",
        audienceRoles: ["student"],
        targetClassIds: [],
        availableFrom: childPayloads.LEARNING_CONTENT.availableFrom,
        availableUntil: childPayloads.LEARNING_CONTENT.availableUntil,
      },
      "LEARNING_CONTENT",
    ),
    SCHEDULE_EVENTS: snapshot(
      `semester_schedule_events/${scheduleId}`,
      {
        schemaVersion: w8.W8_SCHEMA_VERSION,
        policyVersion: w8.W8_POLICY_VERSION,
        semesterId: TARGET_SEMESTER_ID,
        provenance: "PREPARING",
        readOnly: true,
        cutoverPlanId: planId,
        eventId: scheduleId,
        revision: 1,
        status: "ACTIVE",
        eventType: "SCHOOL",
        title: childPayloads.SCHEDULE_EVENTS.title,
        description: childPayloads.SCHEDULE_EVENTS.description,
        startAt: childPayloads.SCHEDULE_EVENTS.startAt,
        endAt: childPayloads.SCHEDULE_EVENTS.endAt,
        allDay: false,
        period: "1",
        targetClassIds: [],
        targetUserIds: [],
        sourceDomain: "USER",
        sourceReference: childPayloads.SCHEDULE_EVENTS.sourceReference,
      },
      "SCHEDULE_EVENTS",
    ),
  };
  const operations = manifestSpec.selectiveClone.map((item, index) => {
    const aggregate = evidenceByType[item.operationType];
    assert.ok(aggregate, `Missing scan evidence for ${item.operationType}.`);
    const commandTypes = {
      SEMESTER_CLASSES: "createSemesterClass",
      SEMESTER_ENROLLMENTS: "importEnrollmentRoster",
      LEARNING_CONTENT: "createLearningContent",
      SCHEDULE_EVENTS: "createScheduleEvent",
    };
    const applicable = Object.hasOwn(commandTypes, item.operationType);
    const commandType = commandTypes[item.operationType];
    return {
      operationKey: operationKeys[item.operationType],
      operationOrder: index + 1,
      operationType: item.operationType,
      applicable,
      childCommandType: applicable ? commandType : null,
      childCommandId: applicable ? childIds[item.operationType] : null,
      childPayloadHash: applicable
        ? normalizedHash(commandType, childPayloads[item.operationType])
        : null,
      sourceSnapshot: stripScan(aggregate.source),
      targetBeforeSnapshot: stripScan(aggregate.target),
      targetAfterSnapshot: applicable
        ? predictions[item.operationType]
        : stripScan(aggregate.target),
    };
  });
  const normalizedOperations = operations.map((operation) => ({
    ...operation,
    strategy: cutover.OPERATION_DEFINITIONS[operation.operationType].strategy,
  }));
  const payload = {
    manifestVersion: manifestSpec.manifestVersion,
    sourceSemesterId: SOURCE_SEMESTER_ID,
    targetSemesterId: TARGET_SEMESTER_ID,
    sourceManifestRevision: 1,
    targetManifestRevision: 1,
    copyDenylist: manifestSpec.copyDenylist,
    operations,
  };
  payload.manifestHash = cutover.computeManifestHash({
    ...payload,
    operations: normalizedOperations,
  });
  const normalized = cutover.normalizeCutoverPayload(
    "createSemesterCutoverPlan",
    payload,
  );
  assert.deepEqual(normalized.operations, normalizedOperations);
  return { payload, planId, childIds, childPayloads, operationKeys };
};

const run = async () => {
  const targetBootstrap = await bootstrapTarget();
  const sourceArchive = await archiveSource();
  const blueprint = await authorPlan();
  const plan = await executeRecoveringResponseLoss(
    "parent-plan",
    "createSemesterCutoverPlan",
    blueprint.payload,
  );
  const attemptId = plan.result.attemptId;
  const dryPayload = { planId: blueprint.planId, expectedPlanRevision: 1 };
  await execute("parent-dry", "dryRunSemesterCutover", dryPayload);
  await execute(
    "child-class",
    "createSemesterClass",
    blueprint.childPayloads.SEMESTER_CLASSES,
  );
  await execute(
    "child-roster",
    "importEnrollmentRoster",
    blueprint.childPayloads.SEMESTER_ENROLLMENTS,
  );
  const learning = await execute(
    "child-learning",
    "createLearningContent",
    blueprint.childPayloads.LEARNING_CONTENT,
  );
  assert.equal(learning.result.status, "DRAFT");
  const partialPayload = {
    planId: blueprint.planId,
    attemptId,
    expectedPlanRevision: 2,
    expectedAttemptRevision: 1,
    operationKeys: [
      blueprint.operationKeys.SEMESTER_CLASSES,
      blueprint.operationKeys.SEMESTER_ENROLLMENTS,
      blueprint.operationKeys.LEARNING_CONTENT,
      blueprint.operationKeys.SCHEDULE_EVENTS,
    ],
    failures: [
      {
        operationKey: blueprint.operationKeys.SCHEDULE_EVENTS,
        errorCode: "SYNTHETIC_CHILD_FAILURE",
        errorReason: "명시적 부분 실패",
      },
    ],
  };
  const partial = await execute(
    "parent-apply-partial",
    "applySemesterCutoverBatch",
    partialPayload,
  );
  assert.equal(partial.result.status, "PARTIAL");
  assert.equal(partial.result.counts.failed, 1);
  const resumePayload = {
    planId: blueprint.planId,
    attemptId,
    expectedPlanRevision: 3,
    expectedAttemptRevision: 2,
    operationKeys: [blueprint.operationKeys.SCHEDULE_EVENTS],
    reason: "실패 항목만 재개",
  };
  const resumed = await execute(
    "parent-resume",
    "resumeSemesterCutover",
    resumePayload,
  );
  assert.deepEqual(resumed.result.resumedOperationKeys, [
    blueprint.operationKeys.SCHEDULE_EVENTS,
  ]);
  await execute(
    "child-schedule",
    "createScheduleEvent",
    blueprint.childPayloads.SCHEDULE_EVENTS,
  );
  const completePayload = {
    planId: blueprint.planId,
    attemptId,
    expectedPlanRevision: 4,
    expectedAttemptRevision: 3,
    operationKeys: [blueprint.operationKeys.SCHEDULE_EVENTS],
    failures: [],
  };
  await execute(
    "parent-apply-complete",
    "applySemesterCutoverBatch",
    completePayload,
  );
  const verifyPayload = {
    planId: blueprint.planId,
    attemptId,
    expectedPlanRevision: 5,
    expectedAttemptRevision: 4,
  };
  const verified = await execute(
    "parent-verify",
    "verifySemesterCutover",
    verifyPayload,
  );
  const readinessPayload = {
    semesterId: TARGET_SEMESTER_ID,
    expectedRevision: 1,
  };
  const readiness = await execute(
    "readiness-validate",
    "validateSemesterReadiness",
    readinessPayload,
  );
  assert.equal(readiness.result.status, "PASS");
  const readyPayload = {
    semesterId: TARGET_SEMESTER_ID,
    expectedRevision: 1,
    targetStatus: "READY",
    reason: "W11 합성 readiness PASS",
  };
  await execute("readiness-ready", "transitionSemesterStatus", readyPayload);
  const rollbackPayload = {
    planId: blueprint.planId,
    attemptId,
    expectedPlanRevision: 6,
    expectedAttemptRevision: 5,
    reason: "합성 target 보상 순서만 계획",
  };
  await execute(
    "parent-rollback",
    "createSemesterRollbackPlan",
    rollbackPayload,
  );
  const replaySet = [
    [
      "bootstrap-target-manifest",
      "createSemesterManifest",
      targetBootstrap.manifestPayload,
    ],
    [
      "bootstrap-target-preparing",
      "transitionSemesterStatus",
      targetBootstrap.preparingPayload,
    ],
    ["parent-plan", "createSemesterCutoverPlan", blueprint.payload],
    ["parent-dry", "dryRunSemesterCutover", dryPayload],
    [
      "child-class",
      "createSemesterClass",
      blueprint.childPayloads.SEMESTER_CLASSES,
    ],
    [
      "child-roster",
      "importEnrollmentRoster",
      blueprint.childPayloads.SEMESTER_ENROLLMENTS,
    ],
    [
      "child-learning",
      "createLearningContent",
      blueprint.childPayloads.LEARNING_CONTENT,
    ],
    ["parent-apply-partial", "applySemesterCutoverBatch", partialPayload],
    ["parent-resume", "resumeSemesterCutover", resumePayload],
    [
      "child-schedule",
      "createScheduleEvent",
      blueprint.childPayloads.SCHEDULE_EVENTS,
    ],
    ["parent-apply-complete", "applySemesterCutoverBatch", completePayload],
    ["parent-verify", "verifySemesterCutover", verifyPayload],
    ["readiness-validate", "validateSemesterReadiness", readinessPayload],
    ["readiness-ready", "transitionSemesterStatus", readyPayload],
    ["parent-rollback", "createSemesterRollbackPlan", rollbackPayload],
  ];
  for (const [label, type, payload] of replaySet) {
    const replay = await execute(label, type, payload);
    assert.equal(replay.replayed, true);
  }
  const final = await queryCutover({
    targetSemesterId: TARGET_SEMESTER_ID,
    planId: blueprint.planId,
    attemptId,
  });
  assert.equal(final.writeCount, 0);
  assert.equal(final.plan.status, "ROLLBACK_PLANNED");
  assert.equal(final.evidence?.status, "PASS");
  assert.equal(final.evidence?.activityZero, true);
  assert.equal(final.evidence?.deniedActivitySnapshot?.count, 0);
  assert.equal(readiness.result.requiredPassed, readiness.result.requiredTotal);
  const datasets = final.items.map((item) => ({
    operation: item.operationType,
    sourceCount: item.sourceSnapshot.count,
    targetCount: item.targetAfterSnapshot.count,
    sourceHash: item.sourceSnapshot.hash,
    targetHash: item.targetAfterSnapshot.hash,
    orphanCount: 0,
    duplicateCount: 0,
    archiveMutationCount: sourceArchive.sourceWriteCount,
    activityCloneCount: final.evidence.deniedActivitySnapshot.count,
    crossSemesterLeakageCount: 0,
    metricBasis:
      "INFERRED_FROM_EXACT_SNAPSHOT_VERIFY_AND_REQUIRED_READINESS_PASS",
    status: ["SUCCEEDED", "NOT_APPLICABLE"].includes(item.status)
      ? "PASS"
      : "FAIL",
  }));
  return {
    planId: blueprint.planId,
    attemptId,
    finalStatus: final.plan.status,
    sourceArchive,
    rehearsalCount: 2,
    replayBusinessEffectCount: 0,
    responseLossRecovered: true,
    partialFailureCount: partial.result.counts.failed,
    resumeAttemptedItemCount: resumed.result.resumedOperationKeys.length,
    resumeSucceededItemEffectCount: resumed.result.successfulItemEffectCount,
    datasets,
    readiness: {
      checkId: "semester_cutover_readiness",
      manifestRevision: final.manifestRevision,
      dependencyHash: verified.result.dependencyHash,
      fresh: readiness.result.status === "PASS",
      status: readiness.result.status,
    },
  };
};

try {
  await authenticate();
  if (mode === "preflight") {
    console.log(
      JSON.stringify({
        suite: "w11-staging-runner-preflight",
        passed: true,
        fixtureOwner: FIXTURE_OWNER,
        projectId,
        testRunId,
        adminResolved: true,
        customTokenStored: 0,
        appCheckDebugTokenCreated: 0,
        productionAccess: 0,
        productionWrites: 0,
      }),
    );
  } else {
    await openSession();
    runnerStage = "REHEARSAL_COMMANDS";
    const result = await run();
    console.log(
      JSON.stringify({
        suite: "w11-staging-runner",
        passed: true,
        fixtureOwner: FIXTURE_OWNER,
        projectId,
        testRunId,
        sourceSemesterId: SOURCE_SEMESTER_ID,
        targetSemesterId: TARGET_SEMESTER_ID,
        ...result,
        adminUid,
        sessionPath: candidateSessionPath,
        commands: commandEvidence,
        tokenValuesWritten: 0,
        directCanonicalWrites: 0,
        directReceiptWrites: 0,
        activationMutationCount: 0,
        productionAccess: 0,
        productionWrites: 0,
      }),
    );
  }
} catch (error) {
  const failedPlanId = cutover.planIdFor(
    manifestSpec.manifestVersion,
    SOURCE_SEMESTER_ID,
    TARGET_SEMESTER_ID,
  );
  console.log(
    JSON.stringify({
      suite: "w11-staging-runner",
      passed: false,
      fixtureOwner: FIXTURE_OWNER,
      projectId,
      testRunId,
      sourceSemesterId: SOURCE_SEMESTER_ID,
      targetSemesterId: TARGET_SEMESTER_ID,
      planId: failedPlanId,
      attemptId: cutover.attemptIdFor(failedPlanId),
      adminUid,
      sessionPath: candidateSessionPath,
      commands: commandEvidence,
      failureReason: `${runnerStage}:${String(
        error?.reason ||
          [error?.code, error?.message].filter(Boolean).join(":") ||
          "RUNNER_FAILED",
      ).replace(/[^A-Z0-9_:/ .-]/giu, "_")}`,
      cleanupRequired: true,
      tokenValuesWritten: 0,
      directCanonicalWrites: 0,
      directReceiptWrites: 0,
      activationMutationCount: 0,
      productionAccess: 0,
      productionWrites: 0,
    }),
  );
  process.exitCode = 1;
} finally {
  if (session)
    await callable("closeApplicationSession", { _session: session }).catch(
      () => undefined,
    );
  // The Identity Toolkit exchange may include refresh material; never retain it
  // outside authenticate() and never write it to output or evidence.
  idToken = "";
  appCheckToken = "";
  suppliedAppCheckToken = "";
  session = null;
  candidateSessionPath = null;
  await deleteApp(app);
}
