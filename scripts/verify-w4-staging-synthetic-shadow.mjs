import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const FIXTURE_OWNER = "w4-staging-synthetic-shadow-2026-08-11";
const args = process.argv.slice(2);
const projectId = String(
  args
    .find((value) => value.startsWith("--project="))
    ?.slice("--project=".length) || "",
).trim();

assert.notEqual(
  projectId,
  PRODUCTION_PROJECT_ID,
  "Production fixture setup is forbidden.",
);
assert.equal(
  projectId,
  STAGING_PROJECT_ID,
  `W4 temporary fixture requires exact --project=${STAGING_PROJECT_ID}.`,
);
assert.equal(
  args.includes("--apply-temporary-fixture"),
  true,
  "Temporary Staging writes require --apply-temporary-fixture.",
);

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const { applicationDefault, getApps, initializeApp } =
  requireFromFunctions("firebase-admin/app");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");
const app =
  getApps().find(
    (candidate) => candidate.name === "w4-staging-synthetic-shadow",
  ) ||
  initializeApp(
    { credential: applicationDefault(), projectId },
    "w4-staging-synthetic-shadow",
  );
const db = getFirestore(app);
const fixtureDocuments = new Map([
  [
    "synthetic-teacher-001",
    {
      role: "teacher",
      teacherPortalEnabled: true,
      name: "합성 담임 001",
    },
  ],
  [
    "synthetic-teacher-002",
    {
      role: "teacher",
      teacherPortalEnabled: true,
      name: "합성 담임 002",
    },
  ],
  [
    "synthetic-student-001",
    {
      role: "student",
      studentName: "합성 학생 001",
      studentGrade: "1",
      studentClass: "1",
      studentNumber: "1",
      w4HomeroomTeacherUid: "synthetic-teacher-001",
    },
  ],
  [
    "synthetic-student-002",
    {
      role: "student",
      studentName: "합성 학생 002",
      studentGrade: "1",
      studentClass: "1",
      studentNumber: "2",
      w4HomeroomTeacherUid: "synthetic-teacher-001",
    },
  ],
  [
    "synthetic-student-003",
    {
      role: "student",
      studentName: "합성 학생 003",
      studentGrade: "1",
      studentClass: "2",
      studentNumber: "1",
      w4HomeroomTeacherUid: "synthetic-teacher-002",
    },
  ],
]);
const references = [...fixtureDocuments.keys()].map((uid) =>
  db.doc(`users/${uid}`),
);
const existing = await db.getAll(...references);
const existingDocuments = existing.filter((snapshot) => snapshot.exists);
let recoveredCleanupWrites = 0;
if (existingDocuments.length > 0) {
  assert.equal(
    existingDocuments.every(
      (snapshot) =>
        snapshot.data()?.w4SyntheticFixture === true &&
        snapshot.data()?.w4FixtureOwner === FIXTURE_OWNER,
    ),
    true,
    "A reserved W4 synthetic fixture ID already exists; refusing to overwrite it.",
  );
  const recoveryBatch = db.batch();
  existingDocuments.forEach((snapshot) => recoveryBatch.delete(snapshot.ref));
  await recoveryBatch.commit();
  recoveredCleanupWrites = existingDocuments.length;
}

let fixtureSetupWrites = 0;
let cleanupWrites = 0;
try {
  const setupBatch = db.batch();
  references.forEach((reference) => {
    setupBatch.create(reference, {
      ...fixtureDocuments.get(reference.id),
      w4SyntheticFixture: true,
      w4FixtureOwner: FIXTURE_OWNER,
    });
  });
  await setupBatch.commit();
  fixtureSetupWrites = references.length;

  const verification = spawnSync(
    process.execPath,
    [
      resolve("scripts/verify-w4-shadow-migration.mjs"),
      `--project=${projectId}`,
      "--verify-live",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (verification.stdout) process.stdout.write(verification.stdout);
  if (verification.stderr) process.stderr.write(verification.stderr);
  assert.equal(
    verification.status,
    0,
    "Live synthetic shadow migration failed.",
  );
  assert.match(verification.stdout, /"expectedStudentCount": 3/);
  assert.match(verification.stdout, /"expectedClassCount": 2/);
  assert.match(verification.stdout, /"expectedEnrollmentCount": 3/);
  assert.match(verification.stdout, /"blockingIssueCount": 0/);
} finally {
  const cleanupSnapshots = await db.getAll(...references);
  const cleanupBatch = db.batch();
  cleanupSnapshots.forEach((snapshot) => {
    if (
      snapshot.exists &&
      snapshot.data()?.w4SyntheticFixture === true &&
      snapshot.data()?.w4FixtureOwner === FIXTURE_OWNER
    ) {
      cleanupBatch.delete(snapshot.ref);
      cleanupWrites += 1;
    }
  });
  if (cleanupWrites > 0) await cleanupBatch.commit();
}

const remaining = await db.getAll(...references);
assert.equal(
  remaining.some((snapshot) => snapshot.exists),
  false,
  "Synthetic fixture cleanup failed.",
);
console.log(
  JSON.stringify({
    suite: "w4-dedicated-staging-temporary-synthetic-shadow",
    passed: true,
    projectId,
    fixtureSetupWrites,
    recoveredCleanupWrites,
    sourceMutationCountDuringMigration: 0,
    targetMutationCount: 0,
    cleanupWrites,
    remainingFixtureCount: 0,
    productionAccess: 0,
  }),
);
