import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w4";
const region = "asia-northeast3";
const adminEmail = "westoria28@gmail.com";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];
const config = {
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};
const password = () => `${randomBytes(24).toString("base64url")}Aa1!`;

const makeClient = (name) => {
  const app = initializeApp(config, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const functions = getFunctions(app, region);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { app, auth, db, functions, proof: null, user: null };
};

const openSession = async (client) => {
  const result = (
    await httpsCallable(
      client.functions,
      "openApplicationSession",
    )({
      authorityGeneration: "w1r2-2026-08-09",
      protocolVersion: 2,
    })
  ).data;
  assert.equal(result.status, "active");
  client.proof = {
    authorityGeneration: result.authorityGeneration,
    protocolVersion: result.protocolVersion,
    revision: result.revision,
  };
};

const execute = (client, commandType, payload, options = {}) => {
  const commandId = options.commandId || randomUUID();
  return httpsCallable(
    client.functions,
    "executeCommand",
  )({
    commandId,
    commandType,
    payload,
    _session: client.proof,
    ...(options.dropResponse ? { _testDropResponseAfterCommit: true } : {}),
  });
};

const queryFunction = (client, name, payload) =>
  httpsCallable(client.functions, name)({ ...payload, _session: client.proof });

const reason = (error) =>
  String(
    error?.details?.reason ||
      error?.customData?.details?.reason ||
      error?.code ||
      error?.message,
  );

const expectReason = async (operation, expected) => {
  try {
    await operation();
  } catch (error) {
    assert.equal(reason(error), expected);
    return;
  }
  throw new Error(`Expected ${expected}.`);
};

const withAdminDb = async (testEnv, operation) => {
  let result;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    result = await operation(context.firestore());
  });
  return result;
};

const readCollection = (testEnv, path) =>
  withAdminDb(testEnv, async (db) => {
    const snapshot = await getDocs(collection(db, path));
    return snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
  });

const readDocument = (testEnv, path) =>
  withAdminDb(testEnv, async (db) => {
    const snapshot = await getDoc(doc(db, path));
    return snapshot.exists() ? snapshot.data() : null;
  });

const artifacts = (testEnv, commandId) =>
  withAdminDb(testEnv, async (db) => {
    const [receipts, audits] = await Promise.all([
      getDocs(
        query(
          collection(db, "command_receipts"),
          where("commandId", "==", commandId),
        ),
      ),
      getDocs(
        query(
          collection(db, "command_audit_events"),
          where("commandId", "==", commandId),
        ),
      ),
    ]);
    return {
      receipts: receipts.docs.map((item) => item.data()),
      audits: audits.docs.map((item) => item.data()),
    };
  });

const roster = (semesterId, rosterId, revision) => ({
  semesterId,
  expectedSemesterRevision: revision,
  rosterId,
  importRevision: 1,
  sourceLabel: "W4 emulator synthetic roster",
  sourceHash: (semesterId === "2026-2" ? "a" : "b").repeat(64),
  effectiveFrom: semesterId === "2026-2" ? "2026-08-01" : "2027-03-01",
  expectedStudentUids: ["synthetic-student-1", "synthetic-student-2"],
  classes: [
    {
      grade: "1",
      classNumber: "1",
      displayName: "1학년 1반",
      homeroomTeacherUid: "synthetic-teacher-1",
    },
  ],
  entries: [
    {
      studentUid: "synthetic-student-1",
      displayName: "합성 학생 1",
      classKey: "1::1",
      studentNumber: "1",
    },
    {
      studentUid: "synthetic-student-2",
      displayName: "합성 학생 2",
      classKey: "1::1",
      studentNumber: "2",
    },
  ],
  reason: "W4 emulator synthetic roster",
});

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
  const admin = makeClient("w4-admin-client");
  const outsider = makeClient("w4-outsider-client");
  try {
    await testEnv.clearFirestore();
    admin.user = (
      await createUserWithEmailAndPassword(admin.auth, adminEmail, password())
    ).user;
    outsider.user = (
      await createUserWithEmailAndPassword(
        outsider.auth,
        "outsider@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    await withAdminDb(testEnv, async (db) => {
      await Promise.all([
        setDoc(doc(db, "users", admin.user.uid), {
          role: "teacher",
          teacherPortalEnabled: true,
        }),
        setDoc(doc(db, "users", outsider.user.uid), { role: "student" }),
        setDoc(doc(db, "users", "synthetic-teacher-1"), {
          role: "teacher",
          teacherPortalEnabled: true,
          w4SyntheticFixture: true,
        }),
        setDoc(doc(db, "users", "synthetic-student-1"), {
          role: "student",
          studentName: "합성 학생 1",
          w4SyntheticFixture: true,
          w4HomeroomTeacherUid: "synthetic-teacher-1",
        }),
        setDoc(doc(db, "users", "synthetic-student-2"), {
          role: "student",
          studentName: "합성 학생 2",
          w4SyntheticFixture: true,
          w4HomeroomTeacherUid: "synthetic-teacher-1",
        }),
        setDoc(doc(db, "semester_manifests", "2026-2"), {
          semesterId: "2026-2",
          schoolYear: "2026",
          term: "2",
          displayName: "2026학년도 2학기",
          status: "ACTIVE",
          provenance: "CURRENT",
          revision: 1,
          stateRevision: 1,
          schemaVersion: 1,
          readinessPolicyVersion: "w3-v1",
          startAt: "2026-08-01",
          endAt: "2026-12-31",
          blockingIssues: [],
        }),
        setDoc(doc(db, "site_settings", "semester_active"), {
          semesterId: "2026-2",
          revision: 1,
        }),
        setDoc(doc(db, "site_settings", "config"), {
          year: "2026",
          semester: "2",
          activeSemesterId: "2026-2",
          activeSemesterRevision: 1,
          semesterLifecycleStatus: "ACTIVE",
          semesterWritesEnabled: true,
        }),
      ]);
    });
    await openSession(admin);
    await openSession(outsider);

    const currentRoster = roster("2026-2", "w4-current-roster-v1", 1);
    const previewWritesBefore = (
      await readCollection(testEnv, "command_receipts")
    ).length;
    const preview = (
      await queryFunction(admin, "previewEnrollmentRoster", currentRoster)
    ).data;
    assert.equal(preview.passed, true);
    assert.equal(preview.writeCount, 0);
    assert.equal(
      (await readCollection(testEnv, "command_receipts")).length,
      previewWritesBefore,
    );

    const invalidPreview = (
      await queryFunction(admin, "previewEnrollmentRoster", {
        ...currentRoster,
        rosterId: "w4-invalid-roster",
        expectedStudentUids: [
          "synthetic-student-1",
          "synthetic-student-1",
          "missing-student",
        ],
        classes: [currentRoster.classes[0], currentRoster.classes[0]],
        entries: [currentRoster.entries[0], currentRoster.entries[0]],
      })
    ).data;
    assert.equal(invalidPreview.passed, false);
    assert.ok(invalidPreview.summary.duplicateStudentCount > 0);
    assert.ok(invalidPreview.summary.duplicateClassCount > 0);
    assert.ok(invalidPreview.summary.missingStudentCount > 0);

    const importId = randomUUID();
    const importPayload = {
      ...currentRoster,
      validationHash: preview.validationHash,
    };
    const [firstImport, replayImport] = await Promise.all([
      execute(admin, "importEnrollmentRoster", importPayload, {
        commandId: importId,
      }),
      execute(admin, "importEnrollmentRoster", importPayload, {
        commandId: importId,
      }),
    ]);
    assert.deepEqual(firstImport.data.result, replayImport.data.result);
    assert.deepEqual(
      [firstImport.data.replayed, replayImport.data.replayed].sort(),
      [false, true],
    );
    assert.equal(
      (await readCollection(testEnv, "student_identities")).length,
      2,
    );
    assert.equal((await readCollection(testEnv, "semester_classes")).length, 1);
    assert.equal(
      (await readCollection(testEnv, "semester_enrollments")).length,
      2,
    );
    assert.equal(
      (await readCollection(testEnv, "semester_enrollment_slots")).length,
      2,
    );
    assert.equal(
      (await readCollection(testEnv, "enrollment_roster_imports")).length,
      1,
    );
    const importArtifacts = await artifacts(testEnv, importId);
    assert.equal(importArtifacts.receipts.length, 1);
    assert.equal(importArtifacts.audits.length, 1);
    assert.equal(importArtifacts.receipts[0].result.createdEnrollmentCount, 2);

    const sameRoster = await execute(
      admin,
      "importEnrollmentRoster",
      importPayload,
    );
    assert.equal(sameRoster.data.result.replayedImport, true);
    assert.equal(
      (await readCollection(testEnv, "semester_enrollments")).length,
      2,
    );

    const queryWritesBefore = (
      await readCollection(testEnv, "command_receipts")
    ).length;
    const currentState = (
      await queryFunction(admin, "getArchiveEnrollmentState", {
        source: "CURRENT",
        callSite: "verify-w4-integration-current",
      })
    ).data;
    assert.equal(currentState.provenance, "CURRENT");
    assert.equal(currentState.legacy, false);
    assert.equal(currentState.enrollments.length, 2);
    assert.equal(
      (await readCollection(testEnv, "command_receipts")).length,
      queryWritesBefore,
    );

    await expectReason(
      () =>
        execute(outsider, "prepareSemesterArchive", {
          semesterId: "2026-2",
          expectedRevision: 1,
          accessPolicy: "ADMIN_ONLY",
          sourcePaths: ["semester_classes"],
          unresolvedLegacyItems: [],
          reason: "unauthorized",
        }),
      "COMMAND_ADMIN_REQUIRED",
    );

    const prepared = await execute(admin, "prepareSemesterArchive", {
      semesterId: "2026-2",
      expectedRevision: 1,
      accessPolicy: "ADMIN_ONLY",
      sourcePaths: [
        "semester_classes",
        "semester_enrollments",
        "enrollment_roster_imports",
      ],
      unresolvedLegacyItems: [],
      reason: "W4 archive preparation",
    });
    assert.equal(prepared.data.result.archiveStatus, "PREPARED");

    const createdFuture = await execute(admin, "createSemesterManifest", {
      schoolYear: "2027",
      term: "1",
      displayName: "2027학년도 1학기",
      startDate: "2027-03-01",
      endDate: "2027-07-31",
    });
    const future = roster(
      "2027-1",
      "w4-future-roster-v1",
      createdFuture.data.result.semester.revision,
    );
    const futurePreview = (
      await queryFunction(admin, "previewEnrollmentRoster", future)
    ).data;
    assert.equal(futurePreview.passed, true);
    await execute(admin, "importEnrollmentRoster", {
      ...future,
      validationHash: futurePreview.validationHash,
    });
    await execute(admin, "transitionSemesterStatus", {
      semesterId: "2027-1",
      expectedRevision: 1,
      targetStatus: "PREPARING",
      reason: "W4 readiness integration",
    });
    const validation = await execute(admin, "validateSemesterReadiness", {
      semesterId: "2027-1",
      expectedRevision: 1,
    });
    assert.equal(validation.data.result.status, "PASS");
    const report = await readDocument(
      testEnv,
      "semester_readiness_reports/2027-1",
    );
    const requiredChecks = report.checks.filter((check) => check.required);
    const passedRequiredChecks = requiredChecks.filter(
      (check) => check.status === "PASS",
    );
    assert.equal(validation.data.result.requiredTotal, requiredChecks.length);
    assert.equal(
      validation.data.result.requiredPassed,
      passedRequiredChecks.length,
    );
    assert.equal(report.requiredTotal, requiredChecks.length);
    assert.equal(report.requiredPassed, passedRequiredChecks.length);
    assert.deepEqual(
      report.checks
        .filter((check) =>
          [
            "archive_readiness",
            "class_readiness",
            "enrollment_readiness",
          ].includes(check.checkId),
        )
        .map((check) => [check.checkId, check.status]),
      [
        ["archive_readiness", "PASS"],
        ["class_readiness", "PASS"],
        ["enrollment_readiness", "PASS"],
      ],
    );

    const futureClass = (
      await readCollection(testEnv, "semester_classes")
    ).find((item) => item.data.semesterId === "2027-1").data;
    const lossId = randomUUID();
    await expectReason(
      () =>
        execute(
          admin,
          "updateSemesterClass",
          {
            semesterId: "2027-1",
            classId: futureClass.classId,
            expectedRevision: 1,
            displayName: "1학년 가반",
            homeroomTeacherUid: "synthetic-teacher-1",
            status: "ACTIVE",
            reason: "readiness stale and response loss",
          },
          { commandId: lossId, dropResponse: true },
        ),
      "TEST_RESPONSE_LOSS",
    );
    const lossStatus = (
      await queryFunction(admin, "getCommandStatus", {
        commandId: lossId,
        commandType: "updateSemesterClass",
      })
    ).data;
    assert.equal(lossStatus.status, "SUCCEEDED");
    assert.equal(
      (await readDocument(testEnv, "semester_readiness_reports/2027-1")).status,
      "STALE",
    );

    await execute(admin, "transitionSemesterStatus", {
      semesterId: "2026-2",
      expectedRevision: 1,
      targetStatus: "CLOSING",
      reason: "W4 close",
    });
    await execute(admin, "transitionSemesterStatus", {
      semesterId: "2026-2",
      expectedRevision: 1,
      targetStatus: "CLOSED",
      reason: "W4 close complete",
    });
    const frozen = await execute(admin, "freezeSemesterArchive", {
      semesterId: "2026-2",
      expectedRevision: 1,
      expectedIntegrityHash: prepared.data.result.integrityHash,
      reason: "W4 archive freeze",
    });
    assert.equal(frozen.data.result.archiveStatus, "FROZEN");
    await execute(admin, "transitionSemesterStatus", {
      semesterId: "2026-2",
      expectedRevision: 1,
      targetStatus: "ARCHIVED",
      reason: "W4 archive complete",
    });
    await expectReason(
      () =>
        execute(admin, "createSemesterClass", {
          semesterId: "2026-2",
          expectedSemesterRevision: 1,
          grade: "2",
          classNumber: "1",
          displayName: "2학년 1반",
          homeroomTeacherUid: "synthetic-teacher-1",
          reason: "archived write",
        }),
      "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
    );

    const legacyWritesBefore = (
      await readCollection(testEnv, "command_receipts")
    ).length;
    const legacy = (
      await queryFunction(admin, "getArchiveEnrollmentState", {
        source: "LEGACY",
        semesterId: "2025-2",
        callSite: "verify-w4-integration-legacy",
      })
    ).data;
    assert.equal(legacy.provenance, "LEGACY");
    assert.equal(legacy.readOnly, true);
    assert.equal(legacy.schemaVersion, 0);
    assert.equal(
      (await readCollection(testEnv, "command_receipts")).length,
      legacyWritesBefore,
    );

    console.log(
      JSON.stringify({
        suite: "w4-archive-enrollment-integration",
        passed: true,
        cases: [
          "ROSTER_DRY_RUN_ZERO_WRITE_AND_VALIDATION_FAILURES",
          "CONCURRENT_IMPORT_SAME_COMMAND_EFFECT_ONCE",
          "SAME_ROSTER_NEW_COMMAND_NO_DUPLICATE",
          "FULL_RECEIPT_AUDIT",
          "CURRENT_QUERY_EXPLICIT_PROVENANCE_ZERO_WRITE",
          "UNAUTHORIZED_PRE_BUSINESS_ZERO_EFFECT",
          "ARCHIVE_PREPARE_INTEGRITY",
          "W4_READINESS_REQUIRED_14_OF_14_PASS",
          "W4_DEPENDENCY_CHANGE_STALE",
          "RESPONSE_LOSS_STATUS_RECOVERY",
          "CLOSE_FREEZE_ARCHIVE_LIFECYCLE",
          "ARCHIVED_SERVER_COMMAND_REJECTED",
          "LEGACY_EXPLICIT_READ_ONLY_ZERO_WRITE",
        ],
        productionAccess: 0,
      }),
    );
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await testEnv.cleanup();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
