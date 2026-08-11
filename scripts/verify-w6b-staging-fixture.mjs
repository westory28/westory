import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const FIXTURE_OWNER = "w6b-grade-staging-browser";
const SEMESTER_ID = "2026-2";
const args = process.argv.slice(2);
const valueArg = (name) =>
  String(args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || "").trim();
const projectId = valueArg("--project");
const testRunId = valueArg("--test-run-id");
const browserEvidencePath = valueArg("--browser-evidence");
const archiveCheckpointPath = valueArg("--archive-checkpoint");
const mode = ["setup", "verify", "cleanup"].find((name) => args.includes(`--${name}`));
const modeCount = ["setup", "verify", "cleanup"].filter((name) => args.includes(`--${name}`)).length;

assert.notEqual(projectId, PRODUCTION_PROJECT_ID, "Production fixture access is forbidden.");
assert.equal(projectId, STAGING_PROJECT_ID, `Exact --project=${STAGING_PROJECT_ID} is required.`);
assert.equal(modeCount, 1, "Choose exactly one of --setup, --verify, or --cleanup.");
assert.match(testRunId, /^w6b-[a-z0-9][a-z0-9-]{7,63}$/u, "A scoped W6B testRunId is required.");

const password = String(process.env.WESTORY_W6B_STAGING_PASSWORD || "");
if (mode === "setup") {
  assert.match(password, /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16,}$/u);
}
if (browserEvidencePath) {
  assert.ok(existsSync(resolve(browserEvidencePath)), "Browser evidence file does not exist.");
}
if (mode === "verify" || mode === "cleanup") {
  assert.ok(browserEvidencePath, "--browser-evidence is required for exact verify/cleanup.");
}
if (archiveCheckpointPath) {
  assert.ok(existsSync(resolve(archiveCheckpointPath)), "Archive checkpoint file does not exist.");
}

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const { applicationDefault, deleteApp, initializeApp } = requireFromFunctions("firebase-admin/app");
const { getAuth } = requireFromFunctions("firebase-admin/auth");
const { FieldValue, getFirestore } = requireFromFunctions("firebase-admin/firestore");
const app = initializeApp(
  { credential: applicationDefault(), projectId },
  `w6b-grade-fixture-${createHash("sha256").update(testRunId).digest("hex").slice(0, 12)}`,
);
const auth = getAuth(app);
const db = getFirestore(app);

const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
const canonicalValue = (value) => {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
};
const documentHash = (value) => sha256(JSON.stringify(canonicalValue(value)));
const idSuffix = sha256(testRunId).slice(0, 20);
const studentUid = `w6b-student-${idSuffix}`;
const teacherUid = `w6b-teacher-${idSuffix}`;
const classId = `class-w6b-${idSuffix}`;
const enrollmentId = `enr-w6b-${idSuffix}`;
const slotId = `slot_${sha256(`${SEMESTER_ID}\n${studentUid}`).slice(0, 40)}`;
const attemptId = `attempt_${sha256(`${testRunId}:assessment-attempt`)}`;
const definitionId = `quiz:${SEMESTER_ID}:w6b-fixture:formative`;
const studentEmail = `w6b.student.${idSuffix}@yongshin-ms.ms.kr`;
const teacherEmail = `w6b.teacher.${idSuffix}@yongshin-ms.ms.kr`;
const runPath = `w6b_verification_runs/${testRunId}`;
const immutableSourcePaths = [
  `semester_assessment_attempts/${attemptId}`,
  `semester_assessment_submissions/${attemptId}`,
  `semester_assessment_results/${attemptId}`,
];
const fixturePaths = [
  runPath,
  `users/${studentUid}`,
  `users/${teacherUid}`,
  `semester_classes/${classId}`,
  `semester_enrollments/${enrollmentId}`,
  `semester_enrollment_slots/${slotId}`,
  `semester_assessment_definitions/${definitionId}`,
  ...immutableSourcePaths,
];
const gradeCollections = [
  "semester_grade_records",
  "semester_grade_versions",
  "semester_grade_requests",
  "semester_grade_attestations",
  "grade_legacy_issues",
];

const gradeCommandTypes = new Set([
  "createGradeDraft",
  "reviewGradeDraft",
  "finalizeGradeEvidence",
  "publishOfficialGrade",
  "correctOfficialGrade",
  "requestGradeReview",
  "acknowledgeGradeEvidence",
  "signOfficialGrade",
]);
const canonicalGradePathPattern = /^(?:semester_grade_records\/grade_[a-f0-9]{64}|semester_grade_versions\/gradever_[a-f0-9]{64}|semester_grade_requests\/gradereq_[a-f0-9]{64}|semester_grade_attestations\/gradeatt_[a-f0-9]{64}|grade_legacy_issues\/[A-Za-z0-9_-]{1,180})$/u;

let cachedBrowserEvidence;
const loadBrowserEvidence = () => {
  if (cachedBrowserEvidence !== undefined) return cachedBrowserEvidence;
  if (!browserEvidencePath) {
    cachedBrowserEvidence = { commands: [], canonicalPaths: [] };
    return cachedBrowserEvidence;
  }
  const evidence = JSON.parse(readFileSync(resolve(browserEvidencePath), "utf8"));
  assert.equal(evidence.fixtureOwner, FIXTURE_OWNER, "Browser evidence fixture owner mismatch.");
  assert.equal(evidence.testRunId, testRunId, "Browser evidence testRunId mismatch.");
  assert.equal(evidence.projectId, STAGING_PROJECT_ID, "Browser evidence project mismatch.");
  assert.ok(Array.isArray(evidence.commands), "Browser evidence commands must be an array.");
  assert.ok(Array.isArray(evidence.canonicalPaths), "Browser evidence canonicalPaths must be an array.");
  const canonicalPaths = [...new Set(evidence.canonicalPaths.map((path) => String(path || "")))];
  assert.equal(canonicalPaths.length, evidence.canonicalPaths.length, "Duplicate canonical paths are forbidden.");
  canonicalPaths.forEach((path) => assert.match(path, canonicalGradePathPattern));
  cachedBrowserEvidence = { ...evidence, canonicalPaths };
  return cachedBrowserEvidence;
};

const loadBrowserCommands = () => {
  const evidence = loadBrowserEvidence();
  return evidence.commands.map((command) => {
    assert.ok([studentUid, teacherUid].includes(command.actorUid), "Unexpected command actor.");
    assert.equal(
      gradeCommandTypes.has(String(command.commandType || "")),
      true,
      "Unexpected W6B command type.",
    );
    assert.match(
      String(command.commandId || ""),
      /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})$/iu,
    );
    const receiptId = `cmd_${sha256(`${command.actorUid}\n${command.commandType}\n${command.commandId}`)}`;
    return { ...command, receiptId };
  });
};

const exactCommandEvidencePaths = () =>
  loadBrowserCommands().flatMap(({ receiptId }) => [
    `command_receipts/${receiptId}`,
    `command_audit_events/${receiptId}`,
  ]);

const assertArchiveCheckpoint = async () => {
  if (!archiveCheckpointPath) return { checked: 0 };
  const checkpoint = JSON.parse(readFileSync(resolve(archiveCheckpointPath), "utf8"));
  assert.equal(checkpoint.projectId, STAGING_PROJECT_ID, "Archive checkpoint project mismatch.");
  assert.ok(Array.isArray(checkpoint.documents) && checkpoint.documents.length > 0);
  for (const item of checkpoint.documents) {
    assert.match(String(item.path || ""), /(?:^|\/)2026(?:\/|-)1(?:\/|$)/u);
    assert.match(String(item.sha256 || ""), /^[a-f0-9]{64}$/u);
    const snapshot = await db.doc(item.path).get();
    assert.equal(snapshot.exists, true, `Archive checkpoint missing: ${item.path}`);
    assert.equal(documentHash(snapshot.data()), item.sha256, `Archive hash drift: ${item.path}`);
  }
  return { checked: checkpoint.documents.length };
};

const ownedGradeDocuments = async ({ requireExact = true } = {}) => {
  const documents = new Map();
  const recordIds = new Set();
  for (const collectionName of gradeCollections) {
    const snapshot = await db.collection(collectionName).where("testRunId", "==", testRunId).get();
    for (const item of snapshot.docs) {
      assert.equal(item.data()?.fixtureOwner, FIXTURE_OWNER, `Foreign fixture document: ${item.ref.path}`);
      documents.set(item.ref.path, item);
    }
  }
  const exactPaths = loadBrowserEvidence().canonicalPaths;
  if (exactPaths.length) {
    const exact = await db.getAll(...exactPaths.map((path) => db.doc(path)));
    exactPaths
      .filter((path) => path.startsWith("semester_grade_records/"))
      .forEach((path) => recordIds.add(path.split("/")[1]));
    for (const snapshot of exact) {
      if (!snapshot.exists && !requireExact) continue;
      assert.equal(snapshot.exists, true, `Canonical browser evidence missing: ${snapshot.ref.path}`);
      const data = snapshot.data() || {};
      assert.equal(data.semesterId, SEMESTER_ID, `Canonical semester mismatch: ${snapshot.ref.path}`);
      if (snapshot.ref.parent.id === "grade_legacy_issues") {
        assert.equal(data.fixtureOwner, FIXTURE_OWNER);
        assert.equal(data.testRunId, testRunId);
      } else if (snapshot.ref.parent.id === "semester_grade_records") {
        assert.equal(data.studentUid, studentUid, `Canonical student mismatch: ${snapshot.ref.path}`);
        assert.equal(data.recordId, snapshot.id);
        assert.equal(data.sourceKind, "ASSESSMENT_RESULT");
        assert.equal(data.sourceId, attemptId);
        assert.ok(Array.isArray(data.sourceRefs) && data.sourceRefs.includes(`semester_assessment_results/${attemptId}`));
      } else {
        assert.equal(data.studentUid, studentUid, `Canonical student mismatch: ${snapshot.ref.path}`);
        assert.ok(recordIds.has(data.recordId), `Unmanifested grade record link: ${snapshot.ref.path}`);
      }
      documents.set(snapshot.ref.path, snapshot);
    }
  }
  for (const recordId of recordIds) {
    for (const collectionName of [
      "semester_grade_versions",
      "semester_grade_requests",
      "semester_grade_attestations",
    ]) {
      const linked = await db.collection(collectionName).where("recordId", "==", recordId).get();
      for (const snapshot of linked.docs) {
        const data = snapshot.data() || {};
        assert.equal(data.recordId, recordId, `Canonical record link mismatch: ${snapshot.ref.path}`);
        assert.equal(data.semesterId, SEMESTER_ID, `Canonical semester mismatch: ${snapshot.ref.path}`);
        assert.equal(data.studentUid, studentUid, `Canonical student mismatch: ${snapshot.ref.path}`);
        documents.set(snapshot.ref.path, snapshot);
      }
    }
  }
  return [...documents.values()];
};

const deleteOwnedExactPaths = async () => {
  const snapshots = await db.getAll(...fixturePaths.map((path) => db.doc(path)));
  const owned = snapshots.filter((snapshot) => {
    if (!snapshot.exists) return false;
    assert.equal(snapshot.data()?.fixtureOwner, FIXTURE_OWNER, `Refusing foreign path: ${snapshot.ref.path}`);
    assert.equal(snapshot.data()?.testRunId, testRunId, `Refusing other run: ${snapshot.ref.path}`);
    return true;
  });
  if (owned.length) {
    const batch = db.batch();
    owned.forEach((snapshot) => batch.delete(snapshot.ref));
    await batch.commit();
  }
  return owned.length;
};

const deleteExactCommandEvidence = async () => {
  const commands = loadBrowserCommands();
  if (!commands.length) return 0;
  const paths = exactCommandEvidencePaths();
  const snapshots = await db.getAll(...paths.map((path) => db.doc(path)));
  const existing = snapshots.filter((snapshot) => snapshot.exists);
  for (const snapshot of existing) {
    const command = commands.find((item) => item.receiptId === snapshot.id);
    assert.ok(command, `Refusing unmanifested command evidence: ${snapshot.ref.path}`);
    assert.equal(snapshot.data()?.commandId, command.commandId);
    assert.equal(snapshot.data()?.commandType, command.commandType);
    assert.equal(snapshot.data()?.actorUid, command.actorUid);
  }
  if (existing.length) {
    const batch = db.batch();
    existing.forEach((snapshot) => batch.delete(snapshot.ref));
    await batch.commit();
  }
  return existing.length;
};

const deleteSessions = async () => {
  let deleted = 0;
  for (const uid of [studentUid, teacherUid]) {
    const snapshot = await db.collection(`application_sessions/${uid}/sessions`).get();
    if (snapshot.empty) continue;
    const batch = db.batch();
    snapshot.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
    deleted += snapshot.size;
  }
  return deleted;
};

const deleteAuthUsers = async () => {
  let deleted = 0;
  for (const uid of [studentUid, teacherUid]) {
    try {
      const user = await auth.getUser(uid);
      assert.equal(user.customClaims?.fixtureOwner, FIXTURE_OWNER);
      assert.equal(user.customClaims?.testRunId, testRunId);
      await auth.deleteUser(uid);
      deleted += 1;
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
  return deleted;
};

const cleanupFixture = async () => {
  const gradeDocuments = await ownedGradeDocuments();
  if (gradeDocuments.length) {
    const batch = db.batch();
    gradeDocuments.forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  const deletedCommandDocuments = await deleteExactCommandEvidence();
  const deletedFixtureDocuments = await deleteOwnedExactPaths();
  const deletedSessions = await deleteSessions();
  const deletedAuthUsers = await deleteAuthUsers();

  const residualGradeDocuments = await ownedGradeDocuments({ requireExact: false });
  assert.equal(residualGradeDocuments.length, 0, "Residual W6B grade fixture documents remain.");
  const residualPaths = await db.getAll(...fixturePaths.map((path) => db.doc(path)));
  assert.equal(residualPaths.filter((snapshot) => snapshot.exists).length, 0);
  const commandPaths = exactCommandEvidencePaths();
  if (commandPaths.length) {
    const residualCommands = await db.getAll(...commandPaths.map((path) => db.doc(path)));
    assert.equal(residualCommands.filter((snapshot) => snapshot.exists).length, 0);
  }
  for (const uid of [studentUid, teacherUid]) {
    assert.equal((await db.collection(`application_sessions/${uid}/sessions`).get()).empty, true);
  }
  const archive = await assertArchiveCheckpoint();
  assert.equal((await db.doc(runPath).get()).exists, false, "Run manifest must not survive cleanup.");
  return {
    deletedGradeDocuments: gradeDocuments.length,
    deletedCommandDocuments,
    deletedFixtureDocuments,
    deletedSessions,
    deletedAuthUsers,
    residualBusinessDocuments: 0,
    archiveDocumentsChecked: archive.checked,
  };
};

try {
  if (mode === "cleanup") {
    const result = await cleanupFixture();
    console.log(
      JSON.stringify({
        suite: "w6b-staging-fixture-cleanup",
        passed: true,
        projectId,
        testRunId,
        ...result,
        productionAccess: 0,
      }),
    );
  } else if (mode === "verify") {
    const run = await db.doc(runPath).get();
    assert.equal(run.exists, true, "W6B verification run manifest is missing.");
    assert.equal(run.data()?.fixtureOwner, FIXTURE_OWNER);
    assert.equal(run.data()?.testRunId, testRunId);
    const sources = await db.getAll(...immutableSourcePaths.map((path) => db.doc(path)));
    assert.equal(sources.every((snapshot) => snapshot.exists), true);
    const sourceHash = sha256(
      sources.map((snapshot) => `${snapshot.ref.path}:${documentHash(snapshot.data())}`).join("\n"),
    );
    assert.equal(sourceHash, run.data()?.immutableSourceHash, "W6A source hash changed.");
    const gradeDocuments = await ownedGradeDocuments();
    assert.ok(gradeDocuments.length > 0, "No W6B grade documents were created.");
    assert.ok(loadBrowserEvidence().canonicalPaths.length > 0, "Exact canonical browser paths are required.");
    assert.deepEqual(
      new Set(loadBrowserCommands().map((command) => command.commandType)),
      gradeCommandTypes,
      "Staging browser evidence must cover all eight W6B commands.",
    );
    const archive = await assertArchiveCheckpoint();
    console.log(
      JSON.stringify({
        suite: "w6b-staging-fixture-verify",
        passed: true,
        projectId,
        testRunId,
        gradeDocumentCount: gradeDocuments.length,
        immutableSourceHash: sourceHash,
        archiveDocumentsChecked: archive.checked,
        productionAccess: 0,
      }),
    );
  } else {
    await cleanupFixture();
    for (const user of [
      { uid: studentUid, email: studentEmail, displayName: "W6B 합성 학생" },
      { uid: teacherUid, email: teacherEmail, displayName: "W6B 합성 교사" },
    ]) {
      await auth.createUser({ ...user, password, emailVerified: true });
      await auth.setCustomUserClaims(user.uid, { fixtureOwner: FIXTURE_OWNER, testRunId });
    }
    const sourceHash = sha256(`${testRunId}:immutable-source`);
    const now = new Date().toISOString();
    const batch = db.batch();
    const createOwned = (path, value) =>
      batch.create(db.doc(path), {
        ...value,
        fixtureOwner: FIXTURE_OWNER,
        testRunId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    createOwned(`users/${studentUid}`, {
      uid: studentUid,
      email: studentEmail,
      role: "student",
      name: "합성학생",
      grade: "3",
      class: "1",
      number: "99",
      studentName: "합성학생",
      studentGrade: "3",
      studentClass: "1",
      studentNumber: "99",
      customNameConfirmed: true,
      privacyAgreed: true,
      consentAgreedItems: ["privacy", "terms"],
    });
    createOwned(`users/${teacherUid}`, {
      uid: teacherUid,
      email: teacherEmail,
      role: "teacher",
      name: "W6B 합성 교사",
      teacherPortalEnabled: true,
      staffPermissions: ["student_list_read", "quiz_read", "lesson_read"],
      permissions: { quiz_read: true, lesson_read: true },
    });
    createOwned(`semester_classes/${classId}`, {
      classId,
      semesterId: SEMESTER_ID,
      grade: "3",
      classNumber: "1",
      classKey: "3::1",
      displayName: "3학년 1반",
      homeroomTeacherUid: teacherUid,
      status: "ACTIVE",
    });
    createOwned(`semester_enrollments/${enrollmentId}`, {
      enrollmentId,
      semesterId: SEMESTER_ID,
      studentUid,
      classId,
      enrollmentStatus: "ACTIVE",
      provenance: "CURRENT",
      snapshot: {
        displayName: "합성학생",
        studentNumber: "99",
        grade: "3",
        classNumber: "1",
      },
    });
    createOwned(`semester_enrollment_slots/${slotId}`, {
      slotId,
      semesterId: SEMESTER_ID,
      studentUid,
      activeEnrollmentId: enrollmentId,
      status: "ACTIVE",
    });
    createOwned(`semester_assessment_definitions/${definitionId}`, {
      schemaVersion: 1,
      policyVersion: "w6a-v1",
      definitionId,
      revision: 1,
      semesterId: SEMESTER_ID,
      assessmentKind: "QUIZ",
      title: "W6B 수행평가 증거",
      status: "PUBLISHED",
      sourceHash,
    });
    createOwned(`semester_assessment_attempts/${attemptId}`, {
      schemaVersion: 1,
      policyVersion: "w6a-v1",
      attemptId,
      definitionId,
      definitionRevision: 1,
      semesterId: SEMESTER_ID,
      studentUid,
      enrollmentId,
      classId,
      attemptNumber: 1,
      revision: 2,
      status: "SUBMITTED",
      questionIds: ["1"],
      gradingSnapshot: [{ id: "1", answer: "정답" }],
      answers: { "1": "정답" },
      sourceHash,
      submissionRef: `semester_assessment_submissions/${attemptId}`,
      resultRef: `semester_assessment_results/${attemptId}`,
      submittedAtIso: now,
    });
    createOwned(`semester_assessment_submissions/${attemptId}`, {
      schemaVersion: 1,
      policyVersion: "w6a-v1",
      submissionId: attemptId,
      attemptId,
      definitionId,
      semesterId: SEMESTER_ID,
      studentUid,
      answers: { "1": "정답" },
      attemptRevision: 2,
      sourceHash,
      submittedAtIso: now,
    });
    createOwned(`semester_assessment_results/${attemptId}`, {
      resultId: attemptId,
      attemptId,
      definitionId,
      semesterId: SEMESTER_ID,
      assessmentKind: "QUIZ",
      studentUid,
      enrollmentId,
      classId,
      score: 1,
      total: 1,
      percent: 100,
      answerChecks: [{ id: "1", correct: true }],
      sourceHash,
      submissionRef: `semester_assessment_submissions/${attemptId}`,
      submittedAtIso: now,
    });
    await batch.commit();
    const sources = await db.getAll(...immutableSourcePaths.map((path) => db.doc(path)));
    const immutableSourceHash = sha256(
      sources.map((snapshot) => `${snapshot.ref.path}:${documentHash(snapshot.data())}`).join("\n"),
    );
    await db.doc(runPath).set({
      fixtureOwner: FIXTURE_OWNER,
      testRunId,
      projectId,
      status: "READY",
      studentUid,
      teacherUid,
      studentEmail,
      teacherEmail,
      fixturePaths,
      immutableSourcePaths,
      immutableSourceHash,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    console.log(
      JSON.stringify({
        suite: "w6b-staging-fixture-setup",
        passed: true,
        projectId,
        testRunId,
        studentUid,
        teacherUid,
        studentEmail,
        teacherEmail,
        immutableSourceHash,
        fixtureDocumentCount: fixturePaths.length,
        productionAccess: 0,
      }),
    );
  }
} finally {
  await deleteApp(app);
}
