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
  signInWithEmailAndPassword,
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
  Timestamp,
  where,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const projectId = "demo-westory-session-w3";
const region = "asia-northeast3";
const adminEmail = "westoria28@gmail.com";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];

const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};

const makePassword = () => `${randomBytes(24).toString("base64url")}Aa1!`;

const makeClient = (name) => {
  const app = initializeApp(firebaseConfig, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const functions = getFunctions(app, region);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { app, auth, db, functions, proof: null, authTime: 0, user: null };
};

const readReason = (error) =>
  String(
    error?.details?.reason ||
      error?.customData?.details?.reason ||
      error?.code ||
      error?.message ||
      error,
  );

const expectReason = async (operation, expectedReason) => {
  try {
    await operation();
  } catch (error) {
    assert.equal(readReason(error), expectedReason);
    return;
  }
  throw new Error(`Expected callable to reject with ${expectedReason}.`);
};

const expectOneOfReasons = async (operation, expectedReasons) => {
  try {
    await operation();
  } catch (error) {
    assert.ok(
      expectedReasons.includes(readReason(error)),
      `Expected one of ${expectedReasons.join(", ")}, received ${readReason(error)}.`,
    );
    return;
  }
  throw new Error(`Expected callable to reject with ${expectedReasons.join(" or ")}.`);
};

const openApplicationSession = async (client) => {
  const opened = (
    await httpsCallable(client.functions, "openApplicationSession")({
      authorityGeneration: "w1r2-2026-08-09",
      protocolVersion: 2,
    })
  ).data;
  assert.equal(opened?.status, "active");
  assert.match(String(opened?.revision || ""), /^[a-f0-9]{64}$/);
  client.proof = {
    authorityGeneration: opened.authorityGeneration,
    protocolVersion: opened.protocolVersion,
    revision: opened.revision,
  };
  client.authTime = Number(opened.authTime || 0);
  assert.ok(client.authTime > 0);
};

const executeCommand = (client, envelope) =>
  httpsCallable(client.functions, "executeCommand")({
    ...envelope,
    _session: client.proof,
  });

const getCommandStatus = (client, commandId, commandType) =>
  httpsCallable(client.functions, "getCommandStatus")({
    commandId,
    commandType,
    _session: client.proof,
  });

const stableValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value?.toMillis === "function") {
    return { __timestampMillis: value.toMillis() };
  }
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
};

const readDocument = async (db, path) => {
  const snapshot = await getDoc(doc(db, path));
  return snapshot.exists()
    ? { exists: true, data: stableValue(snapshot.data()) }
    : { exists: false, data: null };
};

const readCollection = async (db, path) => {
  const snapshot = await getDocs(collection(db, path));
  return snapshot.docs
    .map((item) => ({ id: item.id, data: stableValue(item.data()) }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

const withAdminDb = async (testEnv, operation) => {
  let result;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    result = await operation(context.firestore());
  });
  return result;
};

const snapshotSemesterState = (testEnv) =>
  withAdminDb(testEnv, async (db) => ({
    manifests: await readCollection(db, "semester_manifests"),
    readiness: await readCollection(db, "semester_readiness_reports"),
    pointer: await readDocument(db, "site_settings/semester_active"),
    config: await readDocument(db, "site_settings/config"),
    receipts: await readCollection(db, "command_receipts"),
    audits: await readCollection(db, "command_audit_events"),
  }));

const readManifest = (testEnv, semesterId) =>
  withAdminDb(testEnv, (db) =>
    readDocument(db, `semester_manifests/${semesterId}`),
  );

const commandArtifacts = (testEnv, commandId) =>
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
      receipts: receipts.docs.map((item) => stableValue(item.data())),
      audits: audits.docs.map((item) => stableValue(item.data())),
    };
  });

const seedRefs = (semesterId) => {
  const [year, term] = semesterId.split("-");
  const root = `years/${year}/semesters/${term}`;
  return [
    `${root}/point_policies/current`,
    `${root}/assessment_config/settings`,
    `${root}/exam_config/final_exam`,
    `${root}/grading_plans_meta/current`,
    `${root}/calendar_meta/current`,
    `${root}/notices_meta/current`,
  ];
};

const assertSeedCount = async (testEnv, semesterId, expectedCount) => {
  const existing = await withAdminDb(testEnv, async (db) =>
    Promise.all(seedRefs(semesterId).map((path) => readDocument(db, path))),
  );
  assert.equal(existing.filter((item) => item.exists).length, expectedCount);
};

const runCommand = async (client, commandType, payload, options = {}) => {
  const commandId = options.commandId || randomUUID();
  const response = await executeCommand(client, {
    commandId,
    commandType,
    payload,
    ...(options.dropResponse ? { _testDropResponseAfterCommit: true } : {}),
  });
  return { commandId, response: response.data };
};

const transition = (client, semester, targetStatus, reason = "W3 integration") =>
  runCommand(client, "transitionSemesterStatus", {
    semesterId: semester.data.semesterId,
    expectedRevision: semester.data.revision,
    targetStatus,
    reason,
  });

const prepareReady = async (testEnv, client, semesterId) => {
  let semester = await readManifest(testEnv, semesterId);
  if (semester.data.status === "DRAFT") {
    await transition(client, semester, "PREPARING");
  }
  semester = await readManifest(testEnv, semesterId);
  const validation = await runCommand(client, "validateSemesterReadiness", {
    semesterId,
    expectedRevision: semester.data.revision,
  });
  assert.equal(validation.response.status, "SUCCEEDED");
  assert.equal(validation.response.result.status, "PASS");
  assert.equal(validation.response.result.requiredPassed, 11);
  assert.equal(validation.response.result.requiredTotal, 11);
  semester = await readManifest(testEnv, semesterId);
  assert.equal(semester.data.status, "VALIDATING");
  await transition(client, semester, "READY");
  semester = await readManifest(testEnv, semesterId);
  assert.equal(semester.data.status, "READY");
  return { semester, validation };
};

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });

  try {
    await testEnv.clearFirestore();

    const password = makePassword();
    const primary = makeClient(`w3-primary-${randomUUID()}`);
    const primaryCredential = await createUserWithEmailAndPassword(
      primary.auth,
      adminEmail,
      password,
    );
    primary.user = primaryCredential.user;
    await openApplicationSession(primary);

    const peer = makeClient(`w3-peer-${randomUUID()}`);
    const peerCredential = await signInWithEmailAndPassword(
      peer.auth,
      adminEmail,
      password,
    );
    peer.user = peerCredential.user;
    assert.equal(peer.user.uid, primary.user.uid);
    await openApplicationSession(peer);

    const negative = makeClient(`w3-negative-${randomUUID()}`);
    const negativeCredential = await createUserWithEmailAndPassword(
      negative.auth,
      `w3-negative-${randomUUID()}@yongshin-ms.ms.kr`,
      makePassword(),
    );
    negative.user = negativeCredential.user;
    await openApplicationSession(negative);

    const semesterId = "2030-2";
    const createCommandId = randomUUID();
    const createEnvelope = {
      commandId: createCommandId,
      commandType: "createSemesterManifest",
      payload: {
        schoolYear: "2030",
        term: "2",
        displayName: "2030학년도 2학기",
        startDate: "2030-08-20",
        endDate: "2031-02-28",
      },
    };
    const concurrentCreate = await Promise.all([
      executeCommand(primary, createEnvelope),
      executeCommand(peer, createEnvelope),
    ]);
    assert.deepEqual(
      concurrentCreate.map((item) => item.data.replayed).sort(),
      [false, true],
    );
    assert.deepEqual(concurrentCreate[0].data.result, concurrentCreate[1].data.result);
    assert.equal(concurrentCreate[0].data.result.seedCount, 6);
    await assertSeedCount(testEnv, semesterId, 6);
    const createdManifest = await readManifest(testEnv, semesterId);
    assert.equal(createdManifest.exists, true);
    assert.equal(createdManifest.data.status, "DRAFT");
    assert.equal(createdManifest.data.revision, 1);
    const createArtifacts = await commandArtifacts(testEnv, createCommandId);
    assert.equal(createArtifacts.receipts.length, 1);
    assert.equal(createArtifacts.audits.length, 1);

    const createState = await snapshotSemesterState(testEnv);
    await expectReason(
      () =>
        executeCommand(primary, {
          ...createEnvelope,
          payload: { ...createEnvelope.payload, displayName: "같은 ID 다른 학기" },
        }),
      "COMMAND_ID_CONFLICT",
    );
    assert.deepEqual(await snapshotSemesterState(testEnv), createState);

    const partialSemesterId = "2031-1";
    const partialCreate = await runCommand(primary, "createSemesterManifest", {
      schoolYear: "2031",
      term: "1",
      displayName: "2031학년도 1학기 partial fixture",
      startDate: "2031-03-01",
      endDate: "2031-08-19",
      _testFixture: "PARTIAL_SHELL",
    });
    assert.equal(partialCreate.response.result.seedCount, 1);
    await assertSeedCount(testEnv, partialSemesterId, 1);
    let partialManifest = await readManifest(testEnv, partialSemesterId);
    await transition(primary, partialManifest, "PREPARING");
    partialManifest = await readManifest(testEnv, partialSemesterId);
    const partialValidation = await runCommand(
      primary,
      "validateSemesterReadiness",
      {
        semesterId: partialSemesterId,
        expectedRevision: partialManifest.data.revision,
      },
    );
    assert.equal(partialValidation.response.result.status, "FAIL");
    assert.equal(partialValidation.response.result.requiredTotal, 11);
    assert.ok(partialValidation.response.result.requiredPassed < 11);
    const partialReport = await withAdminDb(testEnv, (db) =>
      readDocument(db, `semester_readiness_reports/${partialSemesterId}`),
    );
    assert.equal(partialReport.data.status, "FAIL");
    assert.equal(partialReport.data.stale, false);
    assert.equal(partialReport.data.policyVersion, "w3-v1");
    assert.equal(partialReport.data.requiredTotal, 11);
    assert.equal(partialReport.data.checks.length, 12);
    assert.equal(
      partialReport.data.checks.find(
        (check) => check.checkId === "required_settings",
      )?.status,
      "FAIL",
    );
    const trustedShellCheck = partialReport.data.checks.find(
      (check) => check.checkId === "trusted_shell_complete",
    );
    assert.equal(trustedShellCheck?.status, "PENDING");
    assert.match(String(trustedShellCheck?.evidence || ""), /missing=5/);
    partialManifest = await readManifest(testEnv, partialSemesterId);
    const partialState = await snapshotSemesterState(testEnv);
    await expectOneOfReasons(
      () => transition(primary, partialManifest, "READY"),
      ["SEMESTER_READINESS_NOT_PASS", "SEMESTER_REQUIRED_CHECKS_INCOMPLETE"],
    );
    assert.deepEqual(await snapshotSemesterState(testEnv), partialState);

    let semester = await readManifest(testEnv, semesterId);
    const staleRevision = semester.data.revision;
    await transition(primary, semester, "PREPARING");
    const revisionConflictState = await snapshotSemesterState(testEnv);
    await expectReason(
      () =>
        runCommand(primary, "transitionSemesterStatus", {
          semesterId,
          expectedRevision: staleRevision + 1,
          targetStatus: "PREPARING",
          reason: "stale revision must fail",
        }),
      "SEMESTER_REVISION_CONFLICT",
    );
    assert.deepEqual(await snapshotSemesterState(testEnv), revisionConflictState);

    semester = await readManifest(testEnv, semesterId);
    const firstValidation = await runCommand(
      primary,
      "validateSemesterReadiness",
      { semesterId, expectedRevision: semester.data.revision },
    );
    assert.equal(firstValidation.response.result.status, "PASS");
    assert.equal(firstValidation.response.result.requiredPassed, 11);
    assert.equal(firstValidation.response.result.requiredTotal, 11);
    const freshManifest = await readManifest(testEnv, semesterId);
    const freshReport = await withAdminDb(testEnv, (db) =>
      readDocument(db, `semester_readiness_reports/${semesterId}`),
    );
    assert.equal(freshReport.data.status, "PASS");
    assert.equal(freshReport.data.stale, false);
    assert.equal(freshReport.data.policyVersion, "w3-v1");
    assert.equal(freshReport.data.evaluatedRevision, freshManifest.data.revision);
    assert.equal(freshReport.data.requiredPassed, 11);
    assert.equal(freshReport.data.requiredTotal, 11);
    assert.equal(freshReport.data.checks.length, 12);
    const readinessVersionsBeforeUpdate = await withAdminDb(testEnv, (db) =>
      readCollection(db, `semester_readiness_reports/${semesterId}/versions`),
    );
    assert.equal(readinessVersionsBeforeUpdate.length, 1);

    semester = await readManifest(testEnv, semesterId);
    const updateManifest = await runCommand(primary, "updateSemesterManifest", {
      semesterId,
      expectedRevision: semester.data.revision,
      displayName: "2030학년도 2학기 수정",
      startDate: "2030-08-21",
      endDate: "2031-02-28",
      reason: "readiness stale integration fixture",
    });
    assert.equal(updateManifest.response.status, "SUCCEEDED");
    semester = await readManifest(testEnv, semesterId);
    assert.equal(semester.data.displayName, "2030학년도 2학기 수정");
    assert.equal(semester.data.status, "PREPARING");
    const staleReport = await withAdminDb(testEnv, (db) =>
      readDocument(db, `semester_readiness_reports/${semesterId}`),
    );
    assert.equal(staleReport.data.status, "STALE");
    const staleActivationState = await snapshotSemesterState(testEnv);
    await expectOneOfReasons(
      () =>
        runCommand(primary, "activateSemester", {
          semesterId,
          expectedRevision: semester.data.revision,
          readinessPolicyVersion: "w3-v1",
          expectedActiveSemesterId: null,
        }),
      ["SEMESTER_READINESS_STALE", "SEMESTER_READINESS_NOT_PASS"],
    );
    assert.deepEqual(await snapshotSemesterState(testEnv), staleActivationState);

    const ready = await prepareReady(testEnv, primary, semesterId);
    semester = ready.semester;
    const activationCommandId = randomUUID();
    const activationEnvelope = {
      commandId: activationCommandId,
      commandType: "activateSemester",
      payload: {
        semesterId,
        expectedRevision: semester.data.revision,
        readinessPolicyVersion: "w3-v1",
        expectedActiveSemesterId: null,
      },
      _testDropResponseAfterCommit: true,
    };
    await expectReason(
      () => executeCommand(primary, activationEnvelope),
      "TEST_RESPONSE_LOSS",
    );
    const activationReplay = (await executeCommand(peer, activationEnvelope)).data;
    assert.equal(activationReplay.replayed, true);
    assert.equal(activationReplay.result.semesterId, semesterId);
    assert.equal(activationReplay.result.status, "ACTIVE");
    const activeState = await snapshotSemesterState(testEnv);
    assert.equal(activeState.pointer.data.semesterId, semesterId);
    assert.equal(activeState.config.data.year, "2030");
    assert.equal(activeState.config.data.semester, "2");
    assert.equal(activeState.config.data.activeSemesterId, semesterId);
    assert.equal(activeState.config.data.semesterLifecycleStatus, "ACTIVE");
    assert.equal(activeState.config.data.semesterWritesEnabled, true);
    assert.equal(
      activeState.manifests.filter((item) => item.data.status === "ACTIVE").length,
      1,
    );
    const activationArtifacts = await commandArtifacts(
      testEnv,
      activationCommandId,
    );
    assert.equal(activationArtifacts.receipts.length, 1);
    assert.equal(activationArtifacts.audits.length, 1);

    const statusState = await snapshotSemesterState(testEnv);
    const statusResult = (
      await getCommandStatus(primary, activationCommandId, "activateSemester")
    ).data;
    assert.equal(statusResult.status, "SUCCEEDED");
    assert.equal(statusResult.replayed, true);
    assert.deepEqual(statusResult.result, activationReplay.result);
    assert.deepEqual(await snapshotSemesterState(testEnv), statusState);

    const coreState = (
      await httpsCallable(primary.functions, "getSemesterCoreState")({
        _session: primary.proof,
      })
    ).data;
    assert.equal(coreState.active.semesterId, semesterId);
    assert.equal(coreState.error, null);
    assert.deepEqual(await snapshotSemesterState(testEnv), statusState);

    const settingsCommandId = randomUUID();
    const settingsEnvelope = {
      commandId: settingsCommandId,
      commandType: "updateOperationalSettings",
      payload: { showQuiz: false, showScore: true, showLesson: false },
    };
    const pointerBeforeSettings = activeState.pointer;
    const settingsResults = await Promise.all([
      executeCommand(primary, settingsEnvelope),
      executeCommand(peer, settingsEnvelope),
    ]);
    assert.deepEqual(
      settingsResults.map((item) => item.data.replayed).sort(),
      [false, true],
    );
    const settingsState = await snapshotSemesterState(testEnv);
    assert.equal(settingsState.config.data.showQuiz, false);
    assert.equal(settingsState.config.data.showScore, true);
    assert.equal(settingsState.config.data.showLesson, false);
    assert.deepEqual(settingsState.pointer, pointerBeforeSettings);
    const settingsArtifacts = await commandArtifacts(testEnv, settingsCommandId);
    assert.equal(settingsArtifacts.receipts.length, 1);
    assert.equal(settingsArtifacts.audits.length, 1);

    const unauthorizedBefore = await snapshotSemesterState(testEnv);
    await expectReason(
      () =>
        runCommand(negative, "updateOperationalSettings", {
          showQuiz: true,
          showScore: false,
          showLesson: true,
        }),
      "COMMAND_ADMIN_REQUIRED",
    );
    assert.deepEqual(await snapshotSemesterState(testEnv), unauthorizedBefore);

    await withAdminDb(testEnv, async (db) => {
      const authTimes = new Set([primary.authTime, peer.authTime]);
      await Promise.all(
        [...authTimes].map((authTime) =>
          setDoc(
            doc(
              db,
              "application_sessions",
              primary.user.uid,
              "sessions",
              String(authTime),
            ),
            { highRiskExpiresAt: Timestamp.fromMillis(Date.now() - 1_000) },
            { merge: true },
          ),
        ),
      );
    });
    const expiredBefore = await snapshotSemesterState(testEnv);
    await expectReason(
      () =>
        runCommand(primary, "createSemesterManifest", {
          schoolYear: "2032",
          term: "1",
          displayName: "만료 세션 차단",
          startDate: "2032-03-01",
          endDate: "2032-08-19",
        }),
      "SESSION_EXPIRED",
    );
    assert.deepEqual(await snapshotSemesterState(testEnv), expiredBefore);

    console.log(
      JSON.stringify({
        suite: "w3-semester-core-emulator-integration",
        passed: true,
        cases: [
          "CREATE_CROSS_CONTEXT_EFFECT_ONCE",
          "CREATE_REPLAY_AND_COMMAND_ID_CONFLICT_ZERO_WRITE",
          "TRUSTED_SIX_SEED_TRANSACTION",
          "PARTIAL_SHELL_READINESS_FAIL_AND_READY_ZERO",
          "REVISION_MISMATCH_ZERO_WRITE",
          "READINESS_REQUIRED_CHECKS_11_PASS",
          "READINESS_IMMUTABLE_VERSION_CREATED",
          "MANIFEST_UPDATE_INVALIDATES_READINESS",
          "STALE_READINESS_ACTIVATION_ZERO",
          "READY_GATED_ATOMIC_ACTIVATION",
          "ACTIVE_EXACTLY_ONE",
          "POST_COMMIT_RESPONSE_LOSS_REPLAY",
          "GET_COMMAND_STATUS_QUERY_ONLY",
          "GET_SEMESTER_CORE_STATE_QUERY_ONLY",
          "OPERATIONAL_SETTINGS_CONCURRENT_EFFECT_ONCE_POINTER_PRESERVED",
          "UNAUTHORIZED_PRE_BUSINESS_ZERO_WRITE",
          "EXPIRED_SESSION_PRE_BUSINESS_ZERO_WRITE",
        ],
        productionAccess: 0,
      }),
    );
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await testEnv.cleanup();
  }
};

await main();
