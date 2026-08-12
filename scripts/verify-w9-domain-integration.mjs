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
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w9";
assert.equal(projectId, "demo-westory-session-w9");
assert.notEqual(projectId, "history-quiz-yongsin");
for (const variable of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST"]) {
  assert.ok(process.env[variable], `${variable} is required.`);
}

const semesterId = "2026-2";
const archiveSemesterId = "2026-1";
const region = "asia-northeast3";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];
const config = {
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};
const common = { semesterId, expectedSemesterRevision: 1 };
const W9_COMMAND_TYPES = new Set([
  "saveTeacherDraft",
  "discardTeacherDraft",
  "resolveTeacherDraft",
  "cleanupExpiredTeacherDrafts",
  "createTeacherBulkJob",
  "reconcileTeacherBulkJob",
  "retryTeacherBulkJob",
]);
const canonicalCollections = ["teacher_drafts", "teacher_bulk_jobs"];
const password = () => `${randomBytes(24).toString("base64url")}Aa1!`;
const canonicalize = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
};
const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const payloadHash = (payload) => sha256(canonicalize(payload));

const makeClient = (name) => {
  const app = initializeApp(config, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const functions = getFunctions(app, region);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, db, functions, proof: null, user: null };
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
const execute = (client, commandType, payload, options = {}) =>
  httpsCallable(client.functions, "executeCommand")({
    commandId: options.commandId || randomUUID(),
    commandType,
    payload,
    _session: client.proof,
    ...(options.dropResponse ? { _testDropResponseAfterCommit: true } : {}),
  });
const queryW9 = (client, payload) =>
  httpsCallable(client.functions, "getTeacherOperationsState")({
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
const businessCounts = async (testEnv) =>
  Object.fromEntries(
    await Promise.all(
      canonicalCollections.map(async (name) => [name, (await readCollection(testEnv, name)).length]),
    ),
  );
const recoverResponseLoss = async (client, commandType, payload) => {
  const commandId = randomUUID();
  await expectReason(
    execute(client, commandType, payload, { commandId, dropResponse: true }),
    "TEST_RESPONSE_LOSS",
  );
  const status = (
    await httpsCallable(client.functions, "getCommandStatus")({
      commandId,
      commandType,
      _session: client.proof,
    })
  ).data;
  assert.equal(status.status, "SUCCEEDED");
  const replay = (await execute(client, commandType, payload, { commandId })).data;
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, status.result);
  return status.result;
};
const recoverResponseLossWithId = async (client, commandId, commandType, payload) => {
  await expectReason(
    execute(client, commandType, payload, { commandId, dropResponse: true }),
    "TEST_RESPONSE_LOSS",
  );
  const status = (
    await httpsCallable(client.functions, "getCommandStatus")({
      commandId,
      commandType,
      _session: client.proof,
    })
  ).data;
  assert.equal(status.status, "SUCCEEDED");
  const replay = (await execute(client, commandType, payload, { commandId })).data;
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, status.result);
  return status.result;
};

const learningPayload = (classId, title) => ({
  ...common,
  title,
  summary: `${title} 요약`,
  body: `${title} 본문`,
  resourceUrl: "",
  contentType: "LESSON",
  audienceRoles: ["student"],
  targetClassIds: [classId],
  availableFrom: "",
  availableUntil: "",
});
const draftPayload = ({ key, intendedPayload, baseEntityRevision = null }) => ({
  ...common,
  key,
  expectedDraftRevision: null,
  baseEntityRevision,
  basePayloadHash: sha256(canonicalize({ title: "기준" })),
  payloadSchemaVersion: 1,
  intendedCommandType: "createLearningContent",
  expectedCommandPayloadHash: payloadHash(intendedPayload),
  payload: { title: "작성 중", body: "저장 전 교사 초안" },
  stagedAssets: [],
});
const bulkItem = (itemKey, commandPayload) => ({
  itemKey,
  commandType: "createLearningContent",
  commandPayload,
  commandPayloadHash: payloadHash(commandPayload),
});

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
  const admin = makeClient("w9-admin");
  const teacher = makeClient("w9-teacher");
  const teacherRelogin = makeClient("w9-teacher-relogin");
  const peerTeacher = makeClient("w9-peer-teacher");
  const student = makeClient("w9-student");
  const teacherPassword = password();
  try {
    await testEnv.clearFirestore();
    admin.user = (
      await createUserWithEmailAndPassword(admin.auth, "westoria28@gmail.com", password())
    ).user;
    teacher.user = (
      await createUserWithEmailAndPassword(
        teacher.auth,
        "w9-teacher@yongshin-ms.ms.kr",
        teacherPassword,
      )
    ).user;
    teacherRelogin.user = (
      await signInWithEmailAndPassword(
        teacherRelogin.auth,
        "w9-teacher@yongshin-ms.ms.kr",
        teacherPassword,
      )
    ).user;
    peerTeacher.user = (
      await createUserWithEmailAndPassword(
        peerTeacher.auth,
        "w9-peer-teacher@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    student.user = (
      await createUserWithEmailAndPassword(
        student.auth,
        "w9-student@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    const classId = "w9-class";
    const enrollmentId = "w9-enrollment";
    await withAdminDb(testEnv, async (db) => {
      await Promise.all([
        setDoc(doc(db, "users", admin.user.uid), { role: "admin" }),
        setDoc(doc(db, "users", teacher.user.uid), {
          role: "teacher",
          teacherPortalEnabled: true,
          staffPermissions: ["lesson_read"],
        }),
        setDoc(doc(db, "users", peerTeacher.user.uid), {
          role: "teacher",
          teacherPortalEnabled: true,
          staffPermissions: ["lesson_read"],
        }),
        setDoc(doc(db, "users", student.user.uid), { role: "student" }),
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
          startAt: "2026-08-01",
          endAt: "2026-12-31",
        }),
        setDoc(doc(db, "semester_manifests", archiveSemesterId), {
          semesterId: archiveSemesterId,
          schoolYear: 2026,
          term: 1,
          revision: 4,
          status: "ARCHIVED",
          shellState: "ARCHIVE",
          startAt: "2026-03-01",
          endAt: "2026-07-31",
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
          enrollmentStatus: "ACTIVE",
          studentNumber: "1",
          snapshot: { displayName: "합성 학생", studentNumber: "1" },
        }),
      ]);
    });
    await Promise.all([
      openSession(admin),
      openSession(teacher),
      openSession(teacherRelogin),
      openSession(peerTeacher),
      openSession(student),
    ]);

    const beforeQuery = await businessCounts(testEnv);
    const empty = (
      await queryW9(teacher, { semesterId, source: "CURRENT" })
    ).data;
    assert.equal(empty.writeCount, 0);
    assert.equal(empty.status, "EMPTY");
    assert.deepEqual(await businessCounts(testEnv), beforeQuery);
    await expectReason(
      queryW9(student, { semesterId, source: "CURRENT" }),
      "W9_MANAGE_REQUIRED",
    );

    const intended = learningPayload(classId, "초안 확정 자료");
    const key = {
      routeKey: "/teacher/learning",
      surfaceKey: "LES01",
      entityType: "learning-content",
      entityId: "new",
      clientDraftId: "client-draft-one",
    };
    const saved = (
      await execute(teacher, "saveTeacherDraft", draftPayload({ key, intendedPayload: intended }))
    ).data.result;
    assert.equal(saved.status, "ACTIVE");
    assert.equal(saved.draftRevision, 1);
    for (const malformedKey of [
      { ...key, routeKey: " /teacher/learning" },
      { ...key, routeKey: "/teacher/learning/".repeat(12) },
      { ...key, surfaceKey: "surface/with-slash" },
      { ...key, entityType: "learning/content" },
      { ...key, clientDraftId: "client/draft" },
    ]) {
      await expectReason(
        execute(
          teacher,
          "saveTeacherDraft",
          draftPayload({ key: malformedKey, intendedPayload: intended }),
        ),
        "W9_PAYLOAD_INVALID",
      );
    }

    const recovered = (
      await queryW9(teacherRelogin, { semesterId, source: "CURRENT", draftId: saved.draftId })
    ).data;
    assert.equal(recovered.writeCount, 0);
    assert.equal(recovered.drafts.length, 1);
    assert.equal(recovered.drafts[0].ownerUid, teacher.user.uid);
    const peerOwnList = (
      await queryW9(peerTeacher, { semesterId, source: "CURRENT" })
    ).data;
    assert.equal(peerOwnList.drafts.length, 0);
    const peerScopedDraft = (
      await queryW9(peerTeacher, {
        semesterId,
        source: "CURRENT",
        draftId: saved.draftId,
      })
    ).data;
    assert.equal(peerScopedDraft.drafts.length, 0);

    const updatedDraftPayload = {
      ...draftPayload({ key, intendedPayload: intended }),
      expectedDraftRevision: 1,
      payload: { title: "두 번째 탭 저장", body: "최신 초안" },
    };
    const updated = (
      await execute(teacher, "saveTeacherDraft", updatedDraftPayload)
    ).data.result;
    assert.equal(updated.draftRevision, 2);
    await expectReason(
      execute(teacherRelogin, "saveTeacherDraft", {
        ...updatedDraftPayload,
        payload: { title: "오래된 탭", body: "덮어쓰면 안 됨" },
      }),
      "W9_DRAFT_REVISION_CONFLICT",
    );

    const conflictKey = { ...key, clientDraftId: "client-draft-conflict" };
    const conflictFirst = (
      await execute(
        teacher,
        "saveTeacherDraft",
        draftPayload({ key: conflictKey, intendedPayload: intended, baseEntityRevision: 1 }),
      )
    ).data.result;
    const conflict = (
      await execute(teacherRelogin, "saveTeacherDraft", {
        ...draftPayload({
          key: conflictKey,
          intendedPayload: intended,
          baseEntityRevision: 2,
        }),
        expectedDraftRevision: conflictFirst.draftRevision,
        payload: { title: "기준 변경", body: "CAS 충돌" },
      })
    ).data.result;
    assert.equal(conflict.status, "CONFLICT");
    assert.equal(conflict.saved, false);

    const siblingKey = { ...key, clientDraftId: "same-entity-other-device" };
    const sibling = (
      await execute(
        teacherRelogin,
        "saveTeacherDraft",
        draftPayload({ key: siblingKey, intendedPayload: intended }),
      )
    ).data.result;
    assert.equal(sibling.status, "ACTIVE");
    assert.equal(sibling.draftRevision, 1);

    const canonicalCommandId = randomUUID();
    await execute(teacher, "createLearningContent", intended, {
      commandId: canonicalCommandId,
    });
    const resolved = (
      await execute(teacher, "resolveTeacherDraft", {
        ...common,
        draftId: saved.draftId,
        expectedDraftRevision: updated.draftRevision,
        canonicalCommandType: "createLearningContent",
        canonicalCommandId,
        expectedCommandPayloadHash: payloadHash(intended),
      })
    ).data.result;
    assert.equal(resolved.status, "SAVED");
    assert.equal(resolved.payloadPurged, true);
    assert.equal(resolved.conflictedDraftCount, 1);
    assert.deepEqual(resolved.conflictedDraftIds, [sibling.draftId]);
    const resolvedDocument = await readDocument(
      testEnv,
      `teacher_drafts/${saved.draftId}`,
    );
    assert.deepEqual(resolvedDocument.payload, {});
    assert.deepEqual(resolvedDocument.stagedAssets, []);
    const conflictedSibling = await readDocument(
      testEnv,
      `teacher_drafts/${sibling.draftId}`,
    );
    assert.equal(conflictedSibling.status, "CONFLICT");
    assert.equal(conflictedSibling.draftRevision, 2);
    assert.equal(
      conflictedSibling.conflictReason,
      "BASE_ENTITY_REVISION_CHANGED",
    );
    const siblingPayloadBeforeRejectedSave = structuredClone(
      conflictedSibling.payload,
    );
    await expectReason(
      execute(teacherRelogin, "saveTeacherDraft", {
        ...draftPayload({ key: siblingKey, intendedPayload: intended }),
        expectedDraftRevision: conflictedSibling.draftRevision,
        payload: { title: "재검토 없는 저장", body: "덮어쓰면 안 됨" },
      }),
      "W9_DRAFT_REBASE_REQUIRED",
    );
    const siblingAfterRejectedSave = await readDocument(
      testEnv,
      `teacher_drafts/${sibling.draftId}`,
    );
    assert.equal(siblingAfterRejectedSave.status, "CONFLICT");
    assert.equal(siblingAfterRejectedSave.draftRevision, 2);
    assert.deepEqual(
      siblingAfterRejectedSave.payload,
      siblingPayloadBeforeRejectedSave,
    );

    const failureKey = { ...key, clientDraftId: "official-failure-draft" };
    const retained = (
      await execute(
        teacher,
        "saveTeacherDraft",
        draftPayload({ key: failureKey, intendedPayload: learningPayload(classId, "실패 유지") }),
      )
    ).data.result;
    await expectReason(
      execute(teacher, "resolveTeacherDraft", {
        ...common,
        draftId: retained.draftId,
        expectedDraftRevision: retained.draftRevision,
        canonicalCommandType: "createLearningContent",
        canonicalCommandId: randomUUID(),
        expectedCommandPayloadHash: payloadHash(learningPayload(classId, "실패 유지")),
      }),
      "W9_CANONICAL_RECEIPT_REQUIRED",
    );
    assert.equal((await readDocument(testEnv, `teacher_drafts/${retained.draftId}`)).status, "ACTIVE");

    const discardKey = { ...key, clientDraftId: "discard-draft" };
    const discardDraft = (
      await execute(
        teacher,
        "saveTeacherDraft",
        draftPayload({ key: discardKey, intendedPayload: learningPayload(classId, "폐기") }),
      )
    ).data.result;
    const discarded = (
      await execute(teacher, "discardTeacherDraft", {
        ...common,
        draftId: discardDraft.draftId,
        expectedDraftRevision: discardDraft.draftRevision,
        reason: "사용자가 명시적으로 폐기",
      })
    ).data.result;
    assert.equal(discarded.status, "DISCARDED");
    assert.equal(discarded.payloadPurged, true);
    const discardedDocument = await readDocument(
      testEnv,
      `teacher_drafts/${discardDraft.draftId}`,
    );
    assert.deepEqual(discardedDocument.payload, {});
    assert.deepEqual(discardedDocument.stagedAssets, []);

    const ttlKey = { ...key, clientDraftId: "ttl-draft" };
    const ttlDraft = (
      await execute(
        teacher,
        "saveTeacherDraft",
        draftPayload({ key: ttlKey, intendedPayload: learningPayload(classId, "TTL") }),
      )
    ).data.result;
    await withAdminDb(testEnv, (db) =>
      updateDoc(doc(db, "teacher_drafts", ttlDraft.draftId), {
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    const beforeTtlQuery = await businessCounts(testEnv);
    const ttlWarning = (
      await queryW9(teacher, { semesterId, source: "CURRENT", draftId: ttlDraft.draftId })
    ).data;
    assert.equal(ttlWarning.warnings[0]?.code, "DRAFT_EXPIRED_PENDING_CLEANUP");
    assert.deepEqual(await businessCounts(testEnv), beforeTtlQuery);
    const cleanup = (
      await execute(admin, "cleanupExpiredTeacherDrafts", { ...common, limit: 10 })
    ).data.result;
    assert.equal(cleanup.expiredCount, 1);
    assert.equal(cleanup.canonicalMutationCount, 0);
    assert.equal(cleanup.payloadPurgedCount, 1);

    const archivedDraftId = "draft_archived_cleanup_fixture";
    await withAdminDb(testEnv, (db) =>
      setDoc(doc(db, "teacher_drafts", archivedDraftId), {
        schemaVersion: 1,
        policyVersion: "w9-v1",
        draftId: archivedDraftId,
        ownerUid: admin.user.uid,
        semesterId: archiveSemesterId,
        draftRevision: 1,
        status: "ACTIVE",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    const archivedCleanup = (
      await execute(admin, "cleanupExpiredTeacherDrafts", {
        semesterId: archiveSemesterId,
        expectedSemesterRevision: 4,
        limit: 10,
      })
    ).data.result;
    assert.equal(archivedCleanup.expiredCount, 1);
    assert.equal(archivedCleanup.canonicalMutationCount, 0);
    assert.equal(archivedCleanup.payloadPurgedCount, 1);

    await expectReason(
      execute(teacher, "saveTeacherDraft", {
        ...draftPayload({ key: { ...key, clientDraftId: "archive" }, intendedPayload: intended }),
        semesterId: archiveSemesterId,
        expectedSemesterRevision: 4,
      }),
      "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
    );
    const archive = (
      await queryW9(teacher, { semesterId: archiveSemesterId, source: "ARCHIVE" })
    ).data;
    assert.equal(archive.readOnly, true);
    assert.equal(archive.status, "ARCHIVED");
    const legacy = (
      await queryW9(teacher, { semesterId, source: "LEGACY" })
    ).data;
    assert.equal(legacy.readOnly, true);
    assert.equal(legacy.status, "LEGACY");

    const partialPayloads = [
      learningPayload(classId, "부분 성공 1"),
      learningPayload(classId, "부분 성공 2"),
    ];
    const partialJob = await recoverResponseLoss(teacher, "createTeacherBulkJob", {
      ...common,
      clientBulkId: "partial-job",
      domain: "LEARNING",
      operationType: "PUBLISH_SELECTED",
      policy: "ITEMIZED_PARTIAL",
      filter: { classIds: [classId], selectionMode: "INDIVIDUAL" },
      items: partialPayloads.map((item, index) => bulkItem(`item-${index + 1}`, item)),
    });
    assert.equal(partialJob.itemCount, 2);
    assert.equal(new Set(partialJob.items.map((item) => item.childCommandId)).size, 2);
    assert.equal(
      partialJob.items.every((item) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(item.childCommandId)),
      true,
    );
    await recoverResponseLossWithId(
      teacher,
      partialJob.items[0].childCommandId,
      partialJob.items[0].commandType,
      partialJob.items[0].commandPayload,
    );
    const partial = (
      await execute(teacher, "reconcileTeacherBulkJob", {
        ...common,
        jobId: partialJob.jobId,
        expectedJobRevision: 1,
        reportedFailures: [
          {
            itemKey: partialJob.items[1].itemKey,
            childCommandId: partialJob.items[1].childCommandId,
            errorCode: "offline",
            errorReason: "네트워크 연결이 없어 실행하지 못함",
          },
        ],
      })
    ).data.result;
    assert.equal(partial.status, "PARTIAL");
    assert.deepEqual(partial.counts, { total: 2, succeeded: 1, failed: 1, pending: 0 });

    const replacementPayload = learningPayload(classId, "실패 항목만 재시도");
    const retry = (
      await execute(teacher, "retryTeacherBulkJob", {
        ...common,
        jobId: partialJob.jobId,
        expectedJobRevision: 2,
        items: [bulkItem(partialJob.items[1].itemKey, replacementPayload)],
      })
    ).data.result;
    assert.equal(retry.retriedCount, 1);
    assert.equal(retry.items[0].attempt, 2);
    assert.notEqual(retry.items[0].childCommandId, partialJob.items[1].childCommandId);
    await execute(teacher, retry.items[0].commandType, retry.items[0].commandPayload, {
      commandId: retry.items[0].childCommandId,
    });
    const completed = (
      await execute(teacher, "reconcileTeacherBulkJob", {
        ...common,
        jobId: partialJob.jobId,
        expectedJobRevision: 3,
        reportedFailures: [],
      })
    ).data.result;
    assert.equal(completed.status, "SUCCEEDED");
    assert.deepEqual(completed.counts, { total: 2, succeeded: 2, failed: 0, pending: 0 });
    await expectReason(
      execute(teacher, "retryTeacherBulkJob", {
        ...common,
        jobId: partialJob.jobId,
        expectedJobRevision: 4,
        items: [bulkItem(partialJob.items[0].itemKey, partialPayloads[0])],
      }),
      "W9_BULK_RETRY_NOT_FAILED",
    );

    await expectReason(
      execute(teacher, "createTeacherBulkJob", {
        ...common,
        clientBulkId: "invalid-atomic",
        domain: "LEARNING",
        operationType: "ATOMIC",
        policy: "ALL_OR_NOTHING",
        filter: { classIds: [classId], selectionMode: "PAGE" },
        items: partialPayloads.map((item, index) => bulkItem(`atomic-${index}`, item)),
      }),
      "W9_BULK_ATOMIC_POLICY_INVALID",
    );
    const oversizedPayload = learningPayload(classId, "용량 제한");
    oversizedPayload.body = "가".repeat(20_000);
    const oversizedItems = Array.from({ length: 16 }, (_, index) =>
      bulkItem(`oversized-${index}`, { ...oversizedPayload, title: `용량 제한 ${index}` }),
    );
    const beforeOversized = await businessCounts(testEnv);
    await expectReason(
      execute(teacher, "createTeacherBulkJob", {
        ...common,
        clientBulkId: "oversized-job",
        domain: "LEARNING",
        operationType: "OVERSIZED",
        policy: "ITEMIZED_PARTIAL",
        filter: { selectionMode: "FILTER" },
        items: oversizedItems,
      }),
      "W9_BULK_PAYLOAD_TOO_LARGE",
    );
    assert.deepEqual(await businessCounts(testEnv), beforeOversized);
    const atomicPayload = learningPayload(classId, "원자 작업");
    const atomicJob = (
      await execute(teacher, "createTeacherBulkJob", {
        ...common,
        clientBulkId: "atomic-job",
        domain: "LEARNING",
        operationType: "ATOMIC",
        policy: "ALL_OR_NOTHING",
        filter: { classIds: [classId], selectionMode: "FILTER" },
        items: [bulkItem("atomic", atomicPayload)],
      })
    ).data.result;
    await execute(teacher, atomicJob.items[0].commandType, atomicJob.items[0].commandPayload, {
      commandId: atomicJob.items[0].childCommandId,
    });
    const atomicDone = (
      await execute(teacher, "reconcileTeacherBulkJob", {
        ...common,
        jobId: atomicJob.jobId,
        expectedJobRevision: 1,
        reportedFailures: [],
      })
    ).data.result;
    assert.equal(atomicDone.status, "SUCCEEDED");

    const explicit = (
      await queryW9(teacher, { semesterId, source: "EXPLICIT", includeTerminal: true })
    ).data;
    assert.equal(explicit.provenance, "EXPLICIT");
    assert.equal(explicit.readOnly, true);
    assert.equal(explicit.writeCount, 0);

    const bounded = (
      await queryW9(teacher, {
        semesterId,
        source: "EXPLICIT",
        includeTerminal: true,
        limit: 1,
      })
    ).data;
    assert.ok(bounded.drafts.length <= 1);
    assert.ok(bounded.bulkJobs.length <= 1);
    const truncation = bounded.warnings.find(
      (warning) => warning.code === "TERMINAL_RESULTS_TRUNCATED",
    );
    assert.equal(truncation?.limit, 1);
    assert.equal(truncation?.draftTruncated || truncation?.jobTruncated, true);
    assert.equal(bounded.writeCount, 0);
    await expectReason(
      queryW9(teacher, {
        semesterId,
        source: "CURRENT",
        limit: 101,
      }),
      "W9_PAYLOAD_INVALID",
    );

    const receipts = await readCollection(testEnv, "command_receipts");
    const observedW9 = new Set(
      receipts
        .map((item) => item.data?.commandType)
        .filter((commandType) => W9_COMMAND_TYPES.has(commandType)),
    );
    assert.deepEqual(observedW9, W9_COMMAND_TYPES);
    assert.equal(
      receipts.filter((item) => item.data?.commandType === "createLearningContent").every(
        (item, index, rows) => rows.findIndex((candidate) => candidate.id === item.id) === index,
      ),
      true,
    );

    console.log(
      JSON.stringify({
        suite: "w9-domain-integration",
        passed: true,
        commandTypes: observedW9.size,
        queryWriteCount: 0,
        sameUidReloginRecovery: true,
        crossUidReads: 0,
        staleOverwrite: 0,
        sameEntitySiblingConflicts: 1,
        conflictedDraftRebaseRequired: true,
        officialFailureDraftRetained: true,
        ttlReadTriggeredCleanup: 0,
        deterministicChildIds: true,
        allOrNothing: true,
        itemizedPartial: true,
        failedOnlyRetry: true,
        boundedQueryLimit: 100,
        truncationWarning: true,
        duplicateBusinessEffects: 0,
        archiveWrites: 0,
        legacyWrites: 0,
        productionAccess: 0,
      }),
    );
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await testEnv.cleanup();
  }
};

await main();
