import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
} from "firebase/firestore";

const projectId = "demo-westory-session-student-access";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18220");
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 18220,
    rules: readFileSync("firestore.rules", "utf8"),
  },
});
const authTime = Math.floor(Date.now() / 1000) - 60;
const prefix = "years/2026/semesters/2";
const users = {
  admin: { role: "teacher", email: "westoria28@gmail.com" },
  teacher: { role: "teacher", email: "teacher@yongshin-ms.ms.kr" },
  student: { role: "student", email: "student@yongshin-ms.ms.kr" },
  other: { role: "student", email: "other@yongshin-ms.ms.kr" },
  staff: { role: "staff", email: "staff@yongshin-ms.ms.kr" },
  outsider: { role: "teacher", email: "teacher@example.com" },
};
const client = (uid) =>
  env
    .authenticatedContext(uid, { email: users[uid].email, auth_time: authTime })
    .firestore();
const sessionData = () => ({
  schemaVersion: 2,
  status: "active",
  authTime,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "a".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000),
});
const maintenanceData = () => ({
  enabled: false,
  blockedRoles: ["student"],
  bypassUids: Array.from({ length: 20 }, (_, i) => `fixture-${i}`),
  title: "접속 점검",
  message: "접속을 확인합니다.",
  startedAt: null,
  updatedAt: Timestamp.now(),
  updatedBy: "admin",
  revision: 1,
});
const seed = (path, data) =>
  env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), path), data),
  );
const sessionPath = (uid) => `application_sessions/${uid}/sessions/${authTime}`;
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, profile] of Object.entries(users)) {
      await setDoc(doc(db, "users", uid), {
        uid,
        ...profile,
        registrationApprovalStatus: "APPROVED",
      });
      await setDoc(doc(db, sessionPath(uid)), sessionData());
    }
    await setDoc(
      doc(db, "site_settings/student_maintenance"),
      maintenanceData(),
    );
  });
  let count = 0;
  for (const path of [
    "history_classroom_exemptions",
    "history_classroom_exemption_requests",
  ].flatMap((name) => [name, `${prefix}/${name}`])) {
    for (const uid of ["admin", "teacher"]) {
      await assertSucceeds(getDocs(collection(client(uid), path)));
      count++;
    }
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path, "own"), {
        uid: "student",
        status: "available",
      });
      await setDoc(doc(ctx.firestore(), path, "other"), {
        uid: "other",
        status: "available",
      });
      await setDoc(doc(ctx.firestore(), path, "legacy-missing-owner"), {
        status: "available",
      });
    });
    for (const uid of ["admin", "teacher"]) {
      await assertSucceeds(getDocs(collection(client(uid), path)));
      count++;
    }
    await assertSucceeds(
      getDocs(
        query(
          collection(client("student"), path),
          where("uid", "==", "student"),
        ),
      ),
    );
    await assertFails(getDocs(collection(client("student"), path)));
    await assertFails(getDoc(doc(client("student"), path, "other")));
    await assertFails(getDocs(collection(client("staff"), path)));
    await assertFails(
      setDoc(doc(client("teacher"), path, "direct-write"), { uid: "student" }),
    );
    await assertFails(
      setDoc(doc(client("student"), path, "direct-write"), { uid: "student" }),
    );
    count += 6;
  }
  // These fences must remain intact when reducing duplicate rule evaluation.
  // Restore each fixture immediately so a denial cannot mask a later regression.
  const allow = async (operation) => {
    await assertSucceeds(operation);
    count++;
  };
  const deny = async (operation) => {
    await assertFails(operation);
    count++;
  };
  for (const name of [
    "history_classroom_exemptions",
    "history_classroom_exemption_requests",
  ]) {
    const path = `${prefix}/${name}`;
    const ownQuery = (uid) =>
      getDocs(query(collection(client(uid), path), where("uid", "==", uid)));
    for (const sessionFailure of ["expired", "revoked"]) {
      for (const uid of ["teacher", "student"]) {
        await seed(sessionPath(uid), {
          ...sessionData(),
          ...(sessionFailure === "expired"
            ? { generalExpiresAt: Timestamp.fromMillis(Date.now() - 60000) }
            : { status: "revoked" }),
        });
        await deny(
          uid === "teacher"
            ? getDocs(collection(client(uid), path))
            : ownQuery(uid),
        );
        await seed(sessionPath(uid), sessionData());
      }
    }
    for (const uid of ["teacher", "student"]) {
      await seed(`users/${uid}`, {
        uid,
        ...users[uid],
        registrationApprovalStatus: "PENDING",
      });
      await deny(
        uid === "teacher"
          ? getDocs(collection(client(uid), path))
          : ownQuery(uid),
      );
      await seed(`users/${uid}`, {
        uid,
        ...users[uid],
        registrationApprovalStatus: "APPROVED",
      });
    }
    const enabledMaintenance = {
      ...maintenanceData(),
      enabled: true,
      startedAt: Timestamp.now(),
    };
    await seed("site_settings/student_maintenance", enabledMaintenance);
    await allow(getDocs(collection(client("admin"), path)));
    await allow(getDocs(collection(client("teacher"), path)));
    await deny(ownQuery("student"));
    await seed("site_settings/student_maintenance", {
      ...enabledMaintenance,
      bypassUids: ["student"],
    });
    await allow(ownQuery("student"));
    await deny(getDoc(doc(client("student"), path, "other")));
    await deny(getDocs(collection(client("student"), path)));
    await seed("site_settings/student_maintenance", maintenanceData());

    for (const invalidConfig of [
      { ...maintenanceData(), blockedRoles: ["teacher"] },
      { ...maintenanceData(), unexpected: true },
    ]) {
      await seed("site_settings/student_maintenance", invalidConfig);
      await deny(getDocs(collection(client("admin"), path)));
      await deny(getDocs(collection(client("teacher"), path)));
      await seed("site_settings/student_maintenance", maintenanceData());
    }

    for (const db of [
      env.unauthenticatedContext().firestore(),
      client("outsider"),
    ]) {
      await deny(getDocs(collection(db, path)));
      await deny(getDoc(doc(db, path, "own")));
    }
    await deny(getDoc(doc(client("student"), path, "legacy-missing-owner")));
    await deny(
      setDoc(doc(client("admin"), path, "admin-create"), {
        uid: "student",
        status: "available",
      }),
    );
    await deny(
      updateDoc(doc(client("admin"), path, "own"), { status: "used" }),
    );
    await deny(deleteDoc(doc(client("admin"), path, "own")));

    // Prove the baseline has been restored and failed direct writes changed nothing.
    await allow(getDocs(collection(client("admin"), path)));
    await allow(getDocs(collection(client("teacher"), path)));
    const own = await assertSucceeds(
      getDoc(doc(client("student"), path, "own")),
    );
    assert.equal(own.data().status, "available");
    count++;
  }
  console.log(
    `History Classroom exemption rules: ${count} ownership/teacher-read/server-write cases passed.`,
  );
} finally {
  await env.cleanup();
}
