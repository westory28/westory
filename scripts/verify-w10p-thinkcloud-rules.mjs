import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
} from "firebase/firestore";

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w10p-thinkcloud";
assert.equal(projectId, "demo-westory-session-w10p-thinkcloud");
assert.notEqual(projectId, "history-quiz-yongsin");

const rules = readFileSync(resolve("firestore.rules"), "utf8");
const authTime = Math.floor(Date.now() / 1000) - 5;
const identities = {
  admin: {
    uid: "w10p-thinkcloud-admin",
    email: "westoria28@gmail.com",
    role: "teacher",
  },
  teacher: {
    uid: "w10p-thinkcloud-teacher",
    email: "w10p.thinkcloud.teacher@yongshin-ms.ms.kr",
    role: "teacher",
    grade: "3",
    class: "1",
  },
  otherTeacher: {
    uid: "w10p-thinkcloud-other-teacher",
    email: "w10p.thinkcloud.other.teacher@yongshin-ms.ms.kr",
    role: "teacher",
    grade: "3",
    class: "2",
  },
  student: {
    uid: "w10p-thinkcloud-student",
    email: "w10p.thinkcloud.student@yongshin-ms.ms.kr",
    role: "student",
    grade: "3",
    class: "1",
  },
  outsider: {
    uid: "w10p-thinkcloud-outsider",
    email: "w10p.thinkcloud.outsider@yongshin-ms.ms.kr",
    role: "student",
    grade: "3",
    class: "2",
  },
  formerStudent: {
    uid: "w10p-thinkcloud-former-student",
    email: "w10p.thinkcloud.former.student@yongshin-ms.ms.kr",
    role: "student",
    grade: "3",
    class: "1",
  },
};

const applicationSession = (uid) => ({
  uid,
  authTime,
  status: "active",
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "c".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
  highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
});

const roots = [
  "think_cloud_sessions",
  "years/2026/semesters/2/think_cloud_sessions",
];

const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8080, rules },
});

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const writes = Object.values(identities).flatMap((identity) => [
      setDoc(doc(db, "users", identity.uid), {
        role: identity.role,
        grade: identity.grade || "",
        class: identity.class || "",
        teacherPortalEnabled: identity.role === "teacher",
        staffPermissions: [],
      }),
      setDoc(
        doc(
          db,
          "application_sessions",
          identity.uid,
          "sessions",
          String(authTime),
        ),
        applicationSession(identity.uid),
      ),
    ]);

    for (const root of roots) {
      for (const [sessionId, anonymous] of [
        ["named", false],
        ["anonymous", true],
      ]) {
        writes.push(
          setDoc(doc(db, root, sessionId), {
            targetGrade: "3",
            targetClass: "1",
            status: "active",
            options: { anonymous },
          }),
          setDoc(doc(db, root, sessionId, "responses", "response-1"), {
            uid: identities.student.uid,
            displayName: "합성학생",
            textRaw: "합성 응답",
            textNormalized: "합성 응답",
          }),
        );
      }
    }
    await Promise.all(writes);
  });

  const clients = Object.fromEntries(
    Object.entries(identities).map(([key, identity]) => [
      key,
      env
        .authenticatedContext(identity.uid, {
          email: identity.email,
          auth_time: authTime,
        })
        .firestore(),
    ]),
  );

  let assertions = 0;
  for (const root of roots) {
    const stateRoot = root.replace("think_cloud_sessions", "think_cloud_state");
    for (const db of Object.values(clients)) {
      await assertFails(getDoc(doc(db, stateRoot, "current")));
      await assertFails(getDoc(doc(db, root, "named")));
      await assertFails(
        getDoc(doc(db, root, "named", "responses", "response-1")),
      );
      await assertFails(
        getDoc(doc(db, root, "anonymous", "responses", "response-1")),
      );
      await assertFails(getDocs(collection(db, root, "named", "responses")));
      await assertFails(
        getDocs(collection(db, root, "anonymous", "responses")),
      );
      assertions += 6;
    }
  }

  console.log(
    JSON.stringify({
      suite: "w10p-thinkcloud-rules",
      passed: true,
      roots: roots.length,
      assertions,
      directClientRawReads: 0,
      productionAccess: 0,
    }),
  );
} finally {
  await env.cleanup();
}
