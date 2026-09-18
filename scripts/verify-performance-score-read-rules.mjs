import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

// Exercise the actual collection-group reads used by the performance/written
// exam manager. Direct document reads alone do not test this rules contract.
const projectId = "demo-westory-performance-score-reads";
const port = Number(process.env.CONTENT_RULES_FIRESTORE_PORT || 8080);
const authTime = Math.floor(Date.now() / 1000) - 10;
const profiles = {
  teacher: { role: "teacher", email: "teacher@yongshin-ms.ms.kr" },
  admin: { role: "teacher", email: "westoria28@gmail.com" },
  student: { role: "student", email: "student@yongshin-ms.ms.kr" },
  other: { role: "student", email: "other@yongshin-ms.ms.kr" },
  staff: {
    role: "staff",
    email: "staff@yongshin-ms.ms.kr",
    teacherPortalEnabled: true,
    staffPermissions: ["student_list_read", "lesson_read", "quiz_read"],
  },
  pending: {
    role: "teacher",
    email: "pending@yongshin-ms.ms.kr",
    registrationApprovalStatus: "PENDING",
  },
  outsider: { role: "teacher", email: "outsider@example.com" },
  expired: { role: "teacher", email: "expired@yongshin-ms.ms.kr" },
};
const semesters = ["1", "2"];
const variants = ["firestore.rules", "firestore.staging.rules"];
let checks = 0;
const succeeds = async (operation) => {
  const result = await assertSucceeds(operation);
  checks++;
  return result;
};
const fails = async (operation) => {
  await assertFails(operation);
  checks++;
};
const rosterId = (semester) => `2026-${semester}-roster`;
const scorePath = (semester, uid = "student") =>
  `users/${uid}/performance_scores/${rosterId(semester)}`;
const confirmationPath = (semester, uid = "student") =>
  `${scorePath(semester, uid)}/confirmations/${uid}`;
const rosterQuery = (db, group, semester) =>
  query(collectionGroup(db, group), where("rosterId", "==", rosterId(semester)));

for (const filename of variants) {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port, rules: readFileSync(filename, "utf8") },
  });
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "site_settings/config"), { year: "2026", semester: "2" });
      await setDoc(doc(db, "site_settings/semester_active"), { semesterId: "2026-2", revision: 4 });
      await setDoc(doc(db, "semester_manifests/2026-2"), { semesterId: "2026-2", status: "ACTIVE", revision: 4 });
      await setDoc(doc(db, "semester_manifests/2026-1"), { semesterId: "2026-1", status: "ARCHIVED", revision: 8 });
      await setDoc(doc(db, "site_settings/student_maintenance"), {
        enabled: false, blockedRoles: ["student"], bypassUids: [], title: "점검", message: "확인 중입니다.",
        startedAt: null, updatedAt: Timestamp.now(), updatedBy: "admin", revision: 1,
      });
      for (const [uid, profile] of Object.entries(profiles)) {
        await setDoc(doc(db, `users/${uid}`), {
          uid, registrationApprovalStatus: "APPROVED", ...profile,
        });
        await setDoc(doc(db, `application_sessions/${uid}/sessions/${authTime}`), {
          status: "active", authTime, schemaVersion: 2,
          authorityGeneration: "w1r2-2026-08-09", protocolVersion: 2,
          sessionRevision: "a".repeat(64), authorityModeAtOpen: "ENFORCE",
          generalExpiresAt: Timestamp.fromMillis(Date.now() + (uid === "expired" ? -60000 : 600000)),
          highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 600000),
        });
      }
      for (const semester of semesters) {
        for (const uid of ["student", "other"]) {
          await setDoc(doc(db, scorePath(semester, uid)), {
            uid, rosterId: rosterId(semester), academicYear: "2026", semester,
            totalScore: semester === "1" ? 42 : 45,
          });
          await setDoc(doc(db, confirmationPath(semester, uid)), {
            uid, rosterId: rosterId(semester), signatureName: uid,
            signatureImage: "data:image/png;base64,AAAA",
          });
        }
      }
    });
    const clients = Object.fromEntries(Object.entries(profiles).map(([uid, profile]) => [
      uid, env.authenticatedContext(uid, { email: profile.email, auth_time: authTime }).firestore(),
    ]));
    clients.anonymous = env.unauthenticatedContext().firestore();

    for (const group of ["performance_scores", "confirmations"]) {
      for (const semester of semesters) {
        for (const uid of ["teacher", "admin"]) {
          const snap = await succeeds(getDocs(rosterQuery(clients[uid], group, semester)));
          assert.equal(snap.size, 2, `${filename}: ${uid} reads both ${semester} semester ${group}`);
          assert.ok(snap.docs.every((item) => item.data().rosterId === rosterId(semester)));
        }
        for (const uid of ["student", "other", "staff", "pending", "outsider", "expired", "anonymous"]) {
          await fails(getDocs(rosterQuery(clients[uid], group, semester)));
        }
      }
      await succeeds(getDocs(query(collectionGroup(clients.teacher, group), where("rosterId", "==", "not-created-yet"))));
    }

    // Recursive list permission must preserve individual student scope and the
    // server-only write boundary, including confirmations with signature data.
    for (const semester of semesters) {
      for (const path of [scorePath(semester), confirmationPath(semester)]) {
        await succeeds(getDoc(doc(clients.teacher, path)));
        await (semester === "2" ? succeeds : fails)(getDoc(doc(clients.student, path)));
        await fails(getDoc(doc(clients.other, path)));
        await fails(getDoc(doc(clients.staff, path)));
        for (const uid of ["admin", "teacher", "student"]) {
          await fails(setDoc(doc(clients[uid], `${path}-new`), { uid: "student" }));
          await fails(updateDoc(doc(clients[uid], path), { tampered: true }));
          await fails(deleteDoc(doc(clients[uid], path)));
        }
      }
    }
    await succeeds(getDocs(query(collection(clients.student, "users/student/performance_scores"), where("academicYear", "==", "2026"), where("semester", "==", "2"))));
    await fails(getDocs(collection(clients.student, "users/student/performance_scores")));
    await env.withSecurityRulesDisabled((context) => deleteDoc(doc(context.firestore(), `application_sessions/teacher/sessions/${authTime}`)));
    for (const group of ["performance_scores", "confirmations"]) {
      await fails(getDocs(rosterQuery(clients.teacher, group, "1")));
    }
  } finally {
    await env.cleanup();
  }
}

// The emulator does not enforce query indexes; assert the deployable single-
// field collection-group indexes separately for both roster queries.
const indexes = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
for (const group of ["performance_scores", "confirmations"]) {
  assert.ok(indexes.fieldOverrides.some((field) =>
    field.collectionGroup === group && field.fieldPath === "rosterId"
    && field.indexes.some((index) => index.queryScope === "COLLECTION_GROUP" && index.order === "ASCENDING")),
  `${group}.rosterId needs a deployed collection-group index`);
  checks++;
}
console.log(JSON.stringify({ passed: true, checks, projectId, productionAccess: false, variants }));
