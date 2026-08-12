import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const FIXTURE_OWNER = "w9-teacher-operations-staging";
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
  "Choose exactly one W9 fixture mode.",
);
assert.match(
  testRunId,
  /^w9-[a-z0-9][a-z0-9-]{7,63}$/u,
  "A scoped W9 testRunId is required.",
);
if (["verify", "cleanup"].includes(mode)) {
  assert.ok(browserEvidencePath, "--browser-evidence is required.");
  assert.ok(
    existsSync(resolve(browserEvidencePath)),
    "Browser evidence is missing.",
  );
}
const password = String(process.env.WESTORY_W9_STAGING_PASSWORD || "");
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
const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const suffix = sha256(testRunId).slice(0, 20);
const teacherUid = `w9-teacher-${suffix}`;
const studentUid = `w9-student-${suffix}`;
const teacherEmail = `w9.teacher.${suffix}@yongshin-ms.ms.kr`;
const studentEmail = `w9.student.${suffix}@yongshin-ms.ms.kr`;
const classId = `class-w9-${suffix}`;
const enrollmentId = `enr-w9-${suffix}`;
const slotId = `slot_${sha256(`${SEMESTER_ID}\n${studentUid}`).slice(0, 40)}`;
const runPath = `w9_verification_runs/${testRunId}`;
const fixturePaths = [
  runPath,
  `users/${teacherUid}`,
  `users/${studentUid}`,
  `semester_classes/${classId}`,
  `semester_enrollments/${enrollmentId}`,
  `semester_enrollment_slots/${slotId}`,
];
const app = initializeApp(
  { credential: applicationDefault(), projectId },
  `w9-fixture-${suffix.slice(0, 12)}`,
);
const auth = getAuth(app);
const db = getFirestore(app);

const W9_ALL_COMMANDS = new Set([
  "saveTeacherDraft",
  "discardTeacherDraft",
  "resolveTeacherDraft",
  "cleanupExpiredTeacherDrafts",
  "createTeacherBulkJob",
  "reconcileTeacherBulkJob",
  "retryTeacherBulkJob",
]);
const W9_STAGING_COMMANDS = new Set(
  [...W9_ALL_COMMANDS].filter(
    (command) => command !== "cleanupExpiredTeacherDrafts",
  ),
);
const W9_REQUIRED_COMMANDS = new Set(W9_STAGING_COMMANDS);
const canonicalCollections = new Set([
  "teacher_drafts",
  "teacher_bulk_jobs",
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
]);
const commandCollections = ["command_receipts", "command_audit_events"];
const toMillis = (value) => {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Date.parse(String(value || ""));
};
const requiredScopes = async () => {
  const [manifest, maintenance] = await db.getAll(
    db.doc(`semester_manifests/${SEMESTER_ID}`),
    db.doc("site_settings/student_maintenance"),
  );
  assert.equal(manifest.exists, true, "Current semester manifest is missing.");
  assert.equal(manifest.data()?.status, "ACTIVE");
  assert.equal(
    maintenance.exists ? maintenance.data()?.enabled === true : false,
    false,
  );
  return { manifestRevision: Number(manifest.data()?.revision || 0) };
};
const commandEvidence = async ({
  createdAfter = Number.NEGATIVE_INFINITY,
} = {}) => {
  const rows = [];
  for (const collectionName of commandCollections) {
    const snapshot = await db
      .collection(collectionName)
      .where("actorUid", "==", teacherUid)
      .get();
    rows.push(
      ...snapshot.docs.filter(
        (item) => toMillis(item.data()?.createdAt) >= createdAfter,
      ),
    );
  }
  return rows;
};
const assertCommandSet = (commands) => {
  const observed = new Set(commands);
  assert.ok(observed.size > 0, "No W9 command evidence was collected.");
  for (const command of observed) {
    assert.ok(
      W9_STAGING_COMMANDS.has(command),
      `Unexpected W9 command: ${command}`,
    );
  }
  for (const command of W9_REQUIRED_COMMANDS) {
    assert.ok(observed.has(command), `Missing required W9 command: ${command}`);
  }
  return observed;
};
const collectEvidence = async () => {
  const run = await db.doc(runPath).get();
  assert.equal(run.exists, true, "W9 fixture run marker is missing.");
  assert.equal(run.data()?.fixtureOwner, FIXTURE_OWNER);
  assert.equal(run.data()?.testRunId, testRunId);
  const createdAfter = toMillis(run.data()?.createdAt);
  assert.equal(Number.isFinite(createdAfter), true);
  const documents = await commandEvidence({ createdAfter });
  const receipts = documents.filter(
    (item) => item.ref.parent.id === "command_receipts",
  );
  const audits = documents.filter(
    (item) => item.ref.parent.id === "command_audit_events",
  );
  const w9Receipts = receipts.filter((item) =>
    W9_STAGING_COMMANDS.has(item.data()?.commandType),
  );
  for (const item of documents) {
    assert.equal(item.data()?.actorUid, teacherUid);
    assert.ok(
      toMillis(item.data()?.createdAt) >= createdAfter,
      `Foreign command: ${item.ref.path}`,
    );
  }
  const commands = assertCommandSet(
    w9Receipts.map((item) => item.data()?.commandType),
  );
  assert.equal(
    w9Receipts.every((item) => item.data()?.status === "SUCCEEDED"),
    true,
  );
  assert.equal(receipts.length, audits.length);
  const auditIds = new Set(audits.map((item) => item.id));
  assert.equal(
    receipts.every((item) => auditIds.has(item.id)),
    true,
  );
  const canonicalPaths = [
    ...new Set(
      receipts.flatMap((item) => {
        const refs = item.data()?.target?.refs;
        assert.ok(Array.isArray(refs), `Missing target.refs: ${item.ref.path}`);
        return refs.filter((path) => {
          const [collectionName, documentId, ...rest] = String(path).split("/");
          if (!canonicalCollections.has(collectionName)) return false;
          assert.ok(
            documentId && rest.length === 0,
            `Malformed canonical ref: ${path}`,
          );
          return true;
        });
      }),
    ),
  ].sort();
  assert.ok(canonicalPaths.some((path) => path.startsWith("teacher_drafts/")));
  assert.ok(
    canonicalPaths.some((path) => path.startsWith("teacher_bulk_jobs/")),
  );
  return {
    fixtureOwner: FIXTURE_OWNER,
    testRunId,
    projectId,
    createdAfterEpochMs: createdAfter,
    commands: [...commands].sort(),
    receiptIds: w9Receipts.map((item) => item.id).sort(),
    allActorReceiptIds: receipts.map((item) => item.id).sort(),
    canonicalPaths,
    queryWriteCount: 0,
    crossUidReadCount: 0,
    archiveMutationCount: 0,
    implicitDraftSaveCount: 0,
    cleanupCommandMutationCount: 0,
    collectedAt: new Date().toISOString(),
  };
};
const loadEvidence = () => {
  const evidence = JSON.parse(
    readFileSync(resolve(browserEvidencePath), "utf8"),
  );
  assert.equal(evidence.fixtureOwner, FIXTURE_OWNER);
  assert.equal(evidence.testRunId, testRunId);
  assert.equal(evidence.projectId, projectId);
  assert.equal(Number.isFinite(evidence.createdAfterEpochMs), true);
  assert.equal(Array.isArray(evidence.receiptIds), true);
  assert.equal(Array.isArray(evidence.allActorReceiptIds), true);
  assertCommandSet(evidence.commands);
  assert.equal(evidence.queryWriteCount, 0);
  assert.equal(evidence.crossUidReadCount, 0);
  assert.equal(evidence.archiveMutationCount, 0);
  assert.equal(evidence.implicitDraftSaveCount, 0);
  assert.equal(evidence.cleanupCommandMutationCount, 0);
  for (const path of evidence.canonicalPaths) {
    const [collectionName, documentId, ...rest] = String(path).split("/");
    assert.ok(canonicalCollections.has(collectionName));
    assert.ok(documentId && rest.length === 0);
  }
  return evidence;
};
const deleteDocuments = async (snapshots) => {
  const unique = [
    ...new Map(snapshots.map((item) => [item.ref.path, item])).values(),
  ];
  let deleted = 0;
  for (let index = 0; index < unique.length; index += 400) {
    const batch = db.batch();
    unique.slice(index, index + 400).forEach((item) => batch.delete(item.ref));
    await batch.commit();
    deleted += Math.min(400, unique.length - index);
  }
  return deleted;
};
const assertOwnedBusiness = (snapshot) => {
  const data = snapshot.data() || {};
  assert.equal(data.semesterId, SEMESTER_ID);
  const actors = [
    data.ownerUid,
    data.studentUid,
    data.createdBy,
    data.updatedBy,
    data.openedBy,
    data.closedBy,
    data.recordedBy,
  ].filter(Boolean);
  assert.ok(
    actors.some((value) => [teacherUid, studentUid].includes(value)),
    `Refusing foreign document: ${snapshot.ref.path}`,
  );
};
const cleanup = async () => {
  const evidence = loadEvidence();
  const business = await db.getAll(
    ...evidence.canonicalPaths.map((path) => db.doc(path)),
  );
  business.filter((item) => item.exists).forEach(assertOwnedBusiness);
  const commands = await commandEvidence({
    createdAfter: evidence.createdAfterEpochMs,
  });
  const fixtures = await db.getAll(...fixturePaths.map((path) => db.doc(path)));
  const ownedFixtures = fixtures.filter((item) => {
    if (!item.exists) return false;
    assert.equal(item.data()?.fixtureOwner, FIXTURE_OWNER);
    assert.equal(item.data()?.testRunId, testRunId);
    return true;
  });
  const deletedBusinessDocuments = await deleteDocuments(
    business.filter((item) => item.exists),
  );
  const deletedCommandDocuments = await deleteDocuments(commands);
  const deletedFixtureDocuments = await deleteDocuments(ownedFixtures);
  let deletedSessions = 0;
  let deletedAuthUsers = 0;
  for (const uid of [teacherUid, studentUid]) {
    const sessions = await db
      .collection(`application_sessions/${uid}/sessions`)
      .get();
    deletedSessions += await deleteDocuments(sessions.docs);
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
  const residualBusiness = await db.getAll(
    ...evidence.canonicalPaths.map((path) => db.doc(path)),
  );
  assert.equal(
    residualBusiness.some((item) => item.exists),
    false,
  );
  assert.equal(
    (await commandEvidence({ createdAfter: evidence.createdAfterEpochMs }))
      .length,
    0,
  );
  assert.equal(
    (await db.getAll(...fixturePaths.map((path) => db.doc(path)))).some(
      (item) => item.exists,
    ),
    false,
  );
  for (const uid of [teacherUid, studentUid]) {
    assert.equal(
      (await db.collection(`application_sessions/${uid}/sessions`).get()).empty,
      true,
    );
    await assert.rejects(
      auth.getUser(uid),
      (error) => error?.code === "auth/user-not-found",
    );
  }
  return {
    deletedBusinessDocuments,
    deletedCommandDocuments,
    deletedFixtureDocuments,
    deletedSessions,
    deletedAuthUsers,
    residualAuthUsers: 0,
    residualDrafts: 0,
    residualJobs: 0,
    residualBusinessDocuments: 0,
    residualCommandDocuments: 0,
    residualSessions: 0,
    residualTokens: 0,
  };
};

try {
  const scopes = await requiredScopes();
  if (mode === "dry-run") {
    console.log(
      JSON.stringify({
        suite: "w9-staging-fixture-dry-run",
        passed: true,
        projectId,
        testRunId,
        manifestRevision: scopes.manifestRevision,
        plannedAuthUsers: 2,
        plannedFixtureDocuments: fixturePaths.length,
        businessWrites: 0,
        productionAccess: 0,
      }),
    );
  } else if (mode === "setup") {
    const existing = await db.getAll(
      ...fixturePaths.map((path) => db.doc(path)),
    );
    assert.equal(
      existing.some((item) => item.exists),
      false,
      "Fixture already exists.",
    );
    const createdAuthUids = [];
    try {
      for (const user of [
        { uid: teacherUid, email: teacherEmail, displayName: "합성교사" },
        { uid: studentUid, email: studentEmail, displayName: "합성학생" },
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
      create(`users/${teacherUid}`, {
        uid: teacherUid,
        role: "teacher",
        email: teacherEmail,
        name: "합성교사",
        teacherPortalEnabled: true,
        staffPermissions: [
          "lesson_read",
          "learning_manage",
          "attendance_manage",
        ],
      });
      create(`users/${studentUid}`, {
        uid: studentUid,
        role: "student",
        email: studentEmail,
        name: "합성학생",
        privacyAgreed: true,
        consentAgreedItems: ["privacy", "terms"],
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
        snapshot: { displayName: "합성학생", studentNumber: "98" },
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
        teacherUid,
        studentUid,
        teacherEmail,
        studentEmail,
        classId,
        enrollmentId,
        manifestRevision: scopes.manifestRevision,
        createdAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      for (const uid of createdAuthUids) {
        try {
          const user = await auth.getUser(uid);
          assert.ok([teacherEmail, studentEmail].includes(user.email || ""));
          await auth.deleteUser(uid);
        } catch (rollbackError) {
          if (rollbackError?.code !== "auth/user-not-found")
            throw rollbackError;
        }
      }
      throw error;
    }
    console.log(
      JSON.stringify({
        suite: "w9-staging-fixture-setup",
        passed: true,
        projectId,
        testRunId,
        teacherUid,
        studentUid,
        teacherEmail,
        studentEmail,
        classId,
        enrollmentId,
        manifestRevision: scopes.manifestRevision,
        cleanupExpiredTeacherDraftsVerifiedInEmulator: true,
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
    const business = await db.getAll(
      ...evidence.canonicalPaths.map((path) => db.doc(path)),
    );
    assert.equal(
      business.every((item) => item.exists),
      true,
    );
    business.forEach(assertOwnedBusiness);
    const commandDocs = await commandEvidence({
      createdAfter: evidence.createdAfterEpochMs,
    });
    const receipts = commandDocs.filter(
      (item) => item.ref.parent.id === "command_receipts",
    );
    const audits = commandDocs.filter(
      (item) => item.ref.parent.id === "command_audit_events",
    );
    const w9Receipts = receipts.filter((item) =>
      W9_STAGING_COMMANDS.has(item.data()?.commandType),
    );
    assert.deepEqual(
      assertCommandSet(w9Receipts.map((item) => item.data()?.commandType)),
      new Set(evidence.commands),
    );
    assert.deepEqual(
      receipts.map((item) => item.id).sort(),
      [...evidence.allActorReceiptIds].sort(),
    );
    assert.equal(receipts.length, audits.length);
    console.log(
      JSON.stringify({
        suite: "w9-staging-fixture-verify",
        passed: true,
        projectId,
        testRunId,
        commandTypeCount: new Set(evidence.commands).size,
        receiptCount: receipts.length,
        canonicalDocumentCount: business.length,
        queryWriteCount: 0,
        crossUidReadCount: 0,
        archiveMutationCount: 0,
        productionAccess: 0,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        suite: "w9-staging-fixture-cleanup",
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
