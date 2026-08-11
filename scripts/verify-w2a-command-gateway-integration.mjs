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
  getIdTokenResult,
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

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w2a";
assert.match(
  projectId,
  /^demo-westory-session-(?:w2a|w3|w4|w5|w6a)$/,
  "W2A integration may only target an approved demo emulator project.",
);
const region = "asia-northeast3";
const adminEmail = "westoria28@gmail.com";
const year = "2026";
const semester = "2";
const calendarPath = `years/${year}/semesters/${semester}/calendar`;
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];

const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};

const makePassword = () =>
  `${randomBytes(24).toString("base64url")}Aa1!`;

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

const readCollection = async (db, path) => {
  const snapshot = await getDocs(collection(db, path));
  return snapshot.docs
    .map((item) => ({ id: item.id, data: stableValue(item.data()) }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

const readDocument = async (db, path) => {
  const snapshot = await getDoc(doc(db, path));
  return snapshot.exists()
    ? { exists: true, data: stableValue(snapshot.data()) }
    : { exists: false, data: null };
};

const withAdminDb = async (testEnv, operation) => {
  let result;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    result = await operation(context.firestore());
  });
  return result;
};

const snapshotCommandState = (testEnv) =>
  withAdminDb(testEnv, async (db) => ({
    activePointer: await readDocument(db, "site_settings/semester_active"),
    semesterManifests: await readCollection(db, "semester_manifests"),
    terms: await readDocument(db, "site_settings/terms"),
    consent: await readDocument(db, "site_settings/consent"),
    consentItems: await readCollection(db, "site_settings/consent/items"),
    consentTombstones: await readCollection(
      db,
      "site_settings/consent/deleted_items",
    ),
    calendar: await readCollection(db, calendarPath),
    pointWallets: await readCollection(
      db,
      `years/${year}/semesters/${semester}/point_wallets`,
    ),
    pointTransactions: await readCollection(
      db,
      `years/${year}/semesters/${semester}/point_transactions`,
    ),
    wisHallOfFame: await readDocument(
      db,
      `years/${year}/semesters/${semester}/point_public/hall_of_fame`,
    ),
    receipts: await readCollection(db, "command_receipts"),
    audits: await readCollection(db, "command_audit_events"),
  }));

const commandArtifacts = (testEnv, commandId) =>
  withAdminDb(testEnv, async (db) => {
    const [receiptSnapshot, auditSnapshot] = await Promise.all([
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
      receipts: receiptSnapshot.docs.map((item) => stableValue(item.data())),
      audits: auditSnapshot.docs.map((item) => stableValue(item.data())),
    };
  });

const consentItems = (testEnv) =>
  withAdminDb(testEnv, (db) => readCollection(db, "site_settings/consent/items"));

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });

  try {
    await testEnv.clearFirestore();
    await withAdminDb(testEnv, async (db) => {
      await Promise.all([
        setDoc(doc(db, "site_settings", "config"), {
          year,
          semester,
          activeSemesterId: `${year}-${semester}`,
          activeSemesterRevision: 1,
          semesterLifecycleStatus: "ACTIVE",
          semesterWritesEnabled: true,
          availableSemesters: [
            { year, semester, shellReady: true },
          ],
        }),
        setDoc(doc(db, "site_settings", "semester_active"), {
          semesterId: `${year}-${semester}`,
          revision: 1,
          previousSemesterId: null,
        }),
        setDoc(doc(db, "semester_manifests", `${year}-${semester}`), {
          semesterId: `${year}-${semester}`,
          schoolYear: year,
          term: semester,
          displayName: `${year}학년도 ${semester}학기`,
          status: "ACTIVE",
          provenance: "CURRENT",
          schemaVersion: 1,
          revision: 1,
          stateRevision: 1,
          readinessPolicyVersion: "w3-v1",
          blockingIssues: [],
        }),
        setDoc(doc(db, "site_settings", "terms"), {
          text: "통합 테스트 이전 약관",
          revision: "seed-terms",
        }),
        setDoc(doc(db, "site_settings", "consent"), {
          revision: "seed-consent",
          nextItemOrder: 3,
        }),
        setDoc(
          doc(db, "site_settings", "consent", "items", "seed-consent-item"),
          {
            title: "기존 동의 항목",
            text: "기존 동의 내용",
            required: true,
            order: 4,
          },
        ),
        setDoc(doc(db, "users", "point-student"), {
          role: "student",
          studentName: "포인트 학생",
          studentGrade: "2",
          studentClass: "3",
          studentNumber: "7",
        }),
        setDoc(
          doc(
            db,
            "years",
            year,
            "semesters",
            semester,
            "point_policies",
            "current",
          ),
          {
            manualAdjustEnabled: true,
            allowNegativeBalance: false,
            rankPolicy: { basedOn: "earnedTotal" },
          },
        ),
        setDoc(
          doc(
            db,
            "years",
            year,
            "semesters",
            semester,
            "point_wallets",
            "point-student",
          ),
          {
            uid: "point-student",
            balance: 10,
            earnedTotal: 10,
            rankEarnedTotal: 10,
            spentTotal: 0,
            adjustedTotal: 0,
          },
        ),
        setDoc(doc(db, calendarPath, "ordinary-event"), {
          title: "일반 학사 일정",
          start: "2026-09-01",
          end: "2026-09-01",
          eventType: "event",
          targetType: "common",
          marker: "must-survive-holiday-sync",
        }),
        setDoc(doc(db, calendarPath, "obsolete-holiday"), {
          title: "교체될 기존 공휴일",
          start: "2026-01-01",
          end: "2026-01-01",
          eventType: "holiday",
          targetType: "common",
        }),
      ]);
    });

    const password = makePassword();
    const primary = makeClient(`w2a-primary-${randomUUID()}`);
    const primaryCredential = await createUserWithEmailAndPassword(
      primary.auth,
      adminEmail,
      password,
    );
    primary.user = primaryCredential.user;
    await openApplicationSession(primary);

    const peer = makeClient(`w2a-peer-${randomUUID()}`);
    const peerCredential = await signInWithEmailAndPassword(
      peer.auth,
      adminEmail,
      password,
    );
    peer.user = peerCredential.user;
    assert.equal(peer.user.uid, primary.user.uid);
    await openApplicationSession(peer);

    const negative = makeClient(`w2a-negative-${randomUUID()}`);
    const negativeEmail = `w2a-negative-${randomUUID()}@yongshin-ms.ms.kr`;
    const negativeCredential = await createUserWithEmailAndPassword(
      negative.auth,
      negativeEmail,
      makePassword(),
    );
    negative.user = negativeCredential.user;
    await openApplicationSession(negative);

    const termsCommandId = randomUUID();
    const termsEnvelope = {
      commandId: termsCommandId,
      commandType: "updateTermsSettings",
      payload: { text: "<p>W2A 통합 테스트 약관</p>" },
    };
    const termsFirst = (await executeCommand(primary, termsEnvelope)).data;
    assert.equal(termsFirst.status, "SUCCEEDED");
    assert.equal(termsFirst.replayed, false);
    assert.equal(termsFirst.result.ref, "site_settings/terms");
    const termsAfterFirst = await snapshotCommandState(testEnv);
    assert.equal(
      termsAfterFirst.terms.data.text,
      "<p>W2A 통합 테스트 약관</p>",
    );
    const termsArtifacts = await commandArtifacts(testEnv, termsCommandId);
    assert.equal(termsArtifacts.receipts.length, 1);
    assert.equal(termsArtifacts.audits.length, 1);
    const termsReceipt = termsArtifacts.receipts[0];
    const termsAudit = termsArtifacts.audits[0];
    assert.equal(termsReceipt.commandId, termsCommandId);
    assert.equal(termsReceipt.commandType, "updateTermsSettings");
    assert.equal(termsReceipt.actorUid, primary.user.uid);
    assert.equal(termsReceipt.actorEmail, adminEmail);
    assert.equal(termsReceipt.actorRole, "admin");
    assert.equal(termsReceipt.actorCapability, "command:updateTermsSettings");
    assert.match(termsReceipt.payloadHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(termsReceipt.target, { refs: ["site_settings/terms"] });
    assert.deepEqual(termsReceipt.result, termsFirst.result);
    assert.equal(termsReceipt.retryable, false);
    assert.equal(termsReceipt.checkpoint, "COMMITTED");
    assert.equal(termsReceipt.createdAt.__timestampMillis, termsReceipt.completedAt.__timestampMillis);
    assert.match(termsReceipt.session.revisionHash, /^[a-f0-9]{64}$/);
    assert.equal(termsAudit.commandId, termsCommandId);
    assert.equal(termsAudit.commandType, "updateTermsSettings");
    assert.equal(termsAudit.actorUid, primary.user.uid);
    assert.equal(termsAudit.actorEmail, adminEmail);
    assert.deepEqual(termsAudit.target, termsReceipt.target);
    assert.deepEqual(termsAudit.result, termsFirst.result);
    assert.equal(termsAudit.payloadHash, termsReceipt.payloadHash);

    const termsReplay = (
      await executeCommand(peer, {
        ...termsEnvelope,
        commandId: termsCommandId.toUpperCase(),
      })
    ).data;
    assert.equal(termsReplay.replayed, true);
    assert.equal(termsReplay.commandId, termsCommandId);
    assert.deepEqual(termsReplay.result, termsFirst.result);
    assert.deepEqual(await snapshotCommandState(testEnv), termsAfterFirst);

    await expectReason(
      () =>
        executeCommand(primary, {
          ...termsEnvelope,
          payload: { text: "<p>같은 ID의 다른 약관</p>" },
        }),
      "COMMAND_ID_CONFLICT",
    );
    assert.deepEqual(await snapshotCommandState(testEnv), termsAfterFirst);

    const sequentialConsentId = randomUUID();
    const sequentialConsentEnvelope = {
      commandId: sequentialConsentId,
      commandType: "addConsentItem",
      payload: {
        title: "순차 replay 동의 항목",
        text: "<p>동일 명령은 한 번만 생성됩니다.</p>",
        required: true,
      },
    };
    const consentCountBeforeSequential = (await consentItems(testEnv)).length;
    const sequentialConsentFirst = (
      await executeCommand(primary, sequentialConsentEnvelope)
    ).data;
    assert.equal(sequentialConsentFirst.replayed, false);
    assert.equal(sequentialConsentFirst.result.item.order, 5);
    const sequentialConsentReplay = (
      await executeCommand(peer, sequentialConsentEnvelope)
    ).data;
    assert.equal(sequentialConsentReplay.replayed, true);
    assert.deepEqual(
      sequentialConsentReplay.result,
      sequentialConsentFirst.result,
    );
    assert.equal(
      (await consentItems(testEnv)).length,
      consentCountBeforeSequential + 1,
    );
    const sequentialArtifacts = await commandArtifacts(
      testEnv,
      sequentialConsentId,
    );
    assert.equal(sequentialArtifacts.receipts.length, 1);
    assert.equal(sequentialArtifacts.audits.length, 1);

    const concurrentConsentId = randomUUID();
    const concurrentConsentEnvelope = {
      commandId: concurrentConsentId,
      commandType: "addConsentItem",
      payload: {
        title: "교차 기기 동시 동의 항목",
        text: "<p>두 Firebase app context가 같은 명령을 보냅니다.</p>",
        required: false,
      },
    };
    const consentCountBeforeConcurrent = (await consentItems(testEnv)).length;
    const concurrentResults = await Promise.all([
      executeCommand(primary, concurrentConsentEnvelope),
      executeCommand(peer, concurrentConsentEnvelope),
    ]);
    assert.deepEqual(
      concurrentResults.map((item) => item.data.replayed).sort(),
      [false, true],
    );
    assert.deepEqual(
      concurrentResults[0].data.result,
      concurrentResults[1].data.result,
    );
    assert.equal(
      (await consentItems(testEnv)).length,
      consentCountBeforeConcurrent + 1,
    );
    const concurrentArtifacts = await commandArtifacts(
      testEnv,
      concurrentConsentId,
    );
    assert.equal(concurrentArtifacts.receipts.length, 1);
    assert.equal(concurrentArtifacts.audits.length, 1);

    const updateConsentId = randomUUID();
    const updateConsentEnvelope = {
      commandId: updateConsentId,
      commandType: "updateConsentItem",
      payload: {
        itemId: "seed-consent-item",
        title: "Gateway로 수정한 동의 항목",
        text: "<p>수정도 한 번만 반영됩니다.</p>",
        required: false,
        expectedRevision: null,
      },
    };
    const updateConsentResults = await Promise.all([
      executeCommand(primary, updateConsentEnvelope),
      executeCommand(peer, updateConsentEnvelope),
    ]);
    assert.deepEqual(
      updateConsentResults.map((item) => item.data.replayed).sort(),
      [false, true],
    );
    assert.deepEqual(
      updateConsentResults[0].data.result,
      updateConsentResults[1].data.result,
    );
    const updatedConsentResult = updateConsentResults[0].data.result;
    assert.match(updatedConsentResult.revision, /^[a-f0-9]{64}$/);
    const updatedConsentDocument = await withAdminDb(testEnv, (db) =>
      readDocument(
        db,
        "site_settings/consent/items/seed-consent-item",
      ),
    );
    assert.equal(
      updatedConsentDocument.data.revision,
      updatedConsentResult.revision,
    );
    const updateConsentArtifacts = await commandArtifacts(
      testEnv,
      updateConsentId,
    );
    assert.equal(updateConsentArtifacts.receipts.length, 1);
    assert.equal(updateConsentArtifacts.audits.length, 1);
    const updateConsentState = await snapshotCommandState(testEnv);
    await expectReason(
      () =>
        executeCommand(primary, {
          ...updateConsentEnvelope,
          payload: {
            ...updateConsentEnvelope.payload,
            title: "같은 ID의 다른 수정",
          },
        }),
      "COMMAND_ID_CONFLICT",
    );
    assert.deepEqual(await snapshotCommandState(testEnv), updateConsentState);

    const deleteConsentId = randomUUID();
    const deleteConsentEnvelope = {
      commandId: deleteConsentId,
      commandType: "deleteConsentItem",
      payload: {
        itemId: "seed-consent-item",
        expectedRevision: updatedConsentResult.revision,
      },
      _testDropResponseAfterCommit: true,
    };
    await expectReason(
      () => executeCommand(primary, deleteConsentEnvelope),
      "TEST_RESPONSE_LOSS",
    );
    const deleteConsentRecovered = (
      await executeCommand(peer, deleteConsentEnvelope)
    ).data;
    assert.equal(deleteConsentRecovered.replayed, true);
    assert.equal(deleteConsentRecovered.result.itemId, "seed-consent-item");
    assert.equal(
      (
        await withAdminDb(testEnv, (db) =>
          readDocument(
            db,
            "site_settings/consent/items/seed-consent-item",
          ),
        )
      ).exists,
      false,
    );
    const consentTombstone = await withAdminDb(testEnv, (db) =>
      readDocument(
        db,
        "site_settings/consent/deleted_items/seed-consent-item",
      ),
    );
    assert.equal(consentTombstone.exists, true);
    assert.equal(consentTombstone.data.commandId, deleteConsentId);
    const deleteConsentArtifacts = await commandArtifacts(
      testEnv,
      deleteConsentId,
    );
    assert.equal(deleteConsentArtifacts.receipts.length, 1);
    assert.equal(deleteConsentArtifacts.audits.length, 1);

    const responseLossId = randomUUID();
    const responseLossEnvelope = {
      commandId: responseLossId,
      commandType: "addConsentItem",
      payload: {
        title: "응답 유실 복구 동의 항목",
        text: "<p>commit 뒤 응답만 유실됩니다.</p>",
        required: true,
      },
      _testDropResponseAfterCommit: true,
    };
    const consentCountBeforeResponseLoss = (await consentItems(testEnv)).length;
    await expectReason(
      () => executeCommand(primary, responseLossEnvelope),
      "TEST_RESPONSE_LOSS",
    );
    const recovered = (await executeCommand(peer, responseLossEnvelope)).data;
    assert.equal(recovered.replayed, true);
    assert.equal(recovered.status, "SUCCEEDED");
    assert.equal(
      (await consentItems(testEnv)).length,
      consentCountBeforeResponseLoss + 1,
    );
    const responseLossArtifacts = await commandArtifacts(
      testEnv,
      responseLossId,
    );
    assert.equal(responseLossArtifacts.receipts.length, 1);
    assert.equal(responseLossArtifacts.audits.length, 1);

    const statusStateBefore = await snapshotCommandState(testEnv);
    const statusResult = (
      await getCommandStatus(
        primary,
        responseLossId,
        "addConsentItem",
      )
    ).data;
    assert.equal(statusResult.status, "SUCCEEDED");
    assert.equal(statusResult.replayed, true);
    assert.deepEqual(statusResult.result, recovered.result);
    assert.deepEqual(await snapshotCommandState(testEnv), statusStateBefore);

    const ordinaryEventBefore = await withAdminDb(testEnv, (db) =>
      readDocument(db, `${calendarPath}/ordinary-event`),
    );
    const holidayCommandId = randomUUID();
    const holidayEnvelope = {
      commandId: holidayCommandId,
      commandType: "syncKoreanPublicHolidays",
      payload: {
        year,
        semester,
        holidays: [
          {
            title: "추석",
            start: "2026-09-25",
            eventType: "holiday",
            source: "generated",
          },
          {
            title: "개천절",
            start: "2026-10-03",
            eventType: "holiday",
            source: "kasi",
          },
        ],
      },
    };
    const holidayFirst = (await executeCommand(primary, holidayEnvelope)).data;
    assert.equal(holidayFirst.replayed, false);
    assert.equal(holidayFirst.result.count, 2);
    assert.match(holidayFirst.result.sourceHash, /^[a-f0-9]{64}$/);
    const calendarAfterFirst = await withAdminDb(testEnv, (db) =>
      readCollection(db, calendarPath),
    );
    const holidayDocuments = calendarAfterFirst.filter(
      (item) => item.data.eventType === "holiday",
    );
    assert.equal(holidayDocuments.length, 2);
    assert.deepEqual(
      holidayDocuments.map((item) => item.data.title).sort(),
      ["개천절", "추석"].sort(),
    );
    assert.equal(
      calendarAfterFirst.some((item) => item.id === "obsolete-holiday"),
      false,
    );
    assert.deepEqual(
      await withAdminDb(testEnv, (db) =>
        readDocument(db, `${calendarPath}/ordinary-event`),
      ),
      ordinaryEventBefore,
    );
    const holidayArtifacts = await commandArtifacts(testEnv, holidayCommandId);
    assert.equal(holidayArtifacts.receipts.length, 1);
    assert.equal(holidayArtifacts.audits.length, 1);
    assert.equal(
      holidayArtifacts.receipts[0].sourceHash,
      holidayFirst.result.sourceHash,
    );
    assert.equal(
      holidayArtifacts.audits[0].sourceHash,
      holidayFirst.result.sourceHash,
    );

    const holidayReplay = (
      await executeCommand(peer, {
        ...holidayEnvelope,
        payload: {
          ...holidayEnvelope.payload,
          holidays: [...holidayEnvelope.payload.holidays].reverse(),
        },
      })
    ).data;
    assert.equal(holidayReplay.replayed, true);
    assert.deepEqual(holidayReplay.result, holidayFirst.result);
    assert.deepEqual(
      await withAdminDb(testEnv, (db) => readCollection(db, calendarPath)),
      calendarAfterFirst,
    );

    const unregisteredScopeState = await snapshotCommandState(testEnv);
    await expectReason(
      () =>
        executeCommand(primary, {
          commandId: randomUUID(),
          commandType: "syncKoreanPublicHolidays",
          payload: {
            year: "2099",
            semester: "1",
            holidays: [{
              title: "등록되지 않은 학기",
              start: "2099-01-01",
              eventType: "holiday",
              source: "generated",
            }],
          },
        }),
      "HOLIDAY_SCOPE_NOT_ACTIVE",
    );
    assert.deepEqual(await snapshotCommandState(testEnv), unregisteredScopeState);

    const pointCommandId = randomUUID();
    const pointEnvelope = {
      commandId: pointCommandId,
      commandType: "adjustTeacherPoints",
      payload: {
        year,
        semester,
        uid: "point-student",
        delta: 5,
        sourceLabel: "교차 기기 수동 지급",
        policyId: "",
        mode: "grant",
      },
    };
    const pointConcurrentResults = await Promise.all([
      executeCommand(primary, pointEnvelope),
      executeCommand(peer, pointEnvelope),
    ]);
    assert.deepEqual(
      pointConcurrentResults.map((item) => item.data.replayed).sort(),
      [false, true],
    );
    assert.deepEqual(
      pointConcurrentResults[0].data.result,
      pointConcurrentResults[1].data.result,
    );
    assert.equal(pointConcurrentResults[0].data.result.balance, 15);
    const pointArtifacts = await commandArtifacts(testEnv, pointCommandId);
    assert.equal(pointArtifacts.receipts.length, 1);
    assert.equal(pointArtifacts.audits.length, 1);
    assert.equal(pointArtifacts.receipts[0].target.adapterVersion, "legacyPointV1");
    assert.equal(pointArtifacts.receipts[0].actorRole, "admin");
    assert.equal(
      pointArtifacts.receipts[0].actorCapability,
      "command:adjustTeacherPoints",
    );
    const pointStateAfterFirst = await snapshotCommandState(testEnv);
    assert.equal(pointStateAfterFirst.pointWallets[0].data.balance, 15);
    assert.equal(pointStateAfterFirst.pointTransactions.length, 1);
    await expectReason(
      () =>
        executeCommand(primary, {
          ...pointEnvelope,
          payload: { ...pointEnvelope.payload, delta: 7 },
        }),
      "COMMAND_ID_CONFLICT",
    );
    assert.deepEqual(await snapshotCommandState(testEnv), pointStateAfterFirst);

    const pointResponseLossId = randomUUID();
    const pointResponseLossEnvelope = {
      commandId: pointResponseLossId,
      commandType: "adjustTeacherPoints",
      payload: {
        ...pointEnvelope.payload,
        delta: 3,
        sourceLabel: "응답 유실 복구 지급",
      },
      _testDropResponseAfterCommit: true,
    };
    await expectReason(
      () => executeCommand(primary, pointResponseLossEnvelope),
      "TEST_RESPONSE_LOSS",
    );
    const pointRecovered = (
      await executeCommand(peer, pointResponseLossEnvelope)
    ).data;
    assert.equal(pointRecovered.replayed, true);
    assert.equal(pointRecovered.result.balance, 18);
    const pointStateAfterRecovery = await snapshotCommandState(testEnv);
    assert.equal(pointStateAfterRecovery.pointWallets[0].data.balance, 18);
    assert.equal(pointStateAfterRecovery.pointTransactions.length, 2);
    const pointResponseLossArtifacts = await commandArtifacts(
      testEnv,
      pointResponseLossId,
    );
    assert.equal(pointResponseLossArtifacts.receipts.length, 1);
    assert.equal(pointResponseLossArtifacts.audits.length, 1);

    const legacyCallableState = await snapshotCommandState(testEnv);
    await expectReason(
      () =>
        httpsCallable(primary.functions, "adjustTeacherPoints")({
          year,
          semester,
          uid: "point-student",
          delta: 99,
          sourceLabel: "구형 클라이언트",
          _session: primary.proof,
        }),
      "CLIENT_UPDATE_REQUIRED",
    );
    assert.deepEqual(await snapshotCommandState(testEnv), legacyCallableState);

    const unauthorizedPointState = await snapshotCommandState(testEnv);
    await expectReason(
      () =>
        executeCommand(negative, {
          ...pointEnvelope,
          commandId: randomUUID(),
        }),
      "COMMAND_CAPABILITY_REQUIRED",
    );
    assert.deepEqual(
      await snapshotCommandState(testEnv),
      unauthorizedPointState,
    );

    const unauthorizedStateBefore = await snapshotCommandState(testEnv);
    await expectReason(
      () =>
        executeCommand(negative, {
          commandId: randomUUID(),
          commandType: "updateTermsSettings",
          payload: { text: "권한 없는 쓰기" },
        }),
      "COMMAND_ADMIN_REQUIRED",
    );
    assert.deepEqual(
      await snapshotCommandState(testEnv),
      unauthorizedStateBefore,
    );

    const tokenResult = await getIdTokenResult(primary.user);
    const tokenAuthTime = Math.floor(Date.parse(tokenResult.authTime) / 1000);
    assert.equal(tokenAuthTime, primary.authTime);
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
    const expiredStateBefore = await snapshotCommandState(testEnv);
    await expectReason(
      () =>
        executeCommand(primary, {
          commandId: randomUUID(),
          commandType: "updateTermsSettings",
          payload: { text: "만료 세션 쓰기" },
        }),
      "SESSION_EXPIRED",
    );
    assert.deepEqual(await snapshotCommandState(testEnv), expiredStateBefore);

    console.log(
      JSON.stringify({
        suite: "w2a-command-gateway-emulator-integration",
        passed: true,
        cases: [
          "TERMS_FIRST_SUCCESS",
          "TERMS_SEQUENTIAL_REPLAY",
          "TERMS_COMMAND_ID_CASE_CANONICAL_REPLAY",
          "TERMS_COMMAND_ID_CONFLICT_ZERO_WRITE",
          "CONSENT_SEQUENTIAL_DUPLICATE_ITEM_AND_RECEIPT_ONCE",
          "CONSENT_CROSS_CONTEXT_CONCURRENT_EFFECT_ONCE",
          "CONSENT_UPDATE_CROSS_CONTEXT_EFFECT_ONCE_AND_CONFLICT_ZERO_WRITE",
          "CONSENT_DELETE_RESPONSE_LOSS_TOMBSTONE_RECOVERY",
          "DEMO_POST_COMMIT_RESPONSE_LOSS_REPLAY",
          "GET_COMMAND_STATUS_QUERY_ONLY",
          "UNAUTHORIZED_PRE_BUSINESS_ZERO_WRITE",
          "EXPIRED_SESSION_PRE_BUSINESS_ZERO_WRITE",
          "HOLIDAY_EXPLICIT_SYNC_REPLAY",
          "HOLIDAY_ORDINARY_EVENT_PRESERVED",
          "HOLIDAY_UNREGISTERED_SCOPE_REJECTED",
          "POINT_ADJUST_CROSS_CONTEXT_EFFECT_ONCE_AND_CONFLICT_ZERO_WRITE",
          "POINT_ADJUST_RESPONSE_LOSS_RECOVERY",
          "POINT_ADJUST_UNAUTHORIZED_PRE_BUSINESS_ZERO_WRITE",
          "LEGACY_POINT_CALLABLE_RETIRED_ZERO_WRITE",
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
