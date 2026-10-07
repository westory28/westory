import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";

// Run with the local Firestore emulator only:
// firebase emulators:exec --only firestore --config firebase.login-test.json \
//   --project demo-westory-performance-score-deletion \
//   "node scripts/verify-performance-score-deletion.mjs"
const projectId = "demo-westory-performance-score-deletion";
const host = "127.0.0.1";
const port = Number(process.env.WESTORY_SCORE_DELETION_EMULATOR_PORT || 18192);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
if (
  process.env.FIRESTORE_EMULATOR_HOST &&
  process.env.FIRESTORE_EMULATOR_HOST !== `${host}:${port}`
) {
  throw new Error(
    `This verification requires the local emulator at ${host}:${port}.`,
  );
}

const rules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8",
);
const groupRule =
  /\s*match\s+\/\{path=\*\*\}\/performance_scores\/\{scoreId\}\s*\{\s*allow\s+list:\s*if\s+canManagePerformanceScores\(\);\s*\}/g;
assert.equal(
  [...rules.matchAll(groupRule)].length,
  1,
  "Expected exactly one manager-only performance score collection-group list rule.",
);
const originalRules = rules.replace(groupRule, "");

const schoolEmail = (name) => `${name}@yongshin-ms.ms.kr`;
const actors = {
  teacher: {
    uid: "delete-teacher",
    email: schoolEmail("delete.teacher"),
    role: "teacher",
  },
  admin: {
    uid: "delete-admin",
    email: "westoria28@gmail.com",
    role: "teacher",
  },
  student: {
    uid: "delete-student",
    email: schoolEmail("delete.student"),
    role: "student",
  },
  staff: {
    uid: "delete-staff",
    email: schoolEmail("delete.staff"),
    role: "staff",
  },
  outsider: {
    uid: "delete-outsider",
    email: "delete.outsider@example.com",
    role: "teacher",
  },
};
const staleUid = "delete-previously-linked-student";
const semesterRoot = "years/2026/semesters/2";
const scorePath = (uid, rosterId) =>
  `users/${uid}/performance_scores/${rosterId}`;
const confirmationPath = (uid, rosterId) =>
  `${scorePath(uid, rosterId)}/confirmations/${uid}`;
const rosterPath = (rosterId, root = semesterRoot) =>
  `${root}/performance_score_rosters/${rosterId}`;
const teacherRosterId = "delete-teacher-target";
const adminRosterId = "delete-admin-target";
const otherRosterId = "keep-other-assessment";
const archiveRosterId = "keep-previous-semester";
const fixtures = new Map();

for (const actor of Object.values(actors)) {
  fixtures.set(`users/${actor.uid}`, {
    ...actor,
    name: actor.uid,
    teacherPortalEnabled: actor.role === "staff",
    staffPermissions:
      actor.role === "staff"
        ? ["student_list_read", "quiz_read", "quiz_manage"]
        : [],
  });
}
fixtures.set(`users/${staleUid}`, {
  uid: staleUid,
  email: schoolEmail("delete.previous.student"),
  name: "이전 연결 학생",
  role: "student",
  academicStatus: "transferred",
  teacherPortalEnabled: false,
  staffPermissions: [],
});

const addRoster = (
  rosterId,
  { root = semesterRoot, semester = "2", includeStale = false } = {},
) => {
  const uid = actors.student.uid;
  fixtures.set(rosterPath(rosterId, root), {
    academicYear: "2026",
    semester,
    title: rosterId,
    rows: [
      {
        uid,
        grade: "3",
        class: "1",
        number: "1",
        studentName: "삭제 검증 학생",
      },
    ],
  });
  for (const ownerUid of includeStale ? [uid, staleUid] : [uid]) {
    fixtures.set(scorePath(ownerUid, rosterId), {
      uid: ownerUid,
      rosterId,
      academicYear: "2026",
      semester,
      title: rosterId,
      scoreKind: "performance",
      totalScore: 28,
      totalMaxScore: 30,
    });
    fixtures.set(confirmationPath(ownerUid, rosterId), {
      uid: ownerUid,
      rosterId,
      signatureName: "삭제 검증 학생",
      signatureImage: "data:image/png;base64,dGVzdA==",
    });
  }
};
addRoster(teacherRosterId, { includeStale: true });
addRoster(adminRosterId, { includeStale: true });
addRoster(otherRosterId);
addRoster(archiveRosterId, { root: "years/2026/semesters/1", semester: "1" });

const seed = (env) =>
  env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all(
      [...fixtures].map(([path, data]) => setDoc(doc(db, path), data)),
    );
  });
const actorDatabase = (env, actor) =>
  env.authenticatedContext(actor.uid, { email: actor.email }).firestore();
const rosterQuery = (db, rosterId) =>
  query(
    collectionGroup(db, "performance_scores"),
    where("rosterId", "==", rosterId),
  );
const allFixturePaths = [...fixtures.keys()];
const assertFixtureState = (env, deletedPaths = new Set()) =>
  env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const path of allFixturePaths) {
      const snapshot = await getDoc(doc(db, path));
      assert.equal(
        snapshot.exists(),
        !deletedPaths.has(path),
        `Unexpected existence: ${path}`,
      );
      if (snapshot.exists())
        assert.deepEqual(
          snapshot.data(),
          fixtures.get(path),
          `Unexpected mutation: ${path}`,
        );
    }
  });

const initialize = (activeRules) =>
  initializeTestEnvironment({
    projectId,
    firestore: { host, port, rules: activeRules },
  });
const checks = [];
const check = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};

const reproduceOriginalFailure = async () => {
  const env = await initialize(originalRules);
  try {
    await env.clearFirestore();
    await seed(env);
    for (const role of ["teacher", "admin"]) {
      const db = actorDatabase(env, actors[role]);
      await assertSucceeds(
        getDoc(doc(db, scorePath(actors.student.uid, teacherRosterId))),
      );
      await assert.rejects(getDocs(rosterQuery(db, teacherRosterId)), {
        code: "permission-denied",
      });
    }
    await assertFixtureState(env);
    check(
      "original rules reproduce permission-denied before deletion for teacher and admin",
    );
  } finally {
    await env.cleanup();
  }
};

const verifyPatchedRules = async () => {
  const env = await initialize(rules);
  try {
    await env.clearFirestore();
    await seed(env);
    for (const role of ["student", "staff", "outsider", "anonymous"]) {
      const db =
        role === "anonymous"
          ? env.unauthenticatedContext().firestore()
          : actorDatabase(env, actors[role]);
      await assertFails(getDocs(rosterQuery(db, teacherRosterId)));
      for (const path of [
        scorePath(actors.student.uid, teacherRosterId),
        confirmationPath(actors.student.uid, teacherRosterId),
        rosterPath(teacherRosterId),
      ]) {
        await assertFails(deleteDoc(doc(db, path)));
      }
      check(
        `${role} cannot query all students or delete scores, confirmations, and upload history`,
      );
    }
    await assertFixtureState(env);
    const studentDb = actorDatabase(env, actors.student);
    await assertSucceeds(
      getDoc(doc(studentDb, scorePath(actors.student.uid, teacherRosterId))),
    );
    await assertFails(
      getDoc(doc(studentDb, scorePath(staleUid, teacherRosterId))),
    );
    check(
      "student can still read own score but cannot read another student's score",
    );

    const deletedPaths = new Set();
    for (const [role, rosterId] of [
      ["teacher", teacherRosterId],
      ["admin", adminRosterId],
    ]) {
      const db = actorDatabase(env, actors[role]);
      const snapshot = await assertSucceeds(getDocs(rosterQuery(db, rosterId)));
      assert.deepEqual(
        snapshot.docs.map((entry) => entry.ref.path).sort(),
        [
          scorePath(actors.student.uid, rosterId),
          scorePath(staleUid, rosterId),
        ].sort(),
        "The query must include old student links absent from the current roster.",
      );
      const batch = writeBatch(db);
      snapshot.docs.forEach((entry) => {
        const uid = entry.ref.parent.parent.id;
        const confirmation = confirmationPath(uid, rosterId);
        batch.delete(doc(db, confirmation));
        batch.delete(entry.ref);
        deletedPaths.add(confirmation);
        deletedPaths.add(entry.ref.path);
      });
      await assertSucceeds(batch.commit());
      await assertSucceeds(deleteDoc(doc(db, rosterPath(rosterId))));
      deletedPaths.add(rosterPath(rosterId));
      assert.equal(
        (await assertSucceeds(getDocs(rosterQuery(db, rosterId)))).size,
        0,
      );
      await assertFixtureState(env, deletedPaths);
      check(
        `${role} deletes selected upload, linked and stale scores, and confirmations; other assessment and semester remain unchanged`,
      );
    }
  } finally {
    await env.cleanup();
  }
};

try {
  await reproduceOriginalFailure();
  await verifyPatchedRules();
  console.log(
    JSON.stringify(
      {
        projectId,
        emulator: `${host}:${port}`,
        checks,
        limitation:
          "The Firestore emulator does not verify production collection-group index availability.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
