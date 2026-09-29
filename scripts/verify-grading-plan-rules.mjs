import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "demo-westory-grading-plans",
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync("firestore.rules", "utf8"),
  },
});

const schoolEmail = (uid) => `${uid}@yongshin-ms.ms.kr`;
const client = (uid, email = schoolEmail(uid)) =>
  testEnv.authenticatedContext(uid, { email }).firestore();
const payload = () => ({
  subject: "국어",
  targetGrade: "3",
  items: [
    { type: "정기", name: "2차 정기시험", maxScore: 100, ratio: 50 },
    { type: "수행", name: "문장 탐구", maxScore: 20, ratio: 20 },
    { type: "수행", name: "말하기", maxScore: 30, ratio: 30 },
  ],
  academicYear: "2026",
  semester: "2",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

try {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, role, extra] of [
      ["teacher", "teacher", {}],
      ["student", "student", {}],
      [
        "staff",
        "staff",
        {
          teacherPortalEnabled: true,
          staffPermissions: ["quiz_read", "point_manage"],
        },
      ],
      [
        "student-staff",
        "student",
        { teacherPortalEnabled: true, staffPermissions: ["quiz_read"] },
      ],
      ["external-teacher", "teacher", {}],
    ]) {
      await setDoc(doc(db, "users", uid), {
        uid,
        email: schoolEmail(uid),
        role,
        teacherPortalEnabled: false,
        staffPermissions: [],
        ...extra,
      });
    }
  });

  for (const path of [
    "grading_plans",
    "years/2026/semesters/2/grading_plans",
  ]) {
    const id = "korean-grade-3";
    const teacherRef = doc(client("teacher"), path, id);
    await assertSucceeds(setDoc(teacherRef, payload()));
    await assertSucceeds(
      updateDoc(teacherRef, {
        subject: "국어 평가",
        updatedAt: serverTimestamp(),
      }),
    );
    const saved = await assertSucceeds(getDoc(teacherRef));
    assert.equal(saved.data().subject, "국어 평가");
    assert.equal(saved.data().items.length, 3);
    assert.equal(saved.data().academicYear, "2026");
    assert.equal(saved.data().semester, "2");

    // Students still receive the plan but cannot alter any grading criterion.
    await assertSucceeds(getDoc(doc(client("student"), path, id)));
    for (const db of [
      client("student"),
      client("staff"),
      client("student-staff"),
      client("no-profile"),
      client("external-teacher", "external@example.com"),
      testEnv.unauthenticatedContext().firestore(),
    ]) {
      await assertFails(setDoc(doc(db, path, "unauthorized"), payload()));
      await assertFails(updateDoc(doc(db, path, id), { subject: "변조" }));
      await assertFails(deleteDoc(doc(db, path, id)));
    }
    await assertSucceeds(deleteDoc(teacherRef));

    const adminRef = doc(client("admin", "westoria28@gmail.com"), path, id);
    await assertSucceeds(setDoc(adminRef, payload()));
    await assertSucceeds(updateDoc(adminRef, { subject: "관리자 수정" }));
    await assertSucceeds(deleteDoc(adminRef));
  }
  console.log(
    "Grading plan rules verified: teacher/admin CRUD, student read, unauthorized writes denied in semester and legacy paths.",
  );
} finally {
  await testEnv.cleanup();
}
