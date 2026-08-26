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

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w3";
const adminUid = "w3-admin";
const adminEmail = "westoria28@gmail.com";
const teacherUid = "w3-teacher";
const teacherEmail = "w3-teacher@yongshin-ms.ms.kr";
const authTime = Math.floor(Date.now() / 1000) - 10;
const semesterId = "2027-2";
const semesterMetaSeed = {
  grading_plans_meta: { planCount: 2 },
  calendar_meta: { eventCount: 3 },
  notices_meta: { noticeCount: 4 },
};
const semesterMetaCollections = Object.keys(semesterMetaSeed);
const semesterMetaRef = (
  db,
  collectionName,
  documentId = "current",
  year = "2027",
  semester = "2",
) => doc(db, "years", year, "semesters", semester, collectionName, documentId);
const rules = readFileSync(resolve("firestore.rules"), "utf8");

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules,
  },
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(
        doc(db, "application_sessions", adminUid, "sessions", String(authTime)),
        {
          uid: adminUid,
          email: adminEmail,
          authTime,
          status: "active",
          schemaVersion: 2,
          authorityGeneration: "w1r2-2026-08-09",
          protocolVersion: 2,
          sessionRevision: "c".repeat(64),
          authorityModeAtOpen: "ENFORCE",
          generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
          highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
        },
      ),
      setDoc(
        doc(
          db,
          "application_sessions",
          teacherUid,
          "sessions",
          String(authTime),
        ),
        {
          uid: teacherUid,
          email: teacherEmail,
          authTime,
          status: "active",
          schemaVersion: 2,
          authorityGeneration: "w1r2-2026-08-09",
          protocolVersion: 2,
          sessionRevision: "d".repeat(64),
          authorityModeAtOpen: "ENFORCE",
          generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
          highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
        },
      ),
      setDoc(doc(db, "site_settings", "config"), {
        year: "2026",
        semester: "1",
        activeSemesterId: "2026-1",
      }),
      setDoc(doc(db, "site_settings", "semester_active"), {
        semesterId: "2026-1",
        revision: 1,
      }),
      setDoc(doc(db, "semester_manifests", semesterId), {
        semesterId,
        schoolYear: "2027",
        term: "2",
        status: "READY",
        revision: 3,
      }),
      setDoc(doc(db, "semester_readiness_reports", semesterId), {
        semesterId,
        status: "PASS",
        policyVersion: "w3-v1",
        evaluatedRevision: 3,
        reportId: "report-existing",
        requiredPassed: 11,
        requiredTotal: 11,
        stale: false,
        checks: [],
      }),
      setDoc(
        doc(
          db,
          "semester_readiness_reports",
          semesterId,
          "versions",
          "report-existing",
        ),
        {
          semesterId,
          status: "PASS",
          policyVersion: "w3-v1",
          evaluatedRevision: 3,
          requiredPassed: 11,
          requiredTotal: 11,
          stale: false,
          checks: [],
        },
      ),
      setDoc(doc(db, "site_settings", "school_config"), {
        schoolName: "회귀 검증 학교",
      }),
      setDoc(doc(db, "users", teacherUid), {
        email: teacherEmail,
        role: "teacher",
      }),
      setDoc(
        doc(db, "years", "2027", "semesters", "2", "point_policies", "current"),
        { manualAdjustEnabled: true },
      ),
      ...Object.entries(semesterMetaSeed).map(([collectionName, data]) =>
        setDoc(semesterMetaRef(db, collectionName), data),
      ),
    ]);
  });

  const adminDb = testEnv
    .authenticatedContext(adminUid, {
      email: adminEmail,
      auth_time: authTime,
    })
    .firestore();

  const manifestRef = doc(adminDb, "semester_manifests", semesterId);
  const latestReadinessRef = doc(
    adminDb,
    "semester_readiness_reports",
    semesterId,
  );
  const readinessVersionRef = doc(
    adminDb,
    "semester_readiness_reports",
    semesterId,
    "versions",
    "report-existing",
  );
  const activePointerRef = doc(adminDb, "site_settings", "semester_active");
  const configRef = doc(adminDb, "site_settings", "config");
  const semesterMetaRefs = semesterMetaCollections.map((collectionName) =>
    semesterMetaRef(adminDb, collectionName),
  );

  await assertSucceeds(getDoc(manifestRef));
  await assertSucceeds(getDoc(latestReadinessRef));
  await assertSucceeds(getDoc(readinessVersionRef));
  await assertSucceeds(getDoc(activePointerRef));
  await assertSucceeds(getDoc(configRef));
  for (const reference of semesterMetaRefs) {
    await assertSucceeds(getDoc(reference));
  }

  for (const reference of [
    manifestRef,
    latestReadinessRef,
    readinessVersionRef,
    activePointerRef,
    configRef,
  ]) {
    await assertFails(updateDoc(reference, { directClientMutation: true }));
    await assertFails(deleteDoc(reference));
  }

  for (const reference of semesterMetaRefs) {
    await assertFails(updateDoc(reference, { directClientMutation: true }));
    await assertFails(deleteDoc(reference));
  }

  await assertFails(
    getDoc(semesterMetaRef(adminDb, "calendar_meta", "preview")),
  );
  await assertFails(
    setDoc(semesterMetaRef(adminDb, "calendar_meta", "preview"), {
      eventCount: 1,
    }),
  );
  for (const collectionName of semesterMetaCollections) {
    await assertFails(
      setDoc(semesterMetaRef(adminDb, collectionName, "current", "2028", "1"), {
        directClientMutation: true,
      }),
    );
  }

  const teacherDb = testEnv
    .authenticatedContext(teacherUid, {
      email: teacherEmail,
      auth_time: authTime,
    })
    .firestore();
  const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();
  for (const collectionName of semesterMetaCollections) {
    await assertFails(getDoc(semesterMetaRef(teacherDb, collectionName)));
    await assertFails(
      getDoc(semesterMetaRef(unauthenticatedDb, collectionName)),
    );
  }

  await assertFails(
    setDoc(doc(adminDb, "semester_manifests", "2028-1"), {
      semesterId: "2028-1",
      status: "READY",
    }),
  );
  await assertFails(
    setDoc(doc(adminDb, "semester_readiness_reports", "2028-1"), {
      semesterId: "2028-1",
      status: "PASS",
    }),
  );
  await assertFails(
    setDoc(
      doc(
        adminDb,
        "semester_readiness_reports",
        semesterId,
        "versions",
        "report-direct",
      ),
      { semesterId, status: "PASS" },
    ),
  );

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      deleteDoc(doc(db, "site_settings", "config")),
      deleteDoc(doc(db, "site_settings", "semester_active")),
    ]);
  });
  await assertFails(setDoc(configRef, { year: "2027", semester: "2" }));
  await assertFails(
    setDoc(activePointerRef, {
      semesterId,
      revision: 2,
    }),
  );

  await assertSucceeds(
    setDoc(
      doc(adminDb, "site_settings", "school_config"),
      { schoolName: "기존 설정 경계 유지" },
      { merge: true },
    ),
  );
  await assertFails(
    updateDoc(
      doc(
        adminDb,
        "years",
        "2027",
        "semesters",
        "2",
        "point_policies",
        "current",
      ),
      { manualAdjustEnabled: false },
    ),
  );

  console.log(
    JSON.stringify({
      suite: "w3-semester-core-rules",
      passed: true,
      cases: [
        "SEMESTER_MANIFEST_CREATE_UPDATE_DELETE_DENIED",
        "READINESS_LATEST_CREATE_UPDATE_DELETE_DENIED",
        "READINESS_VERSION_CREATE_UPDATE_DELETE_DENIED",
        "ACTIVE_POINTER_CREATE_UPDATE_DELETE_DENIED",
        "COMPAT_CONFIG_CREATE_UPDATE_DELETE_DENIED",
        "SERVER_OWNED_DOCUMENTS_READABLE_TO_AUTHORIZED_CLIENT",
        "LEGACY_SEMESTER_META_CURRENT_READABLE_TO_ADMIN_ONLY",
        "LEGACY_SEMESTER_META_DIRECT_WRITES_DENIED",
        "UNMIGRATED_SETTINGS_WRITE_RETAINED_AND_W7_POINT_POLICY_WRITE_RETIRED",
      ],
    }),
  );
} finally {
  await testEnv.cleanup();
}
