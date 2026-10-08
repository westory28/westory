import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import * as firestore from "firebase/firestore";

const {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  setDoc,
  updateDoc,
  Timestamp,
} = firestore;
const projectId = "demo-westory-session-student-access";
const baseline = process.env.RULES_BASELINE_REVISION;
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(
  process.env.FIRESTORE_EMULATOR_HOST,
  "127.0.0.1:18220",
  "Local isolated emulator required.",
);
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 18220,
    rules: baseline
      ? execFileSync("git", ["show", `${baseline}:firestore.rules`], {
          encoding: "utf8",
        })
      : readFileSync("firestore.rules", "utf8"),
  },
});
const authTime = Math.floor(Date.now() / 1000) - 60;
const prefix = "years/2026/semesters/2";
const now = Timestamp.now();
const maintenance = {
  enabled: true,
  blockedRoles: ["student"],
  bypassUids: ["fixture-bypass-student"],
  title: "학생 접속 점검",
  message: "운영 확인 중입니다.",
  startedAt: now,
  updatedAt: now,
  updatedBy: "admin",
  revision: 8,
};
const profiles = {
  admin: { email: "westoria28@gmail.com", role: "teacher" },
  teacher: { email: "teacher@yongshin-ms.ms.kr", role: "teacher" },
  student: { email: "student@yongshin-ms.ms.kr", role: "student" },
  "fixture-bypass-student": {
    email: "bypass@yongshin-ms.ms.kr",
    role: "student",
  },
  staff: { email: "staff@yongshin-ms.ms.kr", role: "staff" },
  "expired-admin": { email: "westoria28@gmail.com", role: "teacher" },
};
const client = (uid) =>
  env
    .authenticatedContext(uid, {
      email: profiles[uid].email,
      auth_time: authTime,
    })
    .firestore();
const checks = [];
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, pass: true });
    console.log("PASS " + name);
  } catch (error) {
    checks.push({ name, pass: false });
    console.error("FAIL " + name + ": " + error.message);
  }
}
const notesQuery = (db, uid) =>
  query(
    collection(db, "teacherPatchNotes", uid, "notes"),
    orderBy("updatedAt", "desc"),
    limit(100),
  );
const listenOnce = (q) =>
  new Promise((resolve, reject) => {
    let stop;
    const timeout = setTimeout(() => {
      stop?.();
      reject(new Error("Snapshot timed out"));
    }, 10000);
    stop = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.metadata.fromCache) return;
        clearTimeout(timeout);
        stop();
        resolve(snapshot);
      },
      (error) => {
        clearTimeout(timeout);
        stop?.();
        reject(error);
      },
    );
  });

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "site_settings/student_maintenance"), maintenance);
    for (const [uid, profile] of Object.entries(profiles)) {
      await setDoc(doc(db, "users", uid), {
        uid,
        ...profile,
        registrationApprovalStatus: "APPROVED",
        teacherPortalEnabled: true,
        staffPermissions: ["lesson_read"],
        grade: "3",
        class: "1",
      });
      await setDoc(
        doc(db, "application_sessions", uid, "sessions", String(authTime)),
        {
          schemaVersion: 2,
          status: "active",
          authTime,
          authorityGeneration: "w1r2-2026-08-09",
          protocolVersion: 2,
          sessionRevision: "a".repeat(64),
          authorityModeAtOpen: "ENFORCE",
          generalExpiresAt: Timestamp.fromMillis(
            Date.now() + (uid === "expired-admin" ? -60000 : 3600000),
          ),
          highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 3600000),
        },
      );
      await setDoc(doc(db, "teacherPatchNotes", uid, "notes", "note-1"), {
        ownerUid: uid,
        title: "합성 패치 메모",
        updatedAt: now,
      });
    }
    await setDoc(doc(db, `${prefix}/curriculum/tree`), {
      tree: [{ id: "unit" }],
    });
    await setDoc(doc(db, `${prefix}/assessment_config/settings`), {
      shellReady: true,
    });
    await setDoc(doc(db, `${prefix}/exam_config/final_exam`), {
      shellReady: true,
    });
    for (const name of ["grading_plans_meta", "calendar_meta", "notices_meta"])
      await setDoc(doc(db, `${prefix}/${name}/current`), { shellReady: true });
    for (const name of [
      "grading_plans",
      "calendar",
      "notices",
      "point_products",
      "quiz_questions",
      "history_classrooms",
      "map_resources",
    ])
      await setDoc(doc(db, `${prefix}/${name}/fixture`), {
        title: "합성 자료",
        targetStudentUid: "student",
      });
  });
  const admin = client("admin"),
    teacher = client("teacher");
  await check("admin baseline maintenance and users reads", async () => {
    await assertSucceeds(
      getDoc(doc(admin, "site_settings/student_maintenance")),
    );
    await assertSucceeds(getDocs(collection(admin, "users")));
  });
  for (const [uid, db] of [
    ["admin", admin],
    ["teacher", teacher],
  ]) {
    await check(
      `${uid} actual patch-note ordered/latest100 server subscription`,
      async () => {
        const snapshot = await assertSucceeds(listenOnce(notesQuery(db, uid)));
        assert.equal(snapshot.size, 1);
      },
    );
  }
  for (const name of ["grading_plans_meta", "calendar_meta", "notices_meta"]) {
    await check(
      `internal readiness ${name} stays inaccessible to raw admin reads`,
      async () => {
        await assertFails(getDoc(doc(admin, `${prefix}/${name}/current`)));
        await assertFails(getDoc(doc(admin, `${prefix}/${name}/missing`)));
      },
    );
  }
  await check(
    "notes remain own-teacher only and require a live session",
    async () => {
      await assertFails(getDocs(notesQuery(admin, "teacher")));
      await assertFails(getDocs(notesQuery(teacher, "admin")));
      for (const uid of [
        "student",
        "fixture-bypass-student",
        "staff",
        "expired-admin",
      ])
        await assertFails(getDocs(notesQuery(client(uid), uid)));
    },
  );
  await check(
    "maintenance still blocks students and bypass never grants teacher metadata",
    async () => {
      await assertFails(
        getDoc(doc(client("student"), `${prefix}/curriculum/tree`)),
      );
      for (const uid of [
        "student",
        "fixture-bypass-student",
        "staff",
        "expired-admin",
      ]) {
        for (const name of [
          "grading_plans_meta",
          "calendar_meta",
          "notices_meta",
        ])
          await assertFails(
            getDoc(doc(client(uid), `${prefix}/${name}/current`)),
          );
      }
    },
  );
  await check(
    "opening maintenance never grants students patch notes or readiness metadata",
    async () => {
      await env.withSecurityRulesDisabled((context) =>
        updateDoc(
          doc(context.firestore(), "site_settings/student_maintenance"),
          { enabled: false, startedAt: null },
        ),
      );
      const student = client("student");
      await assertSucceeds(getDoc(doc(student, `${prefix}/curriculum/tree`)));
      await assertFails(getDocs(notesQuery(student, "student")));
      await assertFails(
        getDoc(doc(student, `${prefix}/grading_plans_meta/current`)),
      );
    },
  );
  if (baseline) console.log(JSON.stringify({ baseline, checks }, null, 2));
  else {
    assert.equal(
      checks.filter((item) => !item.pass).length,
      0,
      "Teacher query regression failures",
    );
    console.log(`Teacher readiness rules: ${checks.length} groups passed.`);
  }
} finally {
  await env.cleanup();
}
