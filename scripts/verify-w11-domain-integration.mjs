import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
  deleteDoc,
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
  process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w11";
assert.equal(projectId, "demo-westory-session-w11");
assert.notEqual(projectId, "history-quiz-yongsin");
for (const variable of [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
]) {
  assert.ok(process.env[variable], `${variable} is required.`);
}

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const cutover = requireFromFunctions("./semesterCutover.js");
const semesterCore = requireFromFunctions("./semesterCore.js");
const w8Domains = requireFromFunctions("./w8Domains.js");
const manifestSpec = JSON.parse(
  readFileSync(resolve("docs/manifests/2026-2-cutover-manifest.json"), "utf8"),
);
const sourceSemesterId = "2026-1";
const targetSemesterId = "2026-2";
const archiveSemesterId = "2025-2";
const region = "asia-northeast3";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];
const config = {
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};
const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const canonicalize = (value) => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value));
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
};
const normalizedPayloadHash = (commandType, payload) =>
  sha256(canonicalize(w8Domains.normalizeW8Payload(commandType, payload)));
const password = () => `${randomBytes(24).toString("base64url")}Aa1!`;
const makeClient = (name) => {
  const app = initializeApp(config, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const functions = getFunctions(app, region);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, db, functions, proof: null, user: null };
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
    "executeCommand",
  )({
    commandId: options.commandId || randomUUID(),
    commandType,
    payload,
    _session: client.proof,
    ...(options.dropResponse ? { _testDropResponseAfterCommit: true } : {}),
  });
const queryCutover = (client, payload) =>
  httpsCallable(
    client.functions,
    "getSemesterCutoverState",
  )({
    ...payload,
    _session: client.proof,
  });
const queryFunction = (client, name, payload) =>
  httpsCallable(
    client.functions,
    name,
  )({
    ...payload,
    _session: client.proof,
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
const hashDocument = (path, data, operationType = "UNKNOWN") => {
  const snapshot = cutover.snapshotFromRows([{ path, data }], {
    operationType,
    scope: data?.semesterId || "fixture",
  });
  return { count: snapshot.count, hash: snapshot.hash };
};
const emptySnapshot = {
  count: 0,
  hash: cutover.EMPTY_SNAPSHOT_HASH,
};
const recoverResponseLoss = async (client, commandId, commandType, payload) => {
  await expectReason(
    execute(client, commandType, payload, { commandId, dropResponse: true }),
    "TEST_RESPONSE_LOSS",
  );
  const status = (
    await httpsCallable(
      client.functions,
      "getCommandStatus",
    )({
      commandId,
      commandType,
      _session: client.proof,
    })
  ).data;
  assert.equal(status.status, "SUCCEEDED");
  const replay = (await execute(client, commandType, payload, { commandId }))
    .data;
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, status.result);
  return status.result;
};

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
  const admin = makeClient("w11-admin");
  const teacher = makeClient("w11-teacher");
  const student = makeClient("w11-student");
  try {
    await testEnv.clearFirestore();
    admin.user = (
      await createUserWithEmailAndPassword(
        admin.auth,
        "westoria28@gmail.com",
        password(),
      )
    ).user;
    teacher.user = (
      await createUserWithEmailAndPassword(
        teacher.auth,
        "w11-teacher@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    student.user = (
      await createUserWithEmailAndPassword(
        student.auth,
        "w11-student@yongshin-ms.ms.kr",
        password(),
      )
    ).user;

    const sourceManifest = {
      semesterId: sourceSemesterId,
      schoolYear: 2026,
      term: 1,
      revision: 4,
      status: "ACTIVE",
      provenance: "CURRENT",
      startAt: "2026-03-01",
      endAt: "2026-07-31",
    };
    const targetManifest = {
      semesterId: targetSemesterId,
      schoolYear: 2026,
      term: 2,
      displayName: "2026학년도 2학기",
      revision: 1,
      status: "PREPARING",
      provenance: "PREPARING",
      startAt: "2026-08-01",
      endAt: "2026-12-31",
      schemaVersion: semesterCore.SEMESTER_SCHEMA_VERSION,
      stateRevision: 1,
      readinessPolicyVersion: semesterCore.READINESS_POLICY_VERSION,
      blockingIssues: [],
      shellState: "COMPLETE",
      seedCount: 6,
      requiredSeedCount: 6,
    };
    const targetSeeds = semesterCore.getSemesterSeedDefinitions("2026", "2");
    targetManifest.seedRefs = targetSeeds.map((seed) => seed.path);
    const archiveManifest = {
      semesterId: archiveSemesterId,
      schoolYear: 2025,
      term: 2,
      revision: 9,
      status: "ARCHIVED",
      provenance: "ARCHIVE",
      startAt: "2025-08-01",
      endAt: "2025-12-31",
    };
    await withAdminDb(testEnv, async (db) => {
      await Promise.all([
        setDoc(doc(db, "users", admin.user.uid), { role: "admin" }),
        setDoc(doc(db, "users", teacher.user.uid), {
          role: "teacher",
          teacherPortalEnabled: true,
          staffPermissions: ["lesson_read"],
        }),
        setDoc(doc(db, "users", student.user.uid), { role: "student" }),
        setDoc(doc(db, "semester_manifests", sourceSemesterId), sourceManifest),
        setDoc(doc(db, "semester_manifests", targetSemesterId), targetManifest),
        setDoc(doc(db, "site_settings", "semester_active"), {
          semesterId: sourceSemesterId,
          revision: sourceManifest.revision,
        }),
        setDoc(doc(db, "site_settings", "config"), {
          activeSemesterId: sourceSemesterId,
          activeSemesterRevision: sourceManifest.revision,
          semesterLifecycleStatus: "ACTIVE",
          semesterWritesEnabled: true,
        }),
        setDoc(
          doc(db, "semester_manifests", archiveSemesterId),
          archiveManifest,
        ),
        ...targetSeeds.map((seed) =>
          setDoc(doc(db, seed.path), {
            ...seed.data,
            semesterId: targetSemesterId,
            schemaVersion: semesterCore.SEMESTER_SCHEMA_VERSION,
            seedState: "COMPLETE",
            managedBy: "semesterCore",
          }),
        ),
      ]);
    });
    await Promise.all([
      openSession(admin),
      openSession(teacher),
      openSession(student),
    ]);
    const targetRoster = {
      semesterId: targetSemesterId,
      expectedSemesterRevision: targetManifest.revision,
      rosterId: "w11-target-roster-v1",
      importRevision: 1,
      sourceLabel: "W11 emulator target master",
      sourceHash: "c".repeat(64),
      effectiveFrom: "2026-08-01",
      expectedStudentUids: [student.user.uid],
      classes: [
        {
          grade: "1",
          classNumber: "1",
          displayName: "1학년 1반",
          homeroomTeacherUid: teacher.user.uid,
        },
      ],
      entries: [
        {
          studentUid: student.user.uid,
          displayName: "W11 합성 학생",
          classKey: "1::1",
          studentNumber: "1",
        },
      ],
      reason: "W11 readiness target master",
    };
    const targetRosterPreview = (
      await queryFunction(admin, "previewEnrollmentRoster", targetRoster)
    ).data;
    assert.equal(targetRosterPreview.passed, true);
    assert.equal(targetRosterPreview.writeCount, 0);
    await execute(admin, "importEnrollmentRoster", {
      ...targetRoster,
      validationHash: targetRosterPreview.validationHash,
    });

    const expectedPlanId = cutover.planIdFor(
      manifestSpec.manifestVersion,
      sourceSemesterId,
      targetSemesterId,
    );
    const childIds = {
      LEARNING_CONTENT: randomUUID(),
      SCHEDULE_EVENTS: randomUUID(),
    };
    const operationKeyByType = Object.fromEntries(
      manifestSpec.selectiveClone.map((item, index) => [
        item.operationType,
        `dataset-${String(index + 1).padStart(2, "0")}`,
      ]),
    );
    const childPayloads = {
      LEARNING_CONTENT: {
        semesterId: targetSemesterId,
        expectedSemesterRevision: targetManifest.revision,
        cutoverPlanId: expectedPlanId,
        cutoverOperationKey: operationKeyByType.LEARNING_CONTENT,
        title: "W11 합성 학습",
        summary: "실제 Gateway receipt를 검증하는 합성 학습 자료입니다.",
        body: "W11 Cutover 리허설 전용 본문",
        resourceUrl: "",
        contentType: "LESSON",
        audienceRoles: ["student"],
        targetClassIds: [],
        availableFrom: "2026-08-01T00:00:00.000Z",
        availableUntil: "2026-12-31T23:59:59.000Z",
      },
      SCHEDULE_EVENTS: {
        semesterId: targetSemesterId,
        expectedSemesterRevision: targetManifest.revision,
        cutoverPlanId: expectedPlanId,
        cutoverOperationKey: operationKeyByType.SCHEDULE_EVENTS,
        eventType: "SCHOOL",
        title: "W11 합성 일정",
        description: "실제 Gateway receipt를 검증하는 합성 일정입니다.",
        startAt: "2026-08-17T00:00:00.000Z",
        endAt: "2026-08-17T01:00:00.000Z",
        allDay: false,
        period: "1",
        targetClassIds: [],
        targetUserIds: [],
        sourceDomain: "USER",
        sourceReference: "w11-cutover-emulator",
      },
    };
    const childHashes = {
      LEARNING_CONTENT: normalizedPayloadHash(
        "createLearningContent",
        childPayloads.LEARNING_CONTENT,
      ),
      SCHEDULE_EVENTS: normalizedPayloadHash(
        "createScheduleEvent",
        childPayloads.SCHEDULE_EVENTS,
      ),
    };
    const learningId = `learn_${sha256(
      `${targetSemesterId}\n${childIds.LEARNING_CONTENT}`,
    )}`;
    const learningPath = `semester_learning_contents/${learningId}`;
    const learningData = {
      schemaVersion: w8Domains.W8_SCHEMA_VERSION,
      policyVersion: w8Domains.W8_POLICY_VERSION,
      semesterId: targetSemesterId,
      provenance: "PREPARING",
      readOnly: true,
      cutoverPlanId: expectedPlanId,
      contentId: learningId,
      revision: 1,
      status: "DRAFT",
      title: childPayloads.LEARNING_CONTENT.title,
      summary: childPayloads.LEARNING_CONTENT.summary,
      body: childPayloads.LEARNING_CONTENT.body,
      resourceUrl: childPayloads.LEARNING_CONTENT.resourceUrl,
      contentType: childPayloads.LEARNING_CONTENT.contentType,
      audienceRoles: childPayloads.LEARNING_CONTENT.audienceRoles,
      targetClassIds: childPayloads.LEARNING_CONTENT.targetClassIds,
      availableFrom: childPayloads.LEARNING_CONTENT.availableFrom,
      availableUntil: childPayloads.LEARNING_CONTENT.availableUntil,
    };
    const scheduleId = `schedule_${sha256(
      `${targetSemesterId}\n${childIds.SCHEDULE_EVENTS}`,
    )}`;
    const schedulePath = `semester_schedule_events/${scheduleId}`;
    const scheduleData = {
      schemaVersion: w8Domains.W8_SCHEMA_VERSION,
      policyVersion: w8Domains.W8_POLICY_VERSION,
      semesterId: targetSemesterId,
      provenance: "PREPARING",
      readOnly: true,
      cutoverPlanId: expectedPlanId,
      eventId: scheduleId,
      revision: 1,
      status: "ACTIVE",
      eventType: childPayloads.SCHEDULE_EVENTS.eventType,
      title: childPayloads.SCHEDULE_EVENTS.title,
      description: childPayloads.SCHEDULE_EVENTS.description,
      startAt: childPayloads.SCHEDULE_EVENTS.startAt,
      endAt: childPayloads.SCHEDULE_EVENTS.endAt,
      allDay: childPayloads.SCHEDULE_EVENTS.allDay,
      period: childPayloads.SCHEDULE_EVENTS.period,
      targetClassIds: childPayloads.SCHEDULE_EVENTS.targetClassIds,
      targetUserIds: childPayloads.SCHEDULE_EVENTS.targetUserIds,
      sourceDomain: childPayloads.SCHEDULE_EVENTS.sourceDomain,
      sourceReference: childPayloads.SCHEDULE_EVENTS.sourceReference,
    };
    const sourceManifestSnapshot = hashDocument(
      `semester_manifests/${sourceSemesterId}`,
      sourceManifest,
      "SEMESTER_MANIFEST",
    );
    const targetManifestSnapshot = hashDocument(
      `semester_manifests/${targetSemesterId}`,
      targetManifest,
      "SEMESTER_MANIFEST",
    );
    const snapshotFromPaths = async (operationType, paths) => {
      const rows = [];
      for (const path of paths) {
        const data = await readDocument(testEnv, path);
        if (data) rows.push({ path, data });
      }
      const snapshot = cutover.snapshotFromRows(rows, {
        operationType,
        scope: targetSemesterId,
      });
      return { count: snapshot.count, hash: snapshot.hash };
    };
    const targetSettingsSnapshot = await snapshotFromPaths(
      "SEMESTER_SETTINGS",
      targetSeeds.map((seed) => seed.path),
    );
    const targetClassPaths = (await readCollection(testEnv, "semester_classes"))
      .filter((row) => row.data.semesterId === targetSemesterId)
      .map((row) => `semester_classes/${row.id}`);
    const targetClassSnapshot = await snapshotFromPaths(
      "SEMESTER_CLASSES",
      targetClassPaths,
    );
    const targetEnrollmentPaths = [];
    for (const collectionName of [
      "semester_enrollments",
      "semester_enrollment_slots",
      "enrollment_roster_imports",
    ]) {
      targetEnrollmentPaths.push(
        ...(await readCollection(testEnv, collectionName))
          .filter((row) => row.data.semesterId === targetSemesterId)
          .map((row) => `${collectionName}/${row.id}`),
      );
    }
    const targetEnrollmentSnapshot = await snapshotFromPaths(
      "SEMESTER_ENROLLMENTS",
      targetEnrollmentPaths,
    );
    const normalizedOperations = manifestSpec.selectiveClone.map(
      (item, index) => {
        const applicable = ["LEARNING_CONTENT", "SCHEDULE_EVENTS"].includes(
          item.operationType,
        );
        const definition = cutover.OPERATION_DEFINITIONS[item.operationType];
        const targetAfterSnapshot =
          item.operationType === "LEARNING_CONTENT"
            ? hashDocument(learningPath, learningData)
            : item.operationType === "SCHEDULE_EVENTS"
              ? hashDocument(schedulePath, scheduleData)
              : item.operationType === "SEMESTER_MANIFEST"
                ? targetManifestSnapshot
                : emptySnapshot;
        return {
          operationKey: operationKeyByType[item.operationType],
          operationOrder: index + 1,
          operationType: item.operationType,
          strategy: definition.strategy,
          applicable,
          childCommandType: applicable ? definition.commands[0] : null,
          childCommandId: applicable ? childIds[item.operationType] : null,
          childPayloadHash: applicable ? childHashes[item.operationType] : null,
          sourceSnapshot:
            item.operationType === "SEMESTER_MANIFEST"
              ? sourceManifestSnapshot
              : emptySnapshot,
          targetBeforeSnapshot:
            item.operationType === "SEMESTER_MANIFEST"
              ? targetManifestSnapshot
              : item.operationType === "SEMESTER_SETTINGS"
                ? targetSettingsSnapshot
                : item.operationType === "SEMESTER_CLASSES"
                  ? targetClassSnapshot
                  : item.operationType === "SEMESTER_ENROLLMENTS"
                    ? targetEnrollmentSnapshot
                    : emptySnapshot,
          targetAfterSnapshot:
            item.operationType === "SEMESTER_SETTINGS"
              ? targetSettingsSnapshot
              : item.operationType === "SEMESTER_CLASSES"
                ? targetClassSnapshot
                : item.operationType === "SEMESTER_ENROLLMENTS"
                  ? targetEnrollmentSnapshot
                  : targetAfterSnapshot,
        };
      },
    );
    const rawOperations = normalizedOperations.map(
      ({ strategy, ...operation }) => operation,
    );
    const planPayload = {
      manifestVersion: manifestSpec.manifestVersion,
      sourceSemesterId,
      targetSemesterId,
      sourceManifestRevision: sourceManifest.revision,
      targetManifestRevision: targetManifest.revision,
      copyDenylist: manifestSpec.copyDenylist,
      operations: rawOperations,
    };
    planPayload.manifestHash = cutover.computeManifestHash({
      ...planPayload,
      operations: normalizedOperations,
    });
    assert.deepEqual(
      cutover.normalizeCutoverPayload(
        cutover.CUTOVER_COMMAND_TYPES.CREATE_PLAN,
        planPayload,
      ).operations,
      normalizedOperations,
      "The emulator fixture must use the exact server-normalized manifest.",
    );

    await expectReason(
      execute(teacher, "createSemesterCutoverPlan", planPayload),
      "W11_ADMIN_REQUIRED",
    );
    await expectReason(
      queryCutover(student, { targetSemesterId }),
      "W11_ADMIN_REQUIRED",
    );

    const beforeQuery = await readCollection(testEnv, "semester_cutover_plans");
    const emptyState = (await queryCutover(admin, { targetSemesterId })).data;
    assert.equal(emptyState.writeCount, 0);
    assert.equal(emptyState.status, "EMPTY");
    assert.equal(emptyState.activationControlsAvailable, false);
    assert.equal(emptyState.productionControlsAvailable, false);
    assert.deepEqual(
      await readCollection(testEnv, "semester_cutover_plans"),
      beforeQuery,
    );

    const commandIds = {
      plan: randomUUID(),
      dryBlocked: randomUUID(),
      dryRetry: randomUUID(),
      applyPartial: randomUUID(),
      resume: randomUUID(),
      applyComplete: randomUUID(),
      verify: randomUUID(),
      validateReadiness: randomUUID(),
      transitionReady: randomUUID(),
      rollback: randomUUID(),
      restorePreparing: randomUUID(),
      revalidateReadiness: randomUUID(),
    };
    const sourceSnapshotBeforeArchive = sourceManifestSnapshot;
    const preparedSourceArchive = (
      await execute(admin, "prepareSemesterArchive", {
        semesterId: sourceSemesterId,
        expectedRevision: sourceManifest.revision,
        accessPolicy: "ADMIN_ONLY",
        sourcePaths: ["semester_learning_contents/w11-archive-source-sentinel"],
        unresolvedLegacyItems: [],
        reason: "W11 합성 source archive 준비",
      })
    ).data.result;
    assert.equal(preparedSourceArchive.archiveStatus, "PREPARED");
    for (const targetStatus of ["CLOSING", "CLOSED"]) {
      const transition = (
        await execute(admin, "transitionSemesterStatus", {
          semesterId: sourceSemesterId,
          expectedRevision: sourceManifest.revision,
          targetStatus,
          reason: `W11 합성 source ${targetStatus}`,
        })
      ).data.result;
      assert.equal(transition.status, targetStatus);
    }
    const frozenSourceArchive = (
      await execute(admin, "freezeSemesterArchive", {
        semesterId: sourceSemesterId,
        expectedRevision: sourceManifest.revision,
        expectedIntegrityHash: preparedSourceArchive.integrityHash,
        reason: "W11 합성 source archive freeze",
      })
    ).data.result;
    assert.equal(frozenSourceArchive.archiveStatus, "FROZEN");
    const archivedSource = (
      await execute(admin, "transitionSemesterStatus", {
        semesterId: sourceSemesterId,
        expectedRevision: sourceManifest.revision,
        targetStatus: "ARCHIVED",
        reason: "W11 합성 source archive 완료",
      })
    ).data.result;
    assert.equal(archivedSource.status, "ARCHIVED");
    const archivedSourceManifest = await readDocument(
      testEnv,
      `semester_manifests/${sourceSemesterId}`,
    );
    assert.equal(archivedSourceManifest.status, "ARCHIVED");
    assert.deepEqual(
      hashDocument(
        `semester_manifests/${sourceSemesterId}`,
        archivedSourceManifest,
        "SEMESTER_MANIFEST",
      ),
      sourceSnapshotBeforeArchive,
    );
    assert.equal(
      (
        await httpsCallable(
          teacher.functions,
          "getW8DomainState",
        )({
          domain: "LEARNING",
          audience: "teacher",
          semesterId: sourceSemesterId,
          source: "ARCHIVE",
          _session: teacher.proof,
        })
      ).data.readOnly,
      true,
    );
    assert.equal(
      (
        await getDoc(doc(admin.db, "semester_manifests", sourceSemesterId))
      ).data()?.status,
      "ARCHIVED",
    );
    await expectReason(
      execute(admin, "createSemesterClass", {
        semesterId: sourceSemesterId,
        expectedSemesterRevision: sourceManifest.revision,
        grade: "1",
        classNumber: "9",
        displayName: "Archived source write fence",
        homeroomTeacherUid: teacher.user.uid,
        reason: "W11 archive 일반 명령 fence 검증",
      }),
      "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
    );
    const plan = await recoverResponseLoss(
      admin,
      commandIds.plan,
      "createSemesterCutoverPlan",
      planPayload,
    );
    assert.equal(plan.operationCount, 12);
    const planId = plan.planId;
    assert.equal(planId, expectedPlanId);
    const attemptId = plan.attemptId;
    const blockedActivityPath = `semester_learning_progress/w11-blocked-dry-run-${admin.user.uid}`;
    await withAdminDb(testEnv, (db) =>
      setDoc(doc(db, blockedActivityPath), {
        semesterId: targetSemesterId,
        progressId: "w11-blocked-dry-run",
        studentUid: admin.user.uid,
      }),
    );
    const blockedDryPayload = { planId, expectedPlanRevision: 1 };
    const blockedDry = (
      await execute(admin, "dryRunSemesterCutover", blockedDryPayload, {
        commandId: commandIds.dryBlocked,
      })
    ).data.result;
    assert.equal(blockedDry.status, "BLOCKED");
    assert.equal(blockedDry.activityZero, false);
    assert.equal(blockedDry.attemptRevision, 1);
    assert.equal(blockedDry.deterministicAttemptReused, false);
    await expectReason(
      execute(admin, "dryRunSemesterCutover", {
        planId,
        expectedPlanRevision: 2,
      }),
      "W11_ATTEMPT_REVISION_REQUIRED",
    );
    await withAdminDb(testEnv, (db) => deleteDoc(doc(db, blockedActivityPath)));
    const dryPayload = {
      planId,
      expectedPlanRevision: 2,
      expectedAttemptRevision: 1,
    };
    await withAdminDb(testEnv, (db) =>
      setDoc(
        doc(db, "semester_cutover_targets", targetSemesterId),
        { latestAttemptId: `cutattempt_${"e".repeat(64)}` },
        { merge: true },
      ),
    );
    await expectReason(
      execute(admin, "dryRunSemesterCutover", dryPayload),
      "W11_CUTOVER_TARGET_ATTEMPT_MISMATCH",
    );
    await withAdminDb(testEnv, (db) =>
      setDoc(
        doc(db, "semester_cutover_targets", targetSemesterId),
        { latestAttemptId: attemptId },
        { merge: true },
      ),
    );
    const dry = (
      await execute(admin, "dryRunSemesterCutover", dryPayload, {
        commandId: commandIds.dryRetry,
      })
    ).data.result;
    assert.equal(dry.status, "DRY_RUN_PASSED");
    assert.equal(dry.activityZero, true);
    assert.equal(dry.attemptId, blockedDry.attemptId);
    assert.equal(dry.attemptRevision, 2);
    assert.equal(dry.deterministicAttemptReused, true);
    assert.equal(dry.counts.pending, 2);
    assert.equal(dry.counts.notApplicable, 10);

    const learningOperation = normalizedOperations.find(
      (item) => item.operationType === "LEARNING_CONTENT",
    );
    const scheduleOperation = normalizedOperations.find(
      (item) => item.operationType === "SCHEDULE_EVENTS",
    );
    const learningReceiptId = cutover.receiptIdFor(
      admin.user.uid,
      learningOperation.childCommandType,
      learningOperation.childCommandId,
    );
    const scheduleReceiptId = cutover.receiptIdFor(
      admin.user.uid,
      scheduleOperation.childCommandType,
      scheduleOperation.childCommandId,
    );
    const createdLearning = await recoverResponseLoss(
      admin,
      learningOperation.childCommandId,
      learningOperation.childCommandType,
      childPayloads.LEARNING_CONTENT,
    );
    assert.equal(createdLearning.contentId, learningId);
    assert.equal(createdLearning.status, "DRAFT");
    const learningReceipt = await readDocument(
      testEnv,
      `command_receipts/${learningReceiptId}`,
    );
    assert.equal(
      learningReceipt.payloadHash,
      learningOperation.childPayloadHash,
    );
    assert.deepEqual(learningReceipt.target.refs, [learningPath]);
    const learningAudit = await readDocument(
      testEnv,
      `command_audit_events/${learningReceiptId}`,
    );
    assert.equal(learningReceipt.audit.eventId, learningReceiptId);
    assert.equal(
      learningReceipt.audit.ref,
      `command_audit_events/${learningReceiptId}`,
    );
    assert.equal(
      learningAudit.receiptRef,
      `command_receipts/${learningReceiptId}`,
    );
    assert.equal(learningAudit.payloadHash, learningReceipt.payloadHash);
    assert.equal(learningAudit.actorUid, learningReceipt.actorUid);
    assert.equal(learningReceipt.actorRole, "admin");
    assert.equal(learningReceipt.actorEmail, "westoria28@gmail.com");
    assert.ok(learningReceipt.actorCapability);
    assert.equal(
      learningReceipt.session.ref,
      `application_sessions/${learningReceipt.actorUid}/sessions/${learningReceipt.session.authTime}`,
    );
    assert.ok(learningReceipt.session.authTime > 0);
    assert.ok(learningReceipt.session.authorityMode);
    assert.ok(learningReceipt.session.authorityGeneration);
    assert.ok(learningReceipt.session.protocolVersion > 0);
    assert.match(learningReceipt.session.revisionHash, /^[0-9a-f]{64}$/u);
    assert.equal("observedFailure" in learningReceipt.session, true);
    assert.equal(
      hashDocument(learningPath, await readDocument(testEnv, learningPath))
        .hash,
      hashDocument(learningPath, learningData).hash,
    );
    assert.equal(await readDocument(testEnv, schedulePath), null);
    const partialPayload = {
      planId,
      attemptId,
      expectedPlanRevision: 3,
      expectedAttemptRevision: 2,
      operationKeys: [
        learningOperation.operationKey,
        scheduleOperation.operationKey,
      ],
      failures: [
        {
          operationKey: scheduleOperation.operationKey,
          errorCode: "SYNTHETIC_CHILD_FAILURE",
          errorReason: "명시적 부분 실패 리허설",
        },
      ],
    };
    await withAdminDb(testEnv, (db) =>
      setDoc(
        doc(db, "semester_cutover_targets", targetSemesterId),
        { latestPlanId: `cutplan_${"f".repeat(64)}` },
        { merge: true },
      ),
    );
    await expectReason(
      execute(admin, "applySemesterCutoverBatch", partialPayload),
      "W11_CUTOVER_TARGET_PLAN_MISMATCH",
    );
    await withAdminDb(testEnv, (db) =>
      setDoc(
        doc(db, "semester_cutover_targets", targetSemesterId),
        { latestPlanId: planId },
        { merge: true },
      ),
    );
    const partial = (
      await execute(admin, "applySemesterCutoverBatch", partialPayload, {
        commandId: commandIds.applyPartial,
      })
    ).data.result;
    assert.equal(partial.status, "PARTIAL");
    assert.equal(partial.counts.succeeded, 1);
    assert.equal(partial.counts.failed, 1);
    assert.equal(partial.canonicalBusinessWriteCount, 0);

    const resumePayload = {
      planId,
      attemptId,
      expectedPlanRevision: 4,
      expectedAttemptRevision: 3,
      operationKeys: [scheduleOperation.operationKey],
      reason: "실패한 합성 일정만 복구합니다.",
    };
    const resumed = (
      await execute(admin, "resumeSemesterCutover", resumePayload, {
        commandId: commandIds.resume,
      })
    ).data.result;
    assert.equal(resumed.successfulItemEffectCount, 0);
    assert.deepEqual(resumed.childCommandIds, [
      scheduleOperation.childCommandId,
    ]);
    await expectReason(
      execute(admin, "resumeSemesterCutover", {
        ...resumePayload,
        expectedPlanRevision: 5,
        expectedAttemptRevision: 4,
        operationKeys: [learningOperation.operationKey],
      }),
      "W11_RESUME_ITEM_INVALID",
    );

    const createdSchedule = (
      await execute(
        admin,
        scheduleOperation.childCommandType,
        childPayloads.SCHEDULE_EVENTS,
        { commandId: scheduleOperation.childCommandId },
      )
    ).data.result;
    assert.equal(createdSchedule.eventId, scheduleId);
    assert.equal(createdSchedule.status, "ACTIVE");
    const scheduleReceipt = await readDocument(
      testEnv,
      `command_receipts/${scheduleReceiptId}`,
    );
    assert.equal(
      scheduleReceipt.payloadHash,
      scheduleOperation.childPayloadHash,
    );
    assert.deepEqual(scheduleReceipt.target.refs, [schedulePath]);
    assert.equal(
      hashDocument(schedulePath, await readDocument(testEnv, schedulePath))
        .hash,
      hashDocument(schedulePath, scheduleData).hash,
    );
    const completePayload = {
      planId,
      attemptId,
      expectedPlanRevision: 5,
      expectedAttemptRevision: 4,
      operationKeys: [scheduleOperation.operationKey],
      failures: [],
    };
    const completed = (
      await execute(admin, "applySemesterCutoverBatch", completePayload, {
        commandId: commandIds.applyComplete,
      })
    ).data.result;
    assert.equal(completed.status, "APPLIED");
    assert.equal(completed.counts.succeeded, 2);
    assert.equal(completed.counts.notApplicable, 10);

    const archiveBefore = hashDocument(
      `semester_manifests/${archiveSemesterId}`,
      await readDocument(testEnv, `semester_manifests/${archiveSemesterId}`),
    );
    const verifyPayload = {
      planId,
      attemptId,
      expectedPlanRevision: 6,
      expectedAttemptRevision: 5,
    };
    const verified = (
      await execute(admin, "verifySemesterCutover", verifyPayload, {
        commandId: commandIds.verify,
      })
    ).data.result;
    assert.equal(verified.status, "VERIFIED");
    assert.equal(verified.pointerMutationCount, 0);
    assert.equal(verified.activationMutationCount, 0);
    assert.equal(
      (await readCollection(testEnv, "semester_cutover_evidence")).length,
      1,
    );

    const readinessPayload = {
      semesterId: targetSemesterId,
      expectedRevision: targetManifest.revision,
    };
    const readiness = (
      await execute(admin, "validateSemesterReadiness", readinessPayload, {
        commandId: commandIds.validateReadiness,
      })
    ).data.result;
    if (readiness.status !== "PASS") {
      const failedReadinessReport = await readDocument(
        testEnv,
        `semester_readiness_reports/${targetSemesterId}`,
      );
      console.error(
        "W11 readiness blocker evidence",
        JSON.stringify(failedReadinessReport?.checks || []),
      );
    }
    assert.equal(readiness.status, "PASS");
    assert.equal(readiness.requiredPassed, readiness.requiredTotal);
    const readinessReport = await readDocument(
      testEnv,
      `semester_readiness_reports/${targetSemesterId}`,
    );
    assert.equal(
      readinessReport.checks.find(
        (check) => check.checkId === cutover.READINESS_CHECK_ID,
      )?.status,
      "PASS",
    );
    const readyPayload = {
      semesterId: targetSemesterId,
      expectedRevision: targetManifest.revision,
      targetStatus: "READY",
      reason: "W11 검증 증거와 W3 readiness를 확인했습니다.",
    };
    const ready = (
      await execute(admin, "transitionSemesterStatus", readyPayload, {
        commandId: commandIds.transitionReady,
      })
    ).data.result;
    assert.equal(ready.status, "READY");
    assert.equal(ready.revision, targetManifest.revision);

    await withAdminDb(testEnv, async (db) => {
      const current = await getDoc(doc(db, learningPath));
      assert.equal(current.exists(), true);
      await setDoc(
        current.ref,
        {
          ...current.data(),
          revision: 2,
          body: `${current.data().body}\nW11 dependency drift fault injection`,
        },
        { merge: false },
      );
    });
    const staleReadinessPayload = {
      semesterId: targetSemesterId,
      expectedRevision: targetManifest.revision,
    };
    const staleReadiness = (
      await execute(admin, "validateSemesterReadiness", staleReadinessPayload, {
        commandId: commandIds.revalidateReadiness,
      })
    ).data.result;
    assert.equal(staleReadiness.status, "FAIL");
    const staleReport = await readDocument(
      testEnv,
      `semester_readiness_reports/${targetSemesterId}`,
    );
    const staleCutoverCheck = staleReport.checks.find(
      (check) => check.checkId === cutover.READINESS_CHECK_ID,
    );
    assert.equal(staleCutoverCheck.status, "FAIL");
    assert.equal(
      staleCutoverCheck.failureReason,
      "SEMESTER_CUTOVER_EVIDENCE_STALE",
    );
    const restorePreparingPayload = {
      semesterId: targetSemesterId,
      expectedRevision: targetManifest.revision,
      targetStatus: "PREPARING",
      reason: "W11 stale 판정 뒤 rollback-plan 준비 상태 복원",
    };
    const restored = (
      await execute(
        admin,
        "transitionSemesterStatus",
        restorePreparingPayload,
        { commandId: commandIds.restorePreparing },
      )
    ).data.result;
    assert.equal(restored.status, "PREPARING");

    const rollbackPayload = {
      planId,
      attemptId,
      expectedPlanRevision: 7,
      expectedAttemptRevision: 6,
      reason: "합성 target 보상 순서만 계획합니다.",
    };
    const rollback = (
      await execute(admin, "createSemesterRollbackPlan", rollbackPayload, {
        commandId: commandIds.rollback,
      })
    ).data.result;
    assert.equal(rollback.status, "ROLLBACK_PLANNED");
    assert.equal(rollback.canonicalBusinessWriteCount, 0);
    assert.equal(rollback.pointerMutationCount, 0);
    assert.equal(rollback.activationMutationCount, 0);
    assert.deepEqual(
      rollback.steps.map((step) => step.operationKey),
      [scheduleOperation.operationKey, learningOperation.operationKey],
    );
    assert.deepEqual(
      rollback.steps.map((step) => step.receiptId),
      [scheduleReceiptId, learningReceiptId],
    );
    assert.deepEqual(rollback.steps[0].targetRefs, [schedulePath]);
    assert.deepEqual(rollback.steps[1].targetRefs, [learningPath]);
    assert.equal(
      rollback.steps.every(
        (step) =>
          Array.isArray(step.expectedTargetRevisions) &&
          step.expectedTargetRevisions.every(
            (revision) =>
              step.targetRefs.includes(revision.ref) &&
              typeof revision.revisionField === "string" &&
              revision.revisionField.length > 0 &&
              Number.isSafeInteger(revision.expectedRevision) &&
              revision.expectedRevision >= 0,
          ) &&
          Array.isArray(step.targetPreconditions) &&
          step.targetPreconditions.length === step.targetRefs.length &&
          step.targetPreconditions.every(
            (precondition) =>
              step.targetRefs.includes(precondition.ref) &&
              (precondition.kind === "REVISION"
                ? Number.isSafeInteger(precondition.expectedRevision) &&
                  precondition.expectedRevision >= 0
                : precondition.kind === "DOCUMENT_HASH" &&
                  /^[a-f0-9]{64}$/u.test(precondition.expectedHash)),
          ) &&
          step.compensationBasis.type === "SUCCEEDED_COMMAND_RECEIPT" &&
          step.automaticMutation === false,
      ),
      true,
    );
    assert.equal(
      hashDocument(
        `semester_manifests/${archiveSemesterId}`,
        await readDocument(testEnv, `semester_manifests/${archiveSemesterId}`),
      ).hash,
      archiveBefore.hash,
    );

    const replayCases = [
      [commandIds.plan, "createSemesterCutoverPlan", planPayload],
      [commandIds.dryBlocked, "dryRunSemesterCutover", blockedDryPayload],
      [commandIds.dryRetry, "dryRunSemesterCutover", dryPayload],
      [
        learningOperation.childCommandId,
        learningOperation.childCommandType,
        childPayloads.LEARNING_CONTENT,
      ],
      [commandIds.applyPartial, "applySemesterCutoverBatch", partialPayload],
      [commandIds.resume, "resumeSemesterCutover", resumePayload],
      [
        scheduleOperation.childCommandId,
        scheduleOperation.childCommandType,
        childPayloads.SCHEDULE_EVENTS,
      ],
      [commandIds.applyComplete, "applySemesterCutoverBatch", completePayload],
      [commandIds.verify, "verifySemesterCutover", verifyPayload],
      [
        commandIds.validateReadiness,
        "validateSemesterReadiness",
        readinessPayload,
      ],
      [commandIds.transitionReady, "transitionSemesterStatus", readyPayload],
      [
        commandIds.revalidateReadiness,
        "validateSemesterReadiness",
        staleReadinessPayload,
      ],
      [
        commandIds.restorePreparing,
        "transitionSemesterStatus",
        restorePreparingPayload,
      ],
      [commandIds.rollback, "createSemesterRollbackPlan", rollbackPayload],
    ];
    const beforeSecondRehearsal = {
      plans: (await readCollection(testEnv, "semester_cutover_plans")).length,
      attempts: (await readCollection(testEnv, "semester_cutover_attempts"))
        .length,
      evidence: (await readCollection(testEnv, "semester_cutover_evidence"))
        .length,
    };
    for (const [commandId, commandType, payload] of replayCases) {
      const replay = (await execute(admin, commandType, payload, { commandId }))
        .data;
      assert.equal(replay.replayed, true);
    }
    assert.deepEqual(
      {
        plans: (await readCollection(testEnv, "semester_cutover_plans")).length,
        attempts: (await readCollection(testEnv, "semester_cutover_attempts"))
          .length,
        evidence: (await readCollection(testEnv, "semester_cutover_evidence"))
          .length,
      },
      beforeSecondRehearsal,
    );

    const finalState = (
      await queryCutover(admin, { targetSemesterId, planId, attemptId })
    ).data;
    assert.equal(finalState.writeCount, 0);
    assert.equal(finalState.activationControlsAvailable, false);
    assert.equal(finalState.productionControlsAvailable, false);
    assert.equal(finalState.plan.status, "ROLLBACK_PLANNED");
    assert.equal(finalState.items.length, 12);
    assert.equal(
      (await readCollection(testEnv, "semester_learning_contents")).filter(
        (row) => row.data.semesterId !== targetSemesterId,
      ).length,
      0,
    );

    assert.equal(
      (await readCollection(testEnv, "semester_schedule_events")).filter(
        (row) => row.data.semesterId !== targetSemesterId,
      ).length,
      0,
    );

    const archivePayload = {
      ...planPayload,
      targetSemesterId: archiveSemesterId,
      targetManifestRevision: archiveManifest.revision,
      operations: rawOperations,
    };
    archivePayload.manifestHash = cutover.computeManifestHash({
      ...archivePayload,
      operations: normalizedOperations,
    });
    await expectReason(
      execute(admin, "createSemesterCutoverPlan", archivePayload),
      "W11_MANIFEST_STATE_INVALID",
    );

    console.log(
      JSON.stringify({
        suite: "w11-domain-integration",
        passed: true,
        commands: 6,
        realChildGatewayCommands: 2,
        manualCanonicalSuccessSeeds: 0,
        manualReceiptSuccessSeeds: 0,
        datasets: 12,
        rehearsals: 2,
        partialFailureExplicit: true,
        responseLossRecovered: true,
        resumeSucceededItemEffectCount: 0,
        previousSuccessDuplicateEffectCount: 0,
        archiveMutationCount: 0,
        crossSemesterLeakageCount: 0,
        queryWriteCount: 0,
        readinessRegistryDerived: true,
        readyTransitionPassed: true,
        dependencyRevisionStaleDetected: true,
        blockedDryRunRetry: true,
        latestPlanFence: true,
        receiptAuditAuthorityReconciled: true,
        rollbackSucceededItemsOnly: true,
        activationMutationCount: 0,
        productionAccess: 0,
        productionWrites: 0,
      }),
    );
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await testEnv.cleanup();
  }
};

await main();
