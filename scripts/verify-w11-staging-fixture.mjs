import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const FIXTURE_OWNER = "w11-semester-cutover-staging";
const SOURCE_SEMESTER_ID = "2098-1";
const TARGET_SEMESTER_ID = "2098-2";
const CANONICAL_BASELINE_SEMESTER_ID = "2026-2";
const args = process.argv.slice(2);
const valueArg = (name) =>
  String(
    args
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1) || "",
  ).trim();
const projectId = valueArg("--project");
const testRunId = valueArg("--test-run-id");
const commandEvidencePath = valueArg("--command-evidence");
const runnerEvidencePath = valueArg("--runner-evidence");
const modes = ["dry-run", "setup", "collect-evidence", "verify", "cleanup"];
const mode = modes.find((name) => args.includes(`--${name}`));

// This fence intentionally runs before firebase-admin is resolved or any
// application-default credential can be initialized.
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
assert.equal(
  modes.filter((name) => args.includes(`--${name}`)).length,
  1,
  "Choose exactly one W11 fixture mode.",
);
assert.match(
  testRunId,
  /^w11-[a-z0-9][a-z0-9-]{7,63}$/u,
  "A scoped W11 testRunId is required.",
);
if (["collect-evidence", "verify", "cleanup"].includes(mode)) {
  const requiredEvidencePath =
    mode === "collect-evidence" ? runnerEvidencePath : commandEvidencePath;
  assert.ok(
    requiredEvidencePath,
    mode === "collect-evidence"
      ? "--runner-evidence is required."
      : "--command-evidence is required.",
  );
  assert.equal(existsSync(resolve(requiredEvidencePath)), true);
}
if (["verify", "cleanup"].includes(mode)) {
  assert.ok(commandEvidencePath, "--command-evidence is required.");
}
if (mode === "dry-run") {
  console.log(
    JSON.stringify({
      suite: "w11-staging-fixture-dry-run",
      passed: true,
      projectId,
      fixtureOwner: FIXTURE_OWNER,
      testRunId,
      sourceSemesterId: SOURCE_SEMESTER_ID,
      targetSemesterId: TARGET_SEMESTER_ID,
      canonicalBaselineSemesterId: CANONICAL_BASELINE_SEMESTER_ID,
      credentialInitializationCount: 0,
      productionAccess: 0,
      productionWrites: 0,
    }),
  );
  process.exit(0);
}

const password = String(process.env.WESTORY_W11_STAGING_PASSWORD || "");
if (mode === "setup") {
  assert.match(
    password,
    /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16,}$/u,
    "WESTORY_W11_STAGING_PASSWORD must be a strong temporary password.",
  );
}

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const { applicationDefault, deleteApp, initializeApp } =
  requireFromFunctions("firebase-admin/app");
const { getAuth } = requireFromFunctions("firebase-admin/auth");
const { FieldPath, getFirestore } = requireFromFunctions(
  "firebase-admin/firestore",
);
const cutover = requireFromFunctions("./semesterCutover.js");
const semesterCore = requireFromFunctions("./semesterCore.js");
const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const suffix = sha256(testRunId).slice(0, 20);
const teacherUid = `w11-teacher-${suffix}`;
const studentUid = `w11-student-${suffix}`;
const teacherEmail = `w11.teacher.${suffix}@yongshin-ms.ms.kr`;
const studentEmail = `w11.student.${suffix}@yongshin-ms.ms.kr`;
const classId = `class-w11-${suffix}`;
const enrollmentId = `enr-w11-${suffix}`;
const slotId = `slot_${sha256(`${SOURCE_SEMESTER_ID}\n${studentUid}`).slice(0, 40)}`;
const runPath = `w11_verification_runs/${testRunId}`;
const identityPath = `student_identities/${studentUid}`;
const sourceArchivePath = `semester_archive_manifests/${SOURCE_SEMESTER_ID}`;
const fixturePaths = [
  `users/${teacherUid}`,
  `users/${studentUid}`,
  `semester_manifests/${SOURCE_SEMESTER_ID}`,
  `semester_classes/${classId}`,
  `semester_enrollments/${enrollmentId}`,
  `semester_enrollment_slots/${slotId}`,
  identityPath,
  sourceArchivePath,
  runPath,
];
const reservedPlanId = cutover.planIdFor(
  "w11-v1",
  SOURCE_SEMESTER_ID,
  TARGET_SEMESTER_ID,
);
const reservedAttemptId = cutover.attemptIdFor(reservedPlanId);
const reservedTargetSeedPaths = semesterCore
  .getSemesterSeedDefinitions("2098", "2")
  .map((seed) => seed.path);
const reservedControlPaths = [
  `semester_cutover_targets/${TARGET_SEMESTER_ID}`,
  `semester_cutover_plans/${reservedPlanId}`,
  `semester_cutover_attempts/${reservedAttemptId}`,
];
const app = initializeApp(
  { credential: applicationDefault(), projectId },
  `w11-fixture-${suffix.slice(0, 12)}`,
);
const auth = getAuth(app);
const db = getFirestore(app);

const canonicalCollections = [
  "semester_classes",
  "semester_enrollments",
  "semester_enrollment_slots",
  "enrollment_roster_imports",
  "semester_readiness_reports",
  "semester_assessment_definitions",
  "semester_learning_contents",
  "semester_schedule_events",
  "semester_notices",
  "semester_wis_economies",
  "semester_wis_accounts",
  "semester_wis_balances",
  "semester_wis_rankings",
];
const reservedRootCollections = [
  ...canonicalCollections,
  "semester_manifests",
  "semester_archive_manifests",
  "student_identities",
];
const W11_COMMAND_TYPES = new Set([
  "createSemesterCutoverPlan",
  "dryRunSemesterCutover",
  "applySemesterCutoverBatch",
  "verifySemesterCutover",
  "resumeSemesterCutover",
  "createSemesterRollbackPlan",
]);
const canonicalize = (value) => {
  if (
    value === null ||
    ["boolean", "number", "string"].includes(typeof value)
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value?.toMillis === "function") {
    return { __timestampMillis: value.toMillis() };
  }
  if (value instanceof Date) return { __dateMillis: value.getTime() };
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return String(value);
};
const baselineSnapshot = async () => {
  const manifest = await db
    .doc(`semester_manifests/${CANONICAL_BASELINE_SEMESTER_ID}`)
    .get();
  const rows = manifest.exists
    ? [{ path: manifest.ref.path, data: canonicalize(manifest.data()) }]
    : [];
  for (const path of [
    "site_settings/semester_active",
    "site_settings/config",
  ]) {
    const snapshot = await db.doc(path).get();
    if (snapshot.exists) {
      rows.push({ path, data: canonicalize(snapshot.data()) });
    }
  }
  for (const collectionName of canonicalCollections) {
    const snapshot = await db
      .collection(collectionName)
      .where("semesterId", "==", CANONICAL_BASELINE_SEMESTER_ID)
      .get();
    rows.push(
      ...snapshot.docs.map((item) => ({
        path: item.ref.path,
        data: canonicalize(item.data()),
      })),
    );
  }
  rows.sort((left, right) => left.path.localeCompare(right.path));
  return { count: rows.length, hash: sha256(JSON.stringify(rows)) };
};
const ensureExactOwner = (snapshot, label) => {
  assert.equal(snapshot.exists, true, `${label} is missing.`);
  assert.equal(snapshot.data()?.fixtureOwner, FIXTURE_OWNER);
  assert.equal(snapshot.data()?.testRunId, testRunId);
};
const toMillis = (value) => {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Date.parse(String(value || ""));
};
const readCommandEvidence = () => {
  const evidence = JSON.parse(
    readFileSync(resolve(commandEvidencePath), "utf8"),
  );
  assert.equal(evidence.fixtureOwner, FIXTURE_OWNER);
  assert.equal(evidence.testRunId, testRunId);
  assert.equal(evidence.projectId, projectId);
  assert.equal(evidence.sourceSemesterId, SOURCE_SEMESTER_ID);
  assert.equal(evidence.targetSemesterId, TARGET_SEMESTER_ID);
  assert.equal(Array.isArray(evidence.receiptIds), true);
  assert.equal(Array.isArray(evidence.auditIds), true);
  assert.equal(Array.isArray(evidence.businessPaths), true);
  assert.equal(Array.isArray(evidence.sourcePaths), true);
  assert.equal(Array.isArray(evidence.sessionPaths), true);
  assert.equal(typeof evidence.runnerPassed, "boolean");
  return evidence;
};
const readRunnerEvidence = () => {
  const evidence = JSON.parse(
    readFileSync(resolve(runnerEvidencePath), "utf8"),
  );
  assert.equal(evidence.suite, "w11-staging-runner");
  assert.equal(typeof evidence.passed, "boolean");
  assert.equal(evidence.fixtureOwner, FIXTURE_OWNER);
  assert.equal(evidence.testRunId, testRunId);
  assert.equal(evidence.projectId, projectId);
  assert.equal(evidence.sourceSemesterId, SOURCE_SEMESTER_ID);
  assert.equal(evidence.targetSemesterId, TARGET_SEMESTER_ID);
  if (evidence.passed) {
    assert.equal(evidence.rehearsalCount, 2);
    assert.equal(evidence.replayBusinessEffectCount, 0);
    assert.equal(evidence.responseLossRecovered, true);
    assert.equal(evidence.sourceArchive?.archived, true);
    assert.equal(evidence.sourceArchive?.frozen, true);
    assert.equal(evidence.sourceArchive?.readOnlyProjection, true);
    assert.equal(evidence.sourceArchive?.generalCommandWriteDenied, true);
    assert.equal(evidence.sourceArchive?.sourceWriteCount, 0);
  } else {
    assert.equal(evidence.cleanupRequired, true);
  }
  if (evidence.sessionPath) {
    assert.match(
      evidence.sessionPath,
      new RegExp(
        `^application_sessions/${String(evidence.adminUid).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/sessions/[1-9][0-9]*$`,
        "u",
      ),
    );
  }
  assert.equal(Array.isArray(evidence.commands), true);
  assert.ok(evidence.commands.length > 0);
  return evidence;
};
const assertBusinessPath = (path) => {
  if (String(path).startsWith("years/2098/semesters/2/")) return;
  if (
    /^semester_readiness_reports\/2098-2\/versions\/readiness_[a-f0-9]{64}$/u.test(
      String(path),
    )
  ) {
    return;
  }
  const [collectionName, documentId, ...rest] = String(path).split("/");
  assert.ok(reservedRootCollections.includes(collectionName));
  assert.ok(documentId && rest.length === 0);
  if (collectionName === "semester_manifests") {
    assert.ok([SOURCE_SEMESTER_ID, TARGET_SEMESTER_ID].includes(documentId));
  }
  if (collectionName === "semester_archive_manifests") {
    assert.equal(documentId, SOURCE_SEMESTER_ID);
  }
  if (collectionName === "student_identities") {
    assert.equal(documentId, studentUid);
  }
};

const setup = async () => {
  const exactReservedPaths = [
    ...fixturePaths,
    `semester_manifests/${TARGET_SEMESTER_ID}`,
    ...reservedTargetSeedPaths,
    ...reservedControlPaths,
  ];
  const existing = await db.getAll(
    ...exactReservedPaths.map((path) => db.doc(path)),
  );
  assert.equal(
    existing.some((item) => item.exists),
    false,
    "Reserved W11 fixture paths are not empty.",
  );
  const staleAttemptItems = await db
    .collection(`semester_cutover_attempts/${reservedAttemptId}/items`)
    .limit(2)
    .get();
  assert.equal(
    staleAttemptItems.empty,
    true,
    "Reserved W11 attempt item scope is not empty.",
  );
  for (const collectionName of canonicalCollections) {
    const target = await db
      .collection(collectionName)
      .where("semesterId", "==", TARGET_SEMESTER_ID)
      .limit(2)
      .get();
    assert.equal(
      target.empty,
      true,
      `Reserved W11 target scope is not empty: ${collectionName}.`,
    );
  }
  for (const collectionName of [
    "semester_cutover_plans",
    "semester_cutover_attempts",
    "semester_cutover_evidence",
  ]) {
    const target = await db
      .collection(collectionName)
      .where("targetSemesterId", "==", TARGET_SEMESTER_ID)
      .limit(2)
      .get();
    assert.equal(
      target.empty,
      true,
      `Reserved W11 control scope is not empty: ${collectionName}.`,
    );
  }
  const baseline = await baselineSnapshot();
  const createdAuthUids = [];
  try {
    await auth.createUser({
      uid: teacherUid,
      email: teacherEmail,
      password,
      emailVerified: true,
      displayName: "W11 합성 교사",
    });
    createdAuthUids.push(teacherUid);
    await auth.createUser({
      uid: studentUid,
      email: studentEmail,
      password,
      emailVerified: true,
      displayName: "W11 합성 학생",
    });
    createdAuthUids.push(studentUid);
    const batch = db.batch();
    const marker = { fixtureOwner: FIXTURE_OWNER, testRunId };
    batch.create(db.doc(`users/${teacherUid}`), {
      ...marker,
      role: "teacher",
      teacherPortalEnabled: true,
      staffPermissions: ["lesson_read"],
    });
    batch.create(db.doc(`users/${studentUid}`), {
      ...marker,
      role: "student",
    });
    batch.create(db.doc(identityPath), {
      ...marker,
      studentUid,
      displayName: "W11 합성 학생",
      accountStatus: "ACTIVE",
      revision: 1,
      provenance: "CANONICAL",
      schemaVersion: 1,
    });
    batch.create(db.doc(`semester_manifests/${SOURCE_SEMESTER_ID}`), {
      ...marker,
      semesterId: SOURCE_SEMESTER_ID,
      schoolYear: 2098,
      term: 1,
      displayName: "W11 합성 원본 학기",
      revision: 1,
      status: "ARCHIVED",
      provenance: "ARCHIVE",
      startAt: "2098-03-01",
      endAt: "2098-07-31",
      schemaVersion: 1,
    });
    batch.create(db.doc(`semester_classes/${classId}`), {
      ...marker,
      classId,
      semesterId: SOURCE_SEMESTER_ID,
      status: "ACTIVE",
      grade: 1,
      className: "1",
      revision: 1,
    });
    batch.create(db.doc(`semester_enrollments/${enrollmentId}`), {
      ...marker,
      enrollmentId,
      semesterId: SOURCE_SEMESTER_ID,
      studentUid,
      classId,
      enrollmentStatus: "ACTIVE",
      displayName: "W11 합성 학생",
      studentName: "W11 합성 학생",
      revision: 1,
    });
    batch.create(db.doc(`semester_enrollment_slots/${slotId}`), {
      ...marker,
      slotId,
      semesterId: SOURCE_SEMESTER_ID,
      studentUid,
      enrollmentId,
      classId,
      enrollmentStatus: "ACTIVE",
    });
    batch.create(db.doc(sourceArchivePath), {
      ...marker,
      semesterId: SOURCE_SEMESTER_ID,
      archiveStatus: "FROZEN",
      preparedRevision: 1,
      frozenRevision: 1,
      schemaVersion: 1,
      writeFenceVersion: "w4-v1",
      readinessRegistryVersion: "w4-v1",
      counts: {
        classCount: 1,
        enrollmentCount: 1,
        activeEnrollmentCount: 1,
        rosterImportCount: 0,
      },
      sourcePaths: [`semester_classes/${classId}`],
      integrityHash: sha256(`${testRunId}\nsource-archive`),
      unresolvedLegacyItems: [],
      unresolvedBlockingCount: 0,
      accessPolicy: "ADMIN_ONLY",
    });
    batch.create(db.doc(runPath), {
      ...marker,
      projectId,
      sourceSemesterId: SOURCE_SEMESTER_ID,
      targetSemesterId: TARGET_SEMESTER_ID,
      targetSetupPolicy: "GATEWAY_ONLY_BY_AUTHENTICATED_REHEARSAL_RUNNER",
      canonicalBaselineSemesterId: CANONICAL_BASELINE_SEMESTER_ID,
      canonicalBaselineCount: baseline.count,
      canonicalBaselineHash: baseline.hash,
      teacherUid,
      studentUid,
      classId,
      enrollmentId,
      fixturePaths,
      createdAt: new Date(),
    });
    await batch.commit();
    console.log(
      JSON.stringify({
        suite: "w11-staging-fixture-setup",
        passed: true,
        fixtureOwner: FIXTURE_OWNER,
        testRunId,
        projectId,
        sourceSemesterId: SOURCE_SEMESTER_ID,
        targetSemesterId: TARGET_SEMESTER_ID,
        canonicalBaselineSemesterId: CANONICAL_BASELINE_SEMESTER_ID,
        canonicalBaselineCount: baseline.count,
        canonicalBaselineHash: baseline.hash,
        authUsersCreated: createdAuthUids.length,
        firestoreDocumentsCreated: fixturePaths.length,
        targetDirectSeedCount: 0,
        productionAccess: 0,
        productionWrites: 0,
      }),
    );
  } catch (error) {
    const snapshots = await db.getAll(
      ...fixturePaths.map((path) => db.doc(path)),
    );
    const batch = db.batch();
    snapshots
      .filter((item) => item.exists)
      .forEach((item) => batch.delete(item.ref));
    await batch.commit().catch(() => undefined);
    await Promise.all(
      createdAuthUids.map((uid) => auth.deleteUser(uid).catch(() => undefined)),
    );
    throw error;
  }
};

const collectEvidence = async () => {
  const runner = readRunnerEvidence();
  const run = await db.doc(runPath).get();
  ensureExactOwner(run, "W11 run marker");
  const pointer = await db
    .doc(`semester_cutover_targets/${TARGET_SEMESTER_ID}`)
    .get();
  const planId = String(pointer.data()?.latestPlanId || runner.planId || "");
  const attemptId = String(
    pointer.data()?.latestAttemptId || runner.attemptId || "",
  );
  assert.match(planId, /^cutplan_[a-f0-9]{64}$/u);
  assert.match(attemptId, /^cutattempt_[a-f0-9]{64}$/u);
  const [plan, attempt] = await db.getAll(
    db.doc(`semester_cutover_plans/${planId}`),
    db.doc(`semester_cutover_attempts/${attemptId}`),
  );
  if (runner.passed) {
    assert.equal(pointer.exists, true, "W11 target pointer is missing.");
    assert.equal(plan.data()?.sourceSemesterId, SOURCE_SEMESTER_ID);
    assert.equal(plan.data()?.targetSemesterId, TARGET_SEMESTER_ID);
    assert.equal(attempt.data()?.planId, planId);
  }
  const items = await db
    .collection(`semester_cutover_attempts/${attemptId}/items`)
    .get();
  if (runner.passed) assert.equal(items.size, 12);
  const createdAfter = toMillis(run.data()?.createdAt);
  assert.equal(Number.isFinite(createdAfter), true);
  const exactCommands = [
    ...new Map(
      runner.commands.map((command) => [
        `${command.commandType}\n${command.commandId}`,
        command,
      ]),
    ).values(),
  ];
  const receiptIds = exactCommands.map(
    (command) =>
      `cmd_${sha256(`${runner.adminUid}\n${command.commandType}\n${command.commandId}`)}`,
  );
  const [receipts, audits] = receiptIds.length
    ? await Promise.all([
        db.getAll(...receiptIds.map((id) => db.doc(`command_receipts/${id}`))),
        db.getAll(
          ...receiptIds.map((id) => db.doc(`command_audit_events/${id}`)),
        ),
      ])
    : [[], []];
  const businessPaths = [];
  const sourcePaths = [];
  const controlPathsSeen = [];
  const controlPrefixes = [
    "semester_cutover_plans/",
    "semester_cutover_attempts/",
    `semester_cutover_targets/${TARGET_SEMESTER_ID}`,
    "semester_cutover_evidence/",
  ];
  receipts.forEach((receipt, index) => {
    const expected = exactCommands[index];
    assert.equal(receipt.exists, true);
    assert.equal(receipt.data()?.status, "SUCCEEDED");
    assert.equal(receipt.data()?.actorUid, runner.adminUid);
    assert.equal(receipt.data()?.commandType, expected.commandType);
    assert.equal(receipt.data()?.commandId, expected.commandId);
    assert.ok(toMillis(receipt.data()?.createdAt) >= createdAfter);
    const refs = Array.isArray(receipt.data()?.target?.refs)
      ? receipt.data().target.refs
      : [];
    refs.forEach((path) => {
      if (controlPrefixes.some((prefix) => path.startsWith(prefix))) {
        controlPathsSeen.push(path);
        return;
      }
      assertBusinessPath(path);
      if (
        path === `semester_manifests/${SOURCE_SEMESTER_ID}` ||
        path === `semester_archive_manifests/${SOURCE_SEMESTER_ID}` ||
        fixturePaths.includes(path)
      ) {
        sourcePaths.push(path);
      } else {
        businessPaths.push(path);
      }
    });
  });
  audits.forEach((audit, index) => {
    const expected = exactCommands[index];
    assert.equal(audit.exists, true);
    assert.equal(audit.data()?.actorUid, runner.adminUid);
    assert.equal(audit.data()?.commandType, expected.commandType);
    assert.equal(audit.data()?.commandId, expected.commandId);
    assert.ok(toMillis(audit.data()?.createdAt) >= createdAfter);
  });
  if (runner.passed) {
    assert.equal(
      new Set(
        receipts
          .map((item) => item.data()?.commandType)
          .filter((type) => W11_COMMAND_TYPES.has(type)),
      ).size,
      W11_COMMAND_TYPES.size,
      "The six W11 Gateway command receipts are incomplete.",
    );
    assert.deepEqual(
      items.docs
        .map((item) => String(item.data()?.receiptId || ""))
        .filter(Boolean)
        .sort(),
      receipts
        .filter((receipt) =>
          [
            "createSemesterClass",
            "importEnrollmentRoster",
            "createLearningContent",
            "createScheduleEvent",
          ].includes(receipt.data()?.commandType),
        )
        .map((receipt) => receipt.id)
        .sort(),
    );
  }
  const currentBaseline = await baselineSnapshot();
  assert.equal(currentBaseline.hash, run.data()?.canonicalBaselineHash);
  const evidence = {
    fixtureOwner: FIXTURE_OWNER,
    testRunId,
    projectId,
    sourceSemesterId: SOURCE_SEMESTER_ID,
    targetSemesterId: TARGET_SEMESTER_ID,
    canonicalBaselineSemesterId: CANONICAL_BASELINE_SEMESTER_ID,
    canonicalBaselineHash: currentBaseline.hash,
    fixtureStartedAt: new Date(createdAfter).toISOString(),
    runnerPassed: runner.passed,
    planId,
    attemptId,
    evidenceId: String(pointer.data()?.latestEvidenceId || ""),
    planStatus: String(plan.data()?.status || ""),
    attemptStatus: String(attempt.data()?.status || ""),
    itemIds: items.docs.map((item) => item.id).sort(),
    receiptIds: [...new Set(receiptIds)].sort(),
    auditIds: [...new Set(receiptIds)].sort(),
    commandResults: exactCommands.map((command, index) => ({
      label: command.label,
      commandId: command.commandId,
      commandType: command.commandType,
      payloadHash: String(receipts[index].data()?.payloadHash || ""),
      receiptStatus: String(receipts[index].data()?.status || ""),
      targetKind: String(receipts[index].data()?.target?.kind || ""),
      targetRefs: Array.isArray(receipts[index].data()?.target?.refs)
        ? receipts[index].data().target.refs
        : [],
      replayObservations: runner.commands
        .filter(
          (observation) =>
            observation.commandType === command.commandType &&
            observation.commandId === command.commandId,
        )
        .map((observation) => observation.replayed === true),
    })),
    businessPaths: [...new Set(businessPaths)].sort(),
    sourcePaths: [...new Set(sourcePaths)].sort(),
    sessionPaths: runner.sessionPath ? [runner.sessionPath] : [],
    controlPaths: [
      ...new Set([
        ...controlPathsSeen,
        `semester_cutover_targets/${TARGET_SEMESTER_ID}`,
        `semester_cutover_plans/${planId}`,
        `semester_cutover_attempts/${attemptId}`,
        ...(pointer.data()?.latestEvidenceId
          ? [`semester_cutover_evidence/${pointer.data().latestEvidenceId}`]
          : []),
        ...(plan.data()?.rollbackPlanId
          ? [`semester_cutover_plans/${plan.data().rollbackPlanId}`]
          : []),
      ]),
    ].sort(),
    collectedAt: new Date().toISOString(),
    productionAccess: 0,
    productionWrites: 0,
  };
  console.log(JSON.stringify(evidence));
};

const verify = async () => {
  const evidence = readCommandEvidence();
  const run = await db.doc(runPath).get();
  ensureExactOwner(run, "W11 run marker");
  assert.equal(evidence.runnerPassed, true);
  assert.equal(evidence.planStatus, "ROLLBACK_PLANNED");
  assert.equal(evidence.attemptStatus, "ROLLBACK_PLANNED");
  assert.equal(evidence.itemIds.length, 12);
  const currentBaseline = await baselineSnapshot();
  assert.equal(currentBaseline.hash, run.data()?.canonicalBaselineHash);
  assert.equal(currentBaseline.hash, evidence.canonicalBaselineHash);
  for (const path of evidence.businessPaths) {
    assertBusinessPath(path);
    const snapshot = await db.doc(path).get();
    assert.equal(snapshot.exists, true);
    assert.equal(snapshot.data()?.semesterId, TARGET_SEMESTER_ID);
  }
  for (const path of evidence.sourcePaths) {
    assertBusinessPath(path);
    const snapshot = await db.doc(path).get();
    assert.equal(snapshot.exists, true);
  }
  const sourceManifest = await db
    .doc(`semester_manifests/${SOURCE_SEMESTER_ID}`)
    .get();
  const sourceArchive = await db
    .doc(`semester_archive_manifests/${SOURCE_SEMESTER_ID}`)
    .get();
  assert.equal(sourceManifest.data()?.status, "ARCHIVED");
  assert.equal(sourceArchive.data()?.archiveStatus, "FROZEN");
  assert.equal(evidence.sessionPaths.length, 1);
  const runnerSession = await db.doc(evidence.sessionPaths[0]).get();
  assert.equal(runnerSession.exists, true);
  assert.equal(runnerSession.data()?.status, "closed");
  console.log(
    JSON.stringify({
      suite: "w11-staging-fixture-verify",
      passed: true,
      fixtureOwner: FIXTURE_OWNER,
      testRunId,
      plans: 1,
      attempts: 1,
      items: evidence.itemIds.length,
      canonicalBaselineUnchanged: true,
      productionAccess: 0,
      productionWrites: 0,
    }),
  );
};

const cleanup = async () => {
  const evidence = readCommandEvidence();
  const run = await db.doc(runPath).get();
  ensureExactOwner(run, "W11 run marker");
  const deletable = new Set([
    ...evidence.businessPaths,
    ...evidence.sourcePaths,
    ...evidence.sessionPaths,
    ...evidence.controlPaths,
    ...evidence.itemIds.map(
      (id) => `semester_cutover_attempts/${evidence.attemptId}/items/${id}`,
    ),
    ...evidence.receiptIds.map((id) => `command_receipts/${id}`),
    ...evidence.auditIds.map((id) => `command_audit_events/${id}`),
    ...fixturePaths,
  ]);
  for (const path of evidence.businessPaths) assertBusinessPath(path);
  for (const path of evidence.sourcePaths) assertBusinessPath(path);
  const fixtureSessions = [];
  for (const uid of [teacherUid, studentUid]) {
    const sessions = await db
      .collection(`application_sessions/${uid}/sessions`)
      .get();
    fixtureSessions.push(...sessions.docs.map((item) => item.ref.path));
  }
  fixtureSessions.forEach((path) => deletable.add(path));
  const documents = await db.getAll(
    ...[...deletable].map((path) => db.doc(path)),
  );
  for (let index = 0; index < documents.length; index += 400) {
    const batch = db.batch();
    documents
      .slice(index, index + 400)
      .filter((item) => item.exists)
      .forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  await Promise.all(
    [teacherUid, studentUid].map((uid) =>
      auth.deleteUser(uid).catch((error) => {
        if (error?.code !== "auth/user-not-found") throw error;
      }),
    ),
  );
  const residualDocuments = await db.getAll(
    ...[...deletable].map((path) => db.doc(path)),
  );
  assert.equal(
    residualDocuments.some((item) => item.exists),
    false,
  );
  for (const collectionName of canonicalCollections) {
    const residual = await db
      .collection(collectionName)
      .where("semesterId", "==", TARGET_SEMESTER_ID)
      .limit(2)
      .get();
    assert.equal(
      residual.empty,
      true,
      `Residual W11 target scope remains: ${collectionName}.`,
    );
  }
  for (const collectionName of [
    "semester_cutover_plans",
    "semester_cutover_attempts",
    "semester_cutover_evidence",
  ]) {
    const residual = await db
      .collection(collectionName)
      .where("targetSemesterId", "==", TARGET_SEMESTER_ID)
      .limit(2)
      .get();
    assert.equal(
      residual.empty,
      true,
      `Residual W11 control scope remains: ${collectionName}.`,
    );
  }
  const residualAttemptItems = await db
    .collection(`semester_cutover_attempts/${reservedAttemptId}/items`)
    .limit(2)
    .get();
  assert.equal(residualAttemptItems.empty, true);
  for (const uid of [teacherUid, studentUid]) {
    await assert.rejects(
      auth.getUser(uid),
      (error) => error?.code === "auth/user-not-found",
    );
  }
  const currentBaseline = await baselineSnapshot();
  assert.equal(currentBaseline.hash, evidence.canonicalBaselineHash);
  console.log(
    JSON.stringify({
      suite: "w11-staging-fixture-cleanup",
      passed: true,
      fixtureOwner: FIXTURE_OWNER,
      testRunId,
      projectId,
      residualAuthUsers: 0,
      residualFixtureDocuments: 0,
      residualBusinessDocuments: 0,
      residualPlans: 0,
      residualAttempts: 0,
      residualAttemptItems: 0,
      residualEvidenceDocuments: 0,
      residualReceipts: 0,
      residualAudits: 0,
      residualSessions: 0,
      residualTokens: 0,
      residualStorageObjects: 0,
      canonicalBaselineUnchanged: true,
      canonicalBaselineHash: currentBaseline.hash,
      completedAt: new Date().toISOString(),
      productionAccess: 0,
      productionWrites: 0,
    }),
  );
};

try {
  if (mode === "setup") await setup();
  if (mode === "collect-evidence") await collectEvidence();
  if (mode === "verify") await verify();
  if (mode === "cleanup") await cleanup();
} finally {
  await deleteApp(app);
}
