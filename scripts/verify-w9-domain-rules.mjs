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

const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w9";
assert.equal(projectId, "demo-westory-session-w9");
assert.notEqual(projectId, "history-quiz-yongsin");

const rules = readFileSync(resolve("firestore.rules"), "utf8");
const authTime = Math.floor(Date.now() / 1000) - 5;
const studentUid = "w9-rules-student";
const teacherUid = "w9-rules-teacher";
const canonicalCollections = ["teacher_drafts", "teacher_bulk_jobs"];
const session = (uid) => ({
  uid,
  authTime,
  status: "active",
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "9".repeat(64),
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
        staffPermissions: ["lesson_read"],
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
          ownerUid: teacherUid,
          fixtureOwner: "w9-rules",
        }),
      ),
    ]);
  });

  const contexts = [
    env.authenticatedContext(studentUid, {
      email: "w9-rules-student@yongshin-ms.ms.kr",
      auth_time: authTime,
    }).firestore(),
    env.authenticatedContext(teacherUid, {
      email: "w9-rules-teacher@yongshin-ms.ms.kr",
      auth_time: authTime,
    }).firestore(),
    env.authenticatedContext("w9-rules-admin", {
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

  console.log(
    JSON.stringify({
      suite: "w9-domain-rules",
      passed: true,
      canonicalCollections: canonicalCollections.length,
      deniedOperations,
      ownerCrossUidDirectReadDenied: true,
      previousBundleDirectSdkDenied: true,
      productionAccess: 0,
    }),
  );
} finally {
  await env.cleanup();
}
