import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID ||
  "demo-westory-session-w10p-lesson-reward";
assert.equal(projectId, "demo-westory-session-w10p-lesson-reward");
assert.notEqual(projectId, "history-quiz-yongsin");
for (const variable of [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
]) {
  assert.ok(process.env[variable], `${variable} is required.`);
}
assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^127\.0\.0\.1:\d+$/);
const firestorePort = Number(process.env.FIRESTORE_EMULATOR_HOST.split(":")[1]);
assert.ok(
  Number.isInteger(firestorePort) && firestorePort > 0 && firestorePort < 65536,
);

const year = "2026";
const semester = "2";
const semesterId = `${year}-${semester}`;
const region = "asia-northeast3";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];
const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};
const password = () => `${randomBytes(24).toString("base64url")}Aa1!`;
const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const hashId = (prefix, ...parts) => `${prefix}_${sha256(parts.join("\n"))}`;

const makeClient = (name) => {
  const app = initializeApp(firebaseConfig, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  const db = getFirestore(app);
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
  client.proof = {
    authorityGeneration: result.authorityGeneration,
    protocolVersion: result.protocolVersion,
    revision: result.revision,
  };
};

const execute = (client, commandType, payload, options = {}) =>
  httpsCallable(
    client.functions,
    "executeLessonCorePointCommand",
  )({
    commandId: options.commandId || randomUUID(),
    commandType,
    payload,
    _session: client.proof,
    ...(options.dropResponse ? { _testDropResponseAfterCommit: true } : {}),
    ...(options.abortBeforeCommit ? { _testAbortBeforeCommit: true } : {}),
  });

const reason = (error) =>
  String(
    error?.details?.reason ||
      error?.customData?.details?.reason ||
      error?.code ||
      error?.message,
  );

const expectReason = async (operation, expected) => {
  try {
    await (typeof operation === "function" ? operation() : operation);
  } catch (error) {
    assert.equal(reason(error), expected);
    return error;
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

const readDocument = (testEnv, path) =>
  withAdminDb(testEnv, async (db) => {
    const snapshot = await getDoc(doc(db, path));
    return snapshot.exists() ? snapshot.data() : null;
  });

const readCollection = (testEnv, path) =>
  withAdminDb(testEnv, async (db) => {
    const snapshot = await getDocs(collection(db, path));
    return snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
  });

const commonPayload = { year, semester };

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: firestorePort, rules },
  });
  const student = makeClient("w10p-lesson-reward-student");
  const unenrolled = makeClient("w10p-lesson-reward-unenrolled");
  const teacher = makeClient("w10p-lesson-reward-teacher");

  try {
    await testEnv.clearFirestore();
    student.user = (
      await createUserWithEmailAndPassword(
        student.auth,
        "w10p-lesson-student@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    unenrolled.user = (
      await createUserWithEmailAndPassword(
        unenrolled.auth,
        "w10p-lesson-unenrolled@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    teacher.user = (
      await createUserWithEmailAndPassword(
        teacher.auth,
        "w10p-lesson-teacher@yongshin-ms.ms.kr",
        password(),
      )
    ).user;

    const classId = "w10p-lesson-class";
    const enrollmentId = "w10p-lesson-enrollment";
    const accountId = hashId("wisacct", semesterId, student.user.uid);
    await withAdminDb(testEnv, async (db) => {
      await Promise.all([
        setDoc(doc(db, "users", student.user.uid), {
          role: "student",
          teacherPortalEnabled: false,
        }),
        setDoc(doc(db, "users", unenrolled.user.uid), {
          role: "student",
          teacherPortalEnabled: false,
        }),
        setDoc(doc(db, "users", teacher.user.uid), {
          role: "teacher",
          teacherPortalEnabled: true,
          staffPermissions: ["lesson_read", "point_manage"],
        }),
        setDoc(doc(db, "site_settings", "semester_active"), {
          semesterId,
          activeSemesterId: semesterId,
          revision: 1,
        }),
        setDoc(doc(db, "site_settings", "config"), {
          year: Number(year),
          semester: Number(semester),
          activeSemesterId: semesterId,
          semesterWritesEnabled: true,
        }),
        setDoc(doc(db, "semester_manifests", semesterId), {
          semesterId,
          schoolYear: Number(year),
          term: Number(semester),
          revision: 1,
          status: "ACTIVE",
          shellState: "CURRENT",
        }),
        setDoc(doc(db, "semester_classes", classId), {
          classId,
          semesterId,
          status: "ACTIVE",
          grade: "2",
          classNumber: "3",
        }),
        setDoc(doc(db, "semester_enrollments", enrollmentId), {
          enrollmentId,
          semesterId,
          studentUid: student.user.uid,
          classId,
          displayName: "W10P 합성 학생",
          status: "ACTIVE",
          enrollmentStatus: "ACTIVE",
        }),
        setDoc(
          doc(
            db,
            "semester_enrollment_slots",
            `slot_${sha256(`${semesterId}\n${student.user.uid}`).slice(0, 40)}`,
          ),
          {
            semesterId,
            studentUid: student.user.uid,
            activeEnrollmentId: enrollmentId,
            revision: 1,
            status: "ACTIVE",
          },
        ),
        setDoc(doc(db, "semester_wis_economies", semesterId), {
          schemaVersion: 1,
          policyVersion: "w7-v1",
          integrityVersion: "w10p-aggregate-v1",
          semesterId,
          revision: 1,
          status: "ACTIVE_OPEN",
          currencyName: "위스",
          provenance: "CURRENT",
          readOnly: false,
          accountCount: 1,
          initializedAccountCount: 1,
          ledgerEntryCount: 0,
          inventoryCount: 0,
          orderCount: 0,
          unresolvedLegacyIssueCount: 0,
        }),
        setDoc(doc(db, "semester_wis_accounts", accountId), {
          schemaVersion: 1,
          policyVersion: "w7-v1",
          accountId,
          semesterId,
          studentUid: student.user.uid,
          enrollmentId,
          classId,
          displayName: "W10P 합성 학생",
          status: "ACTIVE",
          provenance: "CURRENT",
          readOnly: false,
          revision: 1,
          balance: 100,
          earnedTotal: 100,
          rankEarnedTotal: 100,
          spentTotal: 0,
          adjustedTotal: 0,
          recentLedgerEntries: [],
        }),
        setDoc(doc(db, "semester_wis_balances", accountId), {
          accountId,
          semesterId,
          studentUid: student.user.uid,
          balance: 100,
          earnedTotal: 100,
          rankEarnedTotal: 100,
          spentTotal: 0,
          adjustedTotal: 0,
          ledgerRevision: 1,
        }),
        setDoc(doc(db, "semester_wis_rankings", accountId), {
          accountId,
          semesterId,
          studentUid: student.user.uid,
          displayName: "W10P 합성 학생",
          balance: 100,
          rankEarnedTotal: 100,
          ledgerRevision: 1,
        }),
        setDoc(
          doc(db, `years/${year}/semesters/${semester}/lessons/lesson-1`),
          {
            unitId: "unit-1",
            title: "합성 핵심포인트 수업",
            isVisibleToStudents: true,
            worksheetExamHighlights: [
              { id: "core-1", widthRatio: 0.2, heightRatio: 0.1 },
              { id: "core-2", widthRatio: 0.2, heightRatio: 0.1 },
            ],
          },
        ),
      ]);
    });

    await Promise.all([
      openSession(student),
      openSession(unenrolled),
      openSession(teacher),
    ]);

    await withAdminDb(testEnv, (db) =>
      setDoc(
        doc(db, "site_settings", "semester_active"),
        { revision: 2 },
        { merge: true },
      ),
    );
    await expectReason(
      execute(student, "recordLessonCorePointFind", {
        ...commonPayload,
        unitId: "unit-1",
        corePointId: "core-1",
      }),
      "LESSON_CORE_POINT_SEMESTER_NOT_ACTIVE",
    );
    await withAdminDb(testEnv, (db) =>
      setDoc(
        doc(db, "site_settings", "semester_active"),
        { revision: 1 },
        { merge: true },
      ),
    );

    await expectReason(
      execute(teacher, "recordLessonCorePointFind", {
        ...commonPayload,
        unitId: "unit-1",
        corePointId: "core-1",
      }),
      "LESSON_CORE_POINT_STUDENT_REQUIRED",
    );
    await expectReason(
      execute(unenrolled, "recordLessonCorePointFind", {
        ...commonPayload,
        unitId: "unit-1",
        corePointId: "core-1",
      }),
      "LESSON_CORE_POINT_ACTIVE_ENROLLMENT_REQUIRED",
    );
    const conflictingEnrollmentId = "w10p-conflicting-enrollment";
    await withAdminDb(testEnv, async (db) => {
      await Promise.all([
        setDoc(doc(db, "semester_enrollments", conflictingEnrollmentId), {
          enrollmentId: conflictingEnrollmentId,
          semesterId,
          studentUid: unenrolled.user.uid,
          classId,
          status: "ACTIVE",
          enrollmentStatus: "TRANSFERRED",
        }),
        setDoc(
          doc(
            db,
            "semester_enrollment_slots",
            `slot_${sha256(`${semesterId}\n${unenrolled.user.uid}`).slice(0, 40)}`,
          ),
          {
            semesterId,
            studentUid: unenrolled.user.uid,
            activeEnrollmentId: conflictingEnrollmentId,
            revision: 1,
            status: "ACTIVE",
          },
        ),
      ]);
    });
    await expectReason(
      execute(unenrolled, "recordLessonCorePointFind", {
        ...commonPayload,
        unitId: "unit-1",
        corePointId: "core-1",
      }),
      "LESSON_CORE_POINT_ACTIVE_ENROLLMENT_REQUIRED",
    );
    await expectReason(
      execute(student, "recordLessonCorePointFind", {
        ...commonPayload,
        unitId: "unit-1",
        corePointId: "forged-core-point",
      }),
      "LESSON_CORE_POINT_NOT_CANONICAL",
    );
    assert.equal((await readCollection(testEnv, "command_receipts")).length, 0);

    const firstRecordId = randomUUID();
    const firstRecord = (
      await execute(
        student,
        "recordLessonCorePointFind",
        { ...commonPayload, unitId: "unit-1", corePointId: "core-1" },
        { commandId: firstRecordId },
      )
    ).data;
    assert.equal(firstRecord.replayed, false);
    assert.equal(firstRecord.result.progressRevision, 1);
    const firstReplay = (
      await execute(
        student,
        "recordLessonCorePointFind",
        { ...commonPayload, unitId: "unit-1", corePointId: "core-1" },
        { commandId: firstRecordId },
      )
    ).data;
    assert.equal(firstReplay.replayed, true);
    assert.deepEqual(firstReplay.result, firstRecord.result);
    await expectReason(
      execute(
        student,
        "recordLessonCorePointFind",
        { ...commonPayload, unitId: "unit-1", corePointId: "core-2" },
        { commandId: firstRecordId },
      ),
      "LESSON_CORE_POINT_COMMAND_ID_CONFLICT",
    );

    const progressPath = `years/${year}/semesters/${semester}/lesson_progress/${student.user.uid}/units/unit-1`;
    const beforeAbort = await readDocument(testEnv, progressPath);
    await expectReason(
      execute(
        student,
        "recordLessonCorePointFind",
        { ...commonPayload, unitId: "unit-1", corePointId: "core-2" },
        { abortBeforeCommit: true },
      ),
      "TEST_COMMIT_ABORT",
    );
    assert.deepEqual(await readDocument(testEnv, progressPath), beforeAbort);
    assert.equal((await readCollection(testEnv, "command_receipts")).length, 1);

    const responseLossRecordId = randomUUID();
    await expectReason(
      execute(
        student,
        "recordLessonCorePointFind",
        { ...commonPayload, unitId: "unit-1", corePointId: "core-2" },
        { commandId: responseLossRecordId, dropResponse: true },
      ),
      "TEST_RESPONSE_LOSS",
    );
    const completedProgress = await readDocument(testEnv, progressPath);
    assert.deepEqual(completedProgress.corePointFinds, ["core-1", "core-2"]);
    assert.equal(completedProgress.revision, 2);
    const recoveredRecord = (
      await execute(
        student,
        "recordLessonCorePointFind",
        { ...commonPayload, unitId: "unit-1", corePointId: "core-2" },
        { commandId: responseLossRecordId },
      )
    ).data;
    assert.equal(recoveredRecord.replayed, true);

    const movedEnrollmentId = "w10p-lesson-enrollment-after-move";
    await withAdminDb(testEnv, async (db) => {
      await Promise.all([
        setDoc(
          doc(db, "semester_enrollments", enrollmentId),
          { enrollmentStatus: "TRANSFERRED", status: "ACTIVE" },
          { merge: true },
        ),
        setDoc(doc(db, "semester_enrollments", movedEnrollmentId), {
          enrollmentId: movedEnrollmentId,
          semesterId,
          studentUid: student.user.uid,
          classId,
          displayName: "W10P 합성 학생",
          enrollmentStatus: "ACTIVE",
        }),
        setDoc(
          doc(
            db,
            "semester_enrollment_slots",
            `slot_${sha256(`${semesterId}\n${student.user.uid}`).slice(0, 40)}`,
          ),
          {
            semesterId,
            studentUid: student.user.uid,
            activeEnrollmentId: movedEnrollmentId,
            revision: 2,
            status: "ACTIVE",
          },
          { merge: true },
        ),
      ]);
    });

    await expectReason(
      execute(student, "claimLessonCorePointReward", {
        ...commonPayload,
        amount: 999999,
      }),
      "LESSON_CORE_POINT_PAYLOAD_INVALID",
    );
    const accountPath = `semester_wis_accounts/${accountId}`;
    const accountBeforeClaimAbort = await readDocument(testEnv, accountPath);
    const receiptsBeforeClaimAbort = (
      await readCollection(testEnv, "command_receipts")
    ).length;
    await expectReason(
      execute(student, "claimLessonCorePointReward", commonPayload, {
        abortBeforeCommit: true,
      }),
      "TEST_COMMIT_ABORT",
    );
    assert.deepEqual(
      await readDocument(testEnv, accountPath),
      accountBeforeClaimAbort,
    );
    assert.equal(
      (await readCollection(testEnv, "semester_wis_ledger")).length,
      0,
    );
    assert.equal(
      (await readDocument(testEnv, `semester_wis_economies/${semesterId}`))
        .ledgerEntryCount,
      0,
    );
    assert.equal(
      (await readCollection(testEnv, "command_receipts")).length,
      receiptsBeforeClaimAbort,
    );

    const responseLossClaimId = randomUUID();
    const [, concurrentClaim] = await Promise.all([
      expectReason(
        execute(student, "claimLessonCorePointReward", commonPayload, {
          commandId: responseLossClaimId,
          dropResponse: true,
        }),
        "TEST_RESPONSE_LOSS",
      ),
      execute(student, "claimLessonCorePointReward", commonPayload),
    ]);
    const accountAfterClaim = await readDocument(testEnv, accountPath);
    assert.equal(accountAfterClaim.balance, 600);
    assert.equal(accountAfterClaim.revision, 2);
    assert.equal(accountAfterClaim.enrollmentId, enrollmentId);
    assert.equal(accountAfterClaim.earnedTotal, 600);
    assert.equal(accountAfterClaim.rankEarnedTotal, 600);
    assert.equal(accountAfterClaim.spentTotal, 0);
    assert.equal(accountAfterClaim.adjustedTotal, 500);
    const balanceAfterClaim = await readDocument(
      testEnv,
      `semester_wis_balances/${accountId}`,
    );
    assert.equal(balanceAfterClaim.balance, 600);
    assert.equal(balanceAfterClaim.earnedTotal, 600);
    assert.equal(balanceAfterClaim.rankEarnedTotal, 600);
    assert.equal(balanceAfterClaim.spentTotal, 0);
    assert.equal(balanceAfterClaim.adjustedTotal, 500);
    assert.equal(balanceAfterClaim.ledgerRevision, 2);
    const rankingAfterClaim = await readDocument(
      testEnv,
      `semester_wis_rankings/${accountId}`,
    );
    assert.equal(rankingAfterClaim.balance, 600);
    assert.equal(rankingAfterClaim.rankEarnedTotal, 600);
    assert.equal(rankingAfterClaim.ledgerRevision, 2);
    const ledgerAfterClaim = await readCollection(
      testEnv,
      "semester_wis_ledger",
    );
    assert.equal(ledgerAfterClaim.length, 1);
    assert.equal(ledgerAfterClaim[0].data.delta, 500);
    assert.equal(ledgerAfterClaim[0].data.sourceId, "lesson-core-points-all");
    assert.equal(
      (await readDocument(testEnv, `semester_wis_economies/${semesterId}`))
        .ledgerEntryCount,
      1,
    );
    assert.equal(accountAfterClaim.recentLedgerEntries.length, 1);
    assert.deepEqual(
      accountAfterClaim.recentLedgerEntries[0],
      ledgerAfterClaim[0].data,
    );
    const studentCore = (
      await httpsCallable(
        student.functions,
        "getWisEconomyState",
      )({
        audience: "student",
        semesterId,
        source: "CURRENT",
        _session: student.proof,
      })
    ).data;
    assert.equal(studentCore.ledger.length, 1);
    assert.equal(
      studentCore.ledger[0].ledgerEntryId,
      ledgerAfterClaim[0].data.ledgerEntryId,
    );
    const recoveredClaim = (
      await execute(student, "claimLessonCorePointReward", commonPayload, {
        commandId: responseLossClaimId,
      })
    ).data;
    assert.equal(recoveredClaim.replayed, true);
    assert.equal(
      Number(recoveredClaim.result.awarded) +
        Number(concurrentClaim.data.result.awarded),
      1,
      "different concurrent command IDs must produce exactly one award",
    );

    const duplicateClaim = (
      await execute(student, "claimLessonCorePointReward", commonPayload)
    ).data;
    assert.equal(duplicateClaim.result.awarded, false);
    assert.equal(duplicateClaim.result.duplicate, true);
    assert.equal(duplicateClaim.result.settled, true);
    assert.equal((await readDocument(testEnv, accountPath)).balance, 600);
    assert.equal(
      (await readCollection(testEnv, "semester_wis_ledger")).length,
      1,
    );
    assert.equal(
      (await readDocument(testEnv, `semester_wis_economies/${semesterId}`))
        .ledgerEntryCount,
      1,
    );

    await expectReason(
      httpsCallable(
        student.functions,
        "applyPointActivityReward",
      )({
        ...commonPayload,
        activityType: "lesson_core_points",
        sourceId: "lesson-core-points-all",
        _session: student.proof,
      }),
      "CLIENT_UPDATE_REQUIRED",
    );

    const receipts = await readCollection(testEnv, "command_receipts");
    const audits = await readCollection(testEnv, "command_audit_events");
    assert.equal(receipts.length, audits.length);
    assert.equal(
      receipts.filter(
        (item) => item.data.commandType === "claimLessonCorePointReward",
      ).length,
      3,
    );

    console.log(
      JSON.stringify({
        suite: "w10p-lesson-core-point-integration",
        passed: true,
        canonicalFinds: 2,
        rewardAmount: 500,
        ledgerEntries: 1,
        concurrentClaimCommands: 2,
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
