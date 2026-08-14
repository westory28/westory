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
const ADMIN_EMAIL = "westoria28@gmail.com";
const STORAGE_BUCKET = `${STAGING_PROJECT_ID}.firebasestorage.app`;
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
if (["collect-evidence", "verify"].includes(mode)) {
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
if (mode === "verify") {
  assert.ok(commandEvidencePath, "--command-evidence is required.");
}
if (mode === "cleanup") {
  for (const path of [commandEvidencePath, runnerEvidencePath].filter(
    Boolean,
  )) {
    assert.equal(existsSync(resolve(path)), true);
  }
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
const { getStorage } = requireFromFunctions("firebase-admin/storage");
const cutover = requireFromFunctions("./semesterCutover.js");
const semesterCore = requireFromFunctions("./semesterCore.js");
const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const suffix = sha256(testRunId).slice(0, 20);
const storagePrefix = `w11-staging-fixtures/${testRunId}/`;
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
  {
    credential: applicationDefault(),
    projectId,
    storageBucket: STORAGE_BUCKET,
  },
  `w11-fixture-${suffix.slice(0, 12)}`,
);
const auth = getAuth(app);
const db = getFirestore(app);
const bucket = getStorage(app).bucket(STORAGE_BUCKET);

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
  ...cutover.ACTIVITY_COLLECTIONS,
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
const W11_COMMAND_SPECS = [
  ["bootstrap-target-manifest", "createSemesterManifest"],
  ["bootstrap-target-preparing", "transitionSemesterStatus"],
  ["source-archive-write-deny", "createSemesterClass"],
  ["parent-plan", "createSemesterCutoverPlan"],
  ["parent-dry", "dryRunSemesterCutover"],
  ["child-class", "createSemesterClass"],
  ["child-roster", "importEnrollmentRoster"],
  ["child-learning", "createLearningContent"],
  ["parent-apply-partial", "applySemesterCutoverBatch"],
  ["parent-resume", "resumeSemesterCutover"],
  ["child-schedule", "createScheduleEvent"],
  ["parent-apply-complete", "applySemesterCutoverBatch"],
  ["parent-verify", "verifySemesterCutover"],
  ["readiness-validate", "validateSemesterReadiness"],
  ["readiness-ready", "transitionSemesterStatus"],
  ["parent-rollback", "createSemesterRollbackPlan"],
].map(([label, commandType]) => ({
  label,
  commandType,
  commandId: (() => {
    const hash = sha256(`${testRunId}\n${label}`);
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  })(),
}));
const commandSpecByLabel = new Map(
  W11_COMMAND_SPECS.map((command) => [command.label, command]),
);
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
    "site_settings/student_maintenance",
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
const maintenanceSnapshot = async () => {
  const snapshot = await db.doc("site_settings/student_maintenance").get();
  const row = snapshot.exists
    ? { path: snapshot.ref.path, data: canonicalize(snapshot.data()) }
    : { path: snapshot.ref.path, exists: false };
  return {
    exists: snapshot.exists,
    hash: sha256(JSON.stringify(row)),
  };
};
const listStorageObjects = async () => {
  const [files] = await bucket.getFiles({ prefix: storagePrefix });
  return files.sort((left, right) => left.name.localeCompare(right.name));
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
  assert.equal(Array.isArray(evidence.controlPaths), true);
  assert.equal(Array.isArray(evidence.itemIds), true);
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
  if (evidence.passed) assert.ok(evidence.commands.length > 0);
  for (const command of evidence.commands) {
    const expected = commandSpecByLabel.get(String(command.label || ""));
    assert.ok(expected, `Unexpected W11 runner command: ${command.label}.`);
    assert.equal(command.commandId, expected.commandId);
    assert.equal(command.commandType, expected.commandType);
  }
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
const controlPrefixes = [
  "semester_cutover_plans/",
  "semester_cutover_attempts/",
  `semester_cutover_targets/${TARGET_SEMESTER_ID}`,
  "semester_cutover_evidence/",
];
const isControlPath = (path) =>
  controlPrefixes.some((prefix) => String(path).startsWith(prefix));
const assertDocumentPath = (path) => {
  assert.equal(typeof path, "string");
  const segments = path.split("/");
  assert.equal(
    segments.length % 2,
    0,
    `A document path was required: ${path}.`,
  );
  assert.equal(
    segments.every((segment) => segment.length > 0),
    true,
    `Empty document path segment: ${path}.`,
  );
};
const resolveAdminActorUid = async (...evidenceDocuments) => {
  const actor = await auth.getUserByEmail(ADMIN_EMAIL);
  for (const evidence of evidenceDocuments.filter(Boolean)) {
    if (evidence.adminUid) assert.equal(evidence.adminUid, actor.uid);
    if (evidence.actorUid) assert.equal(evidence.actorUid, actor.uid);
  }
  return actor.uid;
};
const loadOwnedCommandArtifacts = async ({ actorUid, createdAfter }) => {
  const candidates = W11_COMMAND_SPECS.map((command) => ({
    ...command,
    receiptId: `cmd_${sha256(`${actorUid}\n${command.commandType}\n${command.commandId}`)}`,
  }));
  const [receiptRows, auditRows] = await Promise.all([
    db.getAll(
      ...candidates.map((command) =>
        db.doc(`command_receipts/${command.receiptId}`),
      ),
    ),
    db.getAll(
      ...candidates.map((command) =>
        db.doc(`command_audit_events/${command.receiptId}`),
      ),
    ),
  ]);
  const live = [];
  candidates.forEach((command, index) => {
    const receipt = receiptRows[index];
    const audit = auditRows[index];
    assert.equal(
      audit.exists && !receipt.exists,
      false,
      `An audit exists without its W11 receipt: ${command.receiptId}.`,
    );
    if (!receipt.exists) return;
    assert.equal(receipt.data()?.status, "SUCCEEDED");
    assert.equal(receipt.data()?.actorUid, actorUid);
    assert.equal(receipt.data()?.actorEmail, ADMIN_EMAIL);
    assert.equal(receipt.data()?.commandType, command.commandType);
    assert.equal(receipt.data()?.commandId, command.commandId);
    assert.ok(toMillis(receipt.data()?.createdAt) >= createdAfter);
    assert.equal(audit.exists, true);
    assert.equal(audit.data()?.actorUid, actorUid);
    assert.equal(audit.data()?.actorEmail, ADMIN_EMAIL);
    assert.equal(audit.data()?.commandType, command.commandType);
    assert.equal(audit.data()?.commandId, command.commandId);
    assert.equal(audit.data()?.receiptRef, receipt.ref.path);
    assert.ok(toMillis(audit.data()?.createdAt) >= createdAfter);
    const refs = Array.isArray(receipt.data()?.target?.refs)
      ? receipt.data().target.refs
      : [];
    refs.forEach(assertDocumentPath);
    const authTime = Number(receipt.data()?.session?.authTime || 0);
    assert.equal(Number.isSafeInteger(authTime) && authTime > 0, true);
    live.push({ ...command, receipt, audit, refs, authTime });
  });
  return { candidates, live };
};
const validateOwnedDocument = ({
  snapshot,
  actorUid,
  createdAfter,
  fixturePathSet,
  sessionPathSet,
  targetOwners,
  receiptPathSet,
  auditPathSet,
  artifactOwners,
}) => {
  if (!snapshot.exists) return;
  const path = snapshot.ref.path;
  const data = snapshot.data() || {};
  if (fixturePathSet.has(path)) {
    ensureExactOwner(snapshot, path);
    return;
  }
  if (sessionPathSet.has(path)) {
    const match = path.match(
      /^application_sessions\/([^/]+)\/sessions\/([1-9][0-9]*)$/u,
    );
    assert.ok(match);
    assert.equal(data.uid, match[1]);
    assert.equal(Number(data.authTime), Number(match[2]));
    assert.ok(toMillis(data.createdAt) >= createdAfter);
    return;
  }
  if (receiptPathSet.has(path) || auditPathSet.has(path)) {
    const owner = artifactOwners.get(path);
    assert.ok(owner, `No deterministic command owner exists for ${path}.`);
    assert.equal(data.actorUid, actorUid);
    assert.equal(data.actorEmail, ADMIN_EMAIL);
    assert.equal(data.commandId, owner.commandId);
    assert.equal(data.commandType, owner.commandType);
    if (receiptPathSet.has(path)) assert.equal(data.status, "SUCCEEDED");
    if (auditPathSet.has(path)) {
      assert.equal(data.receiptRef, owner.receipt.ref.path);
    }
    assert.ok(toMillis(data.createdAt) >= createdAfter);
    return;
  }
  const owners = targetOwners.get(path) || [];
  assert.ok(owners.length > 0, `No live W11 command owns ${path}.`);
  if (data.semesterId) {
    assert.equal(
      [SOURCE_SEMESTER_ID, TARGET_SEMESTER_ID].includes(data.semesterId),
      true,
    );
  }
  const ownerCommandIds = new Set(owners.map((owner) => owner.commandId));
  const ownerReceiptIds = new Set(owners.map((owner) => owner.receiptId));
  if (data.commandId) assert.equal(ownerCommandIds.has(data.commandId), true);
  if (data.receiptId) assert.equal(ownerReceiptIds.has(data.receiptId), true);
  for (const field of [
    "createdBy",
    "updatedBy",
    "approvedBy",
    "appliedBy",
    "verifiedBy",
  ]) {
    if (data[field]) assert.equal(data[field], actorUid, `${path}.${field}`);
  }
};

const setup = async () => {
  assert.deepEqual(
    (await listStorageObjects()).map((file) => file.name),
    [],
    "Reserved W11 Storage prefix is not empty.",
  );
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
  const maintenanceBaseline = await maintenanceSnapshot();
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
      maintenanceBaselineExists: maintenanceBaseline.exists,
      maintenanceBaselineHash: maintenanceBaseline.hash,
      storageBucket: STORAGE_BUCKET,
      storagePrefix,
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
        maintenanceBaselineExists: maintenanceBaseline.exists,
        maintenanceBaselineHash: maintenanceBaseline.hash,
        maintenanceMutationCount: 0,
        maintenanceMeasurementBasis:
          "EXACT_SITE_SETTINGS_STUDENT_MAINTENANCE_SNAPSHOT_HASH",
        storageBucket: STORAGE_BUCKET,
        storagePrefix,
        storageObjectsBeforeSetup: 0,
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
      .forEach((item) => {
        ensureExactOwner(item, item.ref.path);
        batch.delete(item.ref);
      });
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
  const createdAfter = toMillis(run.data()?.createdAt);
  assert.equal(Number.isFinite(createdAfter), true);
  const actorUid = await resolveAdminActorUid(runner);
  if (runner.planId) assert.equal(runner.planId, reservedPlanId);
  if (runner.attemptId) assert.equal(runner.attemptId, reservedAttemptId);
  const pointer = await db
    .doc(`semester_cutover_targets/${TARGET_SEMESTER_ID}`)
    .get();
  const planId = reservedPlanId;
  const attemptId = reservedAttemptId;
  const [plan, attempt] = await db.getAll(
    db.doc(`semester_cutover_plans/${planId}`),
    db.doc(`semester_cutover_attempts/${attemptId}`),
  );
  if (runner.passed) {
    assert.equal(pointer.exists, true, "W11 target pointer is missing.");
    assert.equal(pointer.data()?.latestPlanId, planId);
    assert.equal(pointer.data()?.latestAttemptId, attemptId);
    assert.equal(plan.data()?.sourceSemesterId, SOURCE_SEMESTER_ID);
    assert.equal(plan.data()?.targetSemesterId, TARGET_SEMESTER_ID);
    assert.equal(attempt.data()?.planId, planId);
  }
  const items = await db
    .collection(`semester_cutover_attempts/${attemptId}/items`)
    .get();
  if (runner.passed) assert.equal(items.size, 12);
  const { candidates, live } = await loadOwnedCommandArtifacts({
    actorUid,
    createdAfter,
  });
  const receiptIds = live.map((command) => command.receiptId);
  const businessPaths = [];
  const sourcePaths = [];
  const controlPathsSeen = [];
  live.forEach((command) => {
    command.refs.forEach((path) => {
      if (isControlPath(path)) {
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
  if (runner.passed) {
    assert.deepEqual(
      live.map((command) => command.label).sort(),
      candidates
        .filter((command) => command.label !== "source-archive-write-deny")
        .map((command) => command.label)
        .sort(),
      "The complete deterministic W11 receipt set is missing.",
    );
    assert.equal(
      new Set(
        live
          .map((item) => item.commandType)
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
      live
        .filter((command) =>
          [
            "createSemesterClass",
            "importEnrollmentRoster",
            "createLearningContent",
            "createScheduleEvent",
          ].includes(command.commandType),
        )
        .filter((command) => command.label.startsWith("child-"))
        .map((command) => command.receiptId)
        .sort(),
    );
  }
  const currentBaseline = await baselineSnapshot();
  assert.equal(currentBaseline.hash, run.data()?.canonicalBaselineHash);
  const currentMaintenance = await maintenanceSnapshot();
  const maintenanceMutationCount = Number(
    currentMaintenance.hash !== run.data()?.maintenanceBaselineHash,
  );
  assert.equal(
    maintenanceMutationCount,
    0,
    "site_settings/student_maintenance changed during the W11 rehearsal.",
  );
  const sessionPaths = [
    ...new Set([
      ...live.map(
        (command) =>
          `application_sessions/${actorUid}/sessions/${command.authTime}`,
      ),
      ...(runner.sessionPath ? [runner.sessionPath] : []),
    ]),
  ].sort();
  sessionPaths.forEach((path) => {
    assert.match(
      path,
      new RegExp(
        `^application_sessions/${actorUid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/sessions/[1-9][0-9]*$`,
        "u",
      ),
    );
  });
  const currentStorageObjects = await listStorageObjects();
  assert.equal(
    currentStorageObjects.length,
    0,
    "The W11 Storage prefix changed during a no-Storage rehearsal.",
  );
  const evidence = {
    fixtureOwner: FIXTURE_OWNER,
    testRunId,
    projectId,
    sourceSemesterId: SOURCE_SEMESTER_ID,
    targetSemesterId: TARGET_SEMESTER_ID,
    canonicalBaselineSemesterId: CANONICAL_BASELINE_SEMESTER_ID,
    canonicalBaselineHash: currentBaseline.hash,
    maintenanceSnapshotHashBefore: run.data()?.maintenanceBaselineHash,
    maintenanceSnapshotHashAfter: currentMaintenance.hash,
    maintenanceMutationCount,
    maintenanceMeasurementBasis:
      "EXACT_SITE_SETTINGS_STUDENT_MAINTENANCE_SNAPSHOT_HASH",
    fixtureStartedAt: new Date(createdAfter).toISOString(),
    runnerPassed: runner.passed,
    actorUid,
    planId,
    attemptId,
    evidenceId: String(pointer.data()?.latestEvidenceId || ""),
    planStatus: String(plan.data()?.status || ""),
    attemptStatus: String(attempt.data()?.status || ""),
    itemIds: items.docs.map((item) => item.id).sort(),
    receiptIds: [...new Set(receiptIds)].sort(),
    auditIds: [...new Set(receiptIds)].sort(),
    commandResults: live.map((command) => ({
      label: command.label,
      commandId: command.commandId,
      commandType: command.commandType,
      payloadHash: String(command.receipt.data()?.payloadHash || ""),
      receiptStatus: String(command.receipt.data()?.status || ""),
      targetKind: String(command.receipt.data()?.target?.kind || ""),
      targetRefs: command.refs,
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
    sessionPaths,
    controlPaths: [...new Set(controlPathsSeen)].sort(),
    storageBucket: STORAGE_BUCKET,
    storagePrefix,
    storageObjectCount: currentStorageObjects.length,
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
  const currentMaintenance = await maintenanceSnapshot();
  assert.equal(currentMaintenance.hash, run.data()?.maintenanceBaselineHash);
  assert.equal(currentMaintenance.hash, evidence.maintenanceSnapshotHashBefore);
  assert.equal(evidence.maintenanceMutationCount, 0);
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
      maintenanceMutationCount: 0,
      maintenanceMeasurementBasis:
        "EXACT_SITE_SETTINGS_STUDENT_MAINTENANCE_SNAPSHOT_HASH",
      productionAccess: 0,
      productionWrites: 0,
    }),
  );
};

const cleanup = async () => {
  const evidence = commandEvidencePath ? readCommandEvidence() : null;
  const runner = runnerEvidencePath ? readRunnerEvidence() : null;
  const run = await db.doc(runPath).get();
  ensureExactOwner(run, "W11 run marker");
  const runData = run.data() || {};
  const createdAfter = toMillis(runData.createdAt);
  assert.equal(Number.isFinite(createdAfter), true);
  const actorUid = await resolveAdminActorUid(evidence, runner);
  if (evidence?.planId) assert.equal(evidence.planId, reservedPlanId);
  if (evidence?.attemptId) assert.equal(evidence.attemptId, reservedAttemptId);
  if (runner?.planId) assert.equal(runner.planId, reservedPlanId);
  if (runner?.attemptId) assert.equal(runner.attemptId, reservedAttemptId);
  const { candidates, live } = await loadOwnedCommandArtifacts({
    actorUid,
    createdAfter,
  });
  const targetOwners = new Map();
  for (const command of live) {
    for (const path of command.refs) {
      if (!isControlPath(path)) assertBusinessPath(path);
      const owners = targetOwners.get(path) || [];
      owners.push(command);
      targetOwners.set(path, owners);
    }
  }
  const liveReceiptIds = new Set(live.map((command) => command.receiptId));
  const receiptPathSet = new Set(
    [...liveReceiptIds].map((id) => `command_receipts/${id}`),
  );
  const auditPathSet = new Set(
    [...liveReceiptIds].map((id) => `command_audit_events/${id}`),
  );
  const artifactOwners = new Map(
    live.flatMap((command) => [
      [command.receipt.ref.path, command],
      [command.audit.ref.path, command],
    ]),
  );
  const sessionPathSet = new Set(
    live.map(
      (command) =>
        `application_sessions/${actorUid}/sessions/${command.authTime}`,
    ),
  );
  for (const path of runner?.sessionPath ? [runner.sessionPath] : []) {
    assert.match(
      path,
      new RegExp(
        `^application_sessions/${actorUid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/sessions/[1-9][0-9]*$`,
        "u",
      ),
    );
    sessionPathSet.add(path);
  }
  for (const uid of [teacherUid, studentUid]) {
    const sessions = await db
      .collection(`application_sessions/${uid}/sessions`)
      .get();
    sessions.docs.forEach((item) => {
      assert.equal(item.data()?.uid, uid);
      assert.equal(Number(item.data()?.authTime), Number(item.id));
      assert.ok(toMillis(item.data()?.createdAt) >= createdAfter);
      sessionPathSet.add(item.ref.path);
    });
  }
  const targetScopedPaths = new Set(targetOwners.keys());
  const exactTargetDocuments = await db.getAll(
    ...[
      `semester_manifests/${TARGET_SEMESTER_ID}`,
      ...reservedTargetSeedPaths,
      ...reservedControlPaths,
    ].map((path) => db.doc(path)),
  );
  exactTargetDocuments
    .filter((item) => item.exists)
    .forEach((item) => {
      assert.equal(
        targetOwners.has(item.ref.path),
        true,
        `Reserved target document has no deterministic W11 receipt owner: ${item.ref.path}.`,
      );
      targetScopedPaths.add(item.ref.path);
    });
  for (const collectionName of canonicalCollections) {
    const snapshot = await db
      .collection(collectionName)
      .where("semesterId", "==", TARGET_SEMESTER_ID)
      .get();
    snapshot.docs.forEach((item) => {
      assert.equal(
        targetOwners.has(item.ref.path),
        true,
        `Target document has no deterministic W11 receipt owner: ${item.ref.path}.`,
      );
      targetScopedPaths.add(item.ref.path);
    });
  }
  for (const collectionName of [
    "semester_cutover_plans",
    "semester_cutover_attempts",
    "semester_cutover_evidence",
  ]) {
    const snapshot = await db
      .collection(collectionName)
      .where("targetSemesterId", "==", TARGET_SEMESTER_ID)
      .get();
    snapshot.docs.forEach((item) => {
      assert.equal(
        targetOwners.has(item.ref.path),
        true,
        `Control document has no deterministic W11 receipt owner: ${item.ref.path}.`,
      );
      targetScopedPaths.add(item.ref.path);
    });
  }
  const attemptItems = await db
    .collection(`semester_cutover_attempts/${reservedAttemptId}/items`)
    .get();
  attemptItems.docs.forEach((item) => {
    assert.equal(item.data()?.attemptId, reservedAttemptId);
    assert.equal(item.data()?.planId, reservedPlanId);
    assert.equal(
      targetOwners.has(item.ref.path),
      true,
      `Attempt item has no deterministic W11 receipt owner: ${item.ref.path}.`,
    );
    targetScopedPaths.add(item.ref.path);
  });
  const deletable = new Set([
    ...targetScopedPaths,
    ...sessionPathSet,
    ...receiptPathSet,
    ...auditPathSet,
    ...fixturePaths,
  ]);
  if (evidence) {
    const claimedPaths = [
      ...evidence.businessPaths,
      ...evidence.sourcePaths,
      ...evidence.sessionPaths,
      ...evidence.controlPaths,
      ...evidence.itemIds.map(
        (id) => `semester_cutover_attempts/${reservedAttemptId}/items/${id}`,
      ),
      ...evidence.receiptIds.map((id) => `command_receipts/${id}`),
      ...evidence.auditIds.map((id) => `command_audit_events/${id}`),
    ];
    claimedPaths.forEach((path) => {
      assertDocumentPath(path);
      assert.equal(
        deletable.has(path),
        true,
        `External evidence path has no live W11 ownership proof: ${path}.`,
      );
    });
  }
  const fixturePathSet = new Set(fixturePaths);
  const storageObjects = await listStorageObjects();
  for (const file of storageObjects) {
    assert.equal(file.name.startsWith(storagePrefix), true);
    const [metadata] = await file.getMetadata();
    const custom = metadata.metadata || {};
    assert.equal(custom.fixtureOwner, FIXTURE_OWNER);
    assert.equal(custom.testRunId, testRunId);
    assert.equal(custom.actorUid, actorUid);
    assert.equal(
      candidates.some(
        (command) =>
          command.commandId === custom.commandId &&
          command.commandType === custom.commandType,
      ),
      true,
      `Storage object has no deterministic W11 command owner: ${file.name}.`,
    );
  }
  const ownedAuthUsers = [];
  const authUserMarkers = await db.getAll(
    db.doc(`users/${teacherUid}`),
    db.doc(`users/${studentUid}`),
  );
  for (const uid of [teacherUid, studentUid]) {
    const user = await auth.getUser(uid).catch((error) => {
      if (error?.code === "auth/user-not-found") return null;
      throw error;
    });
    if (user) {
      const marker = authUserMarkers.find((item) => item.id === uid);
      ensureExactOwner(marker, `Auth deletion marker for ${uid}`);
      assert.equal(
        user.email,
        uid === teacherUid ? teacherEmail : studentEmail,
      );
      ownedAuthUsers.push(user);
    }
  }
  for (const file of storageObjects) {
    await file.delete({ ignoreNotFound: true });
  }
  await Promise.all(ownedAuthUsers.map((user) => auth.deleteUser(user.uid)));
  const deleteOrder = [
    ...[...deletable].filter(
      (path) =>
        !receiptPathSet.has(path) &&
        !auditPathSet.has(path) &&
        path !== runPath,
    ),
    ...receiptPathSet,
    ...auditPathSet,
    runPath,
  ];
  for (let index = 0; index < deleteOrder.length; index += 200) {
    const paths = deleteOrder.slice(index, index + 200);
    await db.runTransaction(async (transaction) => {
      const documents = await transaction.getAll(
        ...paths.map((path) => db.doc(path)),
      );
      documents.forEach((snapshot) =>
        validateOwnedDocument({
          snapshot,
          actorUid,
          createdAfter,
          fixturePathSet,
          sessionPathSet,
          targetOwners,
          receiptPathSet,
          auditPathSet,
          artifactOwners,
        }),
      );
      documents
        .filter((snapshot) => snapshot.exists)
        .forEach((snapshot) => transaction.delete(snapshot.ref));
    });
  }
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
  assert.equal(currentBaseline.hash, runData.canonicalBaselineHash);
  if (evidence)
    assert.equal(currentBaseline.hash, evidence.canonicalBaselineHash);
  const currentMaintenance = await maintenanceSnapshot();
  assert.equal(currentMaintenance.hash, runData.maintenanceBaselineHash);
  if (evidence?.maintenanceSnapshotHashBefore) {
    assert.equal(
      currentMaintenance.hash,
      evidence.maintenanceSnapshotHashBefore,
    );
  }
  const residualStorageObjects = await listStorageObjects();
  assert.equal(residualStorageObjects.length, 0);
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
      residualTokenValueRecords: 0,
      residualTokensBasis:
        "PERSISTED_TOKEN_VALUES_ONLY; RUNNER_TOKEN_VALUES_ARE_DISCARDED_IN_MEMORY",
      validTokenRevocationMeasured: false,
      validTokenRevocationStatus:
        "NOT_MEASURED; ADMIN_ID_AND_APP_CHECK_TOKENS_ARE_EPHEMERAL_AND_NOT_RETAINED",
      residualStorageObjects: residualStorageObjects.length,
      storageBucket: STORAGE_BUCKET,
      storagePrefix,
      storageObjectsInspected: storageObjects.length,
      storageObjectsDeleted: storageObjects.length,
      canonicalBaselineUnchanged: true,
      canonicalBaselineHash: currentBaseline.hash,
      maintenanceSnapshotHashBefore: runData.maintenanceBaselineHash,
      maintenanceSnapshotHashAfter: currentMaintenance.hash,
      maintenanceMutationCount: 0,
      maintenanceMeasurementBasis:
        "EXACT_SITE_SETTINGS_STUDENT_MAINTENANCE_SNAPSHOT_HASH",
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
