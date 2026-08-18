import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w6b";
assert.notEqual(projectId, PRODUCTION_PROJECT_ID, "Production rules verification is forbidden.");
assert.match(projectId, /^demo-/u, "W6B rules verification requires a demo-* project.");

const rules = readFileSync(resolve("firestore.rules"), "utf8");
const authTime = Math.floor(Date.now() / 1000) - 5;
const adminUid = "w6b-admin";
const teacherUid = "w6b-teacher";
const studentUid = "w6b-student";

const canonicalCollections = [
  "semester_grade_records",
  "semester_grade_versions",
  "semester_grade_requests",
  "semester_grade_attestations",
  "grade_legacy_issues",
];
const canonicalPaths = canonicalCollections.map((name) => `${name}/w6b-seed`);
const previousBundlePaths = [
  "semester_assessment_submissions/w6b-source",
  "semester_assessment_results/w6b-source",
];
const legacyPaths = [
  `users/${studentUid}/performance_score_consents/current`,
  `users/${studentUid}/performance_scores/legacy-score`,
  `users/${studentUid}/performance_scores/legacy-score/confirmations/${studentUid}`,
  "grading_plans/legacy-plan",
  "exam_config/legacy-config",
  "performance_score_rosters/legacy-roster",
  "assessment_config/performance_score",
  "years/2026/semesters/2/grading_plans/legacy-plan",
  "years/2026/semesters/2/exam_config/legacy-config",
  "years/2026/semesters/2/performance_score_rosters/legacy-roster",
  "years/2026/semesters/2/assessment_config/performance_score",
  "years/2026/semesters/2/performance_score_objections/legacy-objection",
  "years/2026/semesters/2/performance_score_answer_sheet_requests/legacy-request",
];

const session = (uid) => ({
  uid,
  authTime,
  status: "active",
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "b".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
  highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
});

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8080, rules },
});

try {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users", adminUid), {
        role: "admin",
        teacherPortalEnabled: true,
        staffPermissions: ["student_list_read"],
      }),
      setDoc(doc(db, "users", teacherUid), {
        role: "teacher",
        teacherPortalEnabled: true,
        staffPermissions: ["student_list_read"],
      }),
      setDoc(doc(db, "users", studentUid), { role: "student" }),
      setDoc(
        doc(db, "application_sessions", adminUid, "sessions", String(authTime)),
        session(adminUid),
      ),
      setDoc(
        doc(db, "application_sessions", teacherUid, "sessions", String(authTime)),
        session(teacherUid),
      ),
      setDoc(
        doc(db, "application_sessions", studentUid, "sessions", String(authTime)),
        session(studentUid),
      ),
      ...[...canonicalPaths, ...previousBundlePaths, ...legacyPaths].map((path) =>
        setDoc(doc(db, path), {
          uid: studentUid,
          studentUid,
          ownerUid: studentUid,
          rosterId: "legacy-score",
          scoreKind: "performance",
          marker: "seed",
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
  const teacherDb = testEnv
    .authenticatedContext(teacherUid, {
      email: "w6b-teacher@yongshin-ms.ms.kr",
      auth_time: authTime,
    })
    .firestore();
  const studentDb = testEnv
    .authenticatedContext(studentUid, {
      email: "w6b-student@yongshin-ms.ms.kr",
      auth_time: authTime,
    })
    .firestore();
  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  const actorDatabases = [adminDb, teacherDb, studentDb, anonymousDb];

  let deniedOperations = 0;
  for (const database of actorDatabases) {
    for (const path of [...canonicalPaths, ...previousBundlePaths]) {
      await assertFails(getDoc(doc(database, path)));
      await assertFails(setDoc(doc(database, `${path}-create`), { marker: "create" }));
      await assertFails(updateDoc(doc(database, path), { marker: "update" }));
      await assertFails(deleteDoc(doc(database, path)));
      deniedOperations += 4;
    }
    for (const collectionName of canonicalCollections) {
      await assertFails(getDocs(collection(database, collectionName)));
      deniedOperations += 1;
    }
  }

  for (const database of [adminDb, teacherDb, studentDb]) {
    for (const path of legacyPaths) {
      const fixedPerformanceConfig = path.endsWith("assessment_config/performance_score");
      if (!fixedPerformanceConfig) {
        await assertFails(setDoc(doc(database, `${path}-create`), { marker: "create" }));
        deniedOperations += 1;
      }
      await assertFails(updateDoc(doc(database, path), { marker: "update" }));
      await assertFails(deleteDoc(doc(database, path)));
      deniedOperations += 2;
    }
  }

  await assertSucceeds(
    getDoc(doc(studentDb, `users/${studentUid}/performance_score_consents/current`)),
  );
  await assertSucceeds(
    getDoc(doc(studentDb, `users/${studentUid}/performance_scores/legacy-score`)),
  );
  await assertFails(getDoc(doc(studentDb, "exam_config/legacy-config")));
  await assertFails(
    getDoc(
      doc(
        studentDb,
        "years/2026/semesters/2/exam_config/legacy-config",
      ),
    ),
  );
  await assertFails(getDocs(collection(studentDb, "exam_config")));
  await assertFails(
    getDocs(
      collection(studentDb, "years/2026/semesters/2/exam_config"),
    ),
  );
  deniedOperations += 4;
  await assertSucceeds(getDoc(doc(teacherDb, "exam_config/legacy-config")));
  await assertSucceeds(getDoc(doc(adminDb, "exam_config/legacy-config")));
  await assertSucceeds(
    getDoc(
      doc(
        teacherDb,
        "years/2026/semesters/2/exam_config/legacy-config",
      ),
    ),
  );
  await assertSucceeds(
    getDoc(
      doc(
        adminDb,
        "years/2026/semesters/2/exam_config/legacy-config",
      ),
    ),
  );
  await assertSucceeds(getDoc(doc(teacherDb, "performance_score_rosters/legacy-roster")));
  await assertSucceeds(
    getDoc(
      doc(
        teacherDb,
        "years/2026/semesters/2/performance_score_answer_sheet_requests/legacy-request",
      ),
    ),
  );

  console.log(
    JSON.stringify({
      suite: "w6b-grade-rules",
      passed: true,
      cases: [
        "CANONICAL_GRADE_COLLECTIONS_SERVER_ONLY",
        "CANONICAL_GRADE_LIST_QUERY_DENIED",
        "W6A_SUBMISSION_RESULT_SERVER_ONLY_REGRESSION",
        "LEGACY_SCORE_CONFIRMATION_CONSENT_WRITES_DENIED",
        "LEGACY_PLAN_CONFIG_ROSTER_WRITES_DENIED_ROOT_AND_SCOPED",
        "LEGACY_REQUEST_AND_OBJECTION_WRITES_DENIED",
        "LEGACY_READ_ONLY_PROJECTION_PRESERVED",
        "EXAM_ANSWER_CONFIG_STUDENT_GET_LIST_DENIED",
        "EXAM_ANSWER_CONFIG_TEACHER_ADMIN_READ_ALLOWED",
        "ADMIN_TEACHER_STUDENT_ANONYMOUS_DIRECT_SDK_BYPASS_DENIED",
      ],
      deniedOperations,
      productionAccess: 0,
    }),
  );
} finally {
  await testEnv.cleanup();
}
