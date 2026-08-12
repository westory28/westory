import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
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

const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w8";
assert.equal(projectId, "demo-westory-session-w8");
assert.notEqual(projectId, "history-quiz-yongsin");

const rules = readFileSync(resolve("firestore.rules"), "utf8");
const authTime = Math.floor(Date.now() / 1000) - 5;
const studentUid = "w8-rules-student";
const teacherUid = "w8-rules-teacher";
const canonicalCollections = [
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
];
const legacyPaths = [
  `users/${studentUid}/attendance/legacy`,
  "site_settings/notification_config",
  `lesson_progress/${studentUid}`,
  `lesson_progress/${studentUid}/units/unit`,
  "lessons/lesson",
  "think_cloud_state/current",
  "think_cloud_sessions/session",
  "think_cloud_sessions/session/responses/response",
  "history_classroom_exemptions/exemption",
  "history_classroom_exemption_requests/request",
  "years/2026/semesters/2/calendar/event",
  "years/2026/semesters/2/notices/notice",
  "years/2026/semesters/2/lessons/lesson",
  "years/2026/semesters/2/think_cloud_state/current",
  "years/2026/semesters/2/think_cloud_sessions/session",
  "years/2026/semesters/2/think_cloud_sessions/session/responses/response",
  `years/2026/semesters/2/lesson_progress/${studentUid}`,
  `years/2026/semesters/2/lesson_progress/${studentUid}/units/unit`,
  `years/2026/semesters/2/notification_inboxes/${studentUid}`,
  `years/2026/semesters/2/notification_inboxes/${studentUid}/items/notice`,
  "years/2026/semesters/2/broadcast_notifications/notice",
  "years/2026/semesters/2/history_classroom_exemptions/exemption",
  "years/2026/semesters/2/history_classroom_exemption_requests/request",
];
const session = (uid) => ({
  uid,
  authTime,
  status: "active",
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "8".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
  highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
});

const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8080, rules },
});

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users", studentUid), { role: "student" }),
      setDoc(doc(db, "users", teacherUid), {
        role: "teacher",
        teacherPortalEnabled: true,
      }),
      setDoc(
        doc(db, "application_sessions", studentUid, "sessions", String(authTime)),
        session(studentUid),
      ),
      setDoc(
        doc(db, "application_sessions", teacherUid, "sessions", String(authTime)),
        session(teacherUid),
      ),
      ...canonicalCollections.map((name) =>
        setDoc(doc(db, name, "seed"), {
          semesterId: "2026-2",
          studentUid,
          fixtureOwner: "w8-rules",
        }),
      ),
      ...legacyPaths.map((path) =>
        setDoc(doc(db, path), { semesterId: "2026-2", studentUid }),
      ),
    ]);
  });

  const contexts = [
    env.authenticatedContext(studentUid, {
      email: "w8-rules-student@yongshin-ms.ms.kr",
      auth_time: authTime,
    }).firestore(),
    env.authenticatedContext(teacherUid, {
      email: "w8-rules-teacher@yongshin-ms.ms.kr",
      auth_time: authTime,
    }).firestore(),
    env.authenticatedContext("w8-rules-admin", {
      email: "westoria28@gmail.com",
      auth_time: authTime,
    }).firestore(),
    env.unauthenticatedContext().firestore(),
  ];
  let deniedOperations = 0;
  for (const db of contexts) {
    for (const name of canonicalCollections) {
      await assertFails(getDoc(doc(db, name, "seed")));
      await assertFails(getDocs(collection(db, name)));
      await assertFails(setDoc(doc(db, name, "create"), { marker: true }));
      await assertFails(updateDoc(doc(db, name, "seed"), { marker: true }));
      await assertFails(deleteDoc(doc(db, name, "seed")));
      deniedOperations += 5;
    }
  }
  for (const db of contexts.slice(0, 3)) {
    for (const path of legacyPaths) {
      await assertFails(setDoc(doc(db, `${path}-create`), { marker: true }));
      await assertFails(updateDoc(doc(db, path), { marker: true }));
      await assertFails(deleteDoc(doc(db, path)));
      deniedOperations += 3;
    }
  }

  console.log(
    JSON.stringify({
      suite: "w8-domain-rules",
      passed: true,
      canonicalCollections: canonicalCollections.length,
      legacyPaths: legacyPaths.length,
      deniedOperations,
      previousBundleDirectSdkDenied: true,
      productionAccess: 0,
    }),
  );
} finally {
  await env.cleanup();
}
