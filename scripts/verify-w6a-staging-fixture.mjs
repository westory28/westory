import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const FIXTURE_OWNER = "w6a-staging-browser-2026-08-11";
const SEMESTER_ID = "2026-2";
const STUDENT_UID = "w6a-staging-student-20260811";
const TEACHER_UID = "w6a-staging-teacher-20260811";
const STUDENT_EMAIL = "w6a.staging.student@yongshin-ms.ms.kr";
const TEACHER_EMAIL = "w6a.staging.teacher@yongshin-ms.ms.kr";
const CLASS_ID = "class_w6a_staging_3_1";
const ENROLLMENT_ID = "enr_w6a_staging_student";
const UNIT_ID = "w6a-staging-unit";
const QUESTION_ID = "900001";
const QUIZ_DEFINITION_ID = `quiz:${SEMESTER_ID}:${UNIT_ID}:formative`;
const HISTORY_SOURCE_ID = "w6a-staging-history";
const HISTORY_DEFINITION_ID = `history_classroom:${SEMESTER_ID}:${HISTORY_SOURCE_ID}`;
const CONFIG_KEY = `${UNIT_ID}_formative`;
const OBSOLETE_FIXTURE_CONFIG_KEY = `${UNIT_ID}::formative`;

const args = process.argv.slice(2);
const projectId = String(
  args.find((value) => value.startsWith("--project="))?.slice(10) || "",
).trim();
const setup = args.includes("--setup");
const cleanup = args.includes("--cleanup");
const password = String(process.env.WESTORY_W6A_STAGING_PASSWORD || "");

assert.notEqual(projectId, PRODUCTION_PROJECT_ID, "Production fixture access is forbidden.");
assert.equal(projectId, STAGING_PROJECT_ID, `Exact --project=${STAGING_PROJECT_ID} is required.`);
assert.notEqual(setup, cleanup, "Choose exactly one of --setup or --cleanup.");
if (setup) {
  assert.match(password, /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16,}$/);
}

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const { applicationDefault, getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
const { getAuth } = requireFromFunctions("firebase-admin/auth");
const { FieldValue, getFirestore } = requireFromFunctions("firebase-admin/firestore");
const app =
  getApps().find((candidate) => candidate.name === "w6a-staging-browser-fixture") ||
  initializeApp(
    { credential: applicationDefault(), projectId },
    "w6a-staging-browser-fixture",
  );
const auth = getAuth(app);
const db = getFirestore(app);

const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
};
const slotId = `slot_${sha256(`${SEMESTER_ID}\n${STUDENT_UID}`).slice(0, 40)}`;

const ownedPaths = [
  `users/${STUDENT_UID}`,
  `users/${TEACHER_UID}`,
  `semester_classes/${CLASS_ID}`,
  `semester_enrollments/${ENROLLMENT_ID}`,
  `semester_enrollment_slots/${slotId}`,
  `years/2026/semesters/2/quiz_questions/${QUESTION_ID}`,
  `years/2026/semesters/2/history_classrooms/${HISTORY_SOURCE_ID}`,
  `semester_assessment_definitions/${QUIZ_DEFINITION_ID}`,
  `semester_assessment_definitions/${HISTORY_DEFINITION_ID}`,
];

const deleteQuery = async (collectionName, field, value) => {
  const snapshots = await db.collection(collectionName).where(field, "==", value).get();
  if (snapshots.empty) return 0;
  const batch = db.batch();
  snapshots.docs.forEach((snapshot) => batch.delete(snapshot.ref));
  await batch.commit();
  return snapshots.size;
};

const cleanupFixture = async () => {
  let deletedBusinessDocuments = 0;
  for (const collectionName of [
    "semester_assessment_attempts",
    "semester_assessment_submissions",
    "semester_assessment_results",
    "command_receipts",
    "command_audit_events",
  ]) {
    deletedBusinessDocuments += await deleteQuery(collectionName, "actorUid", STUDENT_UID);
    deletedBusinessDocuments += await deleteQuery(collectionName, "studentUid", STUDENT_UID);
    deletedBusinessDocuments += await deleteQuery(collectionName, "actorUid", TEACHER_UID);
  }
  deletedBusinessDocuments += await deleteQuery(
    "years/2026/semesters/2/point_transactions",
    "uid",
    STUDENT_UID,
  );

  const pointWalletRef = db.doc(
    `years/2026/semesters/2/point_wallets/${STUDENT_UID}`,
  );
  const pointWallet = await pointWalletRef.get();
  if (pointWallet.exists) {
    assert.equal(pointWallet.data()?.uid, STUDENT_UID);
    await pointWalletRef.delete();
    deletedBusinessDocuments += 1;
  }

  for (const uid of [STUDENT_UID, TEACHER_UID]) {
    const sessions = await db.collection(`application_sessions/${uid}/sessions`).get();
    if (!sessions.empty) {
      const batch = db.batch();
      sessions.docs.forEach((snapshot) => batch.delete(snapshot.ref));
      await batch.commit();
      deletedBusinessDocuments += sessions.size;
    }
  }

  const snapshots = await db.getAll(...ownedPaths.map((path) => db.doc(path)));
  const owned = snapshots.filter(
    (snapshot) => snapshot.exists && snapshot.data()?.w6aFixtureOwner === FIXTURE_OWNER,
  );
  if (owned.length) {
    const batch = db.batch();
    owned.forEach((snapshot) => batch.delete(snapshot.ref));
    await batch.commit();
  }
  await db
    .doc("years/2026/semesters/2/assessment_config/settings")
    .update({
      [CONFIG_KEY]: FieldValue.delete(),
      [OBSOLETE_FIXTURE_CONFIG_KEY]: FieldValue.delete(),
    })
    .catch((error) => {
      if (error?.code !== 5) throw error;
    });

  let deletedAuthUsers = 0;
  for (const uid of [STUDENT_UID, TEACHER_UID]) {
    try {
      const user = await auth.getUser(uid);
      assert.equal(user.customClaims?.w6aFixtureOwner, FIXTURE_OWNER);
      await auth.deleteUser(uid);
      deletedAuthUsers += 1;
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
  return { deletedBusinessDocuments, deletedOwnedDocuments: owned.length, deletedAuthUsers };
};

if (cleanup) {
  const result = await cleanupFixture();
  console.log(JSON.stringify({ suite: "w6a-staging-browser-fixture-cleanup", passed: true, projectId, ...result, productionAccess: 0 }));
  process.exit(0);
}

await cleanupFixture();
for (const user of [
  { uid: STUDENT_UID, email: STUDENT_EMAIL, displayName: "W6A 합성 학생" },
  { uid: TEACHER_UID, email: TEACHER_EMAIL, displayName: "W6A 합성 교사" },
]) {
  await auth.createUser({ ...user, password, emailVerified: true });
  await auth.setCustomUserClaims(user.uid, { w6aFixtureOwner: FIXTURE_OWNER });
}

const question = {
  id: Number(QUESTION_ID),
  unitId: UNIT_ID,
  subUnitId: null,
  category: "formative",
  type: "choice",
  question: "W6A 합성 평가 문항입니다. 정답을 선택해 주세요.",
  answer: "정답",
  options: ["정답", "오답"],
  explanation: "합성 평가 검증용 설명입니다.",
  contentRevision: 1,
  w6aFixtureOwner: FIXTURE_OWNER,
};
const quizAnswerKey = [{ id: QUESTION_ID, answer: "정답", sourceRevision: "1" }];
const historyAnswerKey = [{ id: "blank-1", answer: "고려" }];
const historyAssignedStudents = [STUDENT_UID];
const now = new Date().toISOString();
const batch = db.batch();
const createOwned = (path, value) =>
  batch.create(db.doc(path), { ...value, w6aFixtureOwner: FIXTURE_OWNER });
createOwned(`users/${STUDENT_UID}`, {
  uid: STUDENT_UID,
  email: STUDENT_EMAIL,
  role: "student",
  name: "합성학생",
  grade: "3",
  class: "1",
  number: "39",
  customNameConfirmed: true,
  privacyAgreed: true,
  consentAgreedItems: [],
  studentName: "W6A 합성 학생",
  studentGrade: "3",
  studentClass: "1",
  studentNumber: "99",
});
createOwned(`users/${TEACHER_UID}`, {
  uid: TEACHER_UID,
  email: TEACHER_EMAIL,
  role: "teacher",
  teacherPortalEnabled: true,
  name: "W6A 합성 교사",
  permissions: { quiz_read: true, lesson_read: true },
});
createOwned(`semester_classes/${CLASS_ID}`, {
  classId: CLASS_ID,
  semesterId: SEMESTER_ID,
  grade: "3",
  classNumber: "1",
  displayName: "3학년 1반 (W6A 합성)",
  homeroomTeacherUid: TEACHER_UID,
  status: "ACTIVE",
});
createOwned(`semester_enrollments/${ENROLLMENT_ID}`, {
  enrollmentId: ENROLLMENT_ID,
  semesterId: SEMESTER_ID,
  studentUid: STUDENT_UID,
  classId: CLASS_ID,
  enrollmentStatus: "ACTIVE",
  effectiveFrom: "2026-08-01",
  provenance: "CURRENT",
});
createOwned(`semester_enrollment_slots/${slotId}`, {
  slotId,
  semesterId: SEMESTER_ID,
  studentUid: STUDENT_UID,
  activeEnrollmentId: ENROLLMENT_ID,
});
createOwned(`years/2026/semesters/2/quiz_questions/${QUESTION_ID}`, question);
createOwned(`years/2026/semesters/2/history_classrooms/${HISTORY_SOURCE_ID}`, {
  title: "W6A 합성 역사교실",
  description: "Dedicated Staging 전용 합성 과제입니다.",
  blanks: historyAnswerKey,
  targetStudentUid: STUDENT_UID,
  targetStudentUids: historyAssignedStudents,
  targetStudentAccessMap: { [STUDENT_UID]: true },
  isPublished: true,
  publishedAt: now,
  dueAt: "2026-12-31T23:59:59.000Z",
  contentRevision: 1,
});
createOwned(`semester_assessment_definitions/${QUIZ_DEFINITION_ID}`, {
  definitionId: QUIZ_DEFINITION_ID,
  semesterId: SEMESTER_ID,
  assessmentKind: "QUIZ",
  title: "W6A 합성 형성평가",
  sourceId: UNIT_ID,
  category: "formative",
  questionCount: 1,
  durationSeconds: 600,
  maxAttempts: 3,
  cooldownMinutes: 0,
  opensAt: "",
  closesAt: "",
  assignedClassIds: [CLASS_ID],
  status: "PUBLISHED",
  revision: 1,
  itemCount: 1,
  sourceHash: sha256(canonicalJson(quizAnswerKey)),
  provenance: "CURRENT",
});
createOwned(`semester_assessment_definitions/${HISTORY_DEFINITION_ID}`, {
  definitionId: HISTORY_DEFINITION_ID,
  semesterId: SEMESTER_ID,
  assessmentKind: "HISTORY_CLASSROOM",
  title: "W6A 합성 역사교실",
  sourceId: HISTORY_SOURCE_ID,
  durationSeconds: 600,
  maxAttempts: 3,
  cooldownMinutes: 0,
  opensAt: "",
  closesAt: "",
  assignedClassIds: [],
  status: "PUBLISHED",
  revision: 1,
  itemCount: 1,
  sourceHash: sha256(canonicalJson({ answerKey: historyAnswerKey, assignedStudentUids: historyAssignedStudents })),
  provenance: "CURRENT",
});
await batch.commit();
await db.doc("years/2026/semesters/2/assessment_config/settings").set(
  {
    [CONFIG_KEY]: {
      active: true,
      questionCount: 1,
      randomOrder: false,
      questionOrder: "created",
      timeLimit: 600,
      allowRetake: true,
      cooldown: 0,
      hintLimit: 0,
      visibleTargetGrade: "3",
      visibleClassIds: ["3-1"],
      visibilityVersion: 2,
    },
  },
  { merge: true },
);

console.log(
  JSON.stringify({
    suite: "w6a-staging-browser-fixture-setup",
    passed: true,
    projectId,
    studentEmail: STUDENT_EMAIL,
    teacherEmail: TEACHER_EMAIL,
    quizRoute: `/student/quiz/run?unitId=${UNIT_ID}&category=formative&title=W6A%20합성%20평가`,
    historyRoute: `/student/history-classroom/run?id=${HISTORY_SOURCE_ID}`,
    fixtureDocumentCount: ownedPaths.length,
    productionAccess: 0,
  }),
);
