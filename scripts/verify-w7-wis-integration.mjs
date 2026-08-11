import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w7";
assert.equal(projectId, "demo-westory-session-w7", "W7 integration requires its exact demo project.");
assert.notEqual(projectId, "history-quiz-yongsin", "Production access is forbidden.");
for (const variable of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST"]) {
  assert.ok(process.env[variable], `${variable} is required through firebase emulators:exec.`);
}

const semesterId = "2026-2";
const region = "asia-northeast3";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];
const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};
const password = () => `${randomBytes(24).toString("base64url")}Aa1!`;

const makeClient = (name) => {
  const app = initializeApp(firebaseConfig, name);
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
    await httpsCallable(client.functions, "openApplicationSession")({
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

const execute = (client, commandType, payload, options = {}) => {
  const commandId = options.commandId || randomUUID();
  return httpsCallable(client.functions, "executeCommand")({
    commandId,
    commandType,
    payload,
    _session: client.proof,
    ...(options.dropResponse ? { _testDropResponseAfterCommit: true } : {}),
  });
};

const queryWis = (client, payload) =>
  httpsCallable(client.functions, "getWisEconomyState")({
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

const countDocuments = async (testEnv) => {
  const paths = [
    "semester_wis_economies",
    "semester_wis_accounts",
    "semester_wis_ledger",
    "semester_wis_balances",
    "semester_wis_rankings",
    "wis_product_catalog",
    "semester_wis_inventory",
    "semester_wis_orders",
    "semester_wis_reconciliation_reports",
    "wis_legacy_issues",
    "command_receipts",
    "command_audit_events",
  ];
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [path, (await readCollection(testEnv, path)).length]),
    ),
  );
};

const executeWithResponseLossRecovery = async (client, commandType, payload) => {
  const commandId = randomUUID();
  await expectReason(
    execute(client, commandType, payload, { commandId, dropResponse: true }),
    "TEST_RESPONSE_LOSS",
  );
  const recovered = (
    await httpsCallable(client.functions, "getCommandStatus")({
      commandId,
      commandType,
      _session: client.proof,
    })
  ).data;
  assert.equal(recovered.status, "SUCCEEDED");
  const replay = (await execute(client, commandType, payload, { commandId })).data;
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, recovered.result);
  return recovered.result;
};

const common = {
  semesterId,
  expectedSemesterRevision: 1,
};

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
  const teacher = makeClient("w7-wis-teacher");
  const student = makeClient("w7-wis-student");
  const outsider = makeClient("w7-wis-outsider");

  try {
    await testEnv.clearFirestore();
    teacher.user = (
      await createUserWithEmailAndPassword(
        teacher.auth,
        "w7-wis-teacher@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    student.user = (
      await createUserWithEmailAndPassword(
        student.auth,
        "w7-wis-student@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    outsider.user = (
      await createUserWithEmailAndPassword(
        outsider.auth,
        "w7-wis-outsider@yongshin-ms.ms.kr",
        password(),
      )
    ).user;

    const enrollmentId = "w7-wis-enrollment";
    const classId = "w7-wis-class";
    await withAdminDb(testEnv, async (db) => {
      await Promise.all([
        setDoc(doc(db, "users", teacher.user.uid), {
          role: "teacher",
          teacherPortalEnabled: true,
          staffPermissions: ["point_manage"],
        }),
        setDoc(doc(db, "users", student.user.uid), {
          role: "student",
          teacherPortalEnabled: false,
        }),
        setDoc(doc(db, "users", outsider.user.uid), {
          role: "teacher",
          teacherPortalEnabled: true,
          staffPermissions: [],
        }),
        setDoc(doc(db, "site_settings", "semester_active"), {
          semesterId,
          activeSemesterId: semesterId,
          revision: 1,
          activeSemesterRevision: 1,
        }),
        setDoc(doc(db, "site_settings", "config"), {
          year: 2026,
          semester: 2,
          activeSemesterId: semesterId,
          activeSemesterRevision: 1,
          semesterWritesEnabled: true,
        }),
        setDoc(doc(db, "semester_manifests", semesterId), {
          semesterId,
          schoolYear: 2026,
          term: 2,
          revision: 1,
          status: "ACTIVE",
          shellState: "CURRENT",
        }),
        setDoc(doc(db, "semester_classes", classId), {
          classId,
          semesterId,
          status: "ACTIVE",
        }),
        setDoc(doc(db, "semester_enrollments", enrollmentId), {
          enrollmentId,
          semesterId,
          studentUid: student.user.uid,
          classId,
          displayName: "W7 합성 학생",
          status: "ACTIVE",
          enrollmentStatus: "ACTIVE",
        }),
      ]);
    });

    await Promise.all([openSession(teacher), openSession(student), openSession(outsider)]);

    const beforeUnauthorized = await countDocuments(testEnv);
    await expectReason(
      queryWis(outsider, { audience: "teacher", semesterId, source: "CURRENT" }),
      "WIS_MANAGE_REQUIRED",
    );
    await expectReason(
      execute(outsider, "createSemesterEconomy", {
        ...common,
        displayName: "차단 대상",
        currencyName: "위스",
        initialGrantAmount: 500,
      }),
      "WIS_MANAGE_REQUIRED",
    );
    assert.deepEqual(await countDocuments(testEnv), beforeUnauthorized);

    const economy = await executeWithResponseLossRecovery(
      teacher,
      "createSemesterEconomy",
      {
        ...common,
        displayName: "2026학년도 2학기 위스",
        currencyName: "위스",
        initialGrantAmount: 500,
      },
    );
    assert.equal(economy.status, "ACTIVE_INITIALIZING");

    const accountBatch = (
      await execute(teacher, "createWisAccounts", {
        ...common,
        expectedEconomyRevision: 1,
        enrollmentIds: [enrollmentId],
        reason: "W7 합성 계정 생성",
      })
    ).data.result;
    assert.equal(accountBatch.createdCount, 1);
    assert.equal(accountBatch.economyRevision, 2);

    let teacherState = (
      await queryWis(teacher, {
        audience: "teacher",
        semesterId,
        source: "CURRENT",
      })
    ).data;
    assert.equal(teacherState.writeCount, 0);
    assert.equal(teacherState.provenance, "CURRENT");
    assert.equal(teacherState.readOnly, false);
    assert.equal(teacherState.accounts.length, 1);
    const accountId = teacherState.accounts[0].accountId;

    const beforeMismatchedInitialGrant = await countDocuments(testEnv);
    await expectReason(
      execute(teacher, "grantInitialWis", {
        ...common,
        expectedEconomyRevision: 2,
        accountId,
        expectedAccountRevision: 1,
        amount: 100,
        sourceId: "invalid-initial:2026-2",
        reason: "정책과 다른 최초 지급",
      }),
      "WIS_INITIAL_GRANT_AMOUNT_MISMATCH",
    );
    assert.deepEqual(await countDocuments(testEnv), beforeMismatchedInitialGrant);

    const initialCommandId = randomUUID();
    const initialPayload = {
      ...common,
      expectedEconomyRevision: 2,
      accountId,
      expectedAccountRevision: 1,
      amount: 500,
      sourceId: "initial:2026-2",
      reason: "학기 최초 지급",
    };
    const [initialA, initialB] = await Promise.all([
      execute(teacher, "grantInitialWis", initialPayload, { commandId: initialCommandId }),
      execute(teacher, "grantInitialWis", initialPayload, { commandId: initialCommandId }),
    ]);
    assert.equal(initialA.data.result.balance, 500);
    assert.equal(initialB.data.result.balance, 500);
    assert.equal(
      (await readCollection(testEnv, "semester_wis_ledger")).filter(
        ({ data }) => data.type === "INITIAL_GRANT",
      ).length,
      1,
    );

    const opened = (
      await execute(teacher, "transitionWisEconomy", {
        ...common,
        expectedEconomyRevision: 2,
        targetStatus: "ACTIVE_OPEN",
        reason: "합성 운영 시작",
      })
    ).data.result;
    assert.equal(opened.status, "ACTIVE_OPEN");
    assert.equal(opened.revision, 3);

    const grant = (
      await execute(teacher, "grantWis", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        expectedAccountRevision: 2,
        amount: 200,
        sourceId: "lesson:w7:1",
        reason: "수업 참여",
      })
    ).data.result;
    assert.equal(grant.balance, 700);
    await expectReason(
      execute(teacher, "grantWis", {
        ...common,
        expectedEconomyRevision: 2,
        accountId,
        expectedAccountRevision: 3,
        amount: 1,
        sourceId: "stale",
        reason: "stale 차단",
      }),
      "WIS_ECONOMY_REVISION_CONFLICT",
    );

    const product = (
      await execute(teacher, "upsertWisProduct", {
        ...common,
        expectedEconomyRevision: 3,
        expectedProductRevision: null,
        name: "W7 연필",
        description: "합성 상품",
        imageUrl: "",
        active: true,
        reason: "합성 상품 등록",
      })
    ).data.result;
    const inventory = (
      await execute(teacher, "upsertWisInventory", {
        ...common,
        expectedEconomyRevision: 3,
        productId: product.productId,
        expectedInventoryRevision: null,
        price: 100,
        stock: 2,
        active: true,
        reason: "합성 재고 등록",
      })
    ).data.result;

    let studentState = (
      await queryWis(student, {
        audience: "student",
        semesterId,
        source: "CURRENT",
      })
    ).data;
    assert.equal(studentState.account.balance, 700);
    assert.equal(studentState.inventory[0].available, 2);
    assert.equal(studentState.rankings[0].rank, 1);

    const order = await executeWithResponseLossRecovery(student, "placeWisOrder", {
      ...common,
      expectedEconomyRevision: 3,
      inventoryId: inventory.inventoryId,
      expectedInventoryRevision: 1,
      expectedAccountRevision: 3,
      quantity: 1,
    });
    assert.equal(order.balance, 600);
    assert.equal((await readCollection(testEnv, "semester_wis_orders")).length, 1);
    await expectReason(
      execute(student, "placeWisOrder", {
        ...common,
        expectedEconomyRevision: 3,
        inventoryId: inventory.inventoryId,
        expectedInventoryRevision: 2,
        expectedAccountRevision: 4,
        quantity: 5,
      }),
      "WIS_INSUFFICIENT_STOCK",
    );

    const rejected = (
      await execute(teacher, "reviewWisOrder", {
        ...common,
        expectedEconomyRevision: 3,
        orderId: order.orderId,
        expectedOrderRevision: 1,
        action: "REJECT",
        reason: "합성 반려",
      })
    ).data.result;
    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejected.balance, 700);

    studentState = (
      await queryWis(student, {
        audience: "student",
        semesterId,
        source: "CURRENT",
      })
    ).data;
    const secondInventory = studentState.inventory[0];
    const secondOrder = (
      await execute(student, "placeWisOrder", {
        ...common,
        expectedEconomyRevision: 3,
        inventoryId: secondInventory.inventoryId,
        expectedInventoryRevision: secondInventory.revision,
        expectedAccountRevision: studentState.account.revision,
        quantity: 1,
      })
    ).data.result;
    const approved = (
      await execute(teacher, "reviewWisOrder", {
        ...common,
        expectedEconomyRevision: 3,
        orderId: secondOrder.orderId,
        expectedOrderRevision: 1,
        action: "APPROVE",
        reason: "합성 승인",
      })
    ).data.result;
    assert.equal(approved.status, "APPROVED");
    const fulfilled = (
      await execute(teacher, "reviewWisOrder", {
        ...common,
        expectedEconomyRevision: 3,
        orderId: secondOrder.orderId,
        expectedOrderRevision: 2,
        action: "FULFILL",
        reason: "합성 수령 완료",
      })
    ).data.result;
    assert.equal(fulfilled.status, "FULFILLED");

    const originalBefore = await readDocument(
      testEnv,
      `semester_wis_ledger/${grant.ledgerEntryId}`,
    );
    teacherState = (
      await queryWis(teacher, {
        audience: "teacher",
        semesterId,
        source: "CURRENT",
      })
    ).data;
    const currentAccount = teacherState.accounts.find((item) => item.accountId === accountId);
    const reversal = (
      await execute(teacher, "reverseWisEntry", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        expectedAccountRevision: currentAccount.revision,
        ledgerEntryId: grant.ledgerEntryId,
        reason: "합성 오지급 취소",
      })
    ).data.result;
    assert.equal(reversal.reversedLedgerEntryId, grant.ledgerEntryId);
    assert.deepEqual(
      await readDocument(testEnv, `semester_wis_ledger/${grant.ledgerEntryId}`),
      originalBefore,
    );

    teacherState = (
      await queryWis(teacher, {
        audience: "teacher",
        semesterId,
        source: "CURRENT",
      })
    ).data;
    const rebuilt = (
      await execute(teacher, "rebuildWisProjection", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        reason: "합성 원장 대조",
      })
    ).data.result;
    assert.equal(rebuilt.status, "PASS");

    const beforeQueries = await countDocuments(testEnv);
    const [studentQuery, teacherQuery, legacyQuery] = await Promise.all([
      queryWis(student, { audience: "student", semesterId, source: "CURRENT" }),
      queryWis(teacher, { audience: "teacher", semesterId, source: "CURRENT" }),
      queryWis(student, { audience: "student", semesterId: "2026-1", source: "LEGACY" }),
    ]);
    assert.equal(studentQuery.data.writeCount, 0);
    assert.equal(teacherQuery.data.writeCount, 0);
    assert.equal(legacyQuery.data.readOnly, true);
    assert.equal(legacyQuery.data.provenance, "LEGACY");
    assert.deepEqual(await countDocuments(testEnv), beforeQueries);

    for (const callable of [
      "ensureWisHallOfFame",
      "saveWisHallOfFameConfig",
      "rebuildPointWalletRankTotals",
      "adjustTeacherPoints",
      "updateTeacherPointAdjustment",
      "reviewTeacherPointOrder",
    ]) {
      await expectReason(
        httpsCallable(teacher.functions, callable)({ _session: teacher.proof }),
        "CLIENT_UPDATE_REQUIRED",
      );
    }

    await withAdminDb(testEnv, (db) =>
      setDoc(
        doc(db, "semester_manifests", semesterId),
        {
          semesterId,
          schoolYear: 2026,
          term: 2,
          revision: 1,
          status: "ARCHIVED",
          shellState: "ARCHIVE",
        },
        { merge: false },
      ),
    );
    const beforeArchiveAttempt = await countDocuments(testEnv);
    await expectReason(
      execute(teacher, "grantWis", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        expectedAccountRevision: rebuilt.accountRevision,
        amount: 1,
        sourceId: "archive-write",
        reason: "보관 학기 차단",
      }),
      "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
    );
    assert.deepEqual(await countDocuments(testEnv), beforeArchiveAttempt);
    const archived = (
      await queryWis(student, {
        audience: "student",
        semesterId,
        source: "ARCHIVE",
      })
    ).data;
    assert.equal(archived.provenance, "ARCHIVE");
    assert.equal(archived.readOnly, true);

    const receipts = await readCollection(testEnv, "command_receipts");
    const audits = await readCollection(testEnv, "command_audit_events");
    assert.equal(receipts.length, audits.length);
    assert.ok(receipts.length >= 14);
    assert.ok(receipts.every(({ data }) => data.status === "SUCCEEDED"));
    assert.ok(receipts.every(({ data }) => data.payloadHash && data.actorUid && data.result));
    assert.ok(audits.every(({ data }) => data.commandType && data.actorUid && data.result));

    console.log(
      JSON.stringify({
        suite: "w7-wis-integration",
        passed: true,
        cases: 24,
        receipts: receipts.length,
        productionAccess: 0,
      }),
    );
  } finally {
    await Promise.allSettled(apps.map((app) => deleteApp(app)));
    await testEnv.cleanup();
  }
};

await main();
