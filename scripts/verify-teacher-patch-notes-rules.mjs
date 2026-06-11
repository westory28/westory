import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const projectId = "demo-westory-teacher-patch-notes";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const firestoreHost = "127.0.0.1";
const firestorePort = 8080;

const schoolEmail = (name) => `${name}@yongshin-ms.ms.kr`;

const teacherUid = "teacher-patch-owner";
const otherTeacherUid = "teacher-patch-other";
const staffUid = "teacher-patch-staff";
const studentUid = "teacher-patch-student";

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
  });

  const teacherDb = testEnv
    .authenticatedContext(teacherUid, { email: schoolEmail("teacher.patch") })
    .firestore();
  const otherTeacherDb = testEnv
    .authenticatedContext(otherTeacherUid, {
      email: schoolEmail("other.teacher.patch"),
    })
    .firestore();
  const studentDb = testEnv
    .authenticatedContext(studentUid, { email: schoolEmail("student.patch") })
    .firestore();
  const staffDb = testEnv
    .authenticatedContext(staffUid, { email: schoolEmail("staff.patch") })
    .firestore();

  const teacherNotes = collection(
    teacherDb,
    "teacherPatchNotes",
    teacherUid,
    "notes",
  );
  const teacherNoteRef = doc(teacherNotes, "note-1");

  await assertSucceeds(setDoc(teacherNoteRef, notePayload(teacherUid)));

  await assertSucceeds(getDocs(teacherNotes));

  await assertSucceeds(
    updateDoc(teacherNoteRef, {
      title: "알림장 이미지 교체 확인",
      updatedAt: serverTimestamp(),
    }),
  );

  await assertSucceeds(
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
      collection(otherTeacherDb, "teacherPatchNotes", teacherUid, "notes"),
    ),
  );

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

  await assertSucceeds(deleteDoc(teacherNoteRef));

  console.log(
    JSON.stringify(
      {
        projectId,
        checks: [
          "teacher can create own patch note",
          "teacher can list own patch notes",
          "teacher can update memo fields",
          "teacher can mark patch note done",
          "teacher cannot write another teacher path",
          "another teacher cannot read owner notes",
          "student cannot create patch notes",
          "staff portal user cannot create patch notes",
          "student sourcePath remains blocked",
          "unexpected payload fields remain blocked",
          "teacher can delete own patch note",
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
