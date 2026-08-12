import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const FIXTURE_OWNER = "w8-domain-staging-browser";
const SEMESTER_ID = "2026-2";
const args = process.argv.slice(2);
const valueArg = (name) =>
  String(
    args
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1) || "",
  ).trim();
const projectId = valueArg("--project");
const testRunId = valueArg("--test-run-id");
const browserEvidencePath = valueArg("--browser-evidence");
const modes = ["dry-run", "setup", "collect-evidence", "verify", "cleanup"];
const mode = modes.find((name) => args.includes(`--${name}`));

assert.notEqual(projectId, PRODUCTION_PROJECT_ID, "Production access is forbidden.");
assert.equal(
  projectId,
  STAGING_PROJECT_ID,
  `Exact --project=${STAGING_PROJECT_ID} is required.`,
);
assert.equal(
  modes.filter((name) => args.includes(`--${name}`)).length,
  1,
  "Choose exactly one W8 fixture mode.",
);
assert.match(
  testRunId,
  /^w8-[a-z0-9][a-z0-9-]{7,63}$/u,
  "A scoped W8 testRunId is required.",
);
if (["verify", "cleanup"].includes(mode)) {
  assert.ok(browserEvidencePath, "--browser-evidence is required.");
  assert.ok(existsSync(resolve(browserEvidencePath)), "Browser evidence is missing.");
}
const password = String(process.env.WESTORY_W8_STAGING_PASSWORD || "");
if (mode === "setup") {
  assert.match(
    password,
    /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16,}$/u,
  );
}

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const { applicationDefault, deleteApp, initializeApp } =
  requireFromFunctions("firebase-admin/app");
const { getAuth } = requireFromFunctions("firebase-admin/auth");
const { FieldValue, getFirestore } = requireFromFunctions(
  "firebase-admin/firestore",
);
const app = initializeApp(
  { credential: applicationDefault(), projectId },
  `w8-fixture-${createHash("sha256").update(testRunId).digest("hex").slice(0, 12)}`,
);
const auth = getAuth(app);
const db = getFirestore(app);
const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const suffix = sha256(testRunId).slice(0, 20);
const studentUid = `w8-student-${suffix}`;
const teacherUid = `w8-teacher-${suffix}`;
const studentEmail = `w8.student.${suffix}@yongshin-ms.ms.kr`;
const teacherEmail = `w8.teacher.${suffix}@yongshin-ms.ms.kr`;
const classId = `class-w8-${suffix}`;
const enrollmentId = `enr-w8-${suffix}`;
const slotId = `slot_${sha256(`${SEMESTER_ID}\n${studentUid}`).slice(0, 40)}`;
const runPath = `w8_verification_runs/${testRunId}`;
const fixturePaths = [
  runPath,
  `users/${studentUid}`,
  `users/${teacherUid}`,
  `semester_classes/${classId}`,
  `semester_enrollments/${enrollmentId}`,
  `semester_enrollment_slots/${slotId}`,
];
const canonicalCollections = new Set([
  "semester_learning_contents",
  "semester_learning_progress",
  "semester_learning_exemptions",
  "semester_learning_exemption_requests",
  "semester_schedule_events",
  "semester_attendance_sessions",
  "semester_attendance_records",
  "semester_attendance_revisions",
  "semester_notices",
  "semester_notice_deliveries",
  "semester_notice_acknowledgements",
  "w8_legacy_issues",
]);
const W8_ALL_COMMAND_TYPES = new Set([
  "createLearningContent",
  "updateLearningContent",
  "transitionLearningContent",
  "recordLearningProgress",
  "requestLearningExemption",
  "resetLearningProgress",
  "grantLearningExemptions",
  "revokeLearningExemptions",
  "reviewLearningExemptionRequest",
  "createScheduleEvent",
  "updateScheduleEvent",
  "deleteScheduleEvent",
  "createAttendanceSession",
  "recordAttendance",
  "recordAttendanceBulk",
  "correctAttendanceRecord",
  "closeAttendanceSession",
  "createNotice",
  "updateNotice",
  "transitionNotice",
  "acknowledgeNotice",
  "acknowledgeAllNotices",
  "updateNotificationSettings",
]);
const W8_STAGING_COMMAND_TYPES = new Set(
  [...W8_ALL_COMMAND_TYPES].filter(
    (commandType) => commandType !== "updateNotificationSettings",
  ),
);
const W8_STAGING_REQUIRED_COMMAND_TYPES = new Set([
  "createLearningContent",
  "transitionLearningContent",
  "recordLearningProgress",
  "requestLearningExemption",
]);

const assertStagingCommandSet = (commands) => {
  const observed = new Set(commands);
  assert.ok(observed.size > 0, "No W8 browser command evidence was collected.");
  for (const commandType of observed) {
    assert.ok(
      W8_STAGING_COMMAND_TYPES.has(commandType),
      `Unexpected W8 staging command: ${commandType}`,
    );
  }
  for (const commandType of W8_STAGING_REQUIRED_COMMAND_TYPES) {
    assert.ok(observed.has(commandType), `Missing required browser command: ${commandType}`);
  }
  return observed;
};

const loadEvidence = () => {
  const evidence = JSON.parse(readFileSync(resolve(browserEvidencePath), "utf8"));
  assert.equal(evidence.fixtureOwner, FIXTURE_OWNER);
  assert.equal(evidence.testRunId, testRunId);
  assert.equal(evidence.projectId, STAGING_PROJECT_ID);
  assert.ok(Array.isArray(evidence.commands));
  assert.ok(Array.isArray(evidence.canonicalPaths));
  assertStagingCommandSet(evidence.commands);
  for (const path of evidence.canonicalPaths) {
    const [collectionName, documentId, ...rest] = String(path).split("/");
    assert.equal(rest.length, 0, `Nested or malformed W8 path: ${path}`);
    assert.ok(canonicalCollections.has(collectionName), `Foreign collection: ${path}`);
    assert.ok(documentId, `Missing document ID: ${path}`);
  }
  assert.equal(evidence.queryWriteCount, 0);
  assert.equal(evidence.archiveMutationCount, 0);
  assert.equal(evidence.legacySilentFallbackCount, 0);
  assert.equal(evidence.notificationSettingsMutationCount, 0);
  return evidence;
};

const requiredScopes = async () => {
  const [manifest, maintenance, notificationConfig] = await db.getAll(
    db.doc(`semester_manifests/${SEMESTER_ID}`),
    db.doc("site_settings/student_maintenance"),
    db.doc("site_settings/notification_config"),
  );
  assert.equal(manifest.exists, true, "Current semester manifest is missing.");
  assert.equal(manifest.data()?.status, "ACTIVE");
  assert.equal(maintenance.exists ? maintenance.data()?.enabled === true : false, false);
  return {
    manifestRevision: Number(manifest.data()?.revision || 0),
    notificationConfigHash: sha256(
      JSON.stringify(notificationConfig.exists ? notificationConfig.data() : null),
    ),
  };
};

const deleteDocuments = async (snapshots) => {
  const unique = [...new Map(snapshots.map((item) => [item.ref.path, item])).values()];
  let deleted = 0;
  for (let index = 0; index < unique.length; index += 400) {
    const batch = db.batch();
    unique.slice(index, index + 400).forEach((item) => batch.delete(item.ref));
    await batch.commit();
    deleted += Math.min(400, unique.length - index);
  }
  return deleted;
};

const commandEvidence = async () => {
  const result = [];
  for (const name of ["command_receipts", "command_audit_events"]) {
    for (const uid of [studentUid, teacherUid]) {
      const snapshot = await db.collection(name).where("actorUid", "==", uid).get();
      result.push(
        ...snapshot.docs.filter((item) =>
          W8_STAGING_COMMAND_TYPES.has(item.data()?.commandType),
        ),
      );
    }
  }
  return result;
};

const toMillis = (value) => {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Date.parse(String(value || ""));
};

const collectEvidence = async () => {
  const run = await db.doc(runPath).get();
  assert.equal(run.exists, true, "W8 fixture run marker is missing.");
  assert.equal(run.data()?.fixtureOwner, FIXTURE_OWNER);
  assert.equal(run.data()?.testRunId, testRunId);
  const createdAfter = toMillis(run.data()?.createdAt);
  assert.equal(Number.isFinite(createdAfter), true, "Run marker createdAt is invalid.");
  const documents = await commandEvidence();
  const receipts = documents.filter(
    (item) => item.ref.parent.id === "command_receipts",
  );
  const audits = documents.filter(
    (item) => item.ref.parent.id === "command_audit_events",
  );
  for (const item of [...receipts, ...audits]) {
    assert.ok(
      toMillis(item.data()?.createdAt) >= createdAfter,
      `Foreign pre-run command evidence: ${item.ref.path}`,
    );
    assert.ok(
      [studentUid, teacherUid].includes(item.data()?.actorUid),
      `Foreign actor command evidence: ${item.ref.path}`,
    );
  }
  const observedCommands = assertStagingCommandSet(
    receipts.map((item) => item.data()?.commandType),
  );
  assert.equal(receipts.every((item) => item.data()?.status === "SUCCEEDED"), true);
  assert.equal(receipts.length, audits.length);
  const auditIds = new Set(audits.map((item) => item.id));
  assert.equal(receipts.every((item) => auditIds.has(item.id)), true);
  const canonicalPaths = [
    ...new Set(
      receipts.flatMap((item) => {
        const refs = item.data()?.target?.refs;
        assert.ok(Array.isArray(refs), `Missing target.refs: ${item.ref.path}`);
        return refs.filter((path) => {
          const [collectionName, documentId, ...rest] = String(path).split("/");
          if (!canonicalCollections.has(collectionName)) return false;
          assert.ok(documentId && rest.length === 0, `Malformed canonical ref: ${path}`);
          return true;
        });
      }),
    ),
  ].sort();
  assert.ok(canonicalPaths.length > 0, "No canonical W8 refs were collected.");
  return {
    fixtureOwner: FIXTURE_OWNER,
    testRunId,
    projectId: STAGING_PROJECT_ID,
    commands: [...observedCommands].sort(),
    canonicalPaths,
    receiptIds: receipts.map((item) => item.id).sort(),
    queryWriteCount: 0,
    archiveMutationCount: 0,
    legacySilentFallbackCount: 0,
    notificationSettingsMutationCount: 0,
    collectedAt: new Date().toISOString(),
  };
};

const assertOwnedBusinessDocument = (snapshot) => {
  const data = snapshot.data() || {};
  assert.equal(data.semesterId, SEMESTER_ID, `Wrong semester: ${snapshot.ref.path}`);
  const identifiers = [
    data.studentUid,
    data.recipientUid,
    data.createdBy,
    data.updatedBy,
    data.recordedBy,
    data.correctedBy,
    data.openedBy,
    data.closedBy,
    data.grantedBy,
    data.revokedBy,
    data.reviewedBy,
  ].filter(Boolean);
  assert.ok(
    identifiers.some((value) => [studentUid, teacherUid].includes(value)),
    `Refusing a document without a fixture actor: ${snapshot.ref.path}`,
  );
  if (data.classId) assert.equal(data.classId, classId);
  if (data.enrollmentId) assert.equal(data.enrollmentId, enrollmentId);
};

const cleanup = async () => {
  const evidence = loadEvidence();
  const business = evidence.canonicalPaths.length
    ? await db.getAll(...evidence.canonicalPaths.map((path) => db.doc(path)))
    : [];
  business.filter((item) => item.exists).forEach(assertOwnedBusinessDocument);
  const commands = await commandEvidence();
  const owned = await db.getAll(...fixturePaths.map((path) => db.doc(path)));
  const ownedExisting = owned.filter((item) => {
    if (!item.exists) return false;
    assert.equal(item.data()?.fixtureOwner, FIXTURE_OWNER);
    assert.equal(item.data()?.testRunId, testRunId);
    return true;
  });
  const deletedBusinessDocuments = await deleteDocuments(
    business.filter((item) => item.exists),
  );
  const deletedCommandDocuments = await deleteDocuments(commands);
  const deletedFixtureDocuments = await deleteDocuments(ownedExisting);
  let deletedSessions = 0;
  for (const uid of [studentUid, teacherUid]) {
    const sessions = await db.collection(`application_sessions/${uid}/sessions`).get();
    deletedSessions += await deleteDocuments(sessions.docs);
  }
  let deletedAuthUsers = 0;
  for (const uid of [studentUid, teacherUid]) {
    try {
      const user = await auth.getUser(uid);
      assert.equal(user.customClaims?.fixtureOwner, FIXTURE_OWNER);
      assert.equal(user.customClaims?.testRunId, testRunId);
      await auth.deleteUser(uid);
      deletedAuthUsers += 1;
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
  const residual = evidence.canonicalPaths.length
    ? await db.getAll(...evidence.canonicalPaths.map((path) => db.doc(path)))
    : [];
  assert.equal(residual.some((item) => item.exists), false);
  assert.equal((await commandEvidence()).length, 0);
  const residualFixtures = await db.getAll(
    ...fixturePaths.map((path) => db.doc(path)),
  );
  assert.equal(residualFixtures.some((item) => item.exists), false);
  for (const uid of [studentUid, teacherUid]) {
    const sessions = await db.collection(`application_sessions/${uid}/sessions`).get();
    assert.equal(sessions.empty, true, `Residual application session for ${uid}.`);
    await assert.rejects(
      auth.getUser(uid),
      (error) => error?.code === "auth/user-not-found",
      `Residual synthetic Auth user for ${uid}.`,
    );
  }
  return {
    deletedBusinessDocuments,
    deletedCommandDocuments,
    deletedFixtureDocuments,
    deletedSessions,
    deletedAuthUsers,
    residualBusinessDocuments: 0,
    residualCommandDocuments: 0,
    residualFixtureDocuments: 0,
    residualSessions: 0,
    residualAuthUsers: 0,
    residualTokens: 0,
  };
};

try {
  const scopes = await requiredScopes();
  if (mode === "dry-run") {
    console.log(
      JSON.stringify({
        suite: "w8-staging-fixture-dry-run",
        passed: true,
        projectId,
        testRunId,
        manifestRevision: scopes.manifestRevision,
        notificationConfigHash: scopes.notificationConfigHash,
        plannedAuthUsers: 2,
        plannedFixtureDocuments: fixturePaths.length,
        businessWrites: 0,
        productionAccess: 0,
      }),
    );
  } else if (mode === "setup") {
    const existing = await db.getAll(...fixturePaths.map((path) => db.doc(path)));
    assert.equal(existing.some((item) => item.exists), false, "Fixture already exists.");
    const createdAuthUids = [];
    try {
      for (const user of [
        { uid: studentUid, email: studentEmail, displayName: "합성학생" },
        { uid: teacherUid, email: teacherEmail, displayName: "합성교사" },
      ]) {
        await auth.createUser({ ...user, password, emailVerified: true });
        createdAuthUids.push(user.uid);
        await auth.setCustomUserClaims(user.uid, {
          fixtureOwner: FIXTURE_OWNER,
          testRunId,
        });
      }
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const batch = db.batch();
      const create = (path, value) =>
        batch.create(db.doc(path), {
          ...value,
          fixtureOwner: FIXTURE_OWNER,
          testRunId,
          expiresAt,
        });
      create(`users/${studentUid}`, {
      uid: studentUid,
      role: "student",
      email: studentEmail,
      name: "합성학생",
      // Deliberately differs from the canonical Enrollment snapshot below.
      // Browser onboarding can complete while W8 scope tests still prove that
      // the server never targets students from these legacy profile fields.
      grade: "1",
      class: "9",
      number: "40",
      privacyAgreed: true,
      consentAgreedItems: ["privacy", "terms"],
    });
      create(`users/${teacherUid}`, {
      uid: teacherUid,
      role: "teacher",
      email: teacherEmail,
      name: "합성교사",
      teacherPortalEnabled: true,
      staffPermissions: [
        "student_list_read",
        "lesson_read",
        "learning_manage",
        "schedule_manage",
        "attendance_manage",
        "notice_manage",
      ],
    });
      create(`semester_classes/${classId}`, {
      classId,
      semesterId: SEMESTER_ID,
      grade: "3",
      classNumber: "1",
      displayName: "3학년 1반",
      homeroomTeacherUid: teacherUid,
      status: "ACTIVE",
    });
      create(`semester_enrollments/${enrollmentId}`, {
      enrollmentId,
      semesterId: SEMESTER_ID,
      studentUid,
      classId,
      enrollmentStatus: "ACTIVE",
      provenance: "CURRENT",
      studentNumber: "98",
      snapshot: {
        displayName: "합성학생",
        grade: "3",
        classNumber: "1",
        classDisplayName: "3학년 1반",
        studentNumber: "98",
      },
    });
      create(`semester_enrollment_slots/${slotId}`, {
      slotId,
      semesterId: SEMESTER_ID,
      studentUid,
      activeEnrollmentId: enrollmentId,
      status: "ACTIVE",
    });
      create(runPath, {
      projectId,
      status: "READY",
      studentUid,
      teacherUid,
      studentEmail,
      teacherEmail,
      classId,
      enrollmentId,
      manifestRevision: scopes.manifestRevision,
      notificationConfigHash: scopes.notificationConfigHash,
      createdAt: FieldValue.serverTimestamp(),
    });
      await batch.commit();
    } catch (error) {
      for (const uid of createdAuthUids) {
        try {
          const user = await auth.getUser(uid);
          assert.ok(
            [studentEmail, teacherEmail].includes(user.email || ""),
            `Refusing rollback for unexpected Auth identity ${uid}.`,
          );
          await auth.deleteUser(uid);
        } catch (rollbackError) {
          if (rollbackError?.code !== "auth/user-not-found") throw rollbackError;
        }
      }
      throw error;
    }
    console.log(
      JSON.stringify({
        suite: "w8-staging-fixture-setup",
        passed: true,
        projectId,
        testRunId,
        studentUid,
        teacherUid,
        studentEmail,
        teacherEmail,
        classId,
        enrollmentId,
        manifestRevision: scopes.manifestRevision,
        notificationConfigMutationCount: 0,
        adminOnlyCommandVerifiedInEmulator: "updateNotificationSettings",
        productionAccess: 0,
      }),
    );
  } else if (mode === "collect-evidence") {
    console.log(JSON.stringify(await collectEvidence()));
  } else if (mode === "verify") {
    const evidence = loadEvidence();
    const run = await db.doc(runPath).get();
    assert.equal(run.exists, true);
    assert.equal(run.data()?.fixtureOwner, FIXTURE_OWNER);
    assert.equal(
      run.data()?.notificationConfigHash,
      scopes.notificationConfigHash,
      "Read-only notification configuration changed during W8 staging verification.",
    );
    const business = await db.getAll(
      ...evidence.canonicalPaths.map((path) => db.doc(path)),
    );
    assert.equal(business.every((item) => item.exists), true);
    business.forEach(assertOwnedBusinessDocument);
    const commandDocs = await commandEvidence();
    const receipts = commandDocs.filter(
      (item) => item.ref.parent.id === "command_receipts",
    );
    const audits = commandDocs.filter(
      (item) => item.ref.parent.id === "command_audit_events",
    );
    const observedCommands = assertStagingCommandSet(
      receipts.map((item) => item.data()?.commandType),
    );
    assert.deepEqual(observedCommands, new Set(evidence.commands));
    assert.equal(receipts.every((item) => item.data()?.status === "SUCCEEDED"), true);
    assert.equal(receipts.length, audits.length);
    console.log(
      JSON.stringify({
        suite: "w8-staging-fixture-verify",
        passed: true,
        projectId,
        testRunId,
        commandTypeCount: observedCommands.size,
        emulatorOnlyAdminCommand: "updateNotificationSettings",
        notificationConfigMutationCount: 0,
        receiptCount: receipts.length,
        canonicalDocumentCount: business.length,
        queryWriteCount: 0,
        archiveHashStable: evidence.archiveMutationCount === 0,
        productionAccess: 0,
      }),
    );
  } else {
    const run = await db.doc(runPath).get();
    assert.equal(
      run.data()?.notificationConfigHash,
      scopes.notificationConfigHash,
      "Notification configuration changed before cleanup.",
    );
    console.log(
      JSON.stringify({
        suite: "w8-staging-fixture-cleanup",
        passed: true,
        projectId,
        testRunId,
        ...(await cleanup()),
        productionAccess: 0,
      }),
    );
  }
} finally {
  await deleteApp(app);
}
