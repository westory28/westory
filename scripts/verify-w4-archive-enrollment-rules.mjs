import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const projectId = "demo-westory-session-w4";
const adminUid = "w4-admin";
const staffUid = "w4-staff";
const studentUid = "w4-student";
const otherStudentUid = "w4-other-student";
const adminEmail = "westoria28@gmail.com";
const authTime = Math.floor(Date.now() / 1000) - 10;
const rules = readFileSync(resolve("firestore.rules"), "utf8");

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8080, rules },
});

const session = (uid, email) => ({
  uid,
  email,
  authTime,
  status: "active",
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "d".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
  highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(
        doc(db, "application_sessions", adminUid, "sessions", String(authTime)),
        session(adminUid, adminEmail),
      ),
      setDoc(
        doc(db, "application_sessions", staffUid, "sessions", String(authTime)),
        session(staffUid, "staff@yongshin-ms.ms.kr"),
      ),
      setDoc(
        doc(
          db,
          "application_sessions",
          studentUid,
          "sessions",
          String(authTime),
        ),
        session(studentUid, "student@yongshin-ms.ms.kr"),
      ),
      setDoc(
        doc(
          db,
          "application_sessions",
          otherStudentUid,
          "sessions",
          String(authTime),
        ),
        session(otherStudentUid, "other@yongshin-ms.ms.kr"),
      ),
      setDoc(doc(db, "users", staffUid), {
        role: "teacher",
        teacherPortalEnabled: true,
        staffPermissions: ["student_list_read"],
      }),
      setDoc(doc(db, "users", studentUid), { role: "student" }),
      setDoc(doc(db, "users", otherStudentUid), { role: "student" }),
      setDoc(doc(db, "semester_manifests", "2026-2"), {
        semesterId: "2026-2",
        status: "ACTIVE",
      }),
      setDoc(doc(db, "semester_manifests", "2026-1"), {
        semesterId: "2026-1",
        status: "ARCHIVED",
      }),
      setDoc(doc(db, "student_identities", studentUid), {
        studentUid,
        displayName: "학생",
      }),
      setDoc(doc(db, "student_identities", otherStudentUid), {
        studentUid: otherStudentUid,
        displayName: "다른 학생",
      }),
      setDoc(doc(db, "semester_classes", "class-current"), {
        classId: "class-current",
        semesterId: "2026-2",
        status: "ACTIVE",
      }),
      setDoc(doc(db, "semester_classes", "class-archive"), {
        classId: "class-archive",
        semesterId: "2026-1",
        status: "INACTIVE",
      }),
      setDoc(doc(db, "semester_enrollments", "enrollment-current"), {
        enrollmentId: "enrollment-current",
        semesterId: "2026-2",
        studentUid,
        enrollmentStatus: "ACTIVE",
      }),
      setDoc(doc(db, "semester_enrollments", "enrollment-other"), {
        enrollmentId: "enrollment-other",
        semesterId: "2026-2",
        studentUid: otherStudentUid,
        enrollmentStatus: "ACTIVE",
      }),
      setDoc(doc(db, "semester_enrollments", "enrollment-archive"), {
        enrollmentId: "enrollment-archive",
        semesterId: "2026-1",
        studentUid,
        enrollmentStatus: "COMPLETED",
      }),
      setDoc(doc(db, "semester_enrollment_slots", "slot-current"), {
        semesterId: "2026-2",
        studentUid,
        activeEnrollmentId: "enrollment-current",
      }),
      setDoc(doc(db, "enrollment_roster_imports", "roster-current"), {
        semesterId: "2026-2",
        status: "APPLIED",
      }),
      setDoc(doc(db, "semester_archive_manifests", "2026-1"), {
        semesterId: "2026-1",
        archiveStatus: "FROZEN",
        accessPolicy: "ADMIN_ONLY",
      }),
    ]);
  });

  const adminDb = testEnv
    .authenticatedContext(adminUid, { email: adminEmail, auth_time: authTime })
    .firestore();
  const staffDb = testEnv
    .authenticatedContext(staffUid, {
      email: "staff@yongshin-ms.ms.kr",
      auth_time: authTime,
    })
    .firestore();
  const studentDb = testEnv
    .authenticatedContext(studentUid, {
      email: "student@yongshin-ms.ms.kr",
      auth_time: authTime,
    })
    .firestore();

  const w4Paths = [
    ["student_identities", studentUid],
    ["semester_classes", "class-current"],
    ["semester_enrollments", "enrollment-current"],
    ["semester_enrollment_slots", "slot-current"],
    ["enrollment_roster_imports", "roster-current"],
    ["semester_archive_manifests", "2026-1"],
  ];
  for (const path of w4Paths) {
    const reference = doc(adminDb, ...path);
    await assertSucceeds(getDoc(reference));
    await assertFails(updateDoc(reference, { clientMutation: true }));
    await assertFails(deleteDoc(reference));
    await assertFails(
      setDoc(doc(adminDb, path[0], `${path[1]}-create`), {
        clientMutation: true,
      }),
    );
  }

  await assertSucceeds(getDoc(doc(staffDb, "student_identities", studentUid)));
  await assertSucceeds(
    getDoc(doc(staffDb, "semester_classes", "class-current")),
  );
  await assertSucceeds(
    getDoc(doc(staffDb, "semester_enrollments", "enrollment-current")),
  );
  await assertFails(getDoc(doc(staffDb, "semester_classes", "class-archive")));
  await assertFails(
    getDoc(doc(staffDb, "semester_enrollments", "enrollment-archive")),
  );
  await assertFails(
    getDoc(doc(staffDb, "enrollment_roster_imports", "roster-current")),
  );
  await assertFails(
    getDoc(doc(staffDb, "semester_archive_manifests", "2026-1")),
  );

  await assertSucceeds(
    getDoc(doc(studentDb, "student_identities", studentUid)),
  );
  await assertFails(
    getDoc(doc(studentDb, "student_identities", otherStudentUid)),
  );
  await assertSucceeds(
    getDoc(doc(studentDb, "semester_enrollments", "enrollment-current")),
  );
  await assertSucceeds(
    getDoc(doc(studentDb, "semester_enrollment_slots", "slot-current")),
  );
  await assertFails(
    getDoc(doc(studentDb, "semester_enrollments", "enrollment-other")),
  );
  await assertFails(
    getDoc(doc(studentDb, "semester_enrollments", "enrollment-archive")),
  );
  await assertFails(
    getDoc(doc(studentDb, "semester_classes", "class-current")),
  );

  console.log(
    JSON.stringify({
      suite: "w4-archive-enrollment-rules",
      passed: true,
      cases: [
        "W4_CANONICAL_COLLECTIONS_DIRECT_CREATE_UPDATE_DELETE_DENIED",
        "ADMIN_CAN_READ_CURRENT_AND_ARCHIVE",
        "STAFF_PERMISSION_CAN_READ_CURRENT_NOT_ARCHIVE",
        "STUDENT_CAN_READ_OWN_IDENTITY_ENROLLMENT_SLOT",
        "STUDENT_CANNOT_READ_OTHER_OR_ARCHIVE",
        "ROSTER_AND_ARCHIVE_ADMIN_ONLY",
      ],
      productionAccess: 0,
    }),
  );
} finally {
  await testEnv.cleanup();
}
