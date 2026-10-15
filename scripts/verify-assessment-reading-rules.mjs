// Emulator only; synthetic fixtures. Run from the repository root:
// firebase emulators:exec --only firestore --config firebase.student-access-test.json --project demo-westory-assessment-reading "node scripts/verify-assessment-reading-rules.mjs"
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  setLogLevel,
  where,
} from "firebase/firestore";

const projectId = "demo-westory-assessment-reading";
assert.equal(
  process.env.GCLOUD_PROJECT,
  projectId,
  "Dedicated demo project required.",
);
assert.equal(
  process.env.FIRESTORE_EMULATOR_HOST,
  "127.0.0.1:18220",
  "Isolated local emulator required; never run on production.",
);
const rules = readFileSync("firestore.rules", "utf8");
console.log(`RULES SHA256 ${createHash("sha256").update(rules).digest("hex")}`);
setLogLevel("silent");
const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 18220, rules },
});
const authTime = Math.floor(Date.now() / 1000) - 60;
const email = (uid) =>
  uid === "admin" ? "westoria28@gmail.com" : `${uid}@yongshin-ms.ms.kr`;
const client = (uid, time = authTime) =>
  env
    .authenticatedContext(uid, {
      email: email(uid),
      auth_time: time,
    })
    .firestore();
const results = [];
const check = async (name, allowed, action) => {
  try {
    await (allowed ? assertSucceeds(action()) : assertFails(action()));
    results.push({ name, pass: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1100);
    results.push({ name, pass: false, message });
    console.error(`FAIL ${name}: ${message}`);
  }
};
const seed = (path, data) =>
  env.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), path), data),
  );
const maintenance = (enabled, count = 0) =>
  seed("site_settings/student_maintenance", {
    enabled,
    blockedRoles: ["student"],
    bypassUids: Array.from(
      { length: count },
      (_, index) => `synthetic-bypass-${index}`,
    ),
    title: "합성 권한 검증",
    message: "운영 데이터가 아닌 로컬 에뮬레이터 검증입니다.",
    startedAt: enabled ? Timestamp.now() : null,
    updatedAt: Timestamp.now(),
    updatedBy: "admin",
    revision: 1,
  });
const legacyPaths = [
  "quiz_results",
  "years/2026/semesters/2/quiz_results",
  "quiz_submissions",
  "years/2026/semesters/2/quiz_submissions",
];
const canonicalPaths = [
  "semester_assessment_results",
  "semester_assessment_submissions",
];
try {
  await env.clearFirestore();
  await seed("site_settings/config", { year: "2026", semester: "2" });
  await seed("site_settings/semester_active", {
    semesterId: "2026-2",
    revision: 1,
  });
  for (const [uid, role, permissions] of [
    ["admin", "teacher", []],
    ["teacher", "teacher", []],
    ["quiz-reader", "staff", ["quiz_read"]],
    ["disabled-portal-reader", "staff", ["quiz_read"]],
    ["ordinary-staff", "staff", []],
    ["student-a", "student", []],
    ["student-b", "student", []],
    ["pending-student", "student", []],
  ]) {
    await seed(`users/${uid}`, {
      uid,
      email: email(uid),
      role,
      registrationApprovalStatus:
        uid === "pending-student" ? "PENDING" : "APPROVED",
      teacherPortalEnabled:
        role === "staff" && uid !== "disabled-portal-reader",
      staffPermissions: permissions,
    });
    await seed(`application_sessions/${uid}/sessions/${authTime}`, {
      schemaVersion: 2,
      status: "active",
      authTime,
      authorityGeneration: "w1r2-2026-08-09",
      protocolVersion: 2,
      sessionRevision: "a".repeat(64),
      authorityModeAtOpen: "ENFORCE",
      generalExpiresAt: Timestamp.fromMillis(Date.now() + 3_600_000),
      highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 3_600_000),
    });
  }
  // More than one student's records are needed to exercise genuine list rules.
  for (let index = 0; index < 12; index += 1) {
    const uid = index % 2 === 0 ? "student-a" : "student-b";
    const data = {
      uid,
      studentUid: uid,
      semesterId: "2026-2",
      assessmentKind: "QUIZ",
      score: 50,
      timestamp: Timestamp.fromMillis(1_700_000_000_000 + index),
      answerChecks: [{ id: "synthetic-q1", correct: false }],
    };
    for (const path of [...legacyPaths, ...canonicalPaths])
      await seed(`${path}/record-${index}`, data);
  }
  for (const path of canonicalPaths)
    await seed(`${path}/past`, {
      studentUid: "student-a",
      semesterId: "2026-1",
      assessmentKind: "QUIZ",
      score: 50,
    });

  for (const bypassCount of [0, 20]) {
    await maintenance(false, bypassCount);
    for (const uid of ["admin", "teacher", "quiz-reader"]) {
      const db = client(uid);
      for (const path of legacyPaths) {
        await check(
          `${uid} legacy get ${path} bypass=${bypassCount}`,
          true,
          () => getDoc(doc(db, `${path}/record-0`)),
        );
        await check(
          `${uid} legacy latest500 list ${path} bypass=${bypassCount}`,
          true,
          () =>
            getDocs(
              query(
                collection(db, path),
                orderBy("timestamp", "desc"),
                limit(500),
              ),
            ),
        );
      }
      for (const path of canonicalPaths) {
        await check(
          `${uid} canonical get ${path} bypass=${bypassCount}`,
          true,
          () => getDoc(doc(db, `${path}/record-0`)),
        );
        await check(
          `${uid} canonical semester list ${path} bypass=${bypassCount}`,
          true,
          () =>
            getDocs(
              query(collection(db, path), where("semesterId", "==", "2026-2")),
            ),
        );
      }
    }
  }
  await maintenance(false);
  const student = client("student-a");
  for (const path of [...legacyPaths, ...canonicalPaths]) {
    await seed(`${path}/pending-own`, {
      uid: "pending-student",
      studentUid: "pending-student",
      semesterId: "2026-2",
      assessmentKind: "QUIZ",
      score: 50,
      timestamp: Timestamp.now(),
    });
    await check(`pending student own get denied ${path}`, false, () =>
      getDoc(doc(client("pending-student"), `${path}/pending-own`)),
    );
    await check(`pending student own list denied ${path}`, false, () =>
      getDocs(
        query(
          collection(client("pending-student"), path),
          where(
            legacyPaths.includes(path) ? "uid" : "studentUid",
            "==",
            "pending-student",
          ),
          ...(canonicalPaths.includes(path)
            ? [where("semesterId", "==", "2026-2")]
            : []),
        ),
      ),
    );
    await check(
      `quiz permission without teacher portal get denied ${path}`,
      false,
      () => getDoc(doc(client("disabled-portal-reader"), `${path}/record-0`)),
    );
    await check(
      `quiz permission without teacher portal list denied ${path}`,
      false,
      () =>
        getDocs(
          query(
            collection(client("disabled-portal-reader"), path),
            ...(canonicalPaths.includes(path)
              ? [where("semesterId", "==", "2026-2")]
              : [orderBy("timestamp", "desc"), limit(500)]),
          ),
        ),
    );
  }
  for (const path of legacyPaths) {
    await check(`student legacy own get ${path}`, true, () =>
      getDoc(doc(student, `${path}/record-0`)),
    );
    await check(`student legacy own scoped list ${path}`, true, () =>
      getDocs(
        query(collection(student, path), where("uid", "==", "student-a")),
      ),
    );
    await check(`student legacy foreign get denied ${path}`, false, () =>
      getDoc(doc(student, `${path}/record-1`)),
    );
    await check(`student legacy unscoped list denied ${path}`, false, () =>
      getDocs(collection(student, path)),
    );
  }
  for (const path of canonicalPaths) {
    await check(`student canonical own get ${path}`, true, () =>
      getDoc(doc(student, `${path}/record-0`)),
    );
    await check(`student canonical own current list ${path}`, true, () =>
      getDocs(
        query(
          collection(student, path),
          where("studentUid", "==", "student-a"),
          where("semesterId", "==", "2026-2"),
        ),
      ),
    );
    await check(`student canonical foreign denied ${path}`, false, () =>
      getDoc(doc(student, `${path}/record-1`)),
    );
    await check(`student canonical past denied ${path}`, false, () =>
      getDoc(doc(student, `${path}/past`)),
    );
    await check(
      `student canonical unscoped semester denied ${path}`,
      false,
      () =>
        getDocs(
          query(collection(student, path), where("semesterId", "==", "2026-2")),
        ),
    );
    await check(
      `student canonical missing semester filter denied ${path}`,
      false,
      () =>
        getDocs(
          query(
            collection(student, path),
            where("studentUid", "==", "student-a"),
          ),
        ),
    );
  }
  for (const path of [...legacyPaths, ...canonicalPaths]) {
    await check(`ordinary staff denied ${path}`, false, () =>
      getDoc(doc(client("ordinary-staff"), `${path}/record-0`)),
    );
    await check(`unauthenticated denied ${path}`, false, () =>
      getDoc(doc(env.unauthenticatedContext().firestore(), `${path}/record-0`)),
    );
    await check(`admin without session denied ${path}`, false, () =>
      getDoc(doc(client("admin", authTime + 1), `${path}/record-0`)),
    );
    await check(`quiz reader without session denied ${path}`, false, () =>
      getDoc(doc(client("quiz-reader", authTime + 1), `${path}/record-0`)),
    );
    await check(`client-created assessment record denied ${path}`, false, () =>
      setDoc(doc(student, `${path}/forged`), {
        uid: "student-a",
        studentUid: "student-a",
        semesterId: "2026-2",
        score: 100,
      }),
    );
  }
  // A present-but-expired session must not grant privileged or own access.
  for (const uid of ["admin", "quiz-reader", "student-a"]) {
    await env.withSecurityRulesDisabled((context) =>
      setDoc(
        doc(
          context.firestore(),
          `application_sessions/${uid}/sessions/${authTime}`,
        ),
        { generalExpiresAt: Timestamp.fromMillis(Date.now() - 60_000) },
        { merge: true },
      ),
    );
    for (const path of [...legacyPaths, ...canonicalPaths]) {
      await check(`expired ${uid} session denied ${path}`, false, () =>
        getDoc(doc(client(uid), `${path}/record-0`)),
      );
    }
    await env.withSecurityRulesDisabled((context) =>
      setDoc(
        doc(
          context.firestore(),
          `application_sessions/${uid}/sessions/${authTime}`,
        ),
        { generalExpiresAt: Timestamp.fromMillis(Date.now() + 3_600_000) },
        { merge: true },
      ),
    );
  }
  await maintenance(true, 20);
  for (const path of [...legacyPaths, ...canonicalPaths]) {
    await check(`maintenance blocks student ${path}`, false, () =>
      getDoc(doc(student, `${path}/record-0`)),
    );
    for (const uid of ["admin", "teacher", "quiz-reader"])
      await check(`maintenance permits ${uid} ${path}`, true, () =>
        getDoc(doc(client(uid), `${path}/record-0`)),
      );
  }
} finally {
  await env.cleanup();
}
const failures = results.filter((result) => !result.pass);
console.log(
  JSON.stringify(
    {
      projectId,
      assertions: results.length,
      passed: results.length - failures.length,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
