// Run only through the dedicated demo emulator:
// firebase emulators:exec --only firestore --config firebase.student-access-test.json --project demo-westory-session-student-access "node scripts/verify-history-classroom-student-copy-rules.mjs"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  collection,
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
  teacher: { role: "teacher", email: "teacher@yongshin-ms.ms.kr" },
  student: { role: "student", email: "student@yongshin-ms.ms.kr" },
  other: { role: "student", email: "other@yongshin-ms.ms.kr" },
  unassigned: { role: "student", email: "unassigned@yongshin-ms.ms.kr" },
  staff: { role: "staff", email: "staff@yongshin-ms.ms.kr" },
  outsider: { role: "student", email: "student@example.com" },
};
const client = (uid, claims = {}) =>
  env
    .authenticatedContext(uid, {
      email: users[uid].email,
      auth_time: authTime,
      ...claims,
    })
    .firestore();
const views = `${prefix}/history_classroom_student_views`;
const assignees = `${prefix}/history_classroom_assignees`;
let count = 0;
const allow = async (label, operation) => {
  await assertSucceeds(operation());
  count++;
  return label;
};
const deny = async (label, operation) => {
  await assertFails(operation());
  count++;
  return label;
};

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
      await setDoc(
        doc(db, `application_sessions/${uid}/sessions/${authTime}`),
        {
          schemaVersion: 2,
          status: "active",
          authTime,
          authorityGeneration: "w1r2-2026-08-09",
          protocolVersion: 2,
          sessionRevision: "a".repeat(64),
          authorityModeAtOpen: "ENFORCE",
          generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000),
        },
      );
    }
    await setDoc(doc(db, "site_settings/student_maintenance"), {
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
    // The teacher document keeps the roster; the copy carries none of it.
    await setDoc(doc(db, `${prefix}/history_classrooms/shared`), {
      title: "합성 과제",
      isPublished: true,
      targetStudentUids: ["student", "other"],
      targetStudentAccessMap: { student: true, other: true },
      targetStudentNames: ["합성 학생", "다른 학생"],
      targetStudentReasons: { student: "사유 가", other: "사유 나" },
    });
    await setDoc(doc(db, `${views}/shared`), {
      assignmentId: "shared",
      title: "합성 과제",
      isPublished: true,
    });
    await setDoc(doc(db, `${views}/others-only`), {
      assignmentId: "others-only",
      title: "다른 학생 과제",
      isPublished: true,
    });
    // An assignment whose id ends where another student's uid could begin:
    // "shared" + "_" + "x_student" and "shared_x" + "_" + "student" share an id.
    await setDoc(doc(db, `${views}/shared_x`), {
      assignmentId: "shared_x",
      title: "식별자가 겹치는 과제",
      isPublished: true,
    });
    for (const [assignmentId, uid, reason] of [
      ["shared", "student", "사유 가"],
      ["shared", "other", "사유 나"],
      ["others-only", "other", "사유 다"],
      ["shared", "x_student", "사유 라"],
    ]) {
      await setDoc(doc(db, `${assignees}/${assignmentId}_${uid}`), {
        assignmentId,
        uid,
        reason,
        retryResetAt: null,
      });
    }
  });

  const student = client("student");
  await allow("own assignment copy", () => getDoc(doc(student, views, "shared")));
  await deny("copy of an assignment given to others", () =>
    getDoc(doc(student, views, "others-only")),
  );
  await deny("copy reached through another student's look-alike document id", () =>
    getDoc(doc(student, views, "shared_x")),
  );
  await deny("listing every copy", () => getDocs(collection(student, views)));
  const own = await assertSucceeds(
    getDocs(query(collection(student, assignees), where("uid", "==", "student"))),
  );
  count++;
  assert.deepEqual(
    own.docs.map((item) => [item.id, item.data().reason]),
    [["shared_student", "사유 가"]],
    "A student lists only their own assignment documents",
  );
  await deny("another student's assignment document", () =>
    getDoc(doc(student, assignees, "shared_other")),
  );
  await deny("another student's assignment query", () =>
    getDocs(query(collection(student, assignees), where("uid", "==", "other"))),
  );
  await deny("an assignment-wide roster query", () =>
    getDocs(
      query(collection(student, assignees), where("assignmentId", "==", "shared")),
    ),
  );
  await deny("listing every assignment document", () =>
    getDocs(collection(student, assignees)),
  );
  for (const [label, path] of [
    ["copy", `${views}/shared`],
    ["own assignment document", `${assignees}/shared_student`],
  ]) {
    await deny(`student overwrites ${label}`, () =>
      setDoc(doc(student, path), { uid: "student", isPublished: true }),
    );
    await deny(`student edits ${label}`, () =>
      updateDoc(doc(student, path), { reason: "바꾼 사유" }),
    );
    await deny(`student deletes ${label}`, () => deleteDoc(doc(student, path)));
  }
  await deny("student grants themself another assignment", () =>
    setDoc(doc(student, assignees, "others-only_student"), {
      assignmentId: "others-only",
      uid: "student",
    }),
  );

  await deny("an unassigned student's copy read", () =>
    getDoc(doc(client("unassigned"), views, "shared")),
  );
  await deny("a staff account that is not assigned", () =>
    getDoc(doc(client("staff"), views, "shared")),
  );
  await deny("an account outside the school domain", () =>
    getDoc(doc(client("outsider"), views, "shared")),
  );
  await deny("a signed-out visitor", () =>
    getDoc(doc(env.unauthenticatedContext().firestore(), views, "shared")),
  );
  await deny("a student whose session document does not match", () =>
    getDoc(doc(client("student", { auth_time: authTime - 5 }), views, "shared")),
  );

  const teacher = client("teacher");
  await allow("teacher reads a copy", () => getDoc(doc(teacher, views, "shared")));
  await allow("teacher lists copies", () => getDocs(collection(teacher, views)));
  await allow("teacher lists assignment documents", () =>
    getDocs(collection(teacher, assignees)),
  );
  await deny("teacher writes a copy directly", () =>
    setDoc(doc(teacher, views, "shared"), { title: "직접 수정" }),
  );
  await deny("teacher writes an assignment document directly", () =>
    setDoc(doc(teacher, assignees, "shared_student"), { uid: "student" }),
  );

  console.log(
    `History Classroom student copy rules: ${count} own-read, roster-isolation and server-only-write cases passed.`,
  );
} finally {
  await env.cleanup();
}
