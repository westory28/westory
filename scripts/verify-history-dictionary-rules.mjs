import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  setDoc,
  deleteDoc,
  Timestamp,
} from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-westory-dictionary",
  firestore: {
    host: "127.0.0.1",
    port: Number(
      process.env.FIRESTORE_EMULATOR_HOST?.split(":").at(-1) || 8080,
    ),
    rules: readFileSync("firestore.rules", "utf8"),
  },
});
const root = "years/2026/semesters/2";
const words = (uid) =>
  `${root}/dictionary_students/${uid}/history_dictionary_words`;
const epoch = 1700000000;
const context = (uid, email = `${uid}@yongshin-ms.ms.kr`) =>
  env.authenticatedContext(uid, { email, auth_time: epoch }).firestore();
const student = context("student"),
  teacher = context("teacher"),
  staff = context("staff"),
  viewer = context("viewer"),
  unapproved = context("unapproved"),
  expired = context("expired");
const admin = context("admin", "westoria28@gmail.com");
const session = {
  status: "active",
  authTime: epoch,
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "a".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000),
};
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    // A valid, populated maintenance config previously pushed repeated fences
    // in the dictionary read rules past Firestore's expression budget.
    await setDoc(doc(db, "site_settings/student_maintenance"), {
      enabled: false,
      blockedRoles: ["student"],
      bypassUids: Array.from({ length: 20 }, (_, i) => `bypass-${i}`),
      title: "학생 접속 설정",
      message: "학생 접속 상태를 관리합니다.",
      startedAt: null,
      updatedAt: Timestamp.now(),
      updatedBy: "admin",
      revision: 1,
    });
    for (const [uid, role, permissions] of [
      ["student", "student", []],
      ["teacher", "teacher", []],
      ["staff", "staff", ["lesson_read"]],
      ["viewer", "staff", []],
      ["unapproved", "student", []],
      ["expired", "teacher", []],
      ["admin", "teacher", []],
    ]) {
      await setDoc(doc(db, `users/${uid}`), {
        role,
        teacherPortalEnabled: role === "staff",
        staffPermissions: permissions,
        registrationApprovalStatus:
          uid === "unapproved" ? "PENDING" : "APPROVED",
      });
      await setDoc(doc(db, `application_sessions/${uid}/sessions/${epoch}`), {
        ...session,
        ...(uid === "expired"
          ? { generalExpiresAt: Timestamp.fromMillis(1) }
          : {}),
      });
    }
    await Promise.all([
      setDoc(doc(db, `${words("student")}/one`), {
        uid: "student",
        updatedAt: 1,
      }),
      setDoc(doc(db, `${words("other")}/one`), { uid: "other", updatedAt: 1 }),
      setDoc(doc(db, `${root}/history_dictionary_terms/public`), {
        normalizedWord: "역사",
        status: "published",
        updatedAt: 1,
      }),
      setDoc(doc(db, `${root}/history_dictionary_terms/draft`), {
        normalizedWord: "역사",
        status: "draft",
        updatedAt: 1,
      }),
      setDoc(doc(db, `${root}/history_dictionary_requests/own`), {
        uid: "student",
        updatedAt: 1,
      }),
      setDoc(doc(db, `${root}/history_dictionary_requests/other`), {
        uid: "other",
        updatedAt: 1,
      }),
    ]);
  });
  for (const db of [admin, teacher, staff]) {
    await assertSucceeds(
      getDocs(
        collection(db, "years/2027/semesters/1/history_dictionary_requests"),
      ),
    );
    await assertSucceeds(
      getDocs(
        collection(db, "years/2027/semesters/1/history_dictionary_terms"),
      ),
    );
    await assertSucceeds(
      getDocs(
        query(
          collection(db, `${root}/history_dictionary_terms`),
          orderBy("updatedAt", "desc"),
        ),
      ),
    );
    await assertSucceeds(
      getDocs(
        query(
          collection(db, `${root}/history_dictionary_requests`),
          orderBy("updatedAt", "desc"),
        ),
      ),
    );
    await assertSucceeds(getDocs(collection(db, words("other"))));
    await assertSucceeds(
      getDoc(doc(db, `${root}/history_dictionary_terms/missing`)),
    );
  }
  await assertSucceeds(
    getDocs(
      query(
        collection(student, words("student")),
        orderBy("updatedAt", "desc"),
      ),
    ),
  );
  await assertSucceeds(getDoc(doc(student, `${words("student")}/missing`)));
  await assertFails(getDocs(collection(student, words("other"))));
  await assertSucceeds(
    getDocs(
      query(
        collection(student, `${root}/history_dictionary_terms`),
        where("normalizedWord", "==", "역사"),
        where("status", "==", "published"),
      ),
    ),
  );
  await assertSucceeds(
    getDocs(
      query(
        collection(student, `${root}/history_dictionary_requests`),
        where("uid", "==", "student"),
      ),
    ),
  );
  for (const db of [student, viewer]) {
    await assertFails(
      getDoc(doc(db, `${root}/history_dictionary_terms/draft`)),
    );
    await assertFails(
      getDocs(collection(db, `${root}/history_dictionary_terms`)),
    );
    await assertFails(
      getDocs(collection(db, `${root}/history_dictionary_requests`)),
    );
  }
  for (const db of [
    env.unauthenticatedContext().firestore(),
    context("no-session"),
    unapproved,
    expired,
  ]) {
    await assertFails(getDocs(collection(db, words("student"))));
    await assertFails(
      getDocs(
        query(
          collection(db, `${root}/history_dictionary_terms`),
          where("status", "==", "published"),
        ),
      ),
    );
  }
  for (const db of [student, teacher, admin, staff])
    for (const path of [
      `${words("student")}/one`,
      `${root}/history_dictionary_terms/public`,
      `${root}/history_dictionary_requests/other`,
    ]) {
      await assertFails(
        setDoc(doc(db, path), { uid: "student", status: "published" }),
      );
      await assertFails(deleteDoc(doc(db, path)));
    }
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(
      doc(c.firestore(), "site_settings/student_maintenance"),
      { enabled: true, startedAt: Timestamp.now() },
      { merge: true },
    );
  });
  await assertFails(getDocs(collection(student, words("student"))));
  await assertSucceeds(
    getDocs(collection(teacher, `${root}/history_dictionary_terms`)),
  );
  console.log(
    "PASS dictionary rules: full maintenance config, admin/teacher/lesson staff reads, own words and requests, public lookup, draft/privacy/closed-session/registration fences, no client writes",
  );
} finally {
  await env.cleanup();
}
