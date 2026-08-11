import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const args = process.argv.slice(2);
const verifyLive = args.includes("--verify-live");
const projectId = String(
  args
    .find((value) => value.startsWith("--project="))
    ?.slice("--project=".length) || "",
).trim();
assert.notEqual(
  projectId,
  PRODUCTION_PROJECT_ID,
  "Production shadow migration is forbidden.",
);
assert.equal(
  projectId,
  STAGING_PROJECT_ID,
  `W4 shadow migration requires exact --project=${STAGING_PROJECT_ID}.`,
);
assert.equal(
  args.includes("--apply"),
  false,
  "This mapper is dry-run only. Apply through importEnrollmentRoster so receipt and audit remain authoritative.",
);

const canonicalize = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
};
const sha256 = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const text = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim();
const classKey = (grade, classNumber) =>
  `${text(grade).toLowerCase()}::${text(classNumber).toLowerCase()}`;

const staticFixture = [
  {
    uid: "synthetic-student-001",
    displayName: "합성 학생 001",
    grade: "1",
    classNumber: "1",
    studentNumber: "1",
    homeroomTeacherUid: "synthetic-teacher-001",
  },
  {
    uid: "synthetic-student-002",
    displayName: "합성 학생 002",
    grade: "1",
    classNumber: "1",
    studentNumber: "2",
    homeroomTeacherUid: "synthetic-teacher-001",
  },
  {
    uid: "synthetic-student-003",
    displayName: "합성 학생 003",
    grade: "1",
    classNumber: "2",
    studentNumber: "1",
    homeroomTeacherUid: "synthetic-teacher-002",
  },
];

const loadSyntheticLegacyUsers = async () => {
  if (!verifyLive) {
    return {
      users: staticFixture,
      teacherUids: new Set(["synthetic-teacher-001", "synthetic-teacher-002"]),
    };
  }
  const requireFromFunctions = createRequire(resolve("functions/package.json"));
  const { applicationDefault, getApps, initializeApp } =
    requireFromFunctions("firebase-admin/app");
  const { getFirestore } = requireFromFunctions("firebase-admin/firestore");
  const app =
    getApps().find((candidate) => candidate.name === "w4-shadow-migration") ||
    initializeApp(
      { credential: applicationDefault(), projectId },
      "w4-shadow-migration",
    );
  const db = getFirestore(app);
  const snapshot = await db
    .collection("users")
    .where("w4SyntheticFixture", "==", true)
    .get();
  const teacherUids = new Set(
    snapshot.docs
      .filter(
        (document) => String(document.data()?.role || "student") === "teacher",
      )
      .map((document) => document.id),
  );
  const users = snapshot.docs
    .filter(
      (document) => String(document.data()?.role || "student") !== "teacher",
    )
    .map((document) => ({
      uid: document.id,
      displayName: text(document.data()?.studentName || document.data()?.name),
      grade: text(document.data()?.studentGrade || document.data()?.grade),
      classNumber: text(
        document.data()?.studentClass || document.data()?.class,
      ),
      studentNumber: text(
        document.data()?.studentNumber || document.data()?.number,
      ),
      homeroomTeacherUid: text(document.data()?.w4HomeroomTeacherUid),
    }));
  return { users, teacherUids };
};

const { users, teacherUids } = await loadSyntheticLegacyUsers();
const duplicateStudentCount =
  users.length - new Set(users.map((item) => item.uid)).size;
const missingIdentityCount = users.filter(
  (item) => !item.uid || !item.displayName,
).length;
const missingClassFieldCount = users.filter(
  (item) => !item.grade || !item.classNumber || !item.studentNumber,
).length;
const orphanTeacherCount = users.filter(
  (item) =>
    !item.homeroomTeacherUid || !teacherUids.has(item.homeroomTeacherUid),
).length;
const classDefinitions = new Map();
users.forEach((item) => {
  const key = classKey(item.grade, item.classNumber);
  const existing = classDefinitions.get(key);
  if (!existing) {
    classDefinitions.set(key, {
      grade: item.grade,
      classNumber: item.classNumber,
      displayName: `${item.grade}학년 ${item.classNumber}반`,
      homeroomTeacherUid: item.homeroomTeacherUid,
    });
  }
});
const duplicateStudentNumberCount =
  users.length -
  new Set(
    users.map(
      (item) =>
        `${classKey(item.grade, item.classNumber)}::${item.studentNumber}`,
    ),
  ).size;
const blockingIssueCount =
  duplicateStudentCount +
  missingIdentityCount +
  missingClassFieldCount +
  orphanTeacherCount +
  duplicateStudentNumberCount;
const mapping = {
  semesterId: "2026-2",
  expectedStudentUids: users.map((item) => item.uid).sort(),
  classes: [...classDefinitions.values()].sort((left, right) =>
    classKey(left.grade, left.classNumber).localeCompare(
      classKey(right.grade, right.classNumber),
    ),
  ),
  entries: users
    .map((item) => ({
      studentUid: item.uid,
      displayName: item.displayName,
      classKey: classKey(item.grade, item.classNumber),
      studentNumber: item.studentNumber,
    }))
    .sort((left, right) => left.studentUid.localeCompare(right.studentUid)),
};
const sourceHash = sha256(canonicalize(mapping));

console.log(
  JSON.stringify(
    {
      suite: "w4-shadow-migration-dry-run",
      passed: blockingIssueCount === 0,
      mode: verifyLive
        ? "DEDICATED_STAGING_LIVE_SYNTHETIC_READ_ONLY"
        : "STATIC_SYNTHETIC_DRY_RUN",
      projectId,
      sourceCollection: "users where w4SyntheticFixture == true",
      sourceMutationCount: 0,
      targetMutationCount: 0,
      expectedStudentCount: users.length,
      expectedClassCount: classDefinitions.size,
      expectedEnrollmentCount: users.length,
      duplicateStudentCount,
      duplicateStudentNumberCount,
      orphanTeacherCount,
      missingIdentityCount,
      missingClassFieldCount,
      blockingIssueCount,
      sourceHash,
      applyContract: "previewEnrollmentRoster -> importEnrollmentRoster",
      idempotency:
        "rosterId + importRevision + sourceHash + Command Gateway receipt",
      resumeContract: "getCommandStatus(commandId, importEnrollmentRoster)",
      rollbackContract:
        "do not mutate source; remove only migration-owned canonical fixture documents before activation",
      productionAccess: 0,
    },
    null,
    2,
  ),
);

if (blockingIssueCount !== 0) process.exitCode = 1;
