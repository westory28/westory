import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, Timestamp, updateDoc } from "firebase/firestore";

const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w6a";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const authTime = Math.floor(Date.now() / 1000) - 5;
const adminUid = "w6a-admin";
const studentUid = "w6a-student";

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8080, rules },
});

const session = (uid, email) => ({
  uid,
  email,
  authTime,
  status: "active",
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "a".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
  highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
});

const protectedPaths = [
  "semester_assessment_definitions/definition-one",
  "semester_assessment_attempts/attempt-one",
  "semester_assessment_submissions/submission-one",
  "semester_assessment_results/result-one",
  "assessment_legacy_issues/issue-one",
  "quiz_results/result-one",
  "quiz_submissions/submission-one",
  "history_classroom_results/result-one",
  "years/2026/semesters/2/quiz_results/result-one",
  "years/2026/semesters/2/quiz_submissions/submission-one",
  "years/2026/semesters/2/history_classroom_results/result-one",
  "quiz_questions/question-one",
  "history_classrooms/source-one",
  "assessment_config/settings",
  "years/2026/semesters/2/quiz_questions/question-one",
  "years/2026/semesters/2/history_classrooms/source-one",
  "years/2026/semesters/2/assessment_config/settings",
];

const mapPaths = [
  "map_resources/map-one",
  "years/2026/semesters/2/map_resources/map-one",
];

const createOnlyPaths = [
  "years/2027/semesters/1/quiz_questions/question-new",
  "years/2027/semesters/1/history_classrooms/source-new",
  "years/2027/semesters/1/assessment_config/settings",
];

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await deleteDoc(doc(db, "site_settings", "student_maintenance"));
    await Promise.all([
      setDoc(doc(db, "users", adminUid), {
        role: "admin",
        teacherPortalEnabled: true,
      }),
      setDoc(doc(db, "users", studentUid), { role: "student" }),
      setDoc(
        doc(db, "application_sessions", adminUid, "sessions", String(authTime)),
        session(adminUid, "westoria28@gmail.com"),
      ),
      setDoc(
        doc(db, "application_sessions", studentUid, "sessions", String(authTime)),
        session(studentUid, "student@example.test"),
      ),
      ...protectedPaths.map((path) =>
        setDoc(doc(db, path), { ownerUid: studentUid, marker: "seed" }),
      ),
      ...mapPaths.map((path) =>
        setDoc(doc(db, path), {
          marker: "seed",
          pdfBlanks: [],
          answerOptions: [],
          contentRevision: 0,
        }),
      ),
    ]);
  });

  const adminDb = testEnv
    .authenticatedContext(adminUid, {
      email: "westoria28@gmail.com",
      auth_time: authTime,
    })
    .firestore();
  const studentDb = testEnv
    .authenticatedContext(studentUid, {
      email: "student@example.test",
      auth_time: authTime,
    })
    .firestore();
  const anonymousDb = testEnv.unauthenticatedContext().firestore();

  let deniedOperations = 0;
  for (const database of [adminDb, studentDb, anonymousDb]) {
    for (const path of protectedPaths) {
      if (!path.endsWith("/assessment_config/settings") && path !== "assessment_config/settings") {
        await assertFails(setDoc(doc(database, `${path}-create`), { marker: "create" }));
        deniedOperations += 1;
      }
      await assertFails(updateDoc(doc(database, path), { marker: "update" }));
      await assertFails(deleteDoc(doc(database, path)));
      deniedOperations += 2;
    }
  }

  for (const path of createOnlyPaths) {
    await assertFails(setDoc(doc(adminDb, path), { marker: "create" }));
    deniedOperations += 1;
  }

  for (const path of mapPaths) {
    await assertFails(updateDoc(doc(adminDb, path), {
      pdfBlanks: [{ id: "blank-one", answer: "정답" }],
      answerOptions: ["정답"],
      contentRevision: 1,
    }));
    await assertSucceeds(updateDoc(doc(adminDb, path), { marker: "metadata-update" }));
    deniedOperations += 1;
  }

  for (const collectionName of [
    "semester_assessment_definitions",
    "semester_assessment_attempts",
    "semester_assessment_submissions",
    "semester_assessment_results",
    "assessment_legacy_issues",
  ]) {
    const documentId =
      collectionName === "semester_assessment_definitions"
        ? "definition-one"
        : collectionName === "semester_assessment_attempts"
          ? "attempt-one"
          : collectionName === "semester_assessment_submissions"
            ? "submission-one"
            : collectionName === "assessment_legacy_issues"
              ? "issue-one"
              : "result-one";
    await assertFails(getDoc(doc(adminDb, collectionName, documentId)));
    await assertFails(getDoc(doc(studentDb, collectionName, documentId)));
  }

  console.log(JSON.stringify({
    suite: "w6a-assessment-rules",
    passed: true,
    cases: [
      "CANONICAL_ASSESSMENT_COLLECTIONS_SERVER_ONLY",
      "LEGACY_ISSUE_COLLECTION_SERVER_ONLY",
      "LEGACY_ROOT_RESULT_WRITES_DENIED",
      "LEGACY_SEMESTER_RESULT_WRITES_DENIED",
      "ADMIN_STUDENT_ANONYMOUS_DIRECT_SDK_BYPASS_DENIED",
      "TEACHER_ASSESSMENT_SOURCE_WRITES_GATEWAY_ONLY",
      "MAP_BLANK_FIELDS_GATEWAY_ONLY_WITH_UNRELATED_METADATA_PRESERVED",
    ],
    deniedOperations,
    productionAccess: 0,
  }));
} finally {
  await testEnv.cleanup();
}
