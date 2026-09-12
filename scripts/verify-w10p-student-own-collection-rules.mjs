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
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID ||
  "demo-westory-session-w10p-student-own-collections";
assert.equal(projectId, "demo-westory-session-w10p-student-own-collections");
assert.notEqual(projectId, "history-quiz-yongsin");
assert.notEqual(projectId, "westory-staging-177587430482");

const rules = readFileSync(resolve("firestore.rules"), "utf8");
const authTime = Math.floor(Date.now() / 1000) - 5;
const studentUid = "w10p-visual-student";
const otherStudentUid = "w10p-other-student";

const activeSession = (uid) => ({
  uid,
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

const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: Number(process.env.CONTENT_RULES_FIRESTORE_PORT || 8080), rules },
});

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "site_settings/config"), { year: "2026", semester: "2" });
    await setDoc(doc(db, "site_settings/semester_active"), { semesterId: "2026-2", revision: 4 });
    await setDoc(doc(db, "semester_manifests/2026-2"), { semesterId: "2026-2", status: "ACTIVE", revision: 4 });

    await Promise.all([
      setDoc(doc(db, "users", studentUid), {
        uid: studentUid,
        email: "w10p-visual-student@yongshin-ms.ms.kr",
        role: "student",
        fixtureOwner: "w10p-visual-parity",
        fixtureId: "w10p-visual-fixture-v1",
      }),
      setDoc(doc(db, "users", otherStudentUid), {
        uid: otherStudentUid,
        email: "w10p-other-student@yongshin-ms.ms.kr",
        role: "student",
      }),
      setDoc(
        doc(
          db,
          "application_sessions",
          studentUid,
          "sessions",
          String(authTime),
        ),
        activeSession(studentUid),
      ),
      setDoc(doc(db, "site_settings", "student_maintenance"), {
        enabled: false,
        blockedRoles: ["student"],
        bypassUids: [],
        title: "점검 안내",
        message: "현재 점검 중이 아닙니다.",
        startedAt: null,
        updatedAt: Timestamp.now(),
        updatedBy: "w10p-rules-test",
        revision: 0,
      }),
      setDoc(doc(db, "users", studentUid, "attendance", "2026_2_fixture"), {
        uid: studentUid,
        scope: "2026_2",
      }),
      setDoc(
        doc(db, "years/2026/semesters/2/dictionary_students", studentUid, "history_dictionary_words", "fixture"),
        {
          uid: studentUid,
          updatedAt: Timestamp.now(),
        },
      ),
      setDoc(doc(db, "users", otherStudentUid, "attendance", "2026_2_other"), {
        uid: otherStudentUid,
        scope: "2026_2",
      }),
      setDoc(
        doc(db, "years/2026/semesters/2/dictionary_students", otherStudentUid, "history_dictionary_words", "other"),
        {
          uid: otherStudentUid,
          updatedAt: Timestamp.now(),
        },
      ),
    ]);
  });

  const claims = {
    email: "w10p-visual-student@yongshin-ms.ms.kr",
    auth_time: authTime,
    fixtureOwner: "w10p-visual-parity",
    fixtureId: "w10p-visual-fixture-v1",
    fixtureRole: "student",
  };
  const studentDb = env.authenticatedContext(studentUid, claims).firestore();
  const attendanceQuery = query(
    collection(studentDb, "users", studentUid, "attendance"),
    where("scope", "==", "2026_2"),
  );
  const historyQuery = query(
    collection(studentDb, "years/2026/semesters/2/dictionary_students", studentUid, "history_dictionary_words"),
    orderBy("updatedAt", "desc"),
    limit(20),
  );

  const attendanceResult = await assertSucceeds(getDocs(attendanceQuery));
  const historyResult = await assertSucceeds(getDocs(historyQuery));
  assert.equal(attendanceResult.size, 1);
  assert.equal(historyResult.size, 1);

  await assertFails(
    getDocs(collection(studentDb, "users", otherStudentUid, "attendance")),
  );
  await assertFails(
    getDocs(
      collection(
        studentDb,
        "years/2026/semesters/2/dictionary_students",
        otherStudentUid,
        "history_dictionary_words",
      ),
    ),
  );
  await assertFails(
    setDoc(doc(studentDb, "users", studentUid, "attendance", "forbidden"), {
      uid: studentUid,
      scope: "2026_2",
    }),
  );
  await assertFails(
    setDoc(
      doc(
        studentDb,
        "years/2026/semesters/2/dictionary_students",
        studentUid,
        "history_dictionary_words",
        "forbidden",
      ),
      {
        uid: studentUid,
        updatedAt: Timestamp.now(),
      },
    ),
  );

  const noSessionDb = env
    .authenticatedContext("w10p-no-session-student", {
      email: "w10p-no-session-student@yongshin-ms.ms.kr",
      auth_time: authTime,
    })
    .firestore();
  await assertFails(
    getDocs(
      collection(noSessionDb, "users", "w10p-no-session-student", "attendance"),
    ),
  );
  await assertFails(
    getDocs(
      collection(
        noSessionDb,
        "years/2026/semesters/2/dictionary_students",
        "w10p-no-session-student",
        "history_dictionary_words",
      ),
    ),
  );

  console.log(
    JSON.stringify({
      suite: "w10p-student-own-collection-rules",
      passed: true,
      positiveQueries: 2,
      deniedCrossUserReads: 2,
      deniedWrites: 2,
      deniedWithoutSession: 2,
      productionAccess: 0,
      stagingAccess: 0,
    }),
  );
} finally {
  await env.cleanup();
}
