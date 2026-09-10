import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as firestore from "firebase/firestore";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const projectId = "demo-westory-teacher-patch-notes";
const rules = readFileSync(
  resolve(process.env.WESTORY_FIRESTORE_RULES_PATH || "firestore.rules"),
  "utf8",
);
const firestoreHost = "127.0.0.1";
const firestorePort = Number(process.env.FIRESTORE_EMULATOR_HOST?.split(":").pop() || 8080);

const schoolEmail = (name) => `${name}@yongshin-ms.ms.kr`;

const teacherUid = "teacher-patch-owner";
const otherTeacherUid = "teacher-patch-other";
const staffUid = "teacher-patch-staff";
const studentUid = "teacher-patch-student";
const adminUid = "teacher-patch-admin";
const expiredUid = "teacher-patch-expired";
const revokedUid = "teacher-patch-revoked";
const protocolUid = "teacher-patch-old-protocol";
const revisionUid = "teacher-patch-wrong-revision";
const authTime = Math.floor(Date.now() / 1000) - 10;

const notePayload = (uid, overrides = {}) => ({
  ownerUid: uid,
  title: "알림장 이미지 수정 필요",
  body: "대시보드 알림장 이미지가 새로고침 직후 늦게 반영되는지 확인합니다.",
  type: "bug",
  priority: "high",
  status: "open",
  sourcePath: "/teacher/dashboard",
  targetLabel: "대시보드 알림장",
  targetText: "이미지 수정",
  targetSelector: '[data-patch-target="teacher-dashboard-notice"]',
  targetRect: {
    x: 100,
    y: 120,
    width: 320,
    height: 180,
  },
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  completedAt: null,
  ...overrides,
});

const seedUser = async (db, uid, email, role, extra = {}) => {
  await setDoc(doc(db, "users", uid), {
    uid,
    email,
    role,
    name: role === "teacher" ? "방재석 교사" : "사용자",
    staffPermissions: [],
    teacherPortalEnabled: false,
    customNameConfirmed: true,
    grade: "",
    class: "",
    number: "",
    ...extra,
  });
};

const seedSession = async (db, uid, email, overrides = {}) => {
  const sessionAuthTime = overrides.authTime ?? authTime;
  await setDoc(
    doc(db, "application_sessions", uid, "sessions", String(sessionAuthTime)),
    {
      uid,
      email,
      authTime: sessionAuthTime,
      status: "active",
      schemaVersion: 2,
      authorityGeneration: "w1r2-2026-08-09",
      protocolVersion: 2,
      sessionRevision: "a".repeat(64),
      authorityModeAtOpen: "ENFORCE",
      generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
      highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
      ...overrides,
    },
  );
};

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: firestoreHost,
      port: firestorePort,
      rules,
    },
  });

  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await seedUser(
      adminDb,
      teacherUid,
      schoolEmail("teacher.patch"),
      "teacher",
    );
    await seedUser(
      adminDb,
      otherTeacherUid,
      schoolEmail("other.teacher.patch"),
      "teacher",
    );
    await seedUser(
      adminDb,
      studentUid,
      schoolEmail("student.patch"),
      "student",
    );
    await seedUser(adminDb, staffUid, schoolEmail("staff.patch"), "staff", {
      teacherPortalEnabled: true,
      staffPermissions: ["lesson_read"],
    });
    await seedUser(adminDb, adminUid, "westoria28@gmail.com", "teacher");
    await Promise.all(
      [expiredUid, revokedUid, protocolUid, revisionUid].map((uid) =>
        seedUser(adminDb, uid, schoolEmail(uid), "teacher"),
      ),
    );
    await Promise.all([
      seedSession(adminDb, teacherUid, schoolEmail("teacher.patch")),
      seedSession(adminDb, otherTeacherUid, schoolEmail("other.teacher.patch")),
      seedSession(adminDb, studentUid, schoolEmail("student.patch")),
      seedSession(adminDb, staffUid, schoolEmail("staff.patch")),
      seedSession(adminDb, adminUid, "westoria28@gmail.com"),
      seedSession(adminDb, expiredUid, schoolEmail(expiredUid), {
        generalExpiresAt: Timestamp.fromMillis(Date.now() - 1000),
      }),
      seedSession(adminDb, revokedUid, schoolEmail(revokedUid), {
        status: "revoked",
      }),
      seedSession(adminDb, protocolUid, schoolEmail(protocolUid), {
        schemaVersion: 1,
        protocolVersion: 1,
      }),
      seedSession(adminDb, revisionUid, schoolEmail(revisionUid), {
        sessionRevision: "invalid-revision",
      }),
      seedSession(adminDb, teacherUid, schoolEmail("teacher.patch"), {
        authTime: authTime + 1,
      }),
    ]);
  });

  const teacherDb = testEnv
    .authenticatedContext(teacherUid, {
      email: schoolEmail("teacher.patch"),
      auth_time: authTime,
    })
    .firestore();
  const otherTeacherDb = testEnv
    .authenticatedContext(otherTeacherUid, {
      email: schoolEmail("other.teacher.patch"),
      auth_time: authTime,
    })
    .firestore();
  const studentDb = testEnv
    .authenticatedContext(studentUid, {
      email: schoolEmail("student.patch"),
      auth_time: authTime,
    })
    .firestore();
  const staffDb = testEnv
    .authenticatedContext(staffUid, {
      email: schoolEmail("staff.patch"),
      auth_time: authTime,
    })
    .firestore();
  const adminUserDb = testEnv
    .authenticatedContext(adminUid, {
      email: "westoria28@gmail.com",
      auth_time: authTime,
    })
    .firestore();
  const expiredDb = testEnv
    .authenticatedContext(expiredUid, {
      email: schoolEmail(expiredUid),
      auth_time: authTime,
    })
    .firestore();
  const revokedDb = testEnv
    .authenticatedContext(revokedUid, {
      email: schoolEmail(revokedUid),
      auth_time: authTime,
    })
    .firestore();
  const protocolDb = testEnv
    .authenticatedContext(protocolUid, {
      email: schoolEmail(protocolUid),
      auth_time: authTime,
    })
    .firestore();
  const revisionDb = testEnv
    .authenticatedContext(revisionUid, {
      email: schoolEmail(revisionUid),
      auth_time: authTime,
    })
    .firestore();
  const reauthenticatedTeacherDb = testEnv
    .authenticatedContext(teacherUid, {
      email: schoolEmail("teacher.patch"),
      auth_time: authTime + 1,
    })
    .firestore();
  const anonymousDb = testEnv.unauthenticatedContext().firestore();

  const teacherNotes = collection(
    teacherDb,
    "teacherPatchNotes",
    teacherUid,
    "notes",
  );
  const teacherNoteRef = doc(teacherNotes, "note-1");
  const ownNotesQuery = (db, uid) =>
    query(
      collection(db, "teacherPatchNotes", uid, "notes"),
      orderBy("updatedAt", "desc"),
      limit(100),
    );

  await assertFails(setDoc(teacherNoteRef, notePayload(teacherUid)));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "teacherPatchNotes", teacherUid, "notes", "note-1"), notePayload(teacherUid, { noteRevision: 1 }));
    await setDoc(doc(context.firestore(), "teacherPatchNotes", teacherUid, "notes", "legacy-note"), notePayload(teacherUid));
  });

  if (process.env.WESTORY_TEACHER_PATCH_RULE_CASE === "CREATE_ONLY") {
    console.log(
      JSON.stringify({
        projectId,
        checks: ["direct SDK create is blocked; trusted fixture seeded"],
      }),
    );
    await testEnv.cleanup();
    return;
  }

  await assertSucceeds(getDocs(ownNotesQuery(teacherDb, teacherUid)));

  await assertSucceeds(getDocs(ownNotesQuery(adminUserDb, adminUid)));

  await assertSucceeds(
    getDocs(ownNotesQuery(reauthenticatedTeacherDb, teacherUid)),
  );

  await assertFails(getDocs(teacherNotes));
  const legacyRef = doc(teacherNotes, "legacy-note");
  await assertFails(updateDoc(legacyRef, { title: "기존 메모 수정", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(legacyRef, { status: "done", updatedAt: serverTimestamp(), completedAt: serverTimestamp() }));
  await assertFails(deleteDoc(legacyRef));

  await assertFails(
    updateDoc(teacherNoteRef, {
      title: "알림장 이미지 교체 확인",
      updatedAt: serverTimestamp(),
    }),
  );

  await assertFails(
    updateDoc(teacherNoteRef, {
      status: "done",
      updatedAt: serverTimestamp(),
      completedAt: serverTimestamp(),
    }),
  );

  await assertFails(
    setDoc(
      doc(teacherDb, "teacherPatchNotes", otherTeacherUid, "notes", "note-2"),
      notePayload(otherTeacherUid),
    ),
  );

  await assertFails(
    getDocs(
      ownNotesQuery(otherTeacherDb, teacherUid),
    ),
  );

  await assertFails(
    getDocs(ownNotesQuery(anonymousDb, teacherUid)),
  );

  await assertFails(
    getDocs(ownNotesQuery(expiredDb, expiredUid)),
  );

  await assertFails(
    getDocs(ownNotesQuery(revokedDb, revokedUid)),
  );

  await assertFails(
    getDocs(ownNotesQuery(protocolDb, protocolUid)),
  );

  await assertFails(
    getDocs(ownNotesQuery(revisionDb, revisionUid)),
  );

  await assertFails(getDocs(collectionGroup(teacherDb, "notes")));

  await assertFails(
    setDoc(
      doc(studentDb, "teacherPatchNotes", studentUid, "notes", "note-3"),
      notePayload(studentUid),
    ),
  );

  await assertFails(
    setDoc(
      doc(staffDb, "teacherPatchNotes", staffUid, "notes", "note-4"),
      notePayload(staffUid),
    ),
  );

  await assertFails(
    setDoc(
      doc(teacherDb, "teacherPatchNotes", teacherUid, "notes", "note-5"),
      notePayload(teacherUid, { sourcePath: "/student/dashboard" }),
    ),
  );

  await assertFails(
    updateDoc(teacherNoteRef, {
      unexpectedField: true,
      updatedAt: serverTimestamp(),
    }),
  );

  await assertFails(deleteDoc(teacherNoteRef));

  // Exercise the actual client cursor helper with > 2 pages under real Rules.
  // Timestamp ties require the document snapshot's implicit name tiebreaker.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const batch = firestore.writeBatch(context.firestore());
    for (let index = 0; index < 205; index++) {
      batch.set(doc(context.firestore(), "teacherPatchNotes", teacherUid, "notes", `page-${String(index).padStart(3, "0")}`), {
        ...notePayload(teacherUid),
        status: index === 0 ? "open" : "done",
        updatedAt: Timestamp.fromMillis(1000),
        createdAt: Timestamp.fromMillis(1000),
        completedAt: null,
      });
    }
    await batch.commit();
  });
  const helperModule = { exports: {} };
  runInNewContext(transformSync(readFileSync("src/lib/teacherPatchNotes.ts", "utf8"), { loader: "ts", format: "cjs" }).code, {
    module: helperModule, exports: helperModule.exports, console, setTimeout, clearTimeout,
    require: name => name === "firebase/firestore" ? firestore : name === "./firebase" ? { db: teacherDb, auth: { currentUser: { uid: teacherUid } } } : {},
  });
  const loadPage = (after, expectedCount) => new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => { unsubscribe(); reject(Error("Page subscription timeout")); }, 15000);
    unsubscribe = helperModule.exports.subscribeTeacherPatchNotes(teacherUid, (notes, page) => {
      if (notes.length !== expectedCount) return;
      clearTimeout(timer); unsubscribe(); resolve({ notes, page });
    }, error => { clearTimeout(timer); unsubscribe(); reject(error); }, after);
  });
  const firstPage = await loadPage(undefined, 100);
  assert.equal(firstPage.page.hasNext, true);
  assert.equal(firstPage.page.nextCursor.snapshot.id, "page-107");
  // A deleted cursor document still carries stable ordering values.
  await testEnv.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), "teacherPatchNotes", teacherUid, "notes", "page-107")));
  const secondPage = await loadPage(firstPage.page.nextCursor, 100);
  const lastPage = await loadPage(secondPage.page.nextCursor, 7);
  assert.equal(lastPage.page.hasNext, false);
  assert.ok(lastPage.notes.some(note => note.id === "page-000" && note.status === "open"));
  const ids = [...firstPage.notes, ...secondPage.notes, ...lastPage.notes].map(note => note.id);
  assert.equal(new Set(ids).size, 207);
  let crossOwnerError = false;
  helperModule.exports.subscribeTeacherPatchNotes(otherTeacherUid, () => assert.fail("cross-owner cursor must not subscribe"), () => { crossOwnerError = true; }, firstPage.page.nextCursor);
  assert.equal(crossOwnerError, true);
  await assertFails(getDocs(query(teacherNotes, orderBy("updatedAt", "desc"), limit(101))));
  console.log(JSON.stringify({ pagination: "PASS", readOnlyClient: true, uniqueNotes: 207, pages: 3, oldestOpenReachable: true, timestampTieAndDeletedCursor: true, crossOwnerCursorBlocked: true }));

  console.log(
    JSON.stringify(
      {
        projectId,
        checks: [
          "direct SDK create is blocked",
          "teacher can list own patch notes",
          "admin can list own patch notes",
          "reauthenticated teacher can list own patch notes",
          "teacher query without required order and limit remains blocked",
          "direct SDK content update is blocked",
          "direct SDK status update is blocked",
          "teacher cannot write another teacher path",
          "another teacher cannot read owner notes",
          "anonymous cannot read patch notes",
          "expired session cannot read patch notes",
          "revoked session cannot read patch notes",
          "old schema and protocol cannot read patch notes",
          "invalid server revision cannot read patch notes",
          "unscoped collection-group query remains blocked",
          "student cannot create patch notes",
          "staff portal user cannot create patch notes",
          "student sourcePath remains blocked",
          "unexpected payload fields remain blocked",
          "direct SDK delete is blocked",
        ],
      },
      null,
      2,
    ),
  );

  await testEnv.cleanup();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
